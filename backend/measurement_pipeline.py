"""
measurement_pipeline.py
=======================
NEW MODULE. The orchestrator that runs the target pipeline end to end:

    frame -> undistort -> segment -> validate -> anatomy -> scale
          -> (4 views) -> fuse -> circumference -> confidence -> release

It is the single place the stages are wired together, so app.py stays a
web/state-machine layer and the measurement logic is testable offline
(see validation.py, which drives this module over stored image sets
without a camera).

USAGE
-----
    engine = MeasurementEngine(user_height_cm=175)
    v = engine.process_view("front", frame_bgr)          # per view
    ...
    result = engine.finalize()                           # after all 4
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from camera_calibration import CameraProfile, load_profile_for_capture
from body_segmentation import build_silhouette, assess_clothing, SegmentationError, Silhouette
from capture_validation import validate_capture, CaptureCheck
from anatomy import (analyse_frontal_view, analyse_profile_view, AnatomyError,
                     LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)
from scale_reference import resolve_scale, ScaleError, ScaleEstimate
from multiview import BodyModel, ViewBundle
from measurement_confidence import (ConfidenceFactors, calibration_factor,
                                    scale_factor, segmentation_factor,
                                    decide_release)
from calibration_profile import load_measurement_calibration

VIEWS = ("front", "left", "right", "back")
FRONTAL_VIEWS = ("front", "back")
PROFILE_VIEWS = ("left", "right")


class PipelineError(Exception):
    pass


@dataclass
class ViewResult:
    view: str
    ok: bool
    message: str = ""
    check: Optional[CaptureCheck] = None
    scale: Optional[ScaleEstimate] = None
    silhouette: Optional[Silhouette] = None
    anatomy: object = None
    confidence: Optional[ConfidenceFactors] = None
    clothing_multiplier: float = 1.0
    warnings: List[str] = field(default_factory=list)
    undistorted: Optional[np.ndarray] = None

    def as_dict(self) -> dict:
        d = {"view": self.view, "ok": self.ok, "message": self.message,
             "warnings": list(self.warnings)}
        if self.check:
            d["capture_check"] = self.check.as_dict()
        if self.scale:
            d["scale"] = self.scale.summary()
        if self.silhouette:
            d["segmentation"] = self.silhouette.summary()
        if self.confidence:
            d["confidence_factors"] = self.confidence.as_dict()
            d["view_confidence"] = round(self.confidence.combined(), 3)
        return d


class MeasurementEngine:
    """Stateful engine that accumulates the four views then fuses them.

    `mirrored` must reflect whether the incoming frames have been
    horizontally flipped (app.py mirrors the webcam feed for a natural
    preview). It matters because the front/back discrimination in
    capture_validation reads the left/right shoulder ordering in x.
    """

    def __init__(self, user_height_cm: Optional[float] = None,
                 device_model: Optional[str] = None,
                 profile_path: Optional[str] = None,
                 marker_side_cm: Optional[float] = None,
                 require_marker: bool = False,
                 mirrored: bool = True,
                 strict: bool = True):
        self.user_height_cm = user_height_cm
        # Which physical camera/device the candidate said they're using this
        # session (e.g. "MacBook Air M3", "iPhone 16 Plus") -- looked up by
        # exact name in camera_profile.json. Never falls back to a different
        # device's numbers; an unrecognised name just means uncalibrated mode.
        self.device_model = device_model
        self.profile_path = profile_path
        self.require_marker = require_marker
        self.mirrored = mirrored
        self.strict = strict
        self.calibration = load_measurement_calibration()
        self.marker_side_cm = (marker_side_cm
                               or self.calibration.get("marker_side_cm")
                               or 20.0)
        self._camera_profile: Optional[CameraProfile] = None
        self._camera_warnings: List[str] = []
        self._profile_loaded_for = None
        self.views: Dict[str, ViewResult] = {}
        self.level_ts: Dict[str, float] = {}

    # -- camera ----------------------------------------------------------
    def camera_profile(self, w: int, h: int):
        if self._profile_loaded_for != (w, h):
            kwargs = {"path": self.profile_path} if self.profile_path else {}
            self._camera_profile, self._camera_warnings = load_profile_for_capture(
                w, h, device_model=self.device_model, **kwargs)
            self._profile_loaded_for = (w, h)
        return self._camera_profile, self._camera_warnings

    def calibration_status(self) -> dict:
        prof = self._camera_profile
        return {
            "device_model": self.device_model,
            "calibrated": prof is not None,
            "warnings": list(self._camera_warnings),
            "profile": prof.summary() if prof else None,
            "measurement_calibration": {
                "shape_exponents": self.calibration.get("shape_exponents"),
                "bias_corrections_n": len(self.calibration.get("bias_corrections", {})),
            },
        }

    # -- per-view --------------------------------------------------------
    def process_view(self, view: str, frame_bgr: np.ndarray,
                     pose_landmarks, pose_world_landmarks,
                     pose_segmentation_mask) -> ViewResult:
        """Run one captured view through undistort -> segment -> validate ->
        anatomy -> scale. Returns a ViewResult; `ok=False` means the frame
        was rejected and NO measurement was derived from it."""
        if view not in VIEWS:
            raise PipelineError(f"Unknown view {view!r}")
        res = ViewResult(view=view, ok=False)
        h, w = frame_bgr.shape[:2]

        profile, cam_warnings = self.camera_profile(w, h)
        res.warnings.extend(cam_warnings)

        # NOTE: undistortion is applied to the frame kept for the record,
        # but the pose landmarks handed in were computed on the ORIGINAL
        # frame. Landmarks are only used to bracket search regions and to
        # measure angles, both of which tolerate sub-percent distortion
        # shift; the measurements themselves come from the silhouette,
        # which IS computed on the undistorted frame below.
        if profile is not None:
            frame_u, _ = profile.undistort(frame_bgr)
        else:
            frame_u = frame_bgr
        res.undistorted = frame_u

        try:
            sil = build_silhouette(frame_u, pose_segmentation_mask)
        except SegmentationError as exc:
            res.message = str(exc)
            return res
        res.silhouette = sil

        check = validate_capture(view, pose_landmarks, pose_world_landmarks,
                                 sil, frame_u, mirrored=self.mirrored,
                                 strict=self.strict)
        res.check = check
        res.warnings.extend(check.warnings)
        if not check.ok:
            res.message = check.first_message()
            return res

        # --- scale ---
        try:
            scale = resolve_scale(
                frame_u,
                vertex_y=sil.vertex_y, floor_y=sil.bottom_y,
                user_height_cm=self.user_height_cm,
                silhouette_touches_border=sil.touches_border,
                profile=profile,
                marker_side_cm=self.marker_side_cm,
                require_marker=self.require_marker)
        except ScaleError as exc:
            res.message = str(exc)
            return res
        res.scale = scale
        res.warnings.extend(scale.warnings)

        # --- anatomy ---
        try:
            if view in FRONTAL_VIEWS:
                ana = analyse_frontal_view(sil, pose_landmarks, view=view)
                # Record the level positions so the profile views can be
                # sampled at exactly the same anatomical heights.
                self._merge_level_ts(view, ana)
            else:
                if not self.level_ts:
                    res.message = ("Capture the front view first - the side "
                                   "views measure depth at levels found there.")
                    return res
                ana = analyse_profile_view(sil, pose_landmarks, view, self.level_ts)
        except AnatomyError as exc:
            res.message = str(exc)
            return res
        res.anatomy = ana
        res.warnings.extend(ana.warnings)

        # --- clothing ---
        if view in FRONTAL_VIEWS and "axilla" in ana.levels:
            lm = pose_landmarks.landmark
            hip_y = (lm[LEFT_HIP].y + lm[RIGHT_HIP].y) / 2 * h
            torso_bottom = ana.levels["crotch"].y if "crotch" in ana.levels else hip_y + 0.08 * sil.stature_span_px
            cloth = assess_clothing(sil, ana.levels["axilla"].y, torso_bottom, hip_y)
            res.clothing_multiplier = cloth.confidence_multiplier
            res.warnings.extend(cloth.notes)

        res.confidence = ConfidenceFactors(
            calibration=calibration_factor(profile, cam_warnings),
            scale=scale_factor(scale),
            pose=max(check.pose_quality, 0.05),
            segmentation=segmentation_factor(sil),
            clothing=res.clothing_multiplier,
            view_consistency=1.0,
            landmarks=float(np.clip(check.metrics.get("min_landmark_visibility", 0.8), 0.1, 1.0)),
        )
        res.ok = True
        res.message = f"{view.capitalize()} view captured."
        self.views[view] = res
        return res

    def _merge_level_ts(self, view: str, ana) -> None:
        """Keep one stature-normalised position per anatomical level.

        Front and back both see the levels; we keep the average of the two
        when both are available so the side views sample a level that is
        consistent with both frontal observations rather than with whichever
        happened to be captured first.
        """
        for name, lv in ana.levels.items():
            if name in ("axilla", "crotch", "neck", "chest", "waist", "hip", "shoulder"):
                prev = self.level_ts.get(name)
                self.level_ts[name] = lv.t if prev is None else (prev + lv.t) / 2.0

    # -- finalise --------------------------------------------------------
    def missing_views(self) -> List[str]:
        return [v for v in VIEWS if v not in self.views]

    def finalize(self) -> dict:
        missing = self.missing_views()
        if missing:
            return {"ok": False,
                    "error": f"Missing valid views: {', '.join(missing)}.",
                    "missing_views": missing}

        bundles = {}
        for v, r in self.views.items():
            bundles[v] = ViewBundle(
                view=v, anatomy=r.anatomy, scale=r.scale,
                pose_quality=r.check.pose_quality if r.check else 0.8,
                clothing_multiplier=r.clothing_multiplier,
                warnings=r.warnings)

        model = BodyModel(
            bundles,
            shape_exponents=self.calibration.get("shape_exponents"),
            bias_corrections=self.calibration.get("bias_corrections"),
        ).build()

        # Fold cross-view consistency back into each view's confidence.
        factors = {}
        for v, r in self.views.items():
            f = r.confidence or ConfidenceFactors()
            f.view_consistency = model.scale_consistency
            factors[v] = f

        decision = decide_release(model, factors)
        out = model.as_dict()
        out.update({
            "ok": bool(decision.release),
            "release": decision.as_dict(),
            "camera_calibration": self.calibration_status(),
            "views": {v: r.as_dict() for v, r in self.views.items()},
        })
        return out

    def reset(self):
        self.views.clear()
        self.level_ts.clear()
