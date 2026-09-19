# Fashion-Show Body Scanner — How It Works

This document explains, file by file, how the backend turns a live webcam
feed into body measurements (across shoulder, chest, waist, hip, neck,
sleeve, torso length, inseam, height). It covers: how the live camera
picture gets the guide lines / skeleton drawn on it, how the system tells
you to move, how it decides a photo is "good enough", and the exact math
used to turn pixels into centimetres for every measurement.

This is a **read-only explanation** — nothing in the code was changed to
write this file.

> This project is mid-rewrite: every core file (`measurements.py`,
> `side_measurements.py`, `body_segmentation.py`, `anatomy.py`,
> `circumference.py`, `scale_reference.py`, `capture_validation.py`,
> `measurement_confidence.py`, `measurement_pipeline.py`, `multiview.py`,
> `calibration_profile.py`, `camera_calibration.py`) carries a long
> docstring titled "AUDIT FINDING THIS MODULE ADDRESSES" that documents a
> real, measured bug in an older version of the pipeline and exactly how
> the new code fixes it. Those docstrings are the project's own record of
> *why* the logic is shaped the way it is, and this document leans on them
> heavily rather than re-guessing the reasoning.

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [Libraries used, and why](#2-libraries-used-and-why)
3. [How the live camera feed actually works](#3-how-the-live-camera-feed-actually-works)
4. [File-by-file reference](#4-file-by-file-reference)
5. [How each measurement is actually calculated](#5-how-each-measurement-is-actually-calculated)
6. [The circumference math (superellipse model)](#6-the-circumference-math-superellipse-model)
7. [Confidence scoring and the release gate](#7-confidence-scoring-and-the-release-gate)
8. [Camera calibration vs. measurement calibration](#8-camera-calibration-vs-measurement-calibration)
9. [Quick file index](#9-quick-file-index)

---

## 1. The big picture

One capture "session" walks a person through **four photos** — Front,
Left, Right, Back — using nothing but a webcam and MediaPipe's Pose model.
Nobody presses a shutter button: the system watches the live feed, tells
the person how to move, and takes the photo itself the instant the frame
is good enough.

```
 Webcam frame (every ~33ms)
        │
        ▼
 MediaPipe Pose  ──►  33 body landmarks (x, y, visibility) + a body
                       segmentation mask (a soft "person vs background"
                       probability map)
        │
        ▼
 Live guidance (per frame, cheap):
   - is the whole body inside the frame?
   - are you close enough / too close?
   - are you centred, facing the right way, standing straight?
   → draws the skeleton, a shirt-outline preview, and on-screen text
     ("Move closer", "Turn further", a live 3-2-1 countdown, "READY")
        │
        ▼
 Hold the correct pose for ~1 second, pass the SAME full quality check
 that will grade the still photo (not just the cheap live check)
        │
        ▼
 CAPTURE the still frame, re-run Pose on it (this time with the
 slow-but-accurate settings), then run the full measurement pipeline:
   segmentation → validate → locate anatomy → resolve pixel-to-cm scale
        │
        ▼
 Repeat for Left, Right, Back (each ties into the same measurement
 "engine" so all four views share one consistent set of body landmarks)
        │
        ▼
 FUSE all four views into one body model:
   - shoulder width: front + back, inverse-variance weighted
   - chest / waist / hip: WIDTH (front+back) × DEPTH (left+right) →
     cross-section circumference formula
   - sleeve length: each arm's own side-view, kept separate (not averaged)
   - height, torso length, inseam: from the clearest single view
        │
        ▼
 Confidence scoring + release gate: is this result trustworthy enough to
 show, or should specific views be retaken?
```

The single idea that shapes almost every file in this pipeline is:
**measure the actual outline of the body (the segmentation silhouette),
not the joints MediaPipe reports.** Pose landmarks (shoulder, hip, elbow…)
are *inside* the body — they're joint centres, not the skin's edge — so
using the distance between two joints as a "width" systematically
under-reads the real body width. The rewrite instead reads widths and
depths straight off the body's own silhouette, and only uses the pose
landmarks to know *roughly where* to look (e.g. "the chest is somewhere
between the armpit and the hip").

---

## 2. Libraries used, and why

| Library | Used for | Why this one |
|---|---|---|
| **Flask** (`flask`) | The web server: routes like `/start`, `/video_feed`, `/status` | Small, synchronous, easy to reason about for a single-camera, single-session app. |
| **flask-cors** | Lets the React frontend (a different origin during development) call this API | The frontend and backend run as two separate dev servers; without CORS headers the browser blocks the requests. |
| **OpenCV** (`cv2`, package `opencv-python`) | Reading webcam frames, drawing overlays/lines/text, image resizing, ArUco marker detection, chessboard camera calibration, GrabCut segmentation, morphology (erode/dilate/fill-holes), Sobel gradients | It's the standard, fast, well-documented library for exactly this kind of classical computer-vision work — camera capture, drawing, and geometric image processing all in one dependency. |
| **MediaPipe** (`mediapipe`) | `mp.solutions.pose` — detects 33 body landmarks (shoulders, elbows, wrists, hips, knees, ankles, etc.) *and* a person-segmentation mask from a single RGB frame, in real time on a CPU | This is the one model doing the heavy lifting: pose estimation *and* segmentation from the same pass, fast enough to run live (~16ms/frame at the settings used here), no GPU required. |
| **NumPy** (`numpy`) | All the numeric array work: silhouette masks, width/depth profiles, curve fitting, inverse-variance fusion, vectors/angles | The default numeric toolkit in Python; masks and profiles are naturally arrays and NumPy's vectorised operations make per-row/per-pixel analysis fast. |
| **SciPy** | Listed in `requirements.txt` | Not actually imported anywhere in the measurement/camera code as of this writing (no `import scipy` in any `.py` file) — most likely a transitive dependency of another package, or reserved for future curve-fitting work in `validation.py`. |
| **Pillow** (`PIL`) | Only in the *virtual try-on* code (`vton_engine.py`, `openai_vton_engine.py`, `virtual_tryon.py`) — resizing/converting images before sending them to the try-on model/API | Not used anywhere in the body-measurement pipeline described in this document. |
| **PyTorch / torchvision / diffusers / transformers / accelerate / safetensors / huggingface_hub** | The *virtual try-on* feature (CatVTON neural model) — a separate feature from body measurement | Not part of the measurement/camera pipeline; mentioned here only so it's clear why they appear in `requirements.txt`. |
| **openai** (optional) | Cloud virtual try-on via OpenAI's image API, tried first if `OPENAI_API_KEY` is set | Also unrelated to body measurement. |

**Bottom line for measurement:** the entire pipeline runs on four
libraries — **OpenCV**, **MediaPipe**, **NumPy**, and Flask to serve it —
nothing about turning a photo into a measurement depends on GPUs, PyTorch,
or the internet.

---

## 3. How the live camera feed actually works

All of this lives in **`app.py`**, mainly the function **`camera_loop()`**
(a background thread) plus the small helper functions above it.

### 3.1 The state machine

The whole capture session is one shared dictionary, `state`, protected by
a `threading.Lock` (because the camera runs on its own thread while Flask
answers HTTP requests on others). Its `mode` field walks through:

```
idle → aligning → countdown → (capture happens) → view_captured → aligning (next view) → … → summary
                     │
                     └─(if the countdown finishes but the photo turns out unusable)→ rejected → aligning
```

- **idle** — waiting for the person to enter their height and press Start (`POST /start`).
- **aligning** — a view is in progress; the live feed is being checked every frame, but the person isn't yet holding a good pose.
- **countdown** — the person has held a *valid* pose for long enough; a 3‑2‑1 countdown is playing on screen.
- **view_captured** — the photo for this view was just taken and accepted; a short "Captured!" pause plays before moving to the next view.
- **rejected** — the countdown finished, but the full quality check on the actual still photo failed (e.g. arms too close to the body); the reason is shown on screen for a few seconds.
- **summary** — all four views are done; the fused measurements are ready.

### 3.2 What happens to every single frame

Inside `camera_loop()`, for every frame read from the webcam (`cap.read()`):

1. The frame is horizontally flipped (`cv2.flip(frame, 1)`) so the preview feels like a mirror.
2. `mp_pose.Pose(...)` (MediaPipe) processes the frame and returns:
   - `pose_landmarks` — 33 normalized `(x, y, visibility)` points,
   - `pose_world_landmarks` — the same points in a rough 3D metric space (used only for *angles*, since its absolute scale is unreliable),
   - `segmentation_mask` — a per-pixel probability that this pixel is "person".
3. **The skeleton is drawn** on the preview frame with `mp_drawing.draw_landmarks(display, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)` — this is the literal "lines on the live camera" the user sees connecting shoulders, elbows, wrists, hips, knees, ankles.
4. **Front view only:** a shirt-outline preview box is drawn using `shirt_outline_detector.py`'s `get_torso_box()` (a bounding box built from the shoulder/hip landmarks) and `segment_shirt_grabcut()` (OpenCV's GrabCut algorithm, run for a few iterations to separate the shirt from the background inside that box), then its contour is drawn with `draw_shirt_outline()`. This is a **cosmetic preview only** — it never feeds into a measurement; it just gives the person a live sense of what the camera sees.
5. **Live guidance** runs:
   - `check_alignment()` (front/back) or `check_side_alignment()` (left/right) do *cheap*, per-frame checks: is the whole body inside the frame (via `framing_guidance()`, which looks directly at the segmentation mask's bounding box), are the shoulders level, is the person centred, are the wrists below the shoulders (arms down), and — for side views — is the shoulder-to-shoulder gap small enough to count as a true 90° profile.
   - Every `GATE_EVERY_N_FRAMES` (3) frames, the system also runs `run_live_gate()`, which is the **exact same** `capture_validation.validate_capture()` function that will later judge the still photo. This is deliberate: earlier versions armed the 3‑2‑1 countdown with the cheap checks only, so a photo could pass the cheap checks, run the whole countdown, and *still* get rejected by the stricter check — an endless "3‑2‑1‑hold‑3‑2‑1" loop with no explanation. Now the same check both arms the countdown and grades the photo, so they can never disagree.
   - `draw_gate_hud()` prints either a green **"READY"** in the corner, or a black banner at the bottom listing (in plain English) everything currently blocking the photo — e.g. *"Move closer"*, *"Level your shoulders and stand up straight"*, *"Move your arms about 15‑20cm away from your body…"*.
6. If the person holds an aligned, gate-passing pose for `FRAMES_NEEDED_TO_TRIGGER` (20 frames, roughly 1 second at ~20fps), `mode` becomes `countdown`, and a 3‑2‑1 counts down on screen. If the person breaks position mid-countdown, it resets back to `aligning` immediately.
7. **When the countdown reaches zero:**
   - The still frame is re-processed by `capture_still_pose()` using MediaPipe's *slow, accurate* settings (`model_complexity=2`, `static_image_mode=True`) instead of the fast settings used for the live preview (`model_complexity=1`) — the preview needs speed, the actual measurement deserves the best landmarks and segmentation available, and this only has to run once per view.
   - The right `compute_measurements()` / `compute_left_view_measurement()` / `compute_right_view_measurement()` / `compute_back_view_measurement()` function is called for the current view.
   - If it succeeds, `draw_view_overlay()` (from `draw_overlay.py`) draws the *actual measured levels* — the horizontal lines you see labelled "Shoulder", "Chest", "Waist", etc. — onto the captured photo (not the live preview; this becomes the saved, annotated capture image), and the photo is saved to `static/captures/`.
   - If it fails (`MeasurementError`), `mode` becomes `rejected`, the reason is stored, and a full-screen "PHOTO NOT TAKEN — <reason>" banner (`draw_rejection_banner()`) is shown for a few seconds before returning to `aligning`.
8. After a short "Captured!" pause, the sequence moves to the next view (front → left → right → back) or, after back, computes the final fused summary (`build_summary()`).
9. Whatever the current `display` frame looks like (skeleton, HUD text, banners and all) is JPEG-encoded and stored in a global `latest_jpeg` variable.

### 3.3 How that reaches the browser

`GET /video_feed` calls `mjpeg_generator()`, which is an infinite loop that
reads `latest_jpeg` and yields it as one part of a
`multipart/x-mixed-replace` HTTP stream — the classic "MJPEG stream"
technique. The React frontend simply points an `<img>` tag's `src` at this
URL; the browser itself handles redrawing each new JPEG as it arrives, so
no video codec or WebRTC is involved — it's just a rapid slideshow of
still JPEGs, each one already fully annotated server-side.

`GET /status` is polled by the frontend to read the current `mode`,
`message`, `countdown_value`, and `blocking_reasons` as plain JSON, which
is how the UI shows the same guidance text alongside the video.

---

## 4. File-by-file reference

### `app.py` — the web layer & the live state machine
The Flask application itself. Owns the camera thread (`camera_loop()`),
the shared `state` dictionary, every HTTP route (`/start`, `/status`,
`/video_feed`, `/stop_camera`, `/retake_current`, `/reset`,
`/calibration_status`, `/measurement_report`, `/ground_truth`, plus the
virtual try-on and model-storage routes), and the live guidance helpers
(`framing_guidance`, `check_alignment`, `check_side_alignment`,
`run_live_gate`, `draw_gate_hud`, `draw_rejection_banner`, `build_summary`).
It deliberately contains **no measurement math** — it calls into the other
modules for that — so the logic can be tested offline without a camera
(see `validation.py`).

### `measurement_pipeline.py` — the orchestrator
Defines `MeasurementEngine`, the single object that runs one view through
every stage in order: undistort (using the camera calibration profile, if
one exists) → build the body silhouette → validate the capture → locate
anatomical levels → resolve the pixel-to-cm scale → record a per-view
confidence. It also remembers, across all four views, the *stature-normalised
height* of each anatomical level found in the front view (`level_ts`), so
the side views know where to look for "waist depth" or "chest depth"
without having to reinvent finding a waist on a side silhouette (which
doesn't have a reliable one). `finalize()` hands everything to
`multiview.BodyModel` for fusion once all four views are in.

### `body_segmentation.py` — turning a photo into a trustworthy outline
Defines the `Silhouette` class and `build_silhouette()`. This is the
single most important upgrade in the pipeline: instead of measuring
distances between pose *joints*, every width and depth in this project is
read directly off the body's outline.
- Takes MediaPipe's segmentation mask (a soft 0–1 probability image),
  optionally cross-checks it against a second model (MediaPipe's Selfie
  Segmentation, run on a cropped, zoomed-in region for higher effective
  resolution) and averages where they agree.
- Refines the boundary with a **guided filter** (`guided_filter()` 
  a classic edge-preserving filter implemented from scratch with OpenCV's
  box filters, following He et al. 2010) so the blurry ~7px-wide mask edge
  MediaPipe produces snaps onto the real photographic edge between body
  and background.
- Cleans the mask topologically: keeps only the largest connected blob
  (`_largest_component`), fills interior holes by flood-filling the
  background (`_fill_holes`) — carefully avoiding any dilation, since
  dilating would push the outline outward and make every width read too
  large.
- `edges_at(y)` reads the **sub-pixel** left/right edge of the body on any
  image row, by linearly interpolating exactly where the soft probability
  map crosses 0.5 — this avoids snapping every measurement to whole-pixel
  noise.
- `runs_at(y)` finds contiguous foreground spans on a row — the tool used
  to detect topology changes like "one blob becomes three" (arms
  separating from the torso) or "one blob becomes two" (legs separating at
  the crotch).
- Also computes quality signals: `edge_sharpness` (how crisp the boundary
  is — a blurry outline caps confidence), `model_agreement` (IoU between
  the two segmentation models), and `assess_clothing()` (flags loose
  clothing by looking for hem "flare" and outline "roughness" — it never
  tries to guess and subtract fabric, only lowers confidence and tells the
  person to wear something fitted).

### `anatomy.py` — finding *where* to measure
Given a silhouette and the pose landmarks (used only to bracket rough
search windows), this module locates the actual anatomical measurement
points, each with a stated, non-arbitrary definition:

- **Acromion / shoulder point** — the true tailor's shoulder point, found
  as the point of maximum curvature on the smoothed upper-body contour
  (where the near-horizontal shoulder line breaks into the near-vertical
  arm), refined by intersecting two straight-line fits above and below the
  corner. This is *not* MediaPipe's shoulder landmark, which sits several
  centimetres further inboard (the joint centre, not the skin's edge).
- **Axilla (armpit)** — the first row, scanning down from the shoulders,
  where the silhouette's cross-section topologically splits from one blob
  into three (left arm | torso | right arm). A real, observable landmark.
- **Neck base** — found by first locating the narrowest row of the neck,
  then walking down to where the profile "breaks" outward into the
  trapezius (again via a two-segment line-intersection, mirroring the
  shoulder-corner technique).
- **Chest** — the fullest torso width, searched only from the armpit down
  to 40% of the way to the hip line (so a wide hip can't be mistaken for
  the chest).
- **Waist** — the *narrowest* torso width between the chest level and the
  hip landmark line — the standard tailor's "natural waist".
- **Hip** — the widest width between the waist and the crotch.
- **Crotch** — the row where the silhouette splits from one leg-blob into
  two.
- **Inseam** — crotch row down to the floor-contact row.

Every level is also stored as a **stature-normalised coordinate**
`t = (y - vertex_y) / (floor_y - vertex_y)` (0 = top of head, 1 = floor).
This `t` is the mechanism that lets the side views find "the waist" even
though a side silhouette has no reliable waist minimum of its own — the
front view's waist height is transferred over and the side view just
reads its own depth at that same relative height.

### `capture_validation.py` — the quality gate
Defines `validate_capture()`, which decides whether a frame can be trusted
at all, returning a structured list of specific, human-readable failure
messages (never just "rejected"). Checks include, all normalised so the
same numbers are meaningful at any distance or resolution:
- The **whole body is inside the frame** — silhouette must not touch any
  border (this replaces the old, broken "landmark visibility" test —
  visibility measures whether a joint is hidden by the *body*, not whether
  it's outside the *frame*, so it stayed high even for a foot clamped off
  the bottom edge of the picture).
- **Distance**: the subject's stature must fill 60–88% of the frame
  height.
- **Centring**: within the middle 32–68% of the frame width.
- **Orientation**: rotation about the vertical axis (`shoulder_yaw_deg()`,
  computed from MediaPipe's 3D world landmarks, since a common scale error
  cancels out of an *angle* even though the world landmarks' absolute
  scale is unreliable) must be under 12° for front/back, and within 15° of
  a true 90° profile for side views. Also checks the person is facing the
  *correct* direction (front vs. back) via `facing_direction()` — a purely
  topological test using which shoulder appears on which side of the
  image.
- **Posture**: shoulders level, torso not leaning, knees straight
  (via the angle at hip‑knee‑ankle).
- **Arms clear of the torso**: at the waist row, the silhouette must show
  three separate blobs (arm | torso | arm) — otherwise the waist width
  would include the arms.
- **Lighting**: mean brightness of the body pixels within a sane range,
  and enough contrast that the outline isn't flat/indistinguishable from
  the background.
- **Segmentation quality**: the boundary must be sharp enough (a soft,
  smeared edge is worth ±1.5cm of noise on its own and is rejected
  outright below a threshold).

Also computes `pose_quality` (0–1), a continuous score (not just
pass/fail) used later by the confidence model.

### `scale_reference.py` — pixels → centimetres
Defines how many centimetres one pixel represents, in order of
trustworthiness:
1. **ArUco marker** (`detect_aruco_scale`) — a printed square marker of
   known real-world size (see `make_marker.py`) detected with OpenCV's
   ArUco detector; its measured side length in pixels directly gives
   cm-per-pixel, independent of the person's self-reported height. Also
   estimates the marker's distance from the camera (needs camera
   intrinsics) so it can be checked against the subject's own distance.
2. **Chessboard** (`detect_chessboard_scale`) — same idea with a printed
   chessboard, averaging many corner-to-corner spacings.
3. **Stature (fallback)** (`stature_scale`) — `cm_per_pixel = entered_height_cm / (floor_row - head_vertex_row)`,
   using the silhouette's own top and bottom rows (not extrapolated face
   landmarks, and not the ankle joint, both of which were measured sources
   of several-percent error in the older version of this pipeline). It
   refuses to run at all if the silhouette touches a frame border, since
   the span would then be a crop artefact rather than the person's real
   height.

Every scale estimate carries a `confidence`, a `relative_uncertainty`
(propagated into every downstream measurement's own uncertainty), and a
human-readable list of warnings (e.g. "marker looks tilted").
`resolve_scale()` picks the best available source per view, and
`verify_reference_depth()` cross-checks that a physical marker is actually
sitting at the subject's own depth (not floating 30cm closer to the
camera, which alone can be a >10% error).

### `circumference.py` — turning width + depth into a circumference
The chest/waist/hip aren't flat — they're roughly elliptical
cross-sections. This module estimates that cross-section's *perimeter*
from a measured **width** (from the front/back views) and **depth** (from
the left/right views) using a **superellipse** model:

```
|2x/w|^n + |2y/d|^n = 1
```

where `w` = width, `d` = depth, and `n` is a per-level shape exponent
(chest 2.30, waist 2.20, hip 2.15, neck 2.00 — a plain ellipse is exactly
`n = 2`; larger `n` flattens the sides toward a rounded rectangle, which
increases the perimeter for the same width/depth). The perimeter is
computed by numerically integrating the curve's arc length
(`superellipse_circumference()`), and there's also an exact closed-form
ellipse formula (`ellipse_circumference()`, Ramanujan's second
approximation) used both as the `n=2` case and as a documented "model-free
lower bound" shown alongside every result for transparency. See
[section 6](#6-the-circumference-math-superellipse-model) for the full
walkthrough with numbers.

### `measurement_confidence.py` — how much to trust each number
Defines `ConfidenceFactors` (camera calibration quality, scale quality,
pose quality, segmentation quality, clothing looseness, cross-view
consistency, landmark visibility) which combine via a **geometric mean**
— deliberately, so one badly failing factor drags the whole score down
rather than being smoothed over by five good ones (a perfectly-posed photo
of an outline nobody can actually see is not "85% good"). Also defines
`decide_release()`, the final gate that decides whether the whole
four-view result is good enough to show the user at all, or whether
specific views need to be retaken and why.

### `multiview.py` — fusing four photos into one body
Defines `BodyModel`, which combines the four views' independent
observations into single numbers, using a different, deliberately chosen
rule per measurement (not a blanket average):
- **Scale consistency** (`check_scale_consistency`) — do the four views
  agree about the subject's size/position? Handled differently depending
  on whether the scale came from a physical marker (a genuine independent
  check) or from the entered height (which is shared by all four views by
  construction, so agreeing on it proves nothing — the module is explicit
  about this limitation rather than reporting a fake pass).
- **Shoulder** — front + back both see the same true shoulder span, so
  they're combined by **inverse-variance weighting** (the more certain
  measurement counts for more), and a large front/back disagreement is
  surfaced as a specific warning rather than silently averaged away.
- **Chest / waist / hip** — width fused from front+back, depth fused from
  left+right, then passed through `circumference.estimate_circumference()`.
- **Neck/collar** — same width+depth approach, plus a plausibility check
  (the neck can't reasonably be almost as wide as the shoulders — if it
  is, the detection failed and no collar is reported rather than a wrong
  one).
- **Sleeve length** — computed from *each arm's own side-view profile*
  (that arm hangs essentially in the image plane there, so 2D pixel length
  ≈ true length) and reported **per arm**, not averaged — real people are
  not perfectly symmetric, and the general "sleeve length" used for
  sizing takes the **longer** of the two, since a sleeve must fit the
  longer arm.
- **Torso length / inseam / height** — read from whichever view(s) give
  the clearest, most direct measurement (neck-to-hip vertical distance for
  torso length; crotch-to-floor for inseam; inverse-variance across all
  four views' implied stature for height).

### `draw_overlay.py` — putting lines and numbers on a photo
Pure OpenCV drawing code, no measurement logic. `draw_view_overlay()` is
the function actually used by the live pipeline today: it takes the
levels found by `anatomy.py` and draws the real, measured lines on the
captured photo (front/back: horizontal width lines with cm labels;
left/right: the same lines relabelled as depths, plus the shoulder→elbow→
wrist sleeve line), plus the silhouette contour itself and the head-vertex/
floor reference lines the scale was measured between — so a bad capture is
visually obvious, not just a number you have to trust. (`draw_measurement_overlay`,
`draw_sleeve_overlay` and `draw_back_shoulder_overlay` are simpler,
earlier-style helpers that draw whatever pixel points they're handed;
they're kept for API compatibility but the live pipeline calls
`draw_view_overlay()`.)

### `shirt_outline_detector.py` — the live shirt-outline preview
A largely self-contained script (it has its own `if __name__ == "__main__"`
webcam demo). Three of its functions — `get_torso_box()`,
`segment_shirt_grabcut()`, `draw_shirt_outline()` — are imported by
`app.py` and used **only** to draw a live, cosmetic outline around the
shirt during the *front* view's preview, using:
- `get_torso_box()` — a bounding box derived from the shoulder/hip pose
  landmarks (with padding), marking roughly where the shirt is.
- `segment_shirt_grabcut()` — runs OpenCV's **GrabCut** algorithm (an
  iterative foreground/background segmentation seeded from that box) to
  separate the shirt from skin/background inside it.
- `draw_shirt_outline()` — draws the resulting contour.

This output never reaches the measurement math — it's purely a live
visual so the person can see the camera "seeing" their shirt.

### `camera_calibration.py` — lens intrinsics & undistortion
Defines `CameraProfile` (focal length `fx`/`fy`, optical centre `cx`/`cy`,
lens distortion coefficients, calibration resolution) and
`calibrate_from_chessboard_images()`, a standard OpenCV chessboard camera
calibration. If a profile has been saved (`calibration/camera_profile.json`),
`measurement_pipeline.py` uses it to **undistort** every captured frame
before segmentation, and to convert an object's apparent pixel size into
an estimated real-world distance (used for the ArUco-marker depth check
and the cross-view distance-consistency test). Genuinely optional: the
pipeline works without it, just with lens distortion left uncorrected and
one less independent cross-check available.

### `calibration_profile.py` — the *other* kind of calibration
Deliberately named to avoid confusion with `camera_calibration.py`: this
one stores **measurement-model** settings — the per-level superellipse
shape exponents used by `circumference.py`, any fitted systematic bias
corrections, and the printed marker's real size — in
`calibration/measurement_calibration.json`. By design, `bias_corrections`
ships **empty** and is only ever populated by `validation.py` after seeing
a real ground-truth dataset with enough distinct subjects; a correction
fitted on one person would just be baking that one person's body into
everyone else's results.

### `validation.py` — proving the numbers are actually right
An offline tool (no camera involved): reads a CSV of real tape
measurements paired with a subject's four saved photos, re-runs the exact
same pipeline used live, and reports MAE/RMSE/bias per measurement
(`run_validation`). It's also the *only* code path allowed to fit
`bias_corrections` or refit the superellipse `shape_exponents` from real
data — both refuse to run below a minimum subject count, specifically so
a "correction" can't quietly be one person's body shape baked into a
constant.

### `measurements.py` — the front/back view entry point
Kept for backward compatibility (`compute_measurements()`,
`MeasurementError`, the MediaPipe landmark index constants). Internally it
now just calls into `measurement_pipeline.MeasurementEngine`, then repackages
the fused anatomy/scale into the `{"cm": x, "in": y}` shape the frontend
expects, and assembles the `draw_points` dictionary `draw_overlay.py` uses.

### `side_measurements.py` — the left/right/back view entry points
Same idea as `measurements.py` but for the profile views:
`compute_left_view_measurement()` / `compute_right_view_measurement()`
compute that arm's sleeve length plus body **depth** at every anatomical
level (the entire reason side views exist in this pipeline — depth is
what makes a real circumference possible instead of a guessed multiplier).
`compute_back_view_measurement()` runs the back photo through the exact
same frontal analysis as the front view (geometry from behind is
identical to face-on), producing a second, independent shoulder/chest/
waist/hip width rather than just a "does this roughly match the front?"
cross-check.

### Files not covered in depth (outside body measurement)
- `virtual_tryon.py`, `vton_engine.py`, `openai_vton_engine.py`,
  `inference_worker.py` — the separate **virtual try-on** feature
  (putting a garment photo onto the captured front-view photo), using
  PyTorch/diffusers or OpenAI's cloud API. No overlap with measurement.
- `model_store.py` — saves a finished 4-view session (photos + summary)
  to disk so the Recruiters section can reopen it later.
- `make_marker.py` — a small CLI that generates the printable ArUco scale
  marker PNG used by `scale_reference.py`.
- `auth_store.py`, `app.py`'s `/api/auth/*` routes — login/credentials,
  unrelated to the camera pipeline.

---

## 5. How each measurement is actually calculated

For every item below: **width/depth values always come from the
silhouette** (`body_segmentation.Silhouette.width_at()` /
`edges_at()`), never from a distance between two pose landmarks. Pose
landmarks are only used to know roughly where to search.

- **Height** — `stature_span_px = floor_contact_row − head_vertex_row`,
  read directly off the silhouette's own top and bottom rows, converted
  to cm using whichever scale source was resolved for that view
  (`scale.to_cm()`). Fused across all four views by inverse-variance
  weighting in `multiview.BodyModel._fuse_stature()`.

- **Across Shoulder** — the distance between the left and right
  **acromion points** (`anatomy.find_acromia()` — the corner where the
  shoulder slope turns into the arm, found by curvature analysis of the
  smoothed silhouette contour), *not* MediaPipe's shoulder landmark. Found
  independently in the front and back photos, then fused by
  inverse-variance weighting (`multiview.BodyModel._fuse_shoulder()`); a
  front/back disagreement over 6% is flagged as a likely capture problem
  rather than silently averaged.

- **Chest** — width = fullest torso silhouette width in the band from the
  armpit down to 40% of the way to the hip (`anatomy.analyse_frontal_view()`),
  fused from front+back. Depth = the same anatomical height transferred
  (via the stature-normalised `t` coordinate) into the left and right
  photos, where the widest silhouette *run* at that row is taken as the
  torso's front-to-back thickness (`anatomy.analyse_profile_view()`).
  Width and depth are then combined by the superellipse circumference
  formula (`circumference.estimate_circumference()`, exponent 2.30) in
  `multiview.BodyModel._fuse_circumference("chest")`.

- **Waist** — same approach as chest, except the level itself is defined
  as the **narrowest** torso width between the chest level and the hip
  line (the standard tailor's "natural waist"), and the circumference
  exponent used is 2.20.

- **Hip** — the **widest** torso width between the waist and the crotch;
  circumference exponent 2.15.

- **Neck / Collar** — width = narrowest neck span, walked down to where it
  flares into the trapezius (`anatomy.analyse_frontal_view()`'s neck-base
  logic), fused from front+back; depth transferred to the side views the
  same way as chest/waist/hip. A plausibility check first confirms the
  detected neck width is a sane fraction (22–55%) of the shoulder width —
  if not, no collar number is reported at all rather than a wrong one.
  Circumference exponent 2.00 (a plain ellipse — the neck really is close
  to circular).

- **Sleeve Length** — in each side-view photo,
  `distance(shoulder, elbow) + distance(elbow, wrist)` using the pose
  landmarks (in a true profile the arm lies almost flat in the image
  plane, so this 2D pixel distance is very close to the true 3D length).
  Left and right are reported **separately**; the single "sleeve length"
  used for garment sizing is the **longer** of the two arms
  (`multiview.BodyModel._fuse_sleeves()`), because a sleeve has to fit the
  longer arm.

- **Torso Length** — vertical pixel distance from the neck-base level down
  to the hip level, found in whichever frontal view(s) captured both
  (`multiview.BodyModel._fuse_lengths()`).

- **Inseam** — vertical pixel distance from the crotch row down to the
  floor-contact row.

---

## 6. The circumference math (superellipse model)

A chest, waist or hip isn't a flat line — it's a loop going around the
body — but a 2D photo only ever gives you a straight-line **width** (from
the front) or **depth** (from the side). `circumference.py` bridges that
gap by modelling the cross-section as a **superellipse**:

```
|2x / w|^n + |2y / d|^n = 1
```

- `w` = measured width (cm), `d` = measured depth (cm)
- `n` = a shape exponent, different per body level:

  | Level | n | Meaning |
  |---|---|---|
  | chest | 2.30 | flatter front/back, rounder at the sides |
  | waist | 2.20 | slightly flatter than a pure ellipse |
  | hip | 2.15 | |
  | neck | 2.00 | a plain ellipse |

  At exactly `n = 2` this shape *is* a normal ellipse. Larger `n` pushes
  the shape toward a rounded rectangle, which — for the *same* width and
  depth — has a **longer perimeter** than a pure ellipse. This matches
  real torso cross-sections measured from MRI/3D body scans, which are
  flatter on the front/back and rounder at the flanks rather than
  perfectly elliptical.

The perimeter of that curve has no simple closed-form formula for
`n ≠ 2`, so it's computed by **numerical arc-length integration**
(`superellipse_circumference()`): the curve is walked in tiny steps and the
length of each tiny step is summed (`numpy.trapz` over 2048 samples of one
quarter of the curve, multiplied by 4 for symmetry). For the special case
`n = 2` there's an exact formula (`ellipse_circumference()`, Ramanujan's
second approximation, accurate to about one part in a billion) which is
also reported alongside every result as a transparent "model-free lower
bound" — real cross-sections are never flatter than a pure ellipse of the
same width and depth, so this number is a sanity floor.

**Worked example** (from the file's own self-test): width 32cm, depth
22cm at the waist (`n = 2.20`) comes out to roughly **89.6cm** of
circumference, versus **84.8cm** for a pure ellipse of the same width and
depth — the extra ~5cm is exactly what the flatter, more rectangular
superellipse shape adds for a torso instead of a smooth oval.

The module also propagates measurement **uncertainty**: it perturbs the
width and depth slightly and sees how much the circumference changes
(`dC/dw`, `dC/dd`), then combines that sensitivity with the actual
estimated 1‑sigma error in the width and depth measurements
(`np.hypot(dcdw * width_sigma, dcdd * depth_sigma)`) to produce an honest
`uncertainty_cm` figure reported alongside every chest/waist/hip/collar
value — not just a bare number with no error bar.

**Why not a single "chest = shoulder × 2.2" style multiplier?** Because
the ratio of depth to width at the chest genuinely varies roughly
0.45–0.75 across different adults — that's already a ±15% spread in
circumference for people with an *identical* front-view width. A formula
anchored only to shoulder width can never see that difference; it needs
an actual measured depth from a side photo, which is the entire reason
this pipeline insists on capturing Left and Right views.

---

## 7. Confidence scoring and the release gate

Every measurement carries a confidence score in `[0, 1]`, built in
`measurement_confidence.py` from several independently measured factors —
camera calibration quality, scale-source quality (a physical marker beats
a self-reported height), live pose quality, segmentation sharpness,
clothing looseness, cross-view agreement, and landmark visibility. These
combine by a **geometric mean** (`ConfidenceFactors.combined()`), not an
average — deliberately, so one badly-failing factor (say, an
indistinguishable outline) can't be masked by five other factors being
fine. A capture with perfect posture but an unreadable silhouette edge is
not "85% good"; the geometric mean drags it down hard.

`decide_release()` is the final gate: it refuses to publish a result set
where any of the four "core" measurements (across shoulder, chest, waist,
hip) falls below a 65% confidence threshold, or where the four views
disagree too much about the subject's overall size (`scale_consistency`
< 0.6, meaning "you probably weren't standing in the same spot for every
photo"). When it refuses, it names exactly which views to retake and why,
rather than just showing a number anyway. This is a deliberate design
choice stated directly in the code: the system is built to prioritise
being *repeatable and honest* over always producing an answer.

---

## 8. Camera calibration vs. measurement calibration

These are two different things that share the word "calibration," and the
codebase is careful to keep them in separate files:

- **`camera_calibration.py`** — physical lens properties: focal length,
  optical centre, and distortion coefficients for *this specific camera*.
  Solved once (`python camera_calibration.py capture` then `solve`) from
  photos of a printed chessboard, saved to
  `calibration/camera_profile.json`. Used to **undistort** every frame
  before measurement (so a straight body edge near the frame border isn't
  bent by the lens) and to convert an object's apparent pixel size into an
  estimated distance from the camera.

- **`calibration_profile.py`** — *measurement-model* settings: the
  per-level superellipse shape exponents (`circumference.py`) and any
  fitted bias corrections, saved to
  `calibration/measurement_calibration.json`. These describe the body
  cross-section *model*, not the camera, and — unlike the camera
  profile — the bias corrections are never pre-filled; they stay empty
  until `validation.py` has enough real tape-measurement data to fit them
  responsibly.

Neither is required for the pipeline to run at all — without a camera
profile it just skips undistortion and distance checks; without measurement
calibration it uses the documented default shape exponents.

---

## 9. Quick file index

| File | One-line purpose |
|---|---|
| `app.py` | Flask routes, the camera thread & live state machine, on-screen live guidance/HUD |
| `measurement_pipeline.py` | Orchestrates one view through undistort → segment → validate → anatomy → scale |
| `body_segmentation.py` | Builds the trustworthy body silhouette; sub-pixel edges; clothing looseness |
| `anatomy.py` | Locates shoulder/chest/waist/hip/neck/crotch levels on the silhouette |
| `capture_validation.py` | The quality gate: is this frame measurable at all? |
| `scale_reference.py` | Pixels → centimetres (ArUco marker, chessboard, or entered height) |
| `circumference.py` | Width + depth → circumference, via the superellipse model |
| `measurement_confidence.py` | Per-measurement confidence scoring + the publish/retake gate |
| `multiview.py` | Fuses Front/Left/Right/Back into one body model |
| `draw_overlay.py` | Draws the measured guide lines onto the captured photo |
| `shirt_outline_detector.py` | Live cosmetic shirt-outline preview (GrabCut) for the front view |
| `camera_calibration.py` | Lens intrinsics, undistortion, distance-from-size math |
| `calibration_profile.py` | Storage for shape exponents / bias corrections (measurement, not camera) |
| `validation.py` | Offline scoring against real tape measurements; the only place corrections are fitted |
| `measurements.py` | Front/back-view public API (thin wrapper around `measurement_pipeline`) |
| `side_measurements.py` | Left/right/back-view public API (thin wrapper around `measurement_pipeline`) |
| `model_store.py` | Persists a finished 4-view session for the Recruiters section |
| `make_marker.py` | Generates the printable ArUco scale-reference marker |
| `virtual_tryon.py`, `vton_engine.py`, `openai_vton_engine.py`, `inference_worker.py` | Separate virtual try-on feature — not part of measurement |
| `auth_store.py` | Login credential storage — not part of measurement |
