"""
app.py
------
Front view logic is UNCHANGED from the original single-view version:
check_alignment(), the front capture block (compute_measurements +
draw_measurement_overlay), and the shirt-outline-detector preview are all
untouched -- just now gated to only run during the "front" step of a larger
4-view sequence: Front -> Left -> Right -> Back.

NEW in this version:
  - A view sequence state machine (VIEW_ORDER) that walks the person
    through Front, Left, Right, Back automatically
  - check_side_alignment() for the Left/Right profile views (new)
  - Back view reuses check_alignment() (same geometry as front, just facing
    away from the camera)
  - Left/Right/Back captures use side_measurements.py (new) +
    draw_overlay.py's new draw_sleeve_overlay/draw_back_shoulder_overlay
  - A cross-verification summary once all 4 views are captured: Front vs
    Back shoulder width, and Front vs (Left+Right averaged) sleeve length
  - /retake_current to redo just the view you're on

FASHION-SHOW INTEGRATION (migrated from shirt-new-app-1):
  The measurement, capture, overlay and try-on code below is the
  shirt-new-app-1 implementation. Only the web layer was adapted so the
  React frontend can drive it:
  - CORS for the Vite frontend (CORS_ORIGINS in .env)
  - the webcam opens when a model starts a scan (not at server boot) and is
    released again via /stop_camera when they leave the capture page
  - /start optionally records which Fashion-Show model is being scanned;
    /api/models/save_session persists the finished session (model_store.py)
    so the Recruiters section can open it
  - /api/virtual-try-on accepts model_id to try a shirt on a stored model's
    front photo (without it, the current session's front view is used, as
    before). The hard-coded sample shirts were removed.
  - the HTML template route is gone; the UI lives in ../frontend

Run:
    pip install -r requirements.txt
    python app.py
The API listens on http://127.0.0.1:5050 (SCANNER_PORT in .env).
"""

import os
import time
import threading
from types import SimpleNamespace

import cv2
import mediapipe as mp
import numpy as np
from flask import Flask, Response, request, jsonify
from flask_cors import CORS

import model_store
import auth_store
from shirt_outline_detector import get_torso_box, segment_shirt_grabcut, draw_shirt_outline
from measurements import compute_measurements, MeasurementError
from draw_overlay import (draw_measurement_overlay, draw_sleeve_overlay,
                          draw_back_shoulder_overlay, draw_view_overlay)
from side_measurements import (
    compute_left_view_measurement,
    compute_right_view_measurement,
    compute_back_view_measurement,
)
# --- corrected measurement pipeline -------------------------------------
# The capture gate, scale reference, silhouette analysis and multi-view
# fusion all live behind MeasurementEngine. app.py stays a web/state-machine
# layer; see MEASUREMENT_PIPELINE.md for the audit that motivated this.
from measurement_pipeline import MeasurementEngine
from body_segmentation import build_silhouette, SegmentationError
from capture_validation import validate_capture
import camera_calibration
from camera_calibration import CameraProfile
from virtual_tryon import overlay_shirt_on_body, remove_solid_background
from vton_engine import (
    VTONInferenceEngine,
    validate_and_load_image,
    prepare_person_image,
    prepare_garment_image,
    fit_to_aspect_ratio,
)
from inference_worker import InferenceProcessManager
from openai_vton_engine import closest_supported_size

vton_engine = VTONInferenceEngine()
inference_lock = threading.Lock()
# Constructed inside `if __name__ == "__main__":` below, not here: it starts
# a real OS process, and multiprocessing's "spawn" start method (macOS
# default) re-executes this file in the child with __name__=="__mp_main__"
# to bootstrap -- constructing it at true module top-level would make the
# child ALSO try to spawn a worker process during its own bootstrap, which
# Python's multiprocessing safety check correctly refuses (RuntimeError:
# "attempt... before the current process has finished its bootstrapping").
inference_process_manager = None
INFERENCE_TIMEOUT_SECONDS = 60

mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils

CAPTURE_DIR = os.path.join(os.path.dirname(__file__), "static", "captures")
os.makedirs(CAPTURE_DIR, exist_ok=True)
os.makedirs(model_store.MODELS_DIR, exist_ok=True)

# openai_vton_engine (imported above via vton_engine) has already loaded
# ./.env into os.environ, so these settings can live there too.
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "0"))
SCANNER_PORT = int(os.environ.get("SCANNER_PORT", "5050"))
CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,"
    "http://localhost:4173,http://127.0.0.1:4173",
).split(",") if o.strip()]

app = Flask(__name__)
CORS(app, origins=CORS_ORIGINS)

# ---------------------------------------------------------------------------
# View sequence
# ---------------------------------------------------------------------------
VIEW_ORDER = ["front", "left", "right", "back"]

VIEW_INSTRUCTIONS = {
    "front": "FRONT: face the camera squarely. Stand on the marked spot with your "
             "WHOLE body - top of head to the floor under your feet - inside the "
             "frame, and hold your arms about 15-20cm clear of your sides.",
    "left":  "LEFT: turn a full 90 degrees so your LEFT side faces the camera. "
             "Stay on the same spot. Body depth is measured from this photo, so a "
             "partial turn over-reads your chest and waist.",
    "right": "RIGHT: turn a full 90 degrees the other way, RIGHT side to the "
             "camera. Same spot again.",
    "back":  "BACK: turn all the way around, back to the camera, same spot. Arms "
             "still 15-20cm clear of your sides.",
}

# ---------------------------------------------------------------------------
# CAPTURE STANDARD - enforced, not merely suggested
# ---------------------------------------------------------------------------
# The single largest error in the previous version came from the subject
# standing at a different distance in each shot: the four stored captures
# implied body heights 13.8% apart, which propagated straight into a
# 17.6% front-vs-back shoulder disagreement. These are the conditions the
# quality gate now enforces per view (capture_validation.py):
#
#   * whole body in frame, head vertex and floor contact both visible
#     (the silhouette must not touch ANY frame border)
#   * subject fills 60-88% of the frame height  -> fixed distance band
#   * subject centred within 32-68% of frame width
#   * shoulders square within 12 deg (front/back) or 90+-15 deg (sides)
#   * torso lean < 6 deg, shoulders level within 6 deg, knees straight
#   * arms visibly clear of the torso at the waist
#   * lighting bright enough and the outline separable from the background
#
# SETUP (do this once, then do not move anything):
#   1. Mark the standing spot on the floor with tape.
#   2. Put the camera on a tripod at chest height, level (not tilted),
#      2.5-3.5m from the mark, and do not change zoom between views.
#   3. Calibrate the camera:  python camera_calibration.py capture / solve
#   4. Optional but strongly recommended: print the ArUco scale marker and
#      stand it at the mark, at the subject's own depth. It removes the
#      dependence on the subject's self-reported height entirely.
#   5. Wear fitted clothing and take your shoes off.

# Machine-readable form of the capture standard above, served to the UI so
# the requirements are stated to the user rather than buried in a comment.
CAPTURE_STANDARD = {
    "camera_distance_m": [2.5, 3.5],
    "camera_height": "chest height, level (no tilt)",
    "camera_zoom": "fixed - must not change between views",
    "subject_frame_fill_pct": [60, 88],
    "subject_centre_pct": [32, 68],
    "max_yaw_deg_frontal": 12,
    "profile_yaw_deg": [75, 105],
    "max_torso_lean_deg": 6,
    "max_shoulder_tilt_deg": 6,
    "arm_clearance_cm": [15, 20],
    "footwear": "shoes off",
    "clothing": "fitted - loose clothing lowers confidence and is flagged",
    "floor_mark": "required: the same standing spot for all four views",
    "scale_reference": "printed ArUco marker at the standing spot (optional "
                       "but removes reliance on self-reported height)",
    "whole_body_in_frame": True,
}


# ---------------------------------------------------------------------------
# Shared state (protected by a lock since the camera runs in a background
# thread while Flask serves requests on other threads)
# ---------------------------------------------------------------------------
state_lock = threading.Lock()
state = {
    "mode": "idle",          # idle -> aligning -> countdown -> view_captured -> ... -> summary
    "message": "Enter your height to begin.",
    "aligned_frames": 0,
    "countdown_value": None,
    "user_height_cm": None,
    "device_model": None,      # exact camera/device name the candidate entered, e.g. "MacBook Air M3"
    "view": "front",
    "views_data": {},        # view_name -> {"result": {...}, "image_url": "..."}
    "summary": None,         # fused body model + quality gate, once all views done
    "view_captured_at": None,
    # The engine carries the four views' analyses AND the anatomical level
    # positions found in the front view, which the side views need in order
    # to read depth at the same heights. It must therefore live across the
    # whole capture sequence and be reset when the sequence restarts.
    "engine": None,
    "last_rejection": None,  # why the most recent capture attempt was refused
    "rejected_at": None,     # when, so the reason can be held on screen
    "blocking_reasons": [],  # live: everything currently preventing a capture
    "model": None,           # Fashion-Show model being scanned: {"id", "name", "email"}
}

latest_jpeg = None           # latest annotated live frame, for MJPEG stream
jpeg_lock = threading.Lock()

# Alignment tuning
FRAMES_NEEDED_TO_TRIGGER = 20   # ~ how long you must hold still (at ~20fps -> ~1s)
COUNTDOWN_SECONDS = 3
VIEW_CAPTURED_PAUSE_SECONDS = 2.5  # how long to pause on "captured!" before next view
# Cross-view agreement thresholds now live with the fusion logic
# (multiview.WIDTH_CONSISTENCY_WARN = 6%, DEPTH_ASYMMETRY_WARN = 8%). The old
# 15% here was far too loose to be meaningful: two photos of the same
# shoulder 14.9% apart were reported as "Consistent".
REJECTED_PAUSE_SECONDS = 3.0   # how long to show a rejection before retrying
STOP_THREAD = False


# ---------------------------------------------------------------------------
# LIVE ALIGNMENT GUIDANCE
# ---------------------------------------------------------------------------
# These run every frame, so they must stay cheap. They are GUIDANCE ONLY -
# they help the person get into position. The authoritative decision about
# whether a frame is measurable is made once, at capture time, by
# capture_validation.validate_capture() inside MeasurementEngine, which does
# the full silhouette, orientation, posture and lighting analysis.
#
# The previous version had no such separation: the cheap landmark checks WERE
# the gate, and because none of them tested whether the body was actually
# inside the frame, all four of the stored captures - every one with the feet
# cropped off - were accepted and measured.
# ---------------------------------------------------------------------------

LIVE_MIN_STATURE_FRAC = 0.60
LIVE_MAX_STATURE_FRAC = 0.88
LIVE_BORDER_MARGIN_PX = 4


def framing_guidance(seg_mask, frame_h, frame_w):
    """Cheap in-frame / distance check straight off the pose segmentation mask.

    This is the check whose absence caused the largest error in the old
    pipeline. It costs a couple of milliseconds because the mask comes back
    from MediaPipe for free once enable_segmentation=True is set - a flag the
    old code never set, which is why its segmentation only ever drew a
    preview outline and never informed a decision.

    Returns (ok, message, stature_fraction).
    """
    if seg_mask is None:
        return True, None, None
    binary = seg_mask > 0.5
    rows = np.flatnonzero(binary.any(axis=1))
    cols = np.flatnonzero(binary.any(axis=0))
    if rows.size == 0:
        return False, "Step into the frame.", None

    top, bottom = int(rows[0]), int(rows[-1])
    left, right = int(cols[0]), int(cols[-1])
    if bottom >= frame_h - 1 - LIVE_BORDER_MARGIN_PX:
        return False, "Your FEET are cut off - step back.", None
    if top <= LIVE_BORDER_MARGIN_PX:
        return False, "The top of your HEAD is cut off - step back.", None
    if left <= LIVE_BORDER_MARGIN_PX or right >= frame_w - 1 - LIVE_BORDER_MARGIN_PX:
        return False, "You are touching the side of the frame - move in.", None

    frac = (bottom - top) / float(frame_h)
    if frac < LIVE_MIN_STATURE_FRAC:
        return False, f"Too far away ({frac*100:.0f}% of frame) - move closer.", frac
    if frac > LIVE_MAX_STATURE_FRAC:
        return False, f"Too close ({frac*100:.0f}% of frame) - step back.", frac
    return True, None, frac


def check_alignment(landmarks, frame_w, frame_h, seg_mask=None):
    """Live guidance for the FRONT and BACK views.

    Same name and signature as before (seg_mask is optional and additive) so
    nothing that calls it breaks. Two substantive changes:
      * it now consults framing_guidance() first, so "step back until your
        whole body is visible" is driven by the actual silhouette rather
        than by landmark visibility scores that stay high for joints clamped
        to the frame edge;
      * the shoulder-width distance proxy is gone. It was a normalised
        width compared against fixed 0.08/0.45 bounds, which conflates
        distance with build - a broad person at the right distance and a
        slim person too close read the same. Stature fraction measures
        distance directly.
    """
    ok, msg, _ = framing_guidance(seg_mask, frame_h, frame_w)
    if not ok:
        return False, msg

    lm = landmarks.landmark
    needed = [
        mp_pose.PoseLandmark.LEFT_SHOULDER, mp_pose.PoseLandmark.RIGHT_SHOULDER,
        mp_pose.PoseLandmark.LEFT_HIP, mp_pose.PoseLandmark.RIGHT_HIP,
        mp_pose.PoseLandmark.LEFT_ELBOW, mp_pose.PoseLandmark.RIGHT_ELBOW,
        mp_pose.PoseLandmark.LEFT_WRIST, mp_pose.PoseLandmark.RIGHT_WRIST,
        mp_pose.PoseLandmark.LEFT_ANKLE, mp_pose.PoseLandmark.RIGHT_ANKLE,
        mp_pose.PoseLandmark.NOSE,
    ]
    if any(lm[p].visibility < 0.5 for p in needed):
        return False, "Stand clear so your whole body is unobstructed."

    l_sh = lm[mp_pose.PoseLandmark.LEFT_SHOULDER]
    r_sh = lm[mp_pose.PoseLandmark.RIGHT_SHOULDER]

    if abs(l_sh.y - r_sh.y) > 0.04:
        return False, "Level your shoulders and stand up straight."

    center_x = (l_sh.x + r_sh.x) / 2
    if center_x < 0.32 or center_x > 0.68:
        return False, "Move to the centre of the frame."

    l_wrist = lm[mp_pose.PoseLandmark.LEFT_WRIST]
    r_wrist = lm[mp_pose.PoseLandmark.RIGHT_WRIST]
    if l_wrist.y < l_sh.y or r_wrist.y < r_sh.y:
        return False, "Relax your arms down by your sides."

    return True, "Hold still..."


def check_side_alignment(landmarks, frame_w, frame_h, side, seg_mask=None):
    """Live guidance for the LEFT / RIGHT profile views.

    Fixes the old version's scale-dependent turn test. It compared
    `abs(l_sh.x - r_sh.x)` - a fraction of frame width - against a fixed
    0.10, so the same threshold meant a 25 degree turn for someone standing
    close and a 60 degree turn for someone standing further back. Here the
    shoulder projection gap is normalised by the subject's own pixel
    stature, which makes it distance independent.
    """
    ok, msg, _ = framing_guidance(seg_mask, frame_h, frame_w)
    if not ok:
        return False, msg

    lm = landmarks.landmark
    PL = mp_pose.PoseLandmark
    near_shoulder = PL.LEFT_SHOULDER if side == "left" else PL.RIGHT_SHOULDER
    near_elbow = PL.LEFT_ELBOW if side == "left" else PL.RIGHT_ELBOW
    near_wrist = PL.LEFT_WRIST if side == "left" else PL.RIGHT_WRIST
    near_hip = PL.LEFT_HIP if side == "left" else PL.RIGHT_HIP
    near_ankle = PL.LEFT_ANKLE if side == "left" else PL.RIGHT_ANKLE

    needed = [near_shoulder, near_elbow, near_wrist, near_hip, near_ankle, PL.NOSE]
    if any(lm[p].visibility < 0.45 for p in needed):
        return False, f"Turn so your {side} side faces the camera."

    stature_px = None
    if seg_mask is not None:
        rows = np.flatnonzero((seg_mask > 0.5).any(axis=1))
        if rows.size:
            stature_px = float(rows[-1] - rows[0])

    l_sh, r_sh = lm[PL.LEFT_SHOULDER], lm[PL.RIGHT_SHOULDER]
    gap_px = abs(l_sh.x - r_sh.x) * frame_w
    if stature_px:
        if gap_px / stature_px > 0.075:
            return False, f"Turn further - show your {side} side squarely."
    elif abs(l_sh.x - r_sh.x) > 0.10:
        return False, f"Turn further - show your {side} side squarely."

    near_sh = lm[near_shoulder]
    if near_sh.x < 0.32 or near_sh.x > 0.68:
        return False, "Move to the centre of the frame."

    if lm[near_wrist].y < near_sh.y:
        return False, "Relax your arm down by your side."

    return True, "Hold still..."


# ---------------------------------------------------------------------------
# Live quality gate + on-screen feedback
# ---------------------------------------------------------------------------
# How often to run the FULL validate_capture() in the preview loop. Measured
# at 1080p on this machine: a fast silhouette is 19ms and validate_capture is
# 8ms, so every 3rd frame costs ~9ms/frame amortised on top of a 16ms pose
# pass - about 40fps, which is plenty. Running it every frame would be
# affordable too; every 3rd just leaves headroom on slower machines.
GATE_EVERY_N_FRAMES = 3

# The live gate builds its silhouette WITHOUT the ROI re-segmentation and
# guided-filter refinement that the capture path uses. That makes it ~4x
# faster, and it errs in the safe direction: the unrefined mask has a softer
# boundary, so its edge-sharpness score is LOWER than the capture path's.
# A frame that passes live will therefore also pass at capture on that
# criterion, rather than the other way round.
_gate_pose_static = None


def run_live_gate(view, frame, results):
    """Run the real capture gate on a live frame.

    Returns a CaptureCheck, or None if it could not be evaluated. This is the
    same function that judges the captured still, which is the point: the
    countdown is armed by the same test that decides whether the photo is
    usable, so the two can no longer disagree.
    """
    try:
        sil = build_silhouette(frame, results.segmentation_mask,
                               cross_check=False, refine=False)
        return validate_capture(view, results.pose_landmarks,
                                results.pose_world_landmarks, sil, frame,
                                mirrored=True)
    except SegmentationError:
        return None
    except Exception:
        # A live-preview helper must never take the camera thread down.
        return None


def capture_still_pose(frame):
    """Re-run pose on the captured still with the heavy model.

    The preview loop uses model_complexity=1 for speed (85ms vs 16ms per
    frame at complexity 2). The measurement itself deserves the best
    landmarks and the best segmentation available, and it only has to be
    paid once per view, so the still is re-analysed here with
    static_image_mode=True and complexity 2.
    """
    global _gate_pose_static
    if _gate_pose_static is None:
        _gate_pose_static = mp_pose.Pose(static_image_mode=True,
                                          model_complexity=2,
                                          enable_segmentation=True,
                                          min_detection_confidence=0.5)
    return _gate_pose_static.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))


def draw_gate_hud(display, check, view, fallback_message=None):
    """Show what is currently blocking a capture, right on the preview.

    Previously the only feedback was a single status line that the countdown
    overwrote, so a person standing wrongly got a 3-2-1 countdown and no
    photo, repeatedly, with nothing on screen saying why.
    """
    h, w = display.shape[:2]
    if check is None:
        if not fallback_message:
            return display
        check = SimpleNamespace(ok=False, failures=[fallback_message])
    if check.ok:
        cv2.putText(display, "READY", (w - 160, 40), cv2.FONT_HERSHEY_SIMPLEX,
                    0.9, (0, 0, 0), 5, cv2.LINE_AA)
        cv2.putText(display, "READY", (w - 160, 40), cv2.FONT_HERSHEY_SIMPLEX,
                    0.9, (0, 230, 90), 2, cv2.LINE_AA)
        return display

    lines = check.failures[:4]
    y = h - 22 - 30 * len(lines)
    overlay = display.copy()
    cv2.rectangle(overlay, (0, y - 34), (w, h), (0, 0, 0), -1)
    display = cv2.addWeighted(overlay, 0.55, display, 0.45, 0)
    cv2.putText(display, "FIX THIS BEFORE THE PHOTO IS TAKEN:", (20, y - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 200, 255), 2, cv2.LINE_AA)
    for i, f in enumerate(lines):
        cv2.putText(display, f"- {f[:88]}", (20, y + 22 + i * 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255, 255, 255), 1, cv2.LINE_AA)
    return display


def draw_rejection_banner(display, reason):
    """Full-frame banner shown while a refusal is being held on screen."""
    h, w = display.shape[:2]
    overlay = display.copy()
    cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), -1)
    display = cv2.addWeighted(overlay, 0.6, display, 0.4, 0)
    cv2.putText(display, "PHOTO NOT TAKEN", (20, 60), cv2.FONT_HERSHEY_SIMPLEX,
                1.1, (60, 60, 255), 3, cv2.LINE_AA)
    words, line, lines = str(reason).split(), "", []
    for word in words:
        if len(line) + len(word) + 1 > 52:
            lines.append(line); line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    for i, t in enumerate(lines[:6]):
        cv2.putText(display, t, (20, 110 + i * 34), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, (255, 255, 255), 2, cv2.LINE_AA)
    return display


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def build_summary(engine, views_data):
    """Fuse the four views into the final body model.

    REPLACES the old build_summary(), which did two things and neither of
    them was fusion: it copied each view's dict into the output verbatim,
    and it computed two percentage differences (front-vs-back shoulder,
    front-vs-side-average sleeve) against a 15% "consistent" threshold. On
    this repo's own captures that reported a 17.6% shoulder disagreement as
    "Recheck" with no explanation and no attempt to identify which view was
    at fault, while the real cause - a 13.8% scale difference between the
    photos - went unmentioned because nothing measured it.

    The new summary carries:
      * `body`         the fused measurements, each with a confidence and an
                       uncertainty in cm
      * `cross_checks` front-vs-back width and left-vs-right depth agreement
                       per level, plus the cross-view scale consistency that
                       explains most disagreements
      * `release`      whether the result is good enough to publish, and if
                       not, which views to retake and why
      * `front`/`left`/`right`/`back` - preserved, so existing UI keeps working
    """
    fused = engine.finalize()
    ms = fused.get("measurements", {})

    summary = {
        "body": ms,
        "cross_checks": fused.get("cross_checks", {}),
        "release": fused.get("release", {}),
        "warnings": fused.get("warnings", []),
        "camera_calibration": fused.get("camera_calibration", {}),
        "per_view": fused.get("per_view", {}),
        "scale_consistency": fused.get("scale_consistency"),
        "ok": fused.get("ok", False),
    }

    # --- backwards-compatible view blocks -------------------------------
    for v in VIEW_ORDER:
        summary[v] = dict((views_data.get(v) or {}).get("result") or {})

    def put(view, key, name):
        if name in ms:
            summary.setdefault(view, {})[key] = {"cm": ms[name]["cm"],
                                                 "in": ms[name]["in"],
                                                 "confidence": ms[name]["confidence"]}

    # The fused values are properties of the BODY, not of any one photo, so
    # they are surfaced under `body`. They are also mirrored onto the legacy
    # per-view keys the existing frontend reads, sourced from the fusion
    # rather than from a single view.
    put("front", "across_shoulder", "across_shoulder")
    put("front", "chest", "chest")
    put("front", "waist", "waist")
    put("front", "hip", "hip")
    put("front", "collar", "collar")
    put("front", "sleeve_length", "sleeve_length")
    put("front", "length", "torso_length")
    put("left", "left_sleeve_length", "left_sleeve_length")
    put("right", "right_sleeve_length", "right_sleeve_length")
    put("back", "back_across_shoulder", "across_shoulder")

    cc = summary["cross_checks"]
    sh = cc.get("shoulder_front_back", {})
    sl = cc.get("sleeve_left_right", {})
    summary["cross_check"] = {
        "front_shoulder_cm": sh.get("front_cm"),
        "back_shoulder_cm": sh.get("back_cm"),
        "shoulder_diff_pct": sh.get("diff_pct"),
        "shoulder_consistent": sh.get("consistent", True),
        "front_sleeve_cm": sl.get("left_cm"),
        "side_sleeve_avg_cm": sl.get("right_cm"),
        "sleeve_diff_pct": sl.get("diff_pct"),
        "sleeve_consistent": sl.get("consistent", True),
        "scale_consistency": fused.get("scale_consistency"),
    }
    return summary


def camera_loop():
    global latest_jpeg, STOP_THREAD

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        with state_lock:
            state["mode"] = "error"
            state["message"] = "Could not open webcam."
        return

    countdown_start_time = None
    gate_frame_counter = 0
    live_gate = None          # most recent FULL validate_capture() result

    # Live preview runs model_complexity=1. Measured on this machine at
    # 1080p: complexity 0 = 11ms, 1 = 16ms, 2 = 85ms. Running complexity 2
    # in the preview loop dropped the capture loop to ~12fps, which made
    # FRAMES_NEEDED_TO_TRIGGER take almost twice as long as intended.
    # The heavy model is used where it actually matters - once, on the
    # captured still, in capture_still_pose() below - so the measurement
    # still gets the best landmarks.
    # enable_segmentation stays on: the silhouette is the measurement
    # surface and the live gate needs it too.
    with mp_pose.Pose(model_complexity=1,
                       enable_segmentation=True,
                       smooth_segmentation=True,
                       min_detection_confidence=0.5,
                       min_tracking_confidence=0.5) as pose:

        while not STOP_THREAD:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.05)
                continue

            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            display = frame.copy()

            with state_lock:
                mode = state["mode"]
                user_height_cm = state["user_height_cm"]
                view = state["view"]

            if mode == "idle":
                cv2.putText(display, "Enter height and press Start", (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

            elif mode in ("aligning", "countdown"):
                cv2.putText(display, f"{view.upper()} VIEW", (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = pose.process(rgb)

                if results.pose_landmarks:
                    mp_drawing.draw_landmarks(display, results.pose_landmarks,
                                               mp_pose.POSE_CONNECTIONS)

                    # Shirt-outline preview - ONLY for the front view, exactly
                    # as in the original single-view script
                    if view == "front":
                        box = get_torso_box(results.pose_landmarks, w, h)
                        if box is not None:
                            mask = segment_shirt_grabcut(display, box, iterations=1)
                            if mask is not None:
                                display = draw_shirt_outline(display, mask)

                    seg = results.segmentation_mask

                    # ---- Cheap per-frame guidance ----------------------
                    if view in ("front", "back"):
                        aligned, msg = check_alignment(results.pose_landmarks, w, h,
                                                       seg_mask=seg)
                    else:
                        aligned, msg = check_side_alignment(results.pose_landmarks, w, h,
                                                            side=view, seg_mask=seg)

                    # ---- The REAL gate, run live at a reduced rate ------
                    # BUG THIS FIXES: the countdown used to be armed by the
                    # cheap checks above, but the capture was judged by the
                    # full validate_capture(). The cheap checks are a strict
                    # subset, so a frame could pass them, run the whole
                    # 3-2-1 countdown, and then be refused - and because the
                    # next frame immediately overwrote state["message"] with
                    # "Hold still...", the refusal reason was never visible.
                    # The result was an endless 3-2-1-hold-3-2-1 loop with
                    # no photo and no explanation.
                    #
                    # Now the same validate_capture() that judges the
                    # capture also arms the countdown, so the countdown only
                    # ever starts when the capture will actually succeed,
                    # and its complaints are shown continuously instead of
                    # being discovered after a 4-second cycle.
                    gate_frame_counter += 1
                    if aligned and (gate_frame_counter % GATE_EVERY_N_FRAMES == 0
                                    or live_gate is None):
                        live_gate = run_live_gate(view, frame, results)
                    elif not aligned:
                        live_gate = None

                    gate_ok = bool(live_gate and live_gate.ok)
                    if aligned and live_gate is not None and not live_gate.ok:
                        # Show every blocking reason, not just the first, so
                        # the person can fix them all in one go rather than
                        # one per countdown cycle.
                        msg = " ".join(live_gate.failures[:3])
                        aligned = False

                    display = draw_gate_hud(display, live_gate, view,
                                            fallback_message=None if aligned else msg)

                    with state_lock:
                        if aligned and gate_ok:
                            state["aligned_frames"] += 1
                        else:
                            state["aligned_frames"] = 0
                            state["mode"] = "aligning"
                            countdown_start_time = None
                        state["message"] = msg
                        # Report every blocking reason to /status, whichever
                        # tier produced it. When the cheap per-frame check is
                        # the one that failed, the full gate never ran, so
                        # fall back to that message rather than reporting an
                        # empty list and leaving the UI with nothing to show.
                        if live_gate is not None and live_gate.failures:
                            state["blocking_reasons"] = list(live_gate.failures)
                        elif not aligned and msg:
                            state["blocking_reasons"] = [msg]
                        else:
                            state["blocking_reasons"] = []

                        if state["aligned_frames"] >= FRAMES_NEEDED_TO_TRIGGER and mode == "aligning":
                            state["mode"] = "countdown"
                            countdown_start_time = time.time()

                        if state["mode"] == "countdown":
                            elapsed = time.time() - countdown_start_time
                            remaining = max(0, COUNTDOWN_SECONDS - int(elapsed))
                            state["countdown_value"] = remaining
                            state["message"] = f"Hold still... capturing in {remaining}"

                            if not (aligned and gate_ok):
                                state["mode"] = "aligning"
                                state["aligned_frames"] = 0
                                state["countdown_value"] = None
                                countdown_start_time = None

                            if elapsed >= COUNTDOWN_SECONDS and aligned and gate_ok:
                                # ---- CAPTURE -------------------------
                                # Every view goes through the SAME engine,
                                # which applies undistortion, builds the
                                # silhouette, runs the full quality gate and
                                # resolves the scale. A rejected frame
                                # produces NO measurement - the previous
                                # version would happily measure a body whose
                                # feet were outside the picture.
                                try:
                                    engine = state.get("engine")
                                    if engine is None:
                                        engine = MeasurementEngine(
                                            user_height_cm=user_height_cm,
                                            mirrored=True)   # feed is cv2.flip'ed
                                        state["engine"] = engine

                                    # Re-analyse the still with the heavy
                                    # model. The preview runs complexity 1
                                    # for frame rate; the measurement gets
                                    # complexity 2 and static_image_mode,
                                    # which gives steadier landmarks and a
                                    # cleaner segmentation mask. Falls back
                                    # to the live result if the still
                                    # analysis somehow finds no person.
                                    still = capture_still_pose(frame)
                                    if still.pose_landmarks is not None:
                                        lms = still.pose_landmarks
                                        wlms = still.pose_world_landmarks
                                        segm = still.segmentation_mask
                                    else:
                                        lms = results.pose_landmarks
                                        wlms = results.pose_world_landmarks
                                        segm = results.segmentation_mask

                                    if view == "front":
                                        m_results, draw_points = compute_measurements(
                                            lms, w, h, user_height_cm,
                                            frame=frame,
                                            segmentation_mask=segm,
                                            world_landmarks=wlms,
                                            engine=engine)
                                    elif view == "left":
                                        m_results, draw_points = compute_left_view_measurement(
                                            lms, w, h, user_height_cm,
                                            frame=frame,
                                            segmentation_mask=segm,
                                            world_landmarks=wlms,
                                            engine=engine)
                                    elif view == "right":
                                        m_results, draw_points = compute_right_view_measurement(
                                            lms, w, h, user_height_cm,
                                            frame=frame,
                                            segmentation_mask=segm,
                                            world_landmarks=wlms,
                                            engine=engine)
                                    else:  # back
                                        m_results, draw_points = compute_back_view_measurement(
                                            lms, w, h, user_height_cm,
                                            frame=frame,
                                            segmentation_mask=segm,
                                            world_landmarks=wlms,
                                            engine=engine)

                                    annotated = draw_view_overlay(frame, view,
                                                                  draw_points, m_results)

                                    filename = f"capture_{view}_{int(time.time())}.jpg"
                                    filepath = os.path.join(CAPTURE_DIR, filename)
                                    cv2.imwrite(filepath, annotated)

                                    view_entry = {
                                        "result": m_results,
                                        "image_url": f"/static/captures/{filename}",
                                    }

                                    if view == "front":
                                        raw_filename = f"raw_front_{int(time.time())}.jpg"
                                        raw_filepath = os.path.join(CAPTURE_DIR, raw_filename)
                                        cv2.imwrite(raw_filepath, frame)
                                        view_entry["raw_filepath"] = raw_filepath
                                        view_entry["raw_image_url"] = f"/static/captures/{raw_filename}"

                                    state["views_data"][view] = view_entry
                                    state["last_rejection"] = None
                                    state["mode"] = "view_captured"
                                    state["message"] = f"{view.capitalize()} view captured!"
                                    state["view_captured_at"] = time.time()

                                except MeasurementError as e:
                                    # The gate refused this frame. Enter the
                                    # dedicated "rejected" mode rather than
                                    # dropping straight back to "aligning":
                                    # the aligning branch rewrites
                                    # state["message"] on every single frame,
                                    # so a refusal set here used to be wiped
                                    # ~30ms later and the person saw the
                                    # countdown restart with no explanation.
                                    state["mode"] = "rejected"
                                    state["aligned_frames"] = 0
                                    state["countdown_value"] = None
                                    state["message"] = str(e)
                                    state["last_rejection"] = {
                                        "view": view, "reason": str(e), "at": time.time()}
                                    state["rejected_at"] = time.time()
                                    countdown_start_time = None
                                    live_gate = None

                    with state_lock:
                        cv_val = state.get("countdown_value")
                    if cv_val:
                        cv2.putText(display, str(cv_val), (w // 2 - 20, h // 2),
                                    cv2.FONT_HERSHEY_SIMPLEX, 3, (0, 255, 0), 5)
                else:
                    with state_lock:
                        state["aligned_frames"] = 0
                        state["mode"] = "aligning"
                        state["message"] = "No person detected - step into frame."
                        countdown_start_time = None

            elif mode == "rejected":
                # Hold the refusal on screen long enough to read and act on,
                # then return to aligning. Without this the message is
                # overwritten on the next frame by the aligning branch.
                with state_lock:
                    reason = state["message"]
                    elapsed = time.time() - (state.get("rejected_at") or 0)
                    if elapsed >= REJECTED_PAUSE_SECONDS:
                        state["mode"] = "aligning"
                        state["aligned_frames"] = 0
                        countdown_start_time = None
                display = draw_rejection_banner(display, reason)

            elif mode == "view_captured":
                cv2.putText(display, "Captured! Get ready for next view...", (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

                with state_lock:
                    elapsed = time.time() - state["view_captured_at"]
                    if elapsed >= VIEW_CAPTURED_PAUSE_SECONDS:
                        idx = VIEW_ORDER.index(state["view"])
                        if idx + 1 < len(VIEW_ORDER):
                            next_view = VIEW_ORDER[idx + 1]
                            state["view"] = next_view
                            state["mode"] = "aligning"
                            state["aligned_frames"] = 0
                            state["countdown_value"] = None
                            state["message"] = VIEW_INSTRUCTIONS[next_view]
                            countdown_start_time = None
                        else:
                            state["mode"] = "summary"
                            state["summary"] = build_summary(state["engine"],
                                                             state["views_data"])
                            rel = (state["summary"].get("release") or {})
                            if rel.get("release"):
                                state["message"] = (
                                    f"All views captured - overall confidence "
                                    f"{rel.get('overall_confidence_pct', 0)}%.")
                            else:
                                state["message"] = (
                                    "Measurements were not accurate enough to "
                                    "release. " + " ".join(rel.get("reasons", [])[:2]))

            elif mode == "summary":
                cv2.putText(display, "All views captured!", (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

            # Encode frame for MJPEG stream
            ok, buf = cv2.imencode(".jpg", display)
            if ok:
                with jpeg_lock:
                    latest_jpeg = buf.tobytes()

            time.sleep(0.03)  # ~30fps cap

    cap.release()


def mjpeg_generator():
    while True:
        with jpeg_lock:
            frame = latest_jpeg
        if frame is not None:
            yield (b"--frame\r\n"
                   b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")
        time.sleep(0.03)


# ---------------------------------------------------------------------------
# Camera thread lifecycle (Fashion-Show integration)
# ---------------------------------------------------------------------------
# shirt-new-app-1 started camera_loop() once at boot and never released the
# webcam. Here the same camera_loop() is started when a model begins a scan
# and stopped (via its existing STOP_THREAD flag) when they leave the
# capture page, so recruiters using the try-on API don't light the webcam.
camera_thread = None
camera_thread_lock = threading.Lock()


def ensure_camera_running():
    global camera_thread, STOP_THREAD
    with camera_thread_lock:
        t = camera_thread
        if t is not None and t.is_alive():
            if not STOP_THREAD:
                return
            # A stop is still in progress (a capture can take several
            # seconds). Let it finish rather than starting a second loop on
            # the same webcam; if it is still busy, cancel the stop instead.
            t.join(timeout=10)
            if t.is_alive():
                STOP_THREAD = False
                return
        STOP_THREAD = False
        camera_thread = threading.Thread(target=camera_loop, daemon=True)
        camera_thread.start()


def stop_camera_thread():
    global STOP_THREAD, latest_jpeg
    with camera_thread_lock:
        t = camera_thread
        if t is None or not t.is_alive():
            return
        STOP_THREAD = True
        # Keep the reference even if the join times out, so
        # ensure_camera_running() can see the loop is still winding down.
        t.join(timeout=3)
    with jpeg_lock:
        latest_jpeg = None


def camera_failed():
    """camera_loop() returns straight away when the webcam cannot be opened."""
    t = camera_thread
    return t is not None and not t.is_alive() and not STOP_THREAD


@app.route("/")
def index():
    return jsonify({"service": "Fashion-Show body scanner & virtual try-on API", "ok": True})


@app.route("/video_feed")
def video_feed():
    ensure_camera_running()
    return Response(mjpeg_generator(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/stop_camera", methods=["POST"])
def stop_camera():
    """Release the webcam. The capture session itself (views, summary) is kept."""
    stop_camera_thread()
    return jsonify({"ok": True})


@app.route("/start", methods=["POST"])
def start():
    data = request.get_json(force=True)
    try:
        height_cm = float(data.get("height_cm"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid height"}), 400

    if height_cm < 100 or height_cm > 230:
        return jsonify({"error": "Please enter a realistic height in cm (100-230)."}), 400

    device_model = str(data.get("device_model") or "").strip()[:120]
    if not device_model:
        return jsonify({"error": "Please enter the camera device you're using to capture "
                                 "these photos (e.g. \"MacBook Air M3\", \"iPhone 16 Plus\")."}), 400
    # The device must already have a saved calibration profile in
    # camera_profile.json (exact name match, see camera_calibration.py). An
    # unrecognised device is refused outright rather than silently falling
    # back to an uncalibrated or default profile -- the whole point of this
    # step is that the WRONG device's numbers must never be applied.
    canonical_device = camera_calibration.resolve_device_name(device_model)
    if canonical_device is None:
        return jsonify({"error": "Camera calibration profile not found for this device. "
                                 "Please enter a supported device model."}), 400

    model = None
    if data.get("model_id") not in (None, ""):
        try:
            model = {"id": model_store.safe_model_id(data.get("model_id")),
                     "name": str(data.get("model_name") or "")[:120],
                     "email": str(data.get("model_email") or "")[:200]}
        except model_store.ModelStoreError as e:
            return jsonify({"error": str(e)}), 400

    ensure_camera_running()
    with state_lock:
        state["model"] = model
        state["user_height_cm"] = height_cm
        state["device_model"] = canonical_device
        state["mode"] = "aligning"
        state["view"] = "front"
        state["aligned_frames"] = 0
        state["countdown_value"] = None
        state["message"] = VIEW_INSTRUCTIONS["front"]
        state["views_data"] = {}
        state["summary"] = None
        state["last_rejection"] = None
        state["blocking_reasons"] = []
        # A fresh engine per session: it holds the anatomical level positions
        # found in the front view, which the side views sample depth at.
        # Reusing one across sessions would measure this person's chest at
        # the previous person's chest height. device_model is looked up by
        # exact name in camera_profile.json (see camera_calibration.py) - an
        # unrecognised device was already refused above, so this always has
        # a real, matching calibration profile.
        state["engine"] = MeasurementEngine(user_height_cm=height_cm,
                                            device_model=canonical_device,
                                            mirrored=True)

    return jsonify({"ok": True, "capture_standard": CAPTURE_STANDARD, "device_model": canonical_device})


@app.route("/status")
def status():
    with state_lock:
        payload = {
            "mode": state["mode"],
            "message": state["message"],
            "countdown_value": state["countdown_value"],
            "view": state["view"],
            "view_order": VIEW_ORDER,
            "views_data": state["views_data"],
            "summary": state["summary"],
        }
    # Not gated by state_lock: vton_engine's own attributes are set once at
    # startup (model load) and read-only after that, so no lock is needed.
    if camera_failed():
        payload["mode"] = "error"
        payload["message"] = "Could not open webcam."
    payload["model"] = state.get("model")
    payload["device_model"] = state.get("device_model")
    payload["last_rejection"] = state.get("last_rejection")
    payload["blocking_reasons"] = list(state.get("blocking_reasons") or [])
    payload["capture_standard"] = CAPTURE_STANDARD
    payload["vton_engine"] = {
        "real_model_ready": vton_engine.is_real_model_ready(),
        "status": vton_engine.active_engine_description(),
        "device": vton_engine.device.upper(),
        "openai_configured": vton_engine.openai_engine.is_ready(),
    }
    return jsonify(payload)


@app.route("/calibration_status")
def calibration_status():
    """Report the CAMERA calibration state for one device, and what it
    implies for accuracy.

    Added because "is the camera calibrated?" previously had no answer: the
    project contained no intrinsics, no distortion coefficients and no
    undistortion step at all, while its docstrings used the word
    "calibration" to mean the pixel-to-centimetre scale.

    Profiles are now per DEVICE MODEL (see camera_calibration.py's "Multi-
    device profile storage"), so this checks one named device: pass
    ?device=<device name>, or it falls back to the device selected for the
    current capture session (set on /start).
    """
    device = request.args.get("device") or state.get("device_model")
    known = camera_calibration.list_device_names()
    how_to_calibrate = [
        "python camera_calibration.py capture               # 15-20 chessboard views",
        "python camera_calibration.py solve <device name>    # writes calibration/camera_profile.json",
    ]
    if not device:
        return jsonify({
            "device": None,
            "known_devices": known,
            "calibrated": False,
            "profile": None,
            "how_to_calibrate": how_to_calibrate,
            "note": "No device specified - pass ?device=<exact device name>, "
                    "or start a capture session first.",
        })

    try:
        prof = camera_calibration.load_profile_for_device(device)
    except camera_calibration.CalibrationError as e:
        return jsonify({"error": str(e)}), 400

    payload = {
        "device": device,
        "known_devices": known,
        "calibrated": prof is not None,
        "profile": prof.summary() if prof else None,
        "how_to_calibrate": how_to_calibrate,
    }
    if prof:
        shift = prof.max_distortion_shift_px()
        payload["distortion_impact"] = {
            "max_pixel_shift_px": round(shift, 2),
            "as_pct_of_frame_height": round(shift / prof.height * 100, 2),
            "verdict": ("negligible - this lens is effectively rectilinear"
                        if shift < 1.5 else
                        "significant - undistortion materially changes the "
                        "head-to-floor reference, and is applied"),
        }
    else:
        payload["warning"] = (
            f"No camera profile for \"{device}\". Lens distortion is NOT "
            f"being removed for this device. The subject's head and feet "
            f"sit near the top and bottom frame borders, which is exactly "
            f"where radial distortion is largest, and that span is the "
            f"scale reference for every measurement.")
    return jsonify(payload)


@app.route("/api/camera_devices")
def camera_devices():
    """Every device model with a saved calibration profile, for the
    scan-setup screen's device-name suggestions AND its "is this device
    supported" check. camera_profile.json is the single source of truth -
    nothing about which devices exist is hardcoded here or in the frontend.
    """
    return jsonify({"devices": camera_calibration.list_device_names()})


@app.route("/measurement_report")
def measurement_report():
    """Full diagnostic dump of the current session: per-view quality gate
    results, scale estimates, anatomical levels, cross-view checks and the
    release decision. This is what to look at when a measurement disagrees
    with a tape."""
    with state_lock:
        engine = state.get("engine")
        summary = state.get("summary")
    if summary:
        return jsonify(summary)
    if engine is None:
        return jsonify({"error": "No capture session in progress."}), 404
    return jsonify({
        "captured_views": sorted(engine.views.keys()),
        "missing_views": engine.missing_views(),
        "camera_calibration": engine.calibration_status(),
        "views": {v: r.as_dict() for v, r in engine.views.items()},
    })


@app.route("/ground_truth", methods=["POST"])
def submit_ground_truth():
    """Record the tape measurements the user typed into the results table.

    The UI already had a "Your Tape (cm)" column, but the numbers went
    nowhere - they coloured one cell and were discarded. Persisting them is
    what turns the project's accuracy claims into something falsifiable:
    validation.py reads this file, scores the pipeline against it, and is
    the only thing allowed to fit measurement-specific corrections.

    Body: {"subject_id": "...", "tape": {"chest": 98.0, ...}, "notes": "..."}
    """
    import csv
    from validation import GROUND_TRUTH_CSV, CSV_COLUMNS, VALIDATED

    data = request.get_json(force=True, silent=True) or {}
    tape = {k: v for k, v in (data.get("tape") or {}).items()
            if k in VALIDATED and v not in (None, "")}
    if not tape:
        return jsonify({"error": "No tape measurements supplied."}), 400

    with state_lock:
        views_data = dict(state["views_data"])
        height = state["user_height_cm"]

    def img_path(view):
        entry = views_data.get(view) or {}
        url = entry.get("raw_image_url") or entry.get("image_url") or ""
        return url.lstrip("/") if url else ""

    row = {c: "" for c in CSV_COLUMNS}
    row["subject_id"] = (data.get("subject_id")
                         or f"session_{int(time.time())}")
    row["height_cm"] = height or ""
    row["notes"] = data.get("notes", "")
    for v in VIEW_ORDER:
        row[f"{v}_image"] = img_path(v)
    for k, val in tape.items():
        try:
            row[f"tape_{k}_cm"] = float(val)
        except (TypeError, ValueError):
            pass

    os.makedirs(os.path.dirname(GROUND_TRUTH_CSV), exist_ok=True)
    write_header = not os.path.exists(GROUND_TRUTH_CSV)
    with open(GROUND_TRUTH_CSV, "a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        if write_header:
            w.writeheader()
        w.writerow(row)

    return jsonify({
        "ok": True,
        "subject_id": row["subject_id"],
        "recorded": sorted(tape.keys()),
        "next": "Run `python validation.py report` to score the pipeline "
                "against everything collected so far.",
    })


@app.route("/retake_current", methods=["POST"])
def retake_current():
    """Redo the view currently in progress (discards its data if any)."""
    with state_lock:
        view = state["view"]
        state["views_data"].pop(view, None)
        engine = state.get("engine")
        if engine is not None:
            # Discard the engine's analysis of this view as well, or the
            # stale one would be fused into the final body model.
            engine.views.pop(view, None)
            if view == "front":
                # The front view defines the anatomical levels the side
                # views sample; retaking it invalidates those, so the whole
                # sequence restarts rather than mixing level sets.
                engine.reset()
                state["views_data"] = {}
                state["view"] = "front"
        state["mode"] = "aligning"
        state["countdown_value"] = None
        state["aligned_frames"] = 0
        state["last_rejection"] = None
        state["blocking_reasons"] = []
        state["message"] = VIEW_INSTRUCTIONS[state["view"]]
    ensure_camera_running()
    return jsonify({"ok": True, "view": state["view"]})


@app.route("/reset", methods=["POST"])
def reset():
    if state["user_height_cm"]:
        ensure_camera_running()
    with state_lock:
        state["mode"] = "aligning" if state["user_height_cm"] else "idle"
        state["view"] = "front"
        state["aligned_frames"] = 0
        state["countdown_value"] = None
        state["message"] = VIEW_INSTRUCTIONS["front"]
        state["views_data"] = {}
        state["summary"] = None
        state["last_rejection"] = None
        state["blocking_reasons"] = []
        state["engine"] = (MeasurementEngine(user_height_cm=state["user_height_cm"],
                                             mirrored=True)
                           if state["user_height_cm"] else None)
    return jsonify({"ok": True})


@app.route("/api/models/save_session", methods=["POST"])
def save_model_session():
    """Persist the finished capture session for the model given to /start."""
    with state_lock:
        model = state.get("model")
        views_data = dict(state["views_data"])
        summary = state.get("summary")
        height = state["user_height_cm"]
        mode = state["mode"]
    if not model:
        return jsonify({"error": "This capture session is not linked to a model profile."}), 400
    if mode != "summary" or not summary:
        return jsonify({"error": "All four views must be captured before the session can be saved."}), 409
    try:
        record = model_store.save_session(model, views_data, summary, height)
    except model_store.ModelStoreError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"ok": True, "model_id": record["model_id"], "saved_at": record["saved_at"],
                    "views": record["views"]})


@app.route("/api/models", methods=["GET"])
def list_models():
    """Models that have a stored capture session, for the Recruiters section."""
    return jsonify({"models": model_store.list_models()})


@app.route("/api/models/<model_id>", methods=["GET"])
def get_model(model_id):
    try:
        record = model_store.load_session(model_id)
    except model_store.ModelStoreError as e:
        return jsonify({"error": str(e)}), 400
    if record is None:
        return jsonify({"error": "No captured images found for this model."}), 404
    return jsonify(record)


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """
    The only way to obtain a session: email/password/role must match an
    account created via the Admin panel (POST /api/auth/users). There is
    no self-registration and no auto-create-on-first-login fallback.
    """
    data = request.get_json(silent=True) or {}
    try:
        user = auth_store.authenticate(data.get("email"), data.get("password"), data.get("role"))
    except auth_store.AuthStoreError as e:
        return jsonify({"error": str(e)}), 401
    return jsonify({"ok": True, "user": {
        "id": user["id"], "email": user["email"], "role": user["role"],
        "first_name": user["first_name"], "last_name": user["last_name"],
    }})


@app.route("/api/auth/users", methods=["GET"])
def auth_list_users():
    """Every admin-created account, for the Admin panel's credentials table."""
    return jsonify({"users": auth_store.list_users()})


@app.route("/api/auth/users", methods=["POST"])
def auth_create_user():
    data = request.get_json(silent=True) or {}
    try:
        user = auth_store.create_user(
            role=data.get("role"),
            first_name=data.get("first_name"),
            last_name=data.get("last_name"),
            email=data.get("email"),
            password=data.get("password"),
        )
    except auth_store.AuthStoreError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"ok": True, "user": user})


@app.route("/api/auth/users/<user_id>", methods=["PUT"])
def auth_update_user(user_id):
    data = request.get_json(silent=True) or {}
    try:
        user = auth_store.update_user(
            user_id,
            role=data.get("role"),
            first_name=data.get("first_name"),
            last_name=data.get("last_name"),
            email=data.get("email"),
            password=data.get("password") or None,
        )
    except auth_store.AuthStoreError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"ok": True, "user": user})


@app.route("/api/virtual-try-on", methods=["POST"])
@app.route("/try_on", methods=["POST"])
def virtual_try_on_api():
    """
    Virtual Shirt Try-On Endpoint.
    Input:
      - Multipart file: 'shirt_file' OR 'garment_file'
      - Optional form field 'model_id': use that stored model's front photo
        (Recruiters section). Without it, the current capture session's
        front view is used, as in shirt-new-app-1.
    Output:
      - tryon_image_url: URL to AI-generated try-on result
      - inference_status: model / execution status
      - device_info: hardware execution device (CUDA / CPU)
    """
    # Prevent duplicate concurrent requests
    acquired = inference_lock.acquire(blocking=False)
    if not acquired:
        return jsonify({
            "error": "A virtual try-on request is already in progress. Please wait for it to complete."
        }), 429

    temp_file_path = None
    try:
        # 1. Validate front-view capture existence
        model_id = request.form.get("model_id")
        if model_id:
            try:
                raw_filepath = model_store.raw_front_path(model_id)
            except model_store.ModelStoreError as e:
                return jsonify({"error": str(e)}), 400
            if not raw_filepath:
                return jsonify({
                    "error": "This model has no captured front photo yet."
                }), 404
        else:
            with state_lock:
                front_data = state["views_data"].get("front")

            if not front_data:
                return jsonify({
                    "error": "Front view photo is missing. Please capture your body views first."
                }), 400

            raw_filepath = front_data.get("raw_filepath")
            if not raw_filepath or not os.path.exists(raw_filepath):
                annotated_url = front_data.get("image_url", "")
                filename = annotated_url.split("/")[-1].split("?")[0]
                raw_filepath = os.path.join(CAPTURE_DIR, filename)

        if not os.path.exists(raw_filepath):
            return jsonify({
                "error": "Front-view photo file could not be found on server."
            }), 404

        # 2. Extract uploaded garment image
        garment_input = None
        for file_key in ["shirt_file", "garment_file", "garment"]:
            if file_key in request.files:
                file = request.files[file_key]
                if file.filename != "":
                    garment_input = file.read()
                    break

        if garment_input is None:
            return jsonify({
                "error": "No garment image provided. Please upload a shirt image."
            }), 400

        # 3. Load & Preprocess person and garment images
        try:
            person_pil = validate_and_load_image(raw_filepath)
            garment_pil = validate_and_load_image(garment_input)
        except ValueError as val_err:
            return jsonify({"error": str(val_err)}), 400
        except Exception as e:
            return jsonify({"error": "Failed to read provided images. Ensure files are valid images."}), 400

        original_aspect_ratio = person_pil.size[0] / person_pil.size[1]
        target_size = closest_supported_size(*person_pil.size)

        person_prep = prepare_person_image(person_pil)
        garment_prep = prepare_garment_image(garment_pil)

        # 4. Run Virtual Try-On Inference in an isolated worker process,
        #    bounded so one slow request can't tie up the inference slot
        #    indefinitely -- on timeout the stuck worker is actually killed
        #    (not just abandoned), so the next request gets a clean slate.
        try:
            output_pil, meta = inference_process_manager.run(
                person_image=person_prep,
                garment_image=garment_prep,
                category="tops",
                timeout_seconds=INFERENCE_TIMEOUT_SECONDS,
                target_size=target_size,
            )
        except TimeoutError:
            return jsonify({
                "error": f"Virtual try-on timed out after {INFERENCE_TIMEOUT_SECONDS}s. Please try again."
            }), 504
        except RuntimeError as e:
            return jsonify({"error": f"Virtual try-on processing failed: {e}"}), 500

        # Match the generated image's canvas back to the original front-view
        # photo's aspect ratio/framing (the generation API only returns a
        # handful of fixed canvas sizes, which otherwise makes the result
        # look zoomed in/out next to the original photo).
        try:
            output_pil = fit_to_aspect_ratio(output_pil, original_aspect_ratio)
        except Exception as e:
            print(f"Aspect-ratio fit skipped: {e}")

        # 5. Save generated result securely to static/captures
        tryon_filename = f"tryon_front_{int(time.time())}.jpg"
        tryon_filepath = os.path.join(CAPTURE_DIR, tryon_filename)
        output_pil.save(tryon_filepath, format="JPEG", quality=95)

        tryon_url = f"/static/captures/{tryon_filename}"
        return jsonify({
            "ok": True,
            "tryon_image_url": tryon_url,
            "inference_status": meta.get("status", "Completed"),
            "engine": meta.get("engine", "FASHN VTON v1.5"),
            "device_info": meta.get("device", "CPU"),
            "inference_time_sec": meta.get("inference_time_sec", 0.0),
        })

    except Exception as e:
        return jsonify({"error": f"Virtual try-on processing failed: {str(e)}"}), 500
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception:
                pass
        inference_lock.release()


if __name__ == "__main__":
    inference_process_manager = InferenceProcessManager()

    # The camera thread is started on demand by /start and /video_feed.
    # No silent fallback port: the frontend is configured with this one
    # (VITE_SCANNER_API_URL), so a different port would just look offline.
    port = SCANNER_PORT
    print(f"Starting Fashion-Show Body Scanner & Virtual Try-On API at http://127.0.0.1:{port}")
    try:
        app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
    finally:
        stop_camera_thread()

