"""
camera_calibration.py
=====================
NEW MODULE. Real camera intrinsic calibration + undistortion.

AUDIT FINDING THIS MODULE ADDRESSES
-----------------------------------
Before this module the project had *no camera calibration of any kind*:
no intrinsic matrix, no distortion coefficients, no focal length, no
undistortion step. `grep -i "intrinsic|distort|focal|calibrateCamera"`
over the whole repo matched only prose in docstrings. Every "calibration"
reference in measurements.py/side_measurements.py meant *pixel->cm scale*,
which is a different thing entirely.

Consequences of having no intrinsics:
  1. Lens distortion was never removed. The subject's head and feet sit
     within ~5% of the top/bottom image border (verified on the repo's own
     captures: silhouette top row 36/1080, bottom row clipped at 1079),
     which is exactly where radial distortion is largest. The head->floor
     span is the pixel reference the whole scale depends on, so distortion
     there propagates directly into every centimetre produced.
  2. Without a focal length there is no way to convert an apparent size
     into a camera-to-subject distance, so "stand 2m back" could never be
     verified - only guessed at from normalised shoulder width.
  3. There was no record of which camera/resolution/zoom produced a given
     capture, so a profile could not be checked against the capture.

WHAT THIS MODULE PROVIDES
-------------------------
  * `CameraProfile`  - fx, fy, cx, cy, dist coeffs, calibration resolution,
                       RMS reprojection error, camera identity string.
  * `.rescaled_to(w, h)` - adapts a profile to a different capture
    resolution. Distortion coefficients are defined in *normalised* camera
    coordinates and are therefore resolution independent; fx/fy/cx/cy are
    in pixels and must be rescaled. Aspect-ratio changes are detected and
    reported because they mean a sensor crop, not a plain resize, and a
    plain rescale would be wrong.
  * `.undistort(frame)` - cv2.undistort with alpha=0 so the output frame
    contains only valid pixels (no black wedges that would corrupt
    silhouette edge detection), returning the *new* intrinsics that
    describe the undistorted image.
  * `calibrate_from_chessboard_images()` - standard OpenCV chessboard
    calibration, plus a capture helper CLI.
  * `distance_from_stature_px()` / `pixel_scale_at_distance()` - pinhole
    relations used by the capture-distance gate and the scale module.

CLI
---
    python camera_calibration.py capture                # grab chessboard shots
    python camera_calibration.py solve <device name>     # solve + save under that device
    python camera_calibration.py show [device name]      # list saved devices, or print one

Profiles are stored per device model in camera_profile.json (see
"Multi-device profile storage" below) - one physical camera per device
name, looked up by an exact string match against what the candidate
enters on the scan-setup screen.
"""

from __future__ import annotations

import glob
import json
import os
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Tuple, List

import cv2
import numpy as np

CALIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "calibration")
DEFAULT_PROFILE_PATH = os.path.join(CALIB_DIR, "camera_profile.json")
CHESSBOARD_DIR = os.path.join(CALIB_DIR, "chessboard")

# Physical chessboard used for calibration. INNER corner counts, not squares.
# A standard printed 10x7-square board has 9x6 inner corners.
DEFAULT_BOARD_COLS = 9
DEFAULT_BOARD_ROWS = 6
DEFAULT_SQUARE_MM = 25.0


class CalibrationError(Exception):
    pass


@dataclass
class CameraProfile:
    """Intrinsics for one specific camera *in one specific capture mode*.

    A phone's "1x", "0.5x" and front cameras are three different optical
    systems and each needs its own profile. `camera_id` records which one
    this is so `assert_matches_capture()` can refuse to silently apply the
    wrong profile.
    """

    fx: float
    fy: float
    cx: float
    cy: float
    dist: List[float]                      # k1, k2, p1, p2, k3 [, k4..k6]
    width: int                             # resolution calibration ran at
    height: int
    camera_id: str = "unknown"
    rms_reproj_error: float = float("nan")  # px; < 0.5 is good, > 1.0 is poor
    n_views: int = 0
    created_at: float = field(default_factory=time.time)
    notes: str = ""

    # -- construction -----------------------------------------------------
    @property
    def K(self) -> np.ndarray:
        return np.array([[self.fx, 0.0, self.cx],
                         [0.0, self.fy, self.cy],
                         [0.0, 0.0, 1.0]], dtype=np.float64)

    @property
    def D(self) -> np.ndarray:
        return np.array(self.dist, dtype=np.float64).reshape(1, -1)

    @property
    def aspect(self) -> float:
        return self.width / float(self.height)

    def focal_px(self) -> float:
        """Single focal length in px. fx and fy differ only by pixel
        aspect; for the distance relations we want the vertical one because
        the reference span (stature) is vertical."""
        return float(self.fy)

    # -- resolution handling ---------------------------------------------
    def rescaled_to(self, width: int, height: int) -> Tuple["CameraProfile", Optional[str]]:
        """Return (profile valid at width x height, warning or None).

        Pixel-unit parameters scale with resolution; the normalised
        distortion coefficients do not. If the aspect ratio changed, the
        sensor was cropped rather than resampled and a uniform rescale is
        only approximately right - we still return a best-effort profile
        but attach a warning so callers can downgrade confidence.
        """
        if width == self.width and height == self.height:
            return self, None

        sx = width / float(self.width)
        sy = height / float(self.height)
        warning = None
        if abs(self.aspect - width / float(height)) > 0.01:
            warning = (
                f"Calibration was done at {self.width}x{self.height} "
                f"(aspect {self.aspect:.3f}) but capture is {width}x{height} "
                f"(aspect {width / height:.3f}). Different aspect ratio means "
                f"the sensor is cropped, not resized - re-run calibration in "
                f"the exact capture mode for full accuracy."
            )
        return (
            CameraProfile(
                fx=self.fx * sx, fy=self.fy * sy,
                cx=self.cx * sx, cy=self.cy * sy,
                dist=list(self.dist),
                width=width, height=height,
                camera_id=self.camera_id,
                rms_reproj_error=self.rms_reproj_error,
                n_views=self.n_views,
                created_at=self.created_at,
                notes=self.notes,
            ),
            warning,
        )

    # -- undistortion -----------------------------------------------------
    def undistort(self, frame: np.ndarray) -> Tuple[np.ndarray, "CameraProfile"]:
        """Undistort `frame`, returning (image, intrinsics of that image).

        alpha=0 asks OpenCV for the largest rectangle containing only valid
        (source-backed) pixels, so the result has no black border. That
        matters here: the silhouette top/bottom rows are the stature
        reference, and a black wedge at the frame edge would be segmented
        as background and shift them.
        """
        h, w = frame.shape[:2]
        prof, _ = self.rescaled_to(w, h)
        new_K, _roi = cv2.getOptimalNewCameraMatrix(prof.K, prof.D, (w, h), 0.0, (w, h))
        out = cv2.undistort(frame, prof.K, prof.D, None, new_K)
        undistorted_profile = CameraProfile(
            fx=float(new_K[0, 0]), fy=float(new_K[1, 1]),
            cx=float(new_K[0, 2]), cy=float(new_K[1, 2]),
            dist=[0.0, 0.0, 0.0, 0.0, 0.0],       # by construction
            width=w, height=h,
            camera_id=self.camera_id,
            rms_reproj_error=self.rms_reproj_error,
            n_views=self.n_views,
            notes="undistorted",
        )
        return out, undistorted_profile

    def max_distortion_shift_px(self) -> float:
        """How far the worst-affected pixel moves during undistortion.

        This is the honest, quantitative answer to "does distortion matter
        for my camera?" - if it is under ~1px the lens is effectively
        rectilinear and undistortion changes nothing; if it is 20px on a
        1080-tall frame it is a ~2% error on the stature reference.
        """
        w, h = self.width, self.height
        pts = np.array([[[0, 0]], [[w - 1, 0]], [[0, h - 1]], [[w - 1, h - 1]],
                        [[w / 2, 0]], [[w / 2, h - 1]],
                        [[0, h / 2]], [[w - 1, h / 2]]], dtype=np.float64)
        new_K, _ = cv2.getOptimalNewCameraMatrix(self.K, self.D, (w, h), 0.0, (w, h))
        undist = cv2.undistortPoints(pts, self.K, self.D, P=new_K)
        return float(np.max(np.linalg.norm(undist.reshape(-1, 2) - pts.reshape(-1, 2), axis=1)))

    # -- persistence ------------------------------------------------------
    def save(self, path: str = DEFAULT_PROFILE_PATH) -> str:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(asdict(self), fh, indent=2)
        return path

    @staticmethod
    def load(path: str = DEFAULT_PROFILE_PATH) -> Optional["CameraProfile"]:
        if not os.path.exists(path):
            return None
        try:
            with open(path) as fh:
                data = json.load(fh)
            return CameraProfile(**data)
        except (ValueError, TypeError) as exc:
            raise CalibrationError(f"Corrupt camera profile at {path}: {exc}")

    def summary(self) -> dict:
        return {
            "camera_id": self.camera_id,
            "resolution": f"{self.width}x{self.height}",
            "fx": round(self.fx, 2), "fy": round(self.fy, 2),
            "cx": round(self.cx, 2), "cy": round(self.cy, 2),
            "principal_point_offset_px": [round(self.cx - self.width / 2, 1),
                                          round(self.cy - self.height / 2, 1)],
            "dist": [round(float(d), 6) for d in self.dist],
            "rms_reproj_error_px": round(self.rms_reproj_error, 4),
            "n_views": self.n_views,
            "max_distortion_shift_px": round(self.max_distortion_shift_px(), 2),
            "hfov_deg": round(2 * np.degrees(np.arctan(self.width / (2 * self.fx))), 1),
            "vfov_deg": round(2 * np.degrees(np.arctan(self.height / (2 * self.fy))), 1),
        }


# ---------------------------------------------------------------------------
# Pinhole relations. Used by capture_validation (distance gate) and
# scale_reference (depth-corrected scale).
# ---------------------------------------------------------------------------

def distance_from_size(real_size_cm: float, pixel_size: float, focal_px: float) -> float:
    """Z = f * X / x   (pinhole). Returns cm."""
    if pixel_size <= 0:
        raise CalibrationError("pixel_size must be positive")
    return focal_px * real_size_cm / pixel_size


def pixel_scale_at_distance(distance_cm: float, focal_px: float) -> float:
    """cm per pixel for a fronto-parallel plane at `distance_cm`.

    This is the relation that makes a scale reference *depth aware*:
    scale(Z) = Z / f. Two planes at different depths have different
    cm/px even in the same image, which is why a reference object must sit
    at the subject's own depth (see scale_reference.py).
    """
    if focal_px <= 0:
        raise CalibrationError("focal_px must be positive")
    return distance_cm / focal_px


# ---------------------------------------------------------------------------
# Chessboard calibration
# ---------------------------------------------------------------------------

def find_chessboard(gray: np.ndarray, cols: int, rows: int):
    flags = (cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE |
             cv2.CALIB_CB_FAST_CHECK)
    ok, corners = cv2.findChessboardCorners(gray, (cols, rows), flags)
    if not ok:
        return False, None
    corners = cv2.cornerSubPix(
        gray, corners, (11, 11), (-1, -1),
        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001))
    return True, corners


def calibrate_from_chessboard_images(
    image_paths: List[str],
    cols: int = DEFAULT_BOARD_COLS,
    rows: int = DEFAULT_BOARD_ROWS,
    square_mm: float = DEFAULT_SQUARE_MM,
    camera_id: str = "unknown",
) -> CameraProfile:
    """Standard OpenCV intrinsic calibration.

    Needs >= 10 views of the board at varied orientations/positions
    covering the frame corners; corner coverage is what constrains the
    radial terms, and a board that only ever appears in the middle of the
    frame produces distortion coefficients that are numerically fine and
    physically meaningless.
    """
    if len(image_paths) < 6:
        raise CalibrationError(
            f"Only {len(image_paths)} usable views. Capture at least 10-20 "
            f"chessboard photos covering the frame corners and several tilts."
        )

    objp = np.zeros((rows * cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2)
    objp *= (square_mm / 10.0)         # -> cm

    obj_points, img_points = [], []
    size = None
    used = 0
    for path in image_paths:
        img = cv2.imread(path)
        if img is None:
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if size is None:
            size = gray.shape[::-1]
        elif gray.shape[::-1] != size:
            raise CalibrationError(
                "All calibration images must share one resolution; "
                f"{path} is {gray.shape[::-1]}, expected {size}."
            )
        ok, corners = find_chessboard(gray, cols, rows)
        if ok:
            obj_points.append(objp.copy())
            img_points.append(corners)
            used += 1

    if used < 6:
        raise CalibrationError(
            f"Chessboard found in only {used} of {len(image_paths)} images. "
            f"Check the board is fully visible, flat, well lit and that "
            f"cols/rows ({cols}x{rows}) are INNER corner counts."
        )

    rms, K, D, _rvecs, _tvecs = cv2.calibrateCamera(
        obj_points, img_points, size, None, None)

    return CameraProfile(
        fx=float(K[0, 0]), fy=float(K[1, 1]),
        cx=float(K[0, 2]), cy=float(K[1, 2]),
        dist=[float(v) for v in D.ravel()],
        width=int(size[0]), height=int(size[1]),
        camera_id=camera_id,
        rms_reproj_error=float(rms),
        n_views=used,
        notes=f"chessboard {cols}x{rows} inner corners, {square_mm}mm squares",
    )


# ---------------------------------------------------------------------------
# Multi-device profile storage
# ---------------------------------------------------------------------------
# camera_profile.json holds ONE profile PER DEVICE MODEL, keyed by the exact
# device name the candidate types in on the scan-setup screen, e.g.:
#
#   {
#     "MacBook Air M3": { "fx": ..., "fy": ..., "cx": ..., "cy": ...,
#                         "dist": [...], "width": ..., "height": ... },
#     "iPhone 16 Plus": { ... }
#   }
#
# Lookup matches on the device name (whitespace/case-insensitive so a stray
# capital letter doesn't lock someone out, but never a PARTIAL or fuzzy
# match). There is deliberately no fallback to a different device's
# numbers: applying the wrong camera's intrinsics is worse than applying
# none (it silently makes the undistortion and distance checks wrong
# instead of just skipping them), so an unrecognised device name is
# reported as unsupported rather than borrowing someone else's calibration.

def load_device_profiles(path: str = DEFAULT_PROFILE_PATH) -> dict:
    """Raw {device_name: profile_fields} mapping. {} if the file is missing."""
    if not os.path.exists(path):
        return {}
    with open(path) as fh:
        try:
            data = json.load(fh)
        except ValueError as exc:
            raise CalibrationError(f"Corrupt camera profile file at {path}: {exc}")
    return data if isinstance(data, dict) else {}


def list_device_names(path: str = DEFAULT_PROFILE_PATH) -> List[str]:
    """Every device model that has a saved calibration, for the frontend's
    device-name input suggestions."""
    return sorted(load_device_profiles(path).keys())


def _normalize_device_name(name: str) -> str:
    return (name or "").strip().lower()


def resolve_device_name(device_model: str, path: str = DEFAULT_PROFILE_PATH
                        ) -> Optional[str]:
    """Case/whitespace-insensitive match against the saved device keys.

    Returns the profile's OWN stored spelling (so every downstream lookup
    uses one canonical name), or None if there is no match at all - never a
    partial or fuzzy one.
    """
    target = _normalize_device_name(device_model)
    if not target:
        return None
    for name in load_device_profiles(path):
        if _normalize_device_name(name) == target:
            return name
    return None


def is_device_supported(device_model: str, path: str = DEFAULT_PROFILE_PATH) -> bool:
    return resolve_device_name(device_model, path) is not None


def load_profile_for_device(device_model: str, path: str = DEFAULT_PROFILE_PATH
                            ) -> Optional["CameraProfile"]:
    """Exact (case/whitespace-insensitive) lookup of one device's profile.

    Returns None if the file doesn't exist or has no matching entry -
    callers must treat that as "this device is not supported", never as
    "use some other device's profile instead".
    """
    canonical = resolve_device_name(device_model, path)
    if canonical is None:
        return None
    data = dict(load_device_profiles(path)[canonical])
    data.setdefault("camera_id", canonical)
    try:
        return CameraProfile(**data)
    except TypeError as exc:
        raise CalibrationError(f"Corrupt camera profile for device {canonical!r}: {exc}")


def save_profile_for_device(device_model: str, profile: "CameraProfile",
                            path: str = DEFAULT_PROFILE_PATH) -> str:
    """Add/replace one device's entry without touching any other device's."""
    profiles = load_device_profiles(path)
    profiles[device_model] = asdict(profile)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(profiles, fh, indent=2)
    os.replace(tmp, path)
    return path


def load_profile_for_capture(width: int, height: int,
                             device_model: Optional[str] = None,
                             path: str = DEFAULT_PROFILE_PATH):
    """Load the named device's profile and adapt it to the capture resolution.

    Returns (profile_or_None, warnings[]). Neither a missing device_model
    nor an unrecognised one is an error here - the caller (app.py's /start)
    is what actually refuses the session for an unsupported device; this
    function just never substitutes a different device's numbers.
    """
    if not device_model:
        return None, ["No camera device was selected for this session, so "
                      "no per-device calibration profile could be applied. "
                      "Measurements will run in uncalibrated mode."]
    try:
        prof = load_profile_for_device(device_model, path)
    except CalibrationError as exc:
        return None, [str(exc)]
    if prof is None:
        return None, [
            f"No calibration profile found for \"{device_model}\" in {path}. "
            f"Running in uncalibrated mode."]
    warnings: List[str] = []
    scaled, warn = prof.rescaled_to(width, height)
    if warn:
        warnings.append(warn)
    if prof.rms_reproj_error > 1.0:
        warnings.append(
            f"Calibration RMS reprojection error for \"{device_model}\" is "
            f"{prof.rms_reproj_error:.2f}px (>1px). Recalibrate with sharper, "
            f"more varied board views.")
    return scaled, warnings


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cli_capture(cam_index=0, cols=DEFAULT_BOARD_COLS, rows=DEFAULT_BOARD_ROWS):
    os.makedirs(CHESSBOARD_DIR, exist_ok=True)
    cap = cv2.VideoCapture(cam_index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    if not cap.isOpened():
        raise CalibrationError("Could not open camera.")
    print("SPACE = save a view when the board is detected, q = quit.")
    print("Capture 15-20 views: board tilted left/right/up/down, near/far, "
          "and pushed into every frame CORNER (corner coverage is what "
          "constrains the distortion terms).")
    saved = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        found, corners = find_chessboard(gray, cols, rows)
        disp = frame.copy()
        if found:
            cv2.drawChessboardCorners(disp, (cols, rows), corners, found)
        cv2.putText(disp, f"saved={saved}  detected={found}", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9,
                    (0, 255, 0) if found else (0, 0, 255), 2)
        cv2.imshow("calibration capture", disp)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if key == ord(" ") and found:
            p = os.path.join(CHESSBOARD_DIR, f"cb_{int(time.time()*1000)}.png")
            cv2.imwrite(p, frame)
            saved += 1
            print("saved", p)
    cap.release()
    cv2.destroyAllWindows()


def _cli_solve(cols=DEFAULT_BOARD_COLS, rows=DEFAULT_BOARD_ROWS,
               square_mm=DEFAULT_SQUARE_MM, camera_id="default"):
    paths = sorted(glob.glob(os.path.join(CHESSBOARD_DIR, "*.png")) +
                   glob.glob(os.path.join(CHESSBOARD_DIR, "*.jpg")))
    prof = calibrate_from_chessboard_images(paths, cols, rows, square_mm, camera_id)
    out = save_profile_for_device(camera_id, prof)
    print(json.dumps(prof.summary(), indent=2))
    print(f"saved -> {out} (device \"{camera_id}\")")


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "show"
    if cmd == "capture":
        _cli_capture()
    elif cmd == "solve":
        _cli_solve(camera_id=sys.argv[2] if len(sys.argv) > 2 else "default")
    else:
        device_arg = sys.argv[2] if len(sys.argv) > 2 else None
        if device_arg:
            p = load_profile_for_device(device_arg)
            print(json.dumps(p.summary(), indent=2) if p else f"No profile saved for {device_arg!r}.")
        else:
            names = list_device_names()
            if not names:
                print("No profiles saved yet.")
            else:
                print("Saved device profiles:", ", ".join(names))
                print("Run: python camera_calibration.py show <device name>")
