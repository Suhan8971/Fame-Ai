"""
multiview.py
============
NEW MODULE. Fuses Front + Left + Right + Back into one body model.

AUDIT FINDING THIS MODULE ADDRESSES
-----------------------------------
The old four-view sequence collected four photos and used almost nothing
from three of them:

    front -> across_shoulder, sleeve, length, chest, waist, collar
    left  -> left_sleeve_length     (only)
    right -> right_sleeve_length    (only)
    back  -> back_across_shoulder   (only, and only as a cross-check)

So the side views - the sole source of body DEPTH, and therefore the sole
route to a real circumference - contributed one arm length each. The back
view contributed a number that was compared against the front and, when
it disagreed by 17.6% on the repo's own capture, reported as "Recheck"
with no attempt to work out which view was wrong or why.

WHAT THIS MODULE PROVIDES
-------------------------
  * A per-view scale, each independently derived, plus a cross-view scale
    consistency test. Views whose scale disagrees with the group are
    identified rather than silently averaged in.
  * Anatomical level correspondence across views via the stature-normalised
    coordinate t = (y - vertex)/(floor - vertex). Levels are found where
    they are findable (the front/back width profile) and transferred to the
    side views to read depth at the SAME anatomical height.
  * Per-measurement fusion rules chosen for what each view actually
    observes, instead of a blanket average:

      shoulder     front and back both observe the same biacromial width.
                   FUSE by inverse-variance weighting; large disagreement
                   is a capture fault, not a body property.
      chest/waist/hip
                   width from front+back, depth from left+right, then the
                   superellipse model. Left and right depths are averaged
                   because they measure ONE antero-posterior thickness from
                   two sides; their difference is a rotation-error signal.
      sleeve       each side view sees its own arm unforeshortened; the
                   front view sees both but foreshortened. TAKE THE SIDE
                   VIEW per arm and REPORT LEFT AND RIGHT SEPARATELY -
                   real limb asymmetry is common and averaging destroys it.
      inseam/height
                   front view (crotch and floor are both crisp there).

  * Explicit asymmetry handling with a documented per-measurement policy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

from anatomy import ViewAnatomy
from circumference import estimate_circumference, CircumferenceError
from scale_reference import ScaleEstimate

# A left/right depth difference above this is a capture problem (imperfect
# 90-degree turns), not anatomy: real antero-posterior asymmetry at the
# torso is small.
DEPTH_ASYMMETRY_WARN = 0.08          # fractional
# Front vs back width disagreement above this means one view is wrong.
WIDTH_CONSISTENCY_WARN = 0.06
# Scale spread across views above this means the subject moved between shots.
SCALE_CONSISTENCY_WARN = 0.05


class FusionError(Exception):
    pass


@dataclass
class ViewBundle:
    """Everything one captured view contributes to the body model."""
    view: str
    anatomy: ViewAnatomy
    scale: ScaleEstimate
    pose_quality: float = 1.0
    clothing_multiplier: float = 1.0
    warnings: List[str] = field(default_factory=list)

    def cm(self, px: float) -> float:
        return px * self.scale.cm_per_px

    @property
    def stature_cm(self) -> float:
        return self.cm(self.anatomy.stature_px)


@dataclass
class FusedMeasurement:
    name: str
    value_cm: float
    confidence: float
    sources: List[str]
    uncertainty_cm: float = 0.0
    method: str = ""
    detail: Dict = field(default_factory=dict)
    notes: List[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "cm": round(self.value_cm, 1),
            "in": round(self.value_cm / 2.54, 1),
            "confidence": round(self.confidence, 3),
            "confidence_pct": int(round(self.confidence * 100)),
            "uncertainty_cm": round(self.uncertainty_cm, 1),
            "sources": list(self.sources),
            "method": self.method,
            "notes": list(self.notes),
            **({"detail": self.detail} if self.detail else {}),
        }


# ---------------------------------------------------------------------------
# Cross-view scale consistency
# ---------------------------------------------------------------------------

def check_scale_consistency(bundles: Dict[str, ViewBundle]) -> Tuple[float, List[str], Dict]:
    """Do the four views agree about the subject's size and position?

    Two different questions, because the answer depends on how the scale
    was obtained, and conflating them would produce a check that looks
    reassuring while testing nothing:

    (a) METRIC SCALE (marker/chessboard). Each view's cm/px is fixed by an
        object of known size, so the stature each view implies is an
        independent measurement. If they disagree, the subject was not in
        the same place, or the marker was not at their depth. This is a
        real test and it is applied.

    (b) STATURE SCALE. Each view is normalised by the SAME entered height,
        so every view implies exactly that height by construction and an
        agreement test on it is vacuous - it would report 100% consistency
        for a subject who moved a metre between shots. Reporting it as a
        pass would be worse than not testing at all.

        Two things do still catch a moved subject here:
          * implied camera distance, when the camera is calibrated:
            Z = f * height / stature_px is a genuine independent quantity
            per view (checked below);
          * the front-vs-back width and left-vs-right depth agreement
            checks, which run regardless.

        It is also worth being clear about the failure mode stature scaling
        actually has: uniform distance changes cancel (which is a real
        virtue, provided the whole body is in frame - hence the border
        gate), but a wrong entered height biases every measurement by the
        same percentage and NOTHING in a single session can detect it. Only
        a physical reference marker removes that.

    Returns (consistency 0..1, warnings, detail).
    """
    methods = {v: b.scale.method for v, b in bundles.items()}
    metric_views = {v: b for v, b in bundles.items()
                    if b.scale.method in ("aruco", "chessboard")}
    statures = {v: b.stature_cm for v, b in bundles.items()}
    detail = {
        "scale_methods": methods,
        "stature_cm_by_view": {k: round(v, 1) for k, v in statures.items()},
    }
    warnings: List[str] = []

    # --- (a) metric scale: implied stature must agree -------------------
    if len(metric_views) >= 2:
        vals = np.array([b.stature_cm for b in metric_views.values()], float)
        med = float(np.median(vals))
        spread = float(np.max(np.abs(vals - med)) / med) if med else 1.0
        detail["metric_stature_spread_pct"] = round(spread * 100, 2)
        if spread > SCALE_CONSISTENCY_WARN:
            worst = max(metric_views, key=lambda v: abs(statures[v] - med))
            warnings.append(
                f"The {worst} view measures your height as {statures[worst]:.0f}cm "
                f"while the others measure about {med:.0f}cm "
                f"({spread*100:.1f}% apart). You were not standing in the same "
                f"place for every photo - mark the floor and use the same spot.")
        consistency = float(np.clip(1.0 - spread / (2 * SCALE_CONSISTENCY_WARN), 0.0, 1.0))
    else:
        consistency = None
        detail["metric_stature_spread_pct"] = None

    # --- (b) implied camera distance: works for ANY scale method, as long
    #         as the camera is calibrated -------------------------------
    depths = {v: b.scale.reference_depth_cm for v, b in bundles.items()
              if b.scale.reference_depth_cm}
    if len(depths) >= 2:
        dv = np.array(list(depths.values()), float)
        dmed = float(np.median(dv))
        dspread = float(np.max(np.abs(dv - dmed)) / dmed) if dmed else 1.0
        detail["implied_camera_distance_cm"] = {k: round(v, 1) for k, v in depths.items()}
        detail["distance_spread_pct"] = round(dspread * 100, 2)
        if dspread > SCALE_CONSISTENCY_WARN:
            worst = max(depths, key=lambda v: abs(depths[v] - dmed))
            warnings.append(
                f"You moved between shots: the {worst} view was taken from "
                f"{depths[worst]:.0f}cm away and the others from about "
                f"{dmed:.0f}cm ({dspread*100:.1f}% different). Mark your "
                f"standing spot on the floor and use it for all four views.")
        dist_consistency = float(np.clip(1.0 - dspread / (2 * SCALE_CONSISTENCY_WARN), 0.0, 1.0))
        consistency = dist_consistency if consistency is None else min(consistency, dist_consistency)
    else:
        detail["implied_camera_distance_cm"] = None
        if consistency is None:
            # Nothing independent to compare. Say so, and cap the score
            # below 1.0 so downstream confidence does not treat an untested
            # assumption as a verified one.
            detail["note"] = (
                "No metric scale reference and no camera calibration, so "
                "cross-view scale could not be independently verified. "
                "Front-vs-back width and left-vs-right depth agreement are "
                "still checked. Print the ArUco marker, or run "
                "camera_calibration.py, to make this testable.")
            warnings.append(
                "Cross-view scale could not be independently verified - the "
                "scale comes from your entered height, which every view "
                "shares. Add a printed reference marker for a true check.")
            consistency = 0.85

    return consistency, warnings, detail


# ---------------------------------------------------------------------------
# Fusion helpers
# ---------------------------------------------------------------------------

def _inverse_variance_fuse(values: List[float], sigmas: List[float]) -> Tuple[float, float]:
    """Combine independent estimates weighted by 1/sigma^2.

    The right way to merge two measurements of the same quantity that have
    different reliabilities. Averaging (what the old cross-check implied)
    gives a noisy view equal say with a clean one.
    """
    v = np.asarray(values, float)
    s = np.clip(np.asarray(sigmas, float), 1e-6, None)
    wts = 1.0 / s ** 2
    mean = float(np.sum(wts * v) / np.sum(wts))
    return mean, float(np.sqrt(1.0 / np.sum(wts)))


def _level_width_cm(b: ViewBundle, level: str) -> Optional[Tuple[float, float]]:
    """(width_cm, sigma_cm) at a level in a frontal view."""
    lv = b.anatomy.levels.get(level)
    if lv is None or lv.width_px <= 0:
        return None
    cm = b.cm(lv.width_px)
    # Uncertainty = scale uncertainty (multiplicative) + edge localisation
    # (~0.6px per edge, two edges) converted to cm.
    sigma = float(np.hypot(cm * b.scale.relative_uncertainty,
                           0.85 * b.scale.cm_per_px))
    sigma /= max(lv.confidence, 0.3)
    return cm, sigma


# ---------------------------------------------------------------------------
# Main fusion
# ---------------------------------------------------------------------------

class BodyModel:
    """The fused, multi-view body representation."""

    def __init__(self, bundles: Dict[str, ViewBundle],
                 shape_exponents: Optional[Dict[str, float]] = None,
                 bias_corrections: Optional[Dict[str, float]] = None):
        self.bundles = bundles
        self.shape_exponents = shape_exponents
        self.bias_corrections = bias_corrections or {}
        self.measurements: Dict[str, FusedMeasurement] = {}
        self.warnings: List[str] = []
        self.cross_checks: Dict[str, Dict] = {}
        self.scale_consistency = 1.0

    # -- entry point ------------------------------------------------------
    def build(self) -> "BodyModel":
        self.scale_consistency, warns, detail = check_scale_consistency(self.bundles)
        self.warnings += warns
        self.cross_checks["scale"] = {"consistency": round(self.scale_consistency, 3), **detail}

        self._fuse_stature()
        self._fuse_shoulder()
        for level in ("chest", "waist", "hip"):
            self._fuse_circumference(level)
        self._fuse_neck()
        self._fuse_sleeves()
        self._fuse_lengths()
        self._apply_bias_corrections()
        return self

    # -- individual measurements -----------------------------------------
    def _frontal(self) -> List[ViewBundle]:
        return [self.bundles[v] for v in ("front", "back") if v in self.bundles]

    def _profiles(self) -> List[ViewBundle]:
        return [self.bundles[v] for v in ("left", "right") if v in self.bundles]

    def _fuse_stature(self):
        vals, sig, src = [], [], []
        for v, b in self.bundles.items():
            vals.append(b.stature_cm)
            sig.append(b.stature_cm * b.scale.relative_uncertainty / max(b.pose_quality, 0.3))
            src.append(v)
        if not vals:
            return
        m, s = _inverse_variance_fuse(vals, sig)
        self.measurements["height"] = FusedMeasurement(
            "height", m, self.scale_consistency, src, s,
            "inverse_variance_over_views",
            {"per_view_cm": {v: round(x, 1) for v, x in zip(src, vals)}})

    def _fuse_shoulder(self):
        """Across-shoulder: front and back measure the same biacromial span.

        Both are equally valid views of it, so they are fused by inverse
        variance. A large disagreement means one capture was rotated or
        mis-scaled; that is surfaced, not averaged away.
        """
        vals, sig, src = [], [], []
        for b in self._frontal():
            r = _level_width_cm(b, "shoulder")
            if r is None:
                continue
            cm, s = r
            vals.append(cm); sig.append(s / max(b.pose_quality, 0.3)); src.append(b.view)
        if not vals:
            return
        m, s = _inverse_variance_fuse(vals, sig)
        notes, conf = [], self.scale_consistency
        if len(vals) == 2:
            diff = abs(vals[0] - vals[1]) / m
            self.cross_checks["shoulder_front_back"] = {
                "front_cm": round(vals[0], 1), "back_cm": round(vals[1], 1),
                "diff_pct": round(diff * 100, 1),
                "consistent": bool(diff <= WIDTH_CONSISTENCY_WARN)}
            if diff > WIDTH_CONSISTENCY_WARN:
                notes.append(
                    f"Front and back shoulder widths differ by {diff*100:.1f}%. "
                    f"Usually the two photos were taken at different distances.")
                conf *= float(np.clip(1.0 - (diff - WIDTH_CONSISTENCY_WARN) * 6, 0.25, 1.0))
        self.measurements["across_shoulder"] = FusedMeasurement(
            "across_shoulder", m, conf * self._quality("front", "back"), src, s,
            "acromion_to_acromion_silhouette_corner, front+back inverse-variance",
            notes=notes)

    def _fuse_circumference(self, level: str):
        """Width from the frontal views, depth from the profiles, then the
        superellipse cross-section model."""
        w_vals, w_sig, w_src = [], [], []
        for b in self._frontal():
            r = _level_width_cm(b, level)
            if r is None:
                continue
            cm, s = r
            w_vals.append(cm); w_sig.append(s / max(b.pose_quality, 0.3)); w_src.append(b.view)

        d_vals, d_sig, d_src = [], [], []
        for b in self._profiles():
            r = _level_width_cm(b, level)
            if r is None:
                continue
            cm, s = r
            d_vals.append(cm); d_sig.append(s / max(b.pose_quality, 0.3)); d_src.append(b.view)

        if not w_vals or not d_vals:
            missing = "front/back" if not w_vals else "left/right"
            self.warnings.append(
                f"{level.capitalize()} circumference needs both a width and a "
                f"depth; the {missing} view(s) did not yield a usable "
                f"{level} level.")
            return

        width_cm, width_sig = _inverse_variance_fuse(w_vals, w_sig)
        depth_cm, depth_sig = _inverse_variance_fuse(d_vals, d_sig)

        notes: List[str] = []
        conf = self.scale_consistency

        if len(w_vals) == 2:
            d = abs(w_vals[0] - w_vals[1]) / width_cm
            self.cross_checks[f"{level}_width_front_back"] = {
                "front_cm": round(w_vals[0], 1), "back_cm": round(w_vals[1], 1),
                "diff_pct": round(d * 100, 1),
                "consistent": bool(d <= WIDTH_CONSISTENCY_WARN)}
            if d > WIDTH_CONSISTENCY_WARN:
                notes.append(f"Front and back {level} widths differ by {d*100:.1f}%.")
                conf *= float(np.clip(1.0 - (d - WIDTH_CONSISTENCY_WARN) * 5, 0.3, 1.0))

        if len(d_vals) == 2:
            d = abs(d_vals[0] - d_vals[1]) / depth_cm
            self.cross_checks[f"{level}_depth_left_right"] = {
                "left_cm": round(d_vals[0], 1), "right_cm": round(d_vals[1], 1),
                "diff_pct": round(d * 100, 1),
                "consistent": bool(d <= DEPTH_ASYMMETRY_WARN)}
            if d > DEPTH_ASYMMETRY_WARN:
                notes.append(
                    f"Left and right views disagree on {level} depth by "
                    f"{d*100:.1f}%. Both photos measure the same front-to-back "
                    f"thickness, so this is a turning error - one profile was "
                    f"not a full 90 degrees.")
                conf *= float(np.clip(1.0 - (d - DEPTH_ASYMMETRY_WARN) * 4, 0.3, 1.0))

        try:
            res = estimate_circumference(width_cm, depth_cm, level,
                                         width_sigma_cm=width_sig,
                                         depth_sigma_cm=depth_sig,
                                         exponents=self.shape_exponents)
        except CircumferenceError as exc:
            self.warnings.append(str(exc))
            return

        self.measurements[level] = FusedMeasurement(
            level, res.circumference_cm,
            conf * self._quality("front", "back", "left", "right"),
            w_src + d_src, res.uncertainty_cm,
            f"width(front+back) x depth(left+right) -> {res.model}",
            detail=res.as_dict(), notes=notes)

    def _fuse_neck(self):
        """Neck/collar. Width from the frontal views; depth from the
        profiles when the neck level transfers cleanly, otherwise the
        measurement is omitted rather than guessed at.

        The old code produced a collar as `across_shoulder * 0.85`, which
        is a pure proportion assumption with no input from the neck at all.
        """
        w = [ _level_width_cm(b, "neck") for b in self._frontal() ]
        w = [x for x in w if x]
        d = [ _level_width_cm(b, "neck") for b in self._profiles() ]
        d = [x for x in d if x]
        if not w:
            return
        width_cm, width_sig = _inverse_variance_fuse([x[0] for x in w], [x[1] for x in w])

        # PLAUSIBILITY GATE, not a measurement assumption: the neck base is
        # the hardest level to localise, because it is a short span where the
        # jaw, hair and collar all interfere. If the detected neck width is
        # wildly out of proportion to the shoulder width the detection has
        # failed, and the right output is no collar rather than a wrong one.
        # The band is deliberately wide - it only catches gross failures and
        # never adjusts the value.
        sh = self.measurements.get("across_shoulder")
        if sh and sh.value_cm > 0:
            ratio = width_cm / sh.value_cm
            if not (0.22 <= ratio <= 0.55):
                self.warnings.append(
                    f"Collar not reported: the detected neck width "
                    f"({width_cm:.1f}cm) is implausible against a "
                    f"{sh.value_cm:.1f}cm shoulder width. The neck base could "
                    f"not be located - tie long hair back and wear a "
                    f"low-necked top.")
                return
        if not d:
            self.warnings.append("Neck depth unavailable from the side views; "
                                 "collar size not reported.")
            return
        depth_cm, depth_sig = _inverse_variance_fuse([x[0] for x in d], [x[1] for x in d])
        try:
            res = estimate_circumference(width_cm, depth_cm, "neck",
                                         width_sigma_cm=width_sig,
                                         depth_sigma_cm=depth_sig,
                                         exponents=self.shape_exponents)
        except CircumferenceError as exc:
            self.warnings.append(f"Collar: {exc}")
            return
        self.measurements["collar"] = FusedMeasurement(
            "collar", res.circumference_cm,
            self.scale_consistency * self._quality("front", "back", "left", "right") * 0.9,
            ["front", "back", "left", "right"], res.uncertainty_cm,
            f"neck width x depth -> {res.model}", detail=res.as_dict(),
            notes=["Collar is the least reliable of these measurements: the "
                   "neck base is a short, low-contrast span and hair or a "
                   "collar can obscure it. Treat it as indicative."])

    def _fuse_sleeves(self):
        """Sleeve length per arm, from that arm's own profile view.

        The old code summed 2D shoulder->elbow->wrist distances in the
        FRONT view and averaged the arms. Two errors: a 2D projection of a
        limb that is not parallel to the image plane is short by cos(theta),
        and averaging two arms hides genuine asymmetry. In a profile view
        the near arm hangs essentially in the image plane, so its 2D length
        is very nearly its true length.
        """
        per_arm = {}
        for b in self._profiles():
            p = b.anatomy.points
            if not all(k in p for k in ("shoulder", "elbow", "wrist")):
                continue
            px = (float(np.hypot(p["elbow"][0] - p["shoulder"][0],
                                 p["elbow"][1] - p["shoulder"][1])) +
                  float(np.hypot(p["wrist"][0] - p["elbow"][0],
                                 p["wrist"][1] - p["elbow"][1])))
            cm = b.cm(px)
            sig = float(np.hypot(cm * b.scale.relative_uncertainty,
                                 2.0 * b.scale.cm_per_px))
            per_arm[b.view] = (cm, sig / max(b.pose_quality, 0.3))

        for side in ("left", "right"):
            if side in per_arm:
                cm, sig = per_arm[side]
                self.measurements[f"{side}_sleeve_length"] = FusedMeasurement(
                    f"{side}_sleeve_length", cm,
                    self.scale_consistency * self._quality(side), [side], sig,
                    "shoulder->elbow->wrist in that arm's own profile view")

        if len(per_arm) == 2:
            l, r = per_arm["left"][0], per_arm["right"][0]
            diff = abs(l - r) / max((l + r) / 2, 1e-6)
            self.cross_checks["sleeve_left_right"] = {
                "left_cm": round(l, 1), "right_cm": round(r, 1),
                "diff_pct": round(diff * 100, 1),
                "consistent": bool(diff <= 0.05)}
            # SIZING POLICY: a garment must fit the longer arm, so the
            # single "sleeve length" for sizing is the MAXIMUM, not the
            # mean. The per-arm values are kept above for tailoring.
            m, s = _inverse_variance_fuse([l, r], [per_arm["left"][1], per_arm["right"][1]])
            notes = []
            if diff > 0.05:
                notes.append(
                    f"Your arms measure {diff*100:.1f}% apart ({l:.1f}cm vs "
                    f"{r:.1f}cm). If that is real asymmetry, use the longer "
                    f"arm for sizing; if not, re-shoot both side views.")
            self.measurements["sleeve_length"] = FusedMeasurement(
                "sleeve_length", max(l, r),
                self.scale_consistency * self._quality("left", "right") *
                (0.8 if diff > 0.05 else 1.0),
                ["left", "right"], max(per_arm["left"][1], per_arm["right"][1]),
                "max(left, right) - a sleeve must fit the longer arm",
                {"left_cm": round(l, 1), "right_cm": round(r, 1),
                 "mean_cm": round(m, 1)}, notes)

    def _fuse_lengths(self):
        """Shirt length (neck base to hip level) and inseam (crotch to floor).

        The old shirt "Length" was shoulder-midpoint to hip-midpoint times
        a hardcoded 1.20 "shirts hang below the hip" factor. Here the two
        endpoints are real, located levels and the number is the distance
        between them; how far below the hip a given shirt hangs is a
        garment property, not a body measurement, so it is not baked in.
        """
        for b in self._frontal():
            lv = b.anatomy.levels
            if "neck" in lv and "hip" in lv:
                px = lv["hip"].y - lv["neck"].y
                cm = b.cm(px)
                self.measurements.setdefault("torso_length", FusedMeasurement(
                    "torso_length", cm, self.scale_consistency * self._quality(b.view),
                    [b.view], cm * b.scale.relative_uncertainty,
                    "neck base to hip level, vertical"))
            if "crotch" in lv:
                px = b.anatomy.floor_y - lv["crotch"].y
                cm = b.cm(px)
                self.measurements.setdefault("inseam", FusedMeasurement(
                    "inseam", cm, self.scale_consistency * self._quality(b.view),
                    [b.view], cm * b.scale.relative_uncertainty,
                    "crotch level to floor contact"))

    # -- helpers ----------------------------------------------------------
    def _quality(self, *views: str) -> float:
        qs = [self.bundles[v].pose_quality * self.bundles[v].clothing_multiplier
              for v in views if v in self.bundles]
        return float(np.mean(qs)) if qs else 0.5

    def _apply_bias_corrections(self):
        """Apply validated, data-derived per-measurement offsets.

        Deliberately a no-op unless validation.py has fitted corrections
        from a real ground-truth dataset with enough subjects. A correction
        fitted on one person is that person's body, not a systematic bias.
        """
        for name, corr in self.bias_corrections.items():
            m = self.measurements.get(name)
            if m is None:
                continue
            offset = float(corr.get("offset_cm", 0.0)) if isinstance(corr, dict) else float(corr)
            n = int(corr.get("n_subjects", 0)) if isinstance(corr, dict) else 0
            m.value_cm -= offset
            m.notes.append(f"Bias correction {-offset:+.2f}cm applied "
                           f"(fitted on {n} subjects).")
            m.method += f" + validated bias correction ({-offset:+.2f}cm)"

    # -- output -----------------------------------------------------------
    def as_dict(self) -> dict:
        return {
            "measurements": {k: v.as_dict() for k, v in self.measurements.items()},
            "cross_checks": self.cross_checks,
            "warnings": list(self.warnings),
            "scale_consistency": round(self.scale_consistency, 3),
            "per_view": {v: {"scale": b.scale.summary(),
                             "pose_quality": round(b.pose_quality, 3),
                             "clothing_multiplier": round(b.clothing_multiplier, 3),
                             "levels": {k: lv.as_dict() for k, lv in b.anatomy.levels.items()},
                             "warnings": b.warnings + b.anatomy.warnings}
                         for v, b in self.bundles.items()},
        }
