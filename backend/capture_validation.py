"""
capture_validation.py
=====================
NEW MODULE. The quality gate: decides whether a frame is measurable at all.

AUDIT FINDING THIS MODULE ADDRESSES
-----------------------------------
The old gate was app.py's `check_alignment()` / `check_side_alignment()`.
What they actually checked:

    if any(lm[p].visibility < 0.5 for p in needed): reject
    if abs(l_sh.y - r_sh.y) > 0.04: reject
    if center_x < 0.30 or > 0.70: reject
    if shoulder_width < 0.08 or > 0.45: reject
    if wrist.y < shoulder.y: reject

The decisive omission: **`visibility` is not an in-frame test.** MediaPipe's
`visibility` scores how confident the model is that a joint is not
occluded *by the body*; it stays high for a joint the model has
extrapolated to a clamped position outside the image. On all four of this
repo's stored captures the silhouette runs into the bottom row of the
frame (row 1079 of 1080) - the feet are cut off - while ankle visibility
reads 0.80-0.96 and the old gate passed every one. The stature reference
was then measured against a cropped body: 1075px in the front view versus
944px in the back view, a 13.8% scale disagreement that produced the
37.5cm-vs-44.1cm front/back shoulder split.

Other gaps:
  * No true orientation test. `abs(l_sh.y - r_sh.y) < 0.04` accepts a
    subject rotated 25 degrees about the vertical axis, which foreshortens
    every width by cos(25) = 0.91 - a 9% error, invisible to the check.
  * No front-vs-back discrimination, so a subject who turned the wrong way
    was measured as if facing the camera.
  * The side gate used `abs(l_sh.x - r_sh.x) > 0.10` in NORMALISED units,
    so the threshold's meaning changed with how far away the subject stood.
  * No lean/bend test, no arms-clear-of-torso test, no lighting test.

WHAT THIS MODULE PROVIDES
-------------------------
A single `validate_capture()` returning structured, actionable failures.
Every threshold is expressed against a quantity that is invariant to
distance and framing (fractions of the subject's own stature in pixels,
or angles in degrees), so the same numbers hold at 2m and at 4m.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional, Dict

import numpy as np

from body_segmentation import Silhouette

NOSE = 0
LEFT_EAR, RIGHT_EAR = 7, 8
LEFT_SHOULDER, RIGHT_SHOULDER = 11, 12
LEFT_ELBOW, RIGHT_ELBOW = 13, 14
LEFT_WRIST, RIGHT_WRIST = 15, 16
LEFT_HIP, RIGHT_HIP = 23, 24
LEFT_KNEE, RIGHT_KNEE = 25, 26
LEFT_ANKLE, RIGHT_ANKLE = 27, 28

# --- Capture standard -------------------------------------------------------
# All thresholds are scale-free. STATURE_FRAME_FRACTION is the fraction of
# the frame height the subject should occupy: too small and each cm is only
# a few pixels; too large and the head or feet clip. 0.60-0.88 keeps a
# 175cm subject between roughly 4.6 and 6.8 px/cm on a 1080-tall frame
# while leaving a margin at both ends.
MIN_STATURE_FRAME_FRACTION = 0.60
MAX_STATURE_FRAME_FRACTION = 0.88
MIN_BORDER_MARGIN_FRACTION = 0.012      # of frame height, above head/below feet

MAX_YAW_DEG_FRONTAL = 12.0              # rotation away from square-on
MAX_YAW_ERROR_DEG_PROFILE = 15.0        # deviation from a true 90-degree profile
MAX_SHOULDER_TILT_DEG = 6.0
MAX_TORSO_LEAN_DEG = 6.0
MIN_KNEE_STRAIGHTNESS_DEG = 160.0       # hip-knee-ankle angle
MIN_ARM_GAP_STATURE_FRAC = 0.012        # arm-to-torso clearance
MIN_LANDMARK_VISIBILITY = 0.55
MIN_MEAN_LUMA, MAX_MEAN_LUMA = 45.0, 225.0
MIN_LUMA_STD = 18.0


@dataclass
class CaptureCheck:
    ok: bool
    failures: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    metrics: Dict[str, float] = field(default_factory=dict)
    pose_quality: float = 0.0            # 0..1

    def first_message(self) -> str:
        if self.failures:
            return self.failures[0]
        return "Hold still..."

    def as_dict(self) -> dict:
        return {"ok": self.ok, "failures": list(self.failures),
                "warnings": list(self.warnings), "pose_quality": round(self.pose_quality, 3),
                "metrics": {k: round(v, 3) for k, v in self.metrics.items()}}


# ---------------------------------------------------------------------------
# Orientation from 3D world landmarks
# ---------------------------------------------------------------------------

def shoulder_yaw_deg(world_landmarks) -> Optional[float]:
    """Rotation of the shoulder line about the vertical axis, in degrees.

    0 = shoulders square to the camera, +-90 = true side profile. Computed
    from MediaPipe's `pose_world_landmarks`, whose *absolute* scale is
    unreliable (measured on this repo's captures: shoulder span reported as
    24.6cm to 38.0cm for the same person across four views, so it must
    never be used as a length) but whose *direction* is usable, because a
    common scale error cancels in an angle.
    """
    if world_landmarks is None:
        return None
    wl = world_landmarks.landmark
    dx = wl[LEFT_SHOULDER].x - wl[RIGHT_SHOULDER].x
    dz = wl[LEFT_SHOULDER].z - wl[RIGHT_SHOULDER].z
    if abs(dx) < 1e-6 and abs(dz) < 1e-6:
        return None
    raw = abs(math.degrees(math.atan2(dz, dx)))
    # Fold onto [0, 90]. The shoulder line is an undirected axis: facing the
    # camera and facing away are both "square on" (0 and 180 raw) and both
    # give unforeshortened widths. Which of the two it is, is a separate
    # question answered by facing_direction(). Without this fold a back view
    # reads as a 175-degree rotation and gets rejected as turned away.
    return float(min(raw, 180.0 - raw))


def facing_direction(landmarks, mirrored: bool) -> str:
    """'front' or 'back', from the left/right shoulder ordering in x.

    When the subject faces the camera their anatomical left shoulder
    appears on one side of the image; when they turn around it swaps.
    Verified on this repo's captures: front L.x=0.564 > R.x=0.451, back
    L.x=0.493 < R.x=0.607 (mirrored feed). This is a topological test, so
    unlike a z-depth comparison it does not depend on MediaPipe's noisy
    depth estimate.
    """
    lm = landmarks.landmark
    d = lm[LEFT_SHOULDER].x - lm[RIGHT_SHOULDER].x
    front_when_positive = mirrored
    if d > 0:
        return "front" if front_when_positive else "back"
    return "back" if front_when_positive else "front"


def _angle_deg(a, b, c) -> float:
    ba = np.array(a, float) - np.array(b, float)
    bc = np.array(c, float) - np.array(b, float)
    na, nc = np.linalg.norm(ba), np.linalg.norm(bc)
    if na < 1e-6 or nc < 1e-6:
        return 180.0
    return float(math.degrees(math.acos(np.clip(np.dot(ba, bc) / (na * nc), -1, 1))))


# ---------------------------------------------------------------------------
# Main gate
# ---------------------------------------------------------------------------

def validate_capture(view: str, landmarks, world_landmarks, sil: Silhouette,
                     frame_bgr: np.ndarray, mirrored: bool = True,
                     strict: bool = True) -> CaptureCheck:
    """Full quality gate for one view.

    `view` is one of front/left/right/back. Returns a CaptureCheck whose
    `failures` list is empty only if the frame is genuinely measurable.
    Callers must NOT compute measurements when `ok` is False - producing a
    number from a bad capture is the specific failure mode this whole
    module exists to prevent.
    """
    chk = CaptureCheck(ok=True)
    h, w = sil.height, sil.width
    lm = landmarks.landmark
    stature = sil.stature_span_px

    # ---- 1. Whole body inside the frame -------------------------------
    margin = MIN_BORDER_MARGIN_FRACTION * h
    if sil.touches_top:
        chk.failures.append("The top of your head is cut off. Step back or tilt the camera down.")
    elif sil.vertex_y < margin:
        chk.warnings.append("Your head is very close to the top edge.")
    if sil.touches_bottom:
        chk.failures.append("Your feet are cut off. Step back until your whole body, "
                            "head to feet, is inside the frame.")
    elif (h - sil.bottom_y) < margin:
        chk.warnings.append("Your feet are very close to the bottom edge.")
    if sil.touches_left or sil.touches_right:
        chk.failures.append("Part of your body is outside the left or right edge of the frame.")

    # ---- 2. Distance / subject size ------------------------------------
    frac = stature / float(h)
    chk.metrics["stature_frame_fraction"] = frac
    chk.metrics["stature_px"] = stature
    if frac < MIN_STATURE_FRAME_FRACTION:
        chk.failures.append(
            f"You are too far from the camera (you fill {frac*100:.0f}% of the "
            f"frame height, need {MIN_STATURE_FRAME_FRACTION*100:.0f}%+). Move closer.")
    elif frac > MAX_STATURE_FRAME_FRACTION:
        chk.failures.append(
            f"You are too close (you fill {frac*100:.0f}% of the frame height). Step back.")

    # ---- 3. Centring ----------------------------------------------------
    cols = np.flatnonzero(sil.mask.any(axis=0))
    cx = float((cols[0] + cols[-1]) / 2.0 / w) if cols.size else 0.5
    chk.metrics["centre_x"] = cx
    if not (0.32 <= cx <= 0.68):
        chk.failures.append("Move to the centre of the frame.")

    # ---- 4. Landmark availability ---------------------------------------
    if view in ("front", "back"):
        needed = [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP,
                  LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST, RIGHT_WRIST,
                  LEFT_KNEE, RIGHT_KNEE, LEFT_ANKLE, RIGHT_ANKLE]
    else:
        if view == "left":
            needed = [LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST, LEFT_HIP,
                      LEFT_KNEE, LEFT_ANKLE]
        else:
            needed = [RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST, RIGHT_HIP,
                      RIGHT_KNEE, RIGHT_ANKLE]
    vis = [lm[i].visibility for i in needed]
    chk.metrics["min_landmark_visibility"] = float(min(vis))
    if min(vis) < MIN_LANDMARK_VISIBILITY:
        chk.failures.append("Some body points are hidden. Stand clear of furniture "
                            "with nothing in front of you.")

    # ---- 5. Orientation --------------------------------------------------
    yaw = shoulder_yaw_deg(world_landmarks)
    if yaw is not None:
        chk.metrics["shoulder_yaw_deg"] = yaw
    if view in ("front", "back"):
        if yaw is not None and yaw > MAX_YAW_DEG_FRONTAL:
            chk.failures.append(
                f"You are turned about {yaw:.0f} degrees off square. "
                f"Face the camera squarely - a {yaw:.0f} degree turn "
                f"under-reads every width by "
                f"{(1-math.cos(math.radians(yaw)))*100:.1f}%.")
        seen = facing_direction(landmarks, mirrored)
        chk.metrics["facing_front"] = 1.0 if seen == "front" else 0.0
        if seen != view:
            chk.failures.append(
                f"This should be the {view} view but you are showing your "
                f"{seen}. Turn around.")
        # Shoulders level
        tilt = math.degrees(math.atan2(
            abs(lm[LEFT_SHOULDER].y - lm[RIGHT_SHOULDER].y) * h,
            max(abs(lm[LEFT_SHOULDER].x - lm[RIGHT_SHOULDER].x) * w, 1e-6)))
        chk.metrics["shoulder_tilt_deg"] = tilt
        if tilt > MAX_SHOULDER_TILT_DEG:
            chk.failures.append("Level your shoulders and stand up straight.")
        # Head facing forward: nose over the shoulder midpoint
        mid_x = (lm[LEFT_SHOULDER].x + lm[RIGHT_SHOULDER].x) / 2
        sh_span = abs(lm[LEFT_SHOULDER].x - lm[RIGHT_SHOULDER].x)
        head_off = abs(lm[NOSE].x - mid_x) / max(sh_span, 1e-6)
        chk.metrics["head_offset_ratio"] = head_off
        if head_off > 0.25:
            chk.failures.append("Look straight ahead - keep your head facing forward.")
    else:
        if yaw is not None:
            err = abs(90.0 - yaw)
            chk.metrics["profile_yaw_error_deg"] = err
            if err > MAX_YAW_ERROR_DEG_PROFILE:
                chk.failures.append(
                    f"Turn further: you are {yaw:.0f} degrees round, this view "
                    f"needs a full 90 degree side profile. Body depth is read "
                    f"from this photo, so a partial turn over-reads it.")
        # In a true profile the two shoulders project onto nearly the same
        # column. Threshold in stature-normalised units so it means the same
        # thing at any distance (the old code compared it to a fixed 0.10 in
        # normalised image units, which changed meaning with subject size).
        gap = abs(lm[LEFT_SHOULDER].x - lm[RIGHT_SHOULDER].x) * w / max(stature, 1)
        chk.metrics["shoulder_projection_gap_stature_frac"] = gap
        if gap > 0.075:
            chk.failures.append(f"Turn further to show your {view} side squarely to the camera.")

    # ---- 6. Posture: lean and bend ---------------------------------------
    sh_mid = np.array([(lm[LEFT_SHOULDER].x + lm[RIGHT_SHOULDER].x) / 2 * w,
                       (lm[LEFT_SHOULDER].y + lm[RIGHT_SHOULDER].y) / 2 * h])
    hip_mid = np.array([(lm[LEFT_HIP].x + lm[RIGHT_HIP].x) / 2 * w,
                        (lm[LEFT_HIP].y + lm[RIGHT_HIP].y) / 2 * h])
    lean = math.degrees(math.atan2(abs(hip_mid[0] - sh_mid[0]),
                                   max(abs(hip_mid[1] - sh_mid[1]), 1e-6)))
    chk.metrics["torso_lean_deg"] = lean
    if lean > MAX_TORSO_LEAN_DEG:
        chk.failures.append("You are leaning. Stand upright with your weight even on both feet.")

    for tag, hip_i, knee_i, ank_i in (("left", LEFT_HIP, LEFT_KNEE, LEFT_ANKLE),
                                      ("right", RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE)):
        if view in ("front", "back") or view == tag:
            if min(lm[hip_i].visibility, lm[knee_i].visibility, lm[ank_i].visibility) < 0.4:
                continue
            ang = _angle_deg((lm[hip_i].x * w, lm[hip_i].y * h),
                             (lm[knee_i].x * w, lm[knee_i].y * h),
                             (lm[ank_i].x * w, lm[ank_i].y * h))
            chk.metrics[f"{tag}_knee_deg"] = ang
            if ang < MIN_KNEE_STRAIGHTNESS_DEG:
                chk.failures.append("Straighten your legs and stand still.")
                break

    # ---- 7. Arms clear of the torso --------------------------------------
    if view in ("front", "back"):
        for wrist_i, sh_i in ((LEFT_WRIST, LEFT_SHOULDER), (RIGHT_WRIST, RIGHT_SHOULDER)):
            if lm[wrist_i].y < lm[sh_i].y:
                chk.failures.append("Relax your arms down by your sides.")
                break
        # Topological test: at the waist the mask must show arm|torso|arm.
        waist_probe = hip_mid[1] - 0.06 * stature
        runs = sil.runs_at(float(waist_probe))
        chk.metrics["waist_row_runs"] = float(len(runs))
        if len(runs) < 3:
            chk.failures.append(
                "Move your arms about 15-20cm away from your body so your "
                "waist outline is separate from your arms.")
        else:
            runs_sorted = sorted(runs, key=lambda r: r[0])
            gaps = [runs_sorted[i + 1][0] - runs_sorted[i][1] for i in range(len(runs_sorted) - 1)]
            gmin = min(gaps) / max(stature, 1) if gaps else 0.0
            chk.metrics["min_arm_gap_stature_frac"] = gmin
            if gmin < MIN_ARM_GAP_STATURE_FRAC:
                chk.warnings.append("Your arms are very close to your body; "
                                    "the waist outline may be slightly wide.")

    # ---- 8. Lighting -----------------------------------------------------
    ys, xs = np.nonzero(sil.mask)
    if ys.size > 100:
        gray = frame_bgr[..., 1] if frame_bgr.ndim == 3 else frame_bgr
        vals = gray[ys, xs].astype(np.float32)
        mean_l, std_l = float(vals.mean()), float(vals.std())
        chk.metrics["body_luma_mean"] = mean_l
        chk.metrics["body_luma_std"] = std_l
        if mean_l < MIN_MEAN_LUMA:
            chk.failures.append("Too dark. Add light in front of you.")
        elif mean_l > MAX_MEAN_LUMA:
            chk.warnings.append("The image is very bright; detail at your outline may be lost.")
        if std_l < MIN_LUMA_STD:
            chk.warnings.append("Very flat lighting; your outline may blend into the background.")

    # ---- 9. Segmentation quality ----------------------------------------
    chk.metrics["edge_sharpness"] = sil.edge_sharpness
    chk.metrics["model_agreement"] = sil.model_agreement
    chk.metrics["boundary_transition_px"] = getattr(sil, "transition_px", 7.0)
    # Threshold set from measured behaviour, not taste: MediaPipe's mask
    # transitions over ~5-7px at 1080p even on a clean capture (the model
    # runs at 256x256), which scores ~0.55-0.75 here. Below 0.25 the
    # boundary is spread over 9px+ and a width is worth +-1.5cm, which is
    # not a measurement.
    if sil.edge_sharpness < 0.25:
        chk.failures.append(
            f"Your outline cannot be separated from the background "
            f"(boundary spread over {getattr(sil, 'transition_px', 0):.0f} pixels). "
            f"Stand against a plainer wall or improve the lighting.")
    chk.warnings.extend(sil.warnings)

    # ---- verdict ---------------------------------------------------------
    chk.ok = (len(chk.failures) == 0) if strict else True
    chk.pose_quality = _pose_quality(chk)
    return chk


def _pose_quality(chk: CaptureCheck) -> float:
    """0..1 summary of how good the pose/framing is, used by the confidence
    model. Continuous, so a capture that only just passes the gate is not
    treated the same as a textbook one."""
    if chk.failures:
        return 0.0
    m = chk.metrics
    parts = []

    frac = m.get("stature_frame_fraction")
    if frac is not None:
        mid = (MIN_STATURE_FRAME_FRACTION + MAX_STATURE_FRAME_FRACTION) / 2
        half = (MAX_STATURE_FRAME_FRACTION - MIN_STATURE_FRAME_FRACTION) / 2
        parts.append(1.0 - min(abs(frac - mid) / half, 1.0) * 0.35)

    yaw = m.get("shoulder_yaw_deg")
    if yaw is not None:
        err = m.get("profile_yaw_error_deg", yaw)
        parts.append(float(np.clip(1.0 - err / 20.0, 0.2, 1.0)))

    for key, span in (("torso_lean_deg", MAX_TORSO_LEAN_DEG),
                      ("shoulder_tilt_deg", MAX_SHOULDER_TILT_DEG)):
        if key in m:
            parts.append(float(np.clip(1.0 - m[key] / (span * 1.5), 0.3, 1.0)))

    parts.append(float(np.clip(m.get("edge_sharpness", 0.7), 0.2, 1.0)))
    parts.append(float(np.clip(m.get("model_agreement", 0.9), 0.2, 1.0)))
    parts.append(float(np.clip(m.get("min_landmark_visibility", 0.8), 0.2, 1.0)))
    if chk.warnings:
        parts.append(max(0.75, 1.0 - 0.05 * len(chk.warnings)))
    return float(np.clip(np.mean(parts), 0.0, 1.0))
