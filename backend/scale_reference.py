"""
scale_reference.py
==================
NEW MODULE. Establishes the pixels -> centimetres relationship.

AUDIT FINDING THIS MODULE ADDRESSES
-----------------------------------
The old scale came from `measurements.compute_scale_cm_per_px()`:

    head_top_y = eye_avg_y - 0.55 * |shoulder_y - eye_avg_y|
    scale      = user_height_cm / (ankle_y - head_top_y)

Three independent defects, all measured on this repo's own captures
(static/captures/, session 1788181*):

 (1) The head vertex is *extrapolated from face landmarks*. The offset
     `0.55 * eye-to-shoulder` is a made-up constant and the face landmarks
     it is built on are unreliable when the subject faces away. Measured
     error of the estimated vertex against the segmentation silhouette's
     actual top row: front +10px, left +30px, right +45px, back +30px.
     The 45px error on the right view is 7.7cm of assumed stature - a 6%
     scale error, i.e. ~6cm on a 100cm chest, from this term alone.

 (2) The ankle joint is used as the bottom of the body. The ankle is not
     the floor; the lateral malleolus sits ~4-5% of stature above ground.
     Using ankle-to-vertex as "height" makes the pixel reference too short
     and therefore cm/px too large - every measurement inflated ~4-5%.

 (3) Nothing checked the feet were actually IN FRAME. On all four of the
     repo's stored captures the silhouette runs into the bottom row of the
     image (row 1079 of 1080) and MediaPipe reports ankle visibility 0.80
     - 0.96 while clamping the joint to the frame edge. `visibility` is a
     confidence that the joint is *not occluded by the body*; it is not an
     in-frame test. In the back view this produced a stature reference of
     944px against the front view's 1075px - a 13.8% scale disagreement
     between two photos of the same person seconds apart, which is the
     direct cause of the 37.5cm vs 44.1cm front/back shoulder split the
     old cross-check reported.

WHAT THIS MODULE PROVIDES
-------------------------
Scale sources, in descending order of trustworthiness:

  1. ARUCO      - a printed marker of known side length placed at the
                  subject's standing plane. True metric reference,
                  independent of the user's self-reported height. With
                  intrinsics it also yields the marker's depth via PnP,
                  which lets us verify it really is at the subject's depth.
  2. CHESSBOARD - same idea using a printed chessboard (e.g. A4 sheet).
  3. STATURE    - fallback: the subject's own height against a silhouette
                  vertex-to-floor span. Now measured from the segmentation
                  mask (not extrapolated face landmarks) and extended from
                  the ankle to the true floor contact, and it REFUSES to
                  run when the silhouette touches a frame border.

DEPTH AWARENESS
---------------
A scale is only valid at one depth: scale(Z) = Z / f. A marker 40cm in
front of the subject at 250cm gives a scale 16% too small. So the marker
must sit at the subject's own standing plane, and when intrinsics are
available `verify_reference_depth()` checks that it does, using PnP for
the marker and the stature relation for the subject.

MEASUREMENT PLANE
-----------------
Silhouette widths are tangent to the body at its widest lateral points,
which lie on the body's central (coronal mid-) plane; silhouette depths
from a side view are tangent on the sagittal mid-plane. Both therefore
live at the subject's central axis depth, so a marker placed level with
the subject's standing spot - not in front of it - is the correct
reference. This is documented rather than assumed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, List

import cv2
import numpy as np

from camera_calibration import (CameraProfile, distance_from_size,
                                pixel_scale_at_distance)

# Default marker spec. Print at 100% scale and MEASURE the printed square
# with a ruler - printer scaling is a classic silent 2-4% error.
DEFAULT_ARUCO_DICT = "DICT_5X5_100"
DEFAULT_ARUCO_ID = 0
DEFAULT_MARKER_SIDE_CM = 16.0   # make_marker.py's A4 default; MEASURE your print

# Fraction of stature between the floor and the ankle joint centre.
# Source: ANSUR II / ISO 7250 lateral-malleolus height ~ 4.6% of stature
# (adult, shoes off). Used ONLY to extend the ankle landmark down to the
# floor when the feet are visible but the exact floor contact row is
# ambiguous; when the silhouette's own foot bottom is trustworthy that is
# preferred and this constant is not used at all.
ANKLE_HEIGHT_STATURE_FRACTION = 0.046


class ScaleError(Exception):
    pass


@dataclass
class ScaleEstimate:
    """cm per pixel, plus everything needed to judge whether to trust it."""
    cm_per_px: float
    method: str                       # aruco | chessboard | stature
    confidence: float                 # 0..1
    reference_depth_cm: Optional[float] = None   # depth the scale is valid at
    relative_uncertainty: float = 0.05           # 1-sigma, fractional
    warnings: List[str] = field(default_factory=list)
    detail: dict = field(default_factory=dict)

    def to_cm(self, px: float) -> float:
        return px * self.cm_per_px

    def summary(self) -> dict:
        return {
            "cm_per_px": round(self.cm_per_px, 6),
            "px_per_cm": round(1.0 / self.cm_per_px, 3) if self.cm_per_px else None,
            "method": self.method,
            "confidence": round(self.confidence, 3),
            "relative_uncertainty_pct": round(self.relative_uncertainty * 100, 2),
            "reference_depth_cm": (round(self.reference_depth_cm, 1)
                                   if self.reference_depth_cm else None),
            "warnings": list(self.warnings),
            **{k: v for k, v in self.detail.items()},
        }


# ---------------------------------------------------------------------------
# 1. ArUco marker
# ---------------------------------------------------------------------------

def _aruco_detector(dict_name: str):
    d = getattr(cv2.aruco, dict_name, None)
    if d is None:
        raise ScaleError(f"Unknown ArUco dictionary {dict_name!r}")
    dictionary = cv2.aruco.getPredefinedDictionary(d)
    params = cv2.aruco.DetectorParameters()
    # Sub-pixel corner refinement: without it, marker corners land on whole
    # pixels and a 20cm marker at 150px carries a ~0.7% quantisation error.
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    params.cornerRefinementWinSize = 5
    return cv2.aruco.ArucoDetector(dictionary, params)


def detect_aruco_scale(frame: np.ndarray,
                       marker_side_cm: float = DEFAULT_MARKER_SIDE_CM,
                       dict_name: str = DEFAULT_ARUCO_DICT,
                       marker_id: Optional[int] = DEFAULT_ARUCO_ID,
                       profile: Optional[CameraProfile] = None
                       ) -> Optional[ScaleEstimate]:
    """Detect the reference marker and derive cm/px from its side length.

    The four detected corners give four independent side measurements. We
    use their mean for the scale and their spread as the uncertainty: a
    marker that is tilted or partly motion-blurred produces unequal sides
    and is thereby self-reporting its own unreliability.

    `frame` must already be UNDISTORTED, otherwise the marker's apparent
    side length depends on where in the frame it sits.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    corners, ids, _ = _aruco_detector(dict_name).detectMarkers(gray)
    if ids is None or len(ids) == 0:
        return None

    ids = ids.flatten()
    idx = 0
    if marker_id is not None and marker_id in ids:
        idx = int(np.where(ids == marker_id)[0][0])
    quad = corners[idx].reshape(4, 2).astype(np.float64)

    sides = [float(np.linalg.norm(quad[i] - quad[(i + 1) % 4])) for i in range(4)]
    mean_side = float(np.mean(sides))
    if mean_side <= 1.0:
        return None
    side_spread = float(np.std(sides) / mean_side)

    warnings: List[str] = []
    # A square marker viewed square-on has 4 equal sides. Perspective tilt
    # breaks that, and a tilted marker's apparent side is foreshortened,
    # which biases the scale. 3% spread ~ 14 degrees of tilt.
    if side_spread > 0.03:
        warnings.append(
            f"Reference marker looks tilted or skewed (side lengths vary "
            f"{side_spread*100:.1f}%). Mount it flat and facing the camera.")

    cm_per_px = marker_side_cm / mean_side
    depth_cm = None
    if profile is not None:
        depth_cm = distance_from_size(marker_side_cm, mean_side, profile.focal_px())

    # Uncertainty: corner localisation ~0.3px on each of two corners, plus
    # the observed side spread, plus a printing-accuracy allowance.
    corner_noise = 0.45 / mean_side
    rel_unc = float(np.sqrt(corner_noise ** 2 + side_spread ** 2 + 0.005 ** 2))

    conf = float(np.clip(1.0 - side_spread * 8.0, 0.35, 0.99))
    if mean_side < 60:
        warnings.append(
            f"Reference marker is only {mean_side:.0f}px across. Use a "
            f"larger printed marker or move it closer for a stable scale.")
        conf *= 0.8

    return ScaleEstimate(
        cm_per_px=cm_per_px, method="aruco", confidence=conf,
        reference_depth_cm=depth_cm, relative_uncertainty=rel_unc,
        warnings=warnings,
        detail={"marker_id": int(ids[idx]), "marker_side_px": round(mean_side, 2),
                "marker_side_cm": marker_side_cm,
                "side_spread_pct": round(side_spread * 100, 2)},
    )


# ---------------------------------------------------------------------------
# 2. Chessboard reference
# ---------------------------------------------------------------------------

def detect_chessboard_scale(frame: np.ndarray, cols: int, rows: int,
                            square_cm: float,
                            profile: Optional[CameraProfile] = None
                            ) -> Optional[ScaleEstimate]:
    """cm/px from a printed chessboard of known square size at the
    subject's plane. Uses the median spacing between adjacent inner
    corners along both axes, which averages out per-corner noise over
    (cols-1)*rows + cols*(rows-1) independent samples."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    ok, corners = cv2.findChessboardCorners(
        gray, (cols, rows),
        cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE)
    if not ok:
        return None
    corners = cv2.cornerSubPix(
        gray, corners, (11, 11), (-1, -1),
        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001))
    grid = corners.reshape(rows, cols, 2)

    spacings = []
    spacings += [np.linalg.norm(grid[r, c + 1] - grid[r, c])
                 for r in range(rows) for c in range(cols - 1)]
    spacings += [np.linalg.norm(grid[r + 1, c] - grid[r, c])
                 for r in range(rows - 1) for c in range(cols)]
    spacings = np.asarray(spacings, dtype=np.float64)
    med = float(np.median(spacings))
    spread = float(np.std(spacings) / med)

    depth_cm = (distance_from_size(square_cm, med, profile.focal_px())
                if profile is not None else None)
    warnings = []
    if spread > 0.05:
        warnings.append(f"Chessboard appears tilted ({spread*100:.1f}% spacing "
                        f"variation). Hold it flat and parallel to the camera.")
    return ScaleEstimate(
        cm_per_px=square_cm / med, method="chessboard",
        confidence=float(np.clip(1.0 - spread * 6.0, 0.35, 0.98)),
        reference_depth_cm=depth_cm,
        relative_uncertainty=float(np.sqrt((0.3 / med) ** 2 + spread ** 2 + 0.005 ** 2)),
        warnings=warnings,
        detail={"square_px": round(med, 2), "square_cm": square_cm,
                "spacing_spread_pct": round(spread * 100, 2)},
    )


# ---------------------------------------------------------------------------
# 3. Stature fallback (replaces the old face-landmark method)
# ---------------------------------------------------------------------------

def stature_scale(vertex_y: float, floor_y: float, user_height_cm: float,
                  silhouette_touches_border: bool,
                  profile: Optional[CameraProfile] = None,
                  vertex_uncertainty_px: float = 4.0,
                  floor_uncertainty_px: float = 6.0) -> ScaleEstimate:
    """cm/px from the subject's own stature.

    `vertex_y` and `floor_y` come from the SEGMENTATION SILHOUETTE
    (body_segmentation.stature_span), not from face-landmark
    extrapolation. `floor_y` is the actual foot-ground contact row.

    Raises if the silhouette runs off a frame border, because then the
    span is a crop artefact rather than the person. That single check is
    what would have rejected all four of the repo's stored captures
    instead of silently producing a 13.8% scale disagreement.
    """
    if silhouette_touches_border:
        raise ScaleError(
            "Your head or feet are outside the frame. The whole body from "
            "the top of your head to the floor must be visible - step back "
            "or raise the camera, then try again.")
    span_px = floor_y - vertex_y
    if span_px <= 50:
        raise ScaleError("Could not measure your height in the image. "
                         "Make sure your whole body is visible.")

    cm_per_px = user_height_cm / span_px
    depth_cm = (distance_from_size(user_height_cm, span_px, profile.focal_px())
                if profile is not None else None)

    # Uncertainty is dominated by (a) endpoint localisation, and (b) the
    # user's self-reported height, which people round and misremember;
    # 1cm 1-sigma on a 175cm subject is 0.6%.
    endpoint_unc = float(np.hypot(vertex_uncertainty_px, floor_uncertainty_px) / span_px)
    rel_unc = float(np.sqrt(endpoint_unc ** 2 + (1.0 / user_height_cm) ** 2))

    return ScaleEstimate(
        cm_per_px=cm_per_px, method="stature",
        confidence=0.72,     # capped: depends on a self-reported number
        reference_depth_cm=depth_cm, relative_uncertainty=rel_unc,
        warnings=["Scale derived from your entered height. A printed "
                  "reference marker at your standing spot is more accurate "
                  "- see MEASUREMENT_PIPELINE.md."],
        detail={"stature_span_px": round(span_px, 1),
                "user_height_cm": user_height_cm},
    )


# ---------------------------------------------------------------------------
# Depth cross-check + orchestration
# ---------------------------------------------------------------------------

def verify_reference_depth(marker: ScaleEstimate, subject: ScaleEstimate,
                           tolerance_cm: float = 20.0) -> List[str]:
    """Check the marker really sits at the subject's depth.

    Needs intrinsics (both estimates carry a depth only when a profile was
    supplied). A marker `d` cm nearer than the subject makes every
    measurement small by d/Z; at Z=250cm a 30cm offset is a 12% error, far
    larger than anything else in the pipeline, so this is worth checking
    rather than trusting the setup instructions.
    """
    out: List[str] = []
    if marker.reference_depth_cm is None or subject.reference_depth_cm is None:
        return out
    delta = marker.reference_depth_cm - subject.reference_depth_cm
    if abs(delta) > tolerance_cm:
        out.append(
            f"Reference marker is {abs(delta):.0f}cm "
            f"{'in front of' if delta < 0 else 'behind'} you "
            f"(marker {marker.reference_depth_cm:.0f}cm, you "
            f"{subject.reference_depth_cm:.0f}cm from the camera). Move it "
            f"level with your standing spot - this offset alone is a "
            f"{abs(delta)/max(subject.reference_depth_cm,1)*100:.1f}% "
            f"measurement error.")
    return out


def resolve_scale(frame: np.ndarray,
                  vertex_y: Optional[float],
                  floor_y: Optional[float],
                  user_height_cm: Optional[float],
                  silhouette_touches_border: bool,
                  profile: Optional[CameraProfile] = None,
                  marker_side_cm: float = DEFAULT_MARKER_SIDE_CM,
                  marker_dict: str = DEFAULT_ARUCO_DICT,
                  marker_id: Optional[int] = DEFAULT_ARUCO_ID,
                  require_marker: bool = False) -> ScaleEstimate:
    """Pick the best available scale for one view.

    Marker first, stature second. When both are available we keep the
    marker (it does not depend on a self-reported height) but run the
    depth cross-check and copy any complaint onto the returned estimate.
    """
    marker_scale = None
    try:
        marker_scale = detect_aruco_scale(frame, marker_side_cm, marker_dict,
                                          marker_id, profile)
    except ScaleError:
        marker_scale = None

    stature = None
    stature_error = None
    if user_height_cm and vertex_y is not None and floor_y is not None:
        try:
            stature = stature_scale(vertex_y, floor_y, user_height_cm,
                                    silhouette_touches_border, profile)
        except ScaleError as exc:
            stature_error = exc

    if marker_scale is not None:
        if stature is not None:
            marker_scale.warnings += verify_reference_depth(marker_scale, stature)
            ratio = stature.cm_per_px / marker_scale.cm_per_px
            marker_scale.detail["stature_cross_check_ratio"] = round(ratio, 4)
            if abs(ratio - 1.0) > 0.08:
                marker_scale.warnings.append(
                    f"Marker scale and your entered height disagree by "
                    f"{abs(ratio-1)*100:.1f}%. Check the marker's printed size "
                    f"and your entered height.")
        return marker_scale

    if require_marker:
        raise ScaleError(
            "No reference marker detected. Place the printed marker at your "
            "standing spot, fully visible and unobstructed.")
    if stature is not None:
        return stature
    if stature_error is not None:
        raise stature_error
    raise ScaleError("No usable scale reference: no marker detected and no "
                     "height provided.")
