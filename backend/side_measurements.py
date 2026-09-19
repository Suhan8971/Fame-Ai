"""
side_measurements.py
====================
LEFT / RIGHT / BACK view measurements. Same public API as before
(`compute_left_view_measurement`, `compute_right_view_measurement`,
`compute_back_view_measurement`, `compute_side_scale_cm_per_px`) -
REIMPLEMENTED internals.

WHAT WAS WRONG WITH THE PREVIOUS IMPLEMENTATION
------------------------------------------------
 1. THE SIDE VIEWS MEASURED NOTHING BUT AN ARM.
    `compute_left_view_measurement()` returned exactly one number,
    `left_sleeve_length`, and the right view its mirror. Body DEPTH - the
    only thing a side photograph uniquely provides, and the only route to
    a real circumference - was never extracted. That is why chest and
    waist had to be guessed from a multiple of shoulder width.
    FIXED: the side views now measure antero-posterior body depth at the
    chest, waist, hip and neck levels located in the front view, which
    circumference.estimate_circumference() combines with the front-view
    widths.

 2. THE BACK VIEW WAS A CROSS-CHECK THAT COULD NOT DIAGNOSE ITSELF.
    It produced `back_across_shoulder` purely so app.py could compare it
    with the front number and print "Consistent" or "Recheck". On this
    repo's captures it read 44.1cm against the front's 37.5cm - 17.6%
    apart - and the system had no way to say why, because the cause was
    in the shared scale code, not in either measurement.
    FIXED: the back view is now a full frontal-geometry view. It
    contributes a second independent width at every level, fused with the
    front by inverse-variance weighting, and the scale disagreement that
    caused the split is detected directly by
    multiview.check_scale_consistency().

 3. A SEPARATE, WEAKER SCALE PATH FOR SIDE VIEWS.
    `compute_side_scale_cm_per_px()` repeated the front view's
    face-landmark head-vertex extrapolation on a single visible side.
    Measured vertex error on this repo's side captures: +30px (left) and
    +45px (right), i.e. 5.1cm and 7.7cm of assumed stature - a 5-6% scale
    error, and different in each view, so the two arms could not agree.
    The stored left/right sleeve lengths differ by 7% for that reason.
    FIXED: one scale path for every view (scale_reference.resolve_scale),
    based on a reference marker where available and on the observed
    silhouette vertex-to-floor span otherwise.

 4. FALLING BACK TO A PROPORTION WHEN THE FEET WERE MISSING.
    On ankle failure it divided by HEAD_TO_HIP_HEIGHT_RATIO = 0.52. That
    number is a figure-drawing convention, it varies several percent
    between adults, and reaching for it silently converted a framing
    problem into a measurement error.
    REMOVED: a capture without visible feet is now rejected.

WHAT IS PRESERVED
-----------------
Function names, argument order, the {"cm": x, "in": y} value shape, the
`calibration_method` key, and the `draw_points` dict layout the overlay
code consumes.
"""

from __future__ import annotations

from measurements import (
    NOSE, LEFT_EYE, RIGHT_EYE, LEFT_SHOULDER, RIGHT_SHOULDER,
    LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST, RIGHT_WRIST, LEFT_HIP, RIGHT_HIP,
    LEFT_ANKLE, RIGHT_ANKLE, LEFT_HEEL, RIGHT_HEEL,
    ANKLE_HEIGHT_STATURE_FRACTION,
    compute_scale_cm_per_px, compute_measurements, MeasurementError,
    cm_in, _px, _dist, _midpoint, _visible,
)


def compute_side_scale_cm_per_px(landmarks, frame_w, frame_h, user_height_cm,
                                 side, silhouette=None):
    """cm-per-pixel for a side-profile view.

    Kept for API compatibility, but it is now the SAME calculation the
    front and back views use. There is no separate, weaker side path any
    more: the head vertex and floor contact are read from the silhouette,
    which is visible in a profile just as well as face-on. Requires
    `silhouette`; see measurements.compute_scale_cm_per_px for why the
    landmark-extrapolation version was removed.
    """
    return compute_scale_cm_per_px(landmarks, frame_w, frame_h,
                                   user_height_cm, silhouette=silhouette)


def _profile_view(side, landmarks, frame_w, frame_h, user_height_cm,
                  frame, segmentation_mask, world_landmarks, engine):
    """Shared body of the left/right view measurement."""
    if frame is None:
        raise MeasurementError(
            "Side-view measurement now needs the captured frame: body depth "
            "is read from the segmentation silhouette. Pass frame=<BGR "
            "image>, segmentation_mask=... and world_landmarks=...")
    if engine is None:
        raise MeasurementError(
            "Side views measure depth at the anatomical levels found in the "
            "front view, so they need the same MeasurementEngine instance "
            "the front view was processed with. Pass engine=<engine>.")

    vr = engine.process_view(side, frame, landmarks, world_landmarks, segmentation_mask)
    if not vr.ok:
        raise MeasurementError(vr.message)

    ana, scale = vr.anatomy, vr.scale
    to_cm = scale.to_cm
    p = ana.points

    sleeve_px = (_dist(p["shoulder"], p["elbow"]) + _dist(p["elbow"], p["wrist"]))
    sleeve_cm = to_cm(sleeve_px)

    results = {
        f"{side}_sleeve_length": cm_in(sleeve_cm),
        "calibration_method": scale.method,        # preserved key
        "scale": scale.summary(),
        "capture": vr.check.as_dict() if vr.check else None,
        "segmentation": vr.silhouette.summary() if vr.silhouette else None,
        "confidence": round(vr.confidence.combined(), 3) if vr.confidence else None,
        "height": cm_in(to_cm(ana.stature_px)),
        "warnings": list(vr.warnings),
        # THE POINT OF THIS VIEW: antero-posterior body depth at each
        # anatomical level, transferred from the front view by
        # stature-normalised height. Without these there is no
        # circumference, only a multiplier.
        "depths": {name: cm_in(to_cm(lv.width_px)) for name, lv in ana.levels.items()},
        "levels": {k: lv.as_dict() for k, lv in ana.levels.items()},
    }
    draw_points = {
        "shoulder": p["shoulder"], "elbow": p["elbow"], "wrist": p["wrist"],
        "levels": {k: (lv.y, lv.left_x, lv.right_x, lv.width_px)
                   for k, lv in ana.levels.items()},
        "silhouette": vr.silhouette,
        "floor_y": ana.floor_y,
    }
    return results, draw_points


def compute_left_view_measurement(landmarks, frame_w, frame_h, user_height_cm,
                                  frame=None, segmentation_mask=None,
                                  world_landmarks=None, engine=None):
    """Left profile: left sleeve length + body depth at every level."""
    return _profile_view("left", landmarks, frame_w, frame_h, user_height_cm,
                         frame, segmentation_mask, world_landmarks, engine)


def compute_right_view_measurement(landmarks, frame_w, frame_h, user_height_cm,
                                   frame=None, segmentation_mask=None,
                                   world_landmarks=None, engine=None):
    """Right profile: right sleeve length + body depth at every level."""
    return _profile_view("right", landmarks, frame_w, frame_h, user_height_cm,
                         frame, segmentation_mask, world_landmarks, engine)


def compute_back_view_measurement(landmarks, frame_w, frame_h, user_height_cm,
                                  frame=None, segmentation_mask=None,
                                  world_landmarks=None, engine=None):
    """Back view: a full second frontal observation, not just a check.

    Geometry from behind is identical to face-on, so the back view is run
    through exactly the same analysis as the front and yields an
    independent width at every anatomical level. Those are fused with the
    front view's rather than merely compared with them.
    """
    results, draw_points = compute_measurements(
        landmarks, frame_w, frame_h, user_height_cm,
        frame=frame, segmentation_mask=segmentation_mask,
        world_landmarks=world_landmarks, engine=engine, view="back")
    # Preserved key, so existing overlay/summary code keeps working.
    if "across_shoulder" in results:
        results["back_across_shoulder"] = results["across_shoulder"]
    return results, draw_points
