"""
measurements.py
===============
FRONT-VIEW measurement entry point. Same public API as before
(`compute_measurements`, `MeasurementError`, the landmark index constants
and the `_px`/`_dist`/`_visible` helpers that side_measurements.py
imports) - REIMPLEMENTED internals.

WHAT WAS WRONG WITH THE PREVIOUS IMPLEMENTATION
-----------------------------------------------
Verified against this repo's own stored captures (static/captures/,
session 1788181*), with the old code as it stood:

 1. SCALE FROM AN EXTRAPOLATED HEAD VERTEX
    `head_top_y = eye_y - 0.55 * |shoulder_y - eye_y|` invents the top of
    the head from face landmarks. Error against the real silhouette top:
    front +10px, left +30px, right +45px, back +30px - up to 7.7cm of
    assumed stature, a 6% scale error on its own. In the back view the
    face landmarks are barely meaningful at all.
    FIXED: the vertex now comes from the segmentation silhouette
    (body_segmentation.Silhouette.vertex_y), which is directly observed.

 2. ANKLE USED AS THE FLOOR
    `scale = height_cm / (ankle_y - head_top_y)` treats the ankle joint as
    ground level. The ankle sits ~4.6% of stature above the floor, so the
    pixel reference was short and every centimetre came out ~4-5% large.
    FIXED: the floor contact row of the silhouette is used, and captures
    where the feet leave the frame are rejected outright.

 3. NO CHECK THAT THE BODY WAS IN FRAME
    `visibility >= 0.4` was treated as an in-frame test. It is not - it
    scores occlusion by the body, and stays high for a joint clamped to
    the image border. All four stored captures have the feet cut off and
    all four passed. The front view then implied 1075px of stature and the
    back view 944px for the same person: a 13.8% scale disagreement, which
    is the whole of the 37.5cm-vs-44.1cm front/back shoulder split the old
    cross-check reported and could not explain.
    FIXED: capture_validation.validate_capture() rejects border contact.

 4. WIDTHS TAKEN BETWEEN JOINT CENTRES
    `chest_left_x = l_shoulder.x + (l_hip.x - l_shoulder.x) * 0.35` is a
    point on the line between two joints INSIDE the body. It is not the
    body outline. On the stored front capture it gives 36.5cm at the
    shoulder line where the silhouette is 49.3cm.
    FIXED: widths are read off the segmentation silhouette with sub-pixel
    edge interpolation (body_segmentation.Silhouette.edges_at).

 5. CIRCUMFERENCE FROM A CONSTANT
    `chest = across_shoulder * 2.20 * (measured_ratio / 0.80)`. The
    correction term barely varied (see 4), so the output collapsed onto
    the constant. It produced a 60.9cm waist - 24 inches - for an adult
    male. There was no depth information anywhere in the pipeline.
    FIXED: circumference now needs a width AND a depth and is computed by
    circumference.estimate_circumference(); depth comes from the side
    views. That means chest/waist/hip/collar are NOT available from the
    front view alone and this module no longer pretends otherwise - they
    appear once all four views are captured.

 6. HARDCODED PROPORTIONS
    Removed: CHEST_FROM_SHOULDER_FACTOR (2.20), WAIST_FROM_SHOULDER_FACTOR
    (1.95), COLLAR_FROM_SHOULDER_FACTOR (0.85), BASELINE_CHEST_WIDTH_RATIO
    (0.80), BASELINE_WAIST_WIDTH_RATIO (0.72), CHEST_LEVEL_FRACTION (0.35),
    WAIST_LEVEL_FRACTION (0.95), HEAD_TO_HIP_HEIGHT_RATIO (0.52),
    SHIRT_LENGTH_EXTENSION_FACTOR (1.20) and the 0.55 head-vertex offset.
    Every one of them asserted a body proportion the photograph could have
    measured instead.

WHAT IS PRESERVED
-----------------
Landmark constants, exception type, helper functions, function names and
the {"cm": x, "in": y} value shape the frontend renders.
"""

from __future__ import annotations

import math

# --- MediaPipe Pose landmark indices (unchanged) ---------------------------
NOSE = 0
LEFT_EYE = 2
RIGHT_EYE = 5
LEFT_EAR = 7
RIGHT_EAR = 8
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_ANKLE = 27
RIGHT_ANKLE = 28
LEFT_HEEL = 29
RIGHT_HEEL = 30
LEFT_FOOT_INDEX = 31
RIGHT_FOOT_INDEX = 32

# The only anthropometric constant left in the system, and it is used for
# ONE narrow purpose: reporting how far above the floor the ankle joint
# sits, for diagnostics and for the (deprecated) legacy scale helper. It
# never enters a released measurement - the floor is observed from the
# silhouette instead. Source: ISO 7250 / ANSUR II lateral malleolus height.
ANKLE_HEIGHT_STATURE_FRACTION = 0.046


class MeasurementError(Exception):
    """Raised when a frame cannot yield a trustworthy measurement.

    The message is user-facing and says what to change about the capture.
    """


# --- helpers (unchanged signatures; side_measurements.py imports these) ----

def _px(landmark, w, h):
    return landmark.x * w, landmark.y * h


def _dist(p1, p2):
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def _midpoint(p1, p2):
    return (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2


def _visible(lm, indices, threshold=0.4):
    """Landmark-confidence test.

    NOTE, and this was the single most consequential misunderstanding in
    the old code: `visibility` says how sure the model is that a joint is
    not hidden BY THE BODY. It says nothing about whether the joint is
    inside the image. A joint clamped to the frame edge keeps a high
    visibility. Use capture_validation.validate_capture() for framing.
    """
    return all(lm[i].visibility >= threshold for i in indices)


def cm_in(cm: float) -> dict:
    return {"cm": round(cm, 1), "in": round(cm / 2.54, 1)}


def compute_scale_cm_per_px(landmarks, frame_w, frame_h, user_height_cm,
                            silhouette=None):
    """cm-per-pixel from the subject's stature.

    Kept for API compatibility. The old landmark-extrapolation body is
    GONE: pass `silhouette` (a body_segmentation.Silhouette) and the scale
    is derived from the observed head vertex and floor contact. Without
    one this raises, rather than falling back to the estimate that caused
    the 13.8% cross-view scale disagreement documented above.
    """
    from scale_reference import stature_scale, ScaleError
    if silhouette is None:
        raise MeasurementError(
            "compute_scale_cm_per_px() now needs the body silhouette. The "
            "old face-landmark head-vertex estimate was the pipeline's "
            "largest error source (up to 7.7cm of assumed stature). Use "
            "measurement_pipeline.MeasurementEngine, which builds the "
            "silhouette for you.")
    try:
        est = stature_scale(silhouette.vertex_y, silhouette.bottom_y,
                            user_height_cm, silhouette.touches_border)
    except ScaleError as exc:
        raise MeasurementError(str(exc)) from exc
    return est.cm_per_px, est.method


# ---------------------------------------------------------------------------
# Front-view measurement
# ---------------------------------------------------------------------------

def compute_measurements(landmarks, frame_w, frame_h, user_height_cm,
                         frame=None, segmentation_mask=None,
                         world_landmarks=None, engine=None, view="front"):
    """Measure what a FRONT (or BACK) view can honestly provide on its own.

    Signature is backwards compatible - the four original positional
    arguments are unchanged - with the extra inputs the corrected pipeline
    requires supplied as keywords.

    Returns (results, draw_points), same as before.

    `results` keys:
        across_shoulder   acromion to acromion, from the silhouette
        chest_width       front-view width at the chest level (NOT a
                          circumference - that needs the side views)
        waist_width, hip_width, neck_width
        torso_length      neck base to hip level
        inseam            crotch to floor
        levels            where each level was found and how
        scale             the scale estimate and its method
        capture           the quality-gate result
        calibration_method  preserved key: the scale method name

    Raises MeasurementError if the frame does not pass the quality gate.
    Producing a number from a rejected frame is the failure mode this
    rewrite exists to prevent.
    """
    if frame is None:
        raise MeasurementError(
            "compute_measurements() now needs the captured frame. Body "
            "widths are read from the segmentation silhouette; the old "
            "joint-interpolated widths under-read the shoulder line by 26% "
            "on this project's own captures. Pass frame=<BGR image>, "
            "segmentation_mask=<pose result .segmentation_mask> and "
            "world_landmarks=<pose result .pose_world_landmarks>.")

    from measurement_pipeline import MeasurementEngine

    eng = engine or MeasurementEngine(user_height_cm=user_height_cm)
    vr = eng.process_view(view, frame, landmarks, world_landmarks, segmentation_mask)
    if not vr.ok:
        raise MeasurementError(vr.message)

    ana, scale = vr.anatomy, vr.scale
    to_cm = scale.to_cm

    results = {
        "calibration_method": scale.method,          # preserved key
        "scale": scale.summary(),
        "capture": vr.check.as_dict() if vr.check else None,
        "segmentation": vr.silhouette.summary() if vr.silhouette else None,
        "confidence": round(vr.confidence.combined(), 3) if vr.confidence else None,
        "levels": {k: lv.as_dict() for k, lv in ana.levels.items()},
        "height": cm_in(to_cm(ana.stature_px)),
        "warnings": list(vr.warnings),
        "note": ("Chest, waist, hip and collar are circumferences and need "
                 "the left/right views for body depth; they appear in the "
                 "final summary once all four views are captured."),
    }
    if "shoulder" in ana.levels:
        results["across_shoulder"] = cm_in(to_cm(ana.levels["shoulder"].width_px))
    for level, key in (("chest", "chest_width"), ("waist", "waist_width"),
                       ("hip", "hip_width"), ("neck", "neck_width")):
        if level in ana.levels:
            results[key] = cm_in(to_cm(ana.levels[level].width_px))
    if "neck" in ana.levels and "hip" in ana.levels:
        results["torso_length"] = cm_in(
            to_cm(ana.levels["hip"].y - ana.levels["neck"].y))
    if "crotch" in ana.levels:
        results["inseam"] = cm_in(to_cm(ana.floor_y - ana.levels["crotch"].y))

    p = ana.points
    draw_points = {
        "left_shoulder": p.get("shoulder_l"), "right_shoulder": p.get("shoulder_r"),
        "left_hip": p.get("hip_l"), "right_hip": p.get("hip_r"),
        "left_elbow": p.get("elbow_l"), "right_elbow": p.get("elbow_r"),
        "left_wrist": p.get("wrist_l"), "right_wrist": p.get("wrist_r"),
        "acromion_left": p.get("acromion_left"), "acromion_right": p.get("acromion_right"),
        "vertex": p.get("vertex"),
        "floor_y": ana.floor_y,
        "levels": {k: (lv.y, lv.left_x, lv.right_x, lv.width_px)
                   for k, lv in ana.levels.items()},
        "silhouette": vr.silhouette,
    }
    if p.get("shoulder_l") and p.get("shoulder_r"):
        draw_points["shoulder_mid"] = _midpoint(p["shoulder_l"], p["shoulder_r"])
    if p.get("hip_l") and p.get("hip_r"):
        draw_points["hip_mid"] = _midpoint(p["hip_l"], p["hip_r"])

    return results, draw_points
