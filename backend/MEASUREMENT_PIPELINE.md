# Body Measurement Pipeline — Audit and Rework

This document records what was wrong with the measurement system, what was
changed, and how to verify it. Every quantitative claim below was measured
on this repository's own stored captures (`static/captures/`, capture
session `1788181*`) or on synthetic subjects with known dimensions.

---

## 1. Audit: what the pipeline actually did

### 1.1 Camera calibration — did not exist

A search over the whole repository for `intrinsic`, `distortion`,
`undistort`, `cameraMatrix`, `calibrateCamera`, `focal`, `checkerboard`,
`charuco` or `aruco` matched **only prose inside docstrings**. There was:

| Item | Status before |
|---|---|
| Intrinsic matrix (fx, fy, cx, cy) | absent |
| Distortion coefficients | absent |
| Undistortion step | absent |
| Focal length | absent |
| Record of camera / resolution / zoom used | absent |
| Camera height, distance, orientation | not measured, not enforced |

Every occurrence of the word "calibration" in `measurements.py` and
`side_measurements.py` referred to the **pixel→centimetre scale**, which is
a different thing. So the premise "the camera has already been calibrated"
did not hold for this codebase: it had never been calibrated, and no code
existed that could have applied a calibration if one had been supplied.

Why it matters here specifically: the scale reference is the subject's
head-to-floor span, which runs from near the top border of the frame to
near the bottom border — precisely where radial distortion is largest. On a
synthetic lens with typical phone-grade distortion (k1 = −0.28) the
worst-case pixel displacement is **99 px on a 1080-tall frame (9.2%)**, and
a straight line bows by 3 px (`tests_calibration.py`).

### 1.2 Pixel→centimetre scale — three compounding defects

```python
# old measurements.py
head_top_y = eye_avg_y - (0.55 * abs(shoulder_mid_y - eye_avg_y))
scale = user_height_cm / (ankle_mid_y - head_top_y)
```

**(a) The head vertex was invented from face landmarks.** Measured against
the segmentation silhouette's actual top row:

| View | Estimated vertex | Real vertex | Error | As stature |
|---|---|---|---|---|
| front | y = 46 | y = 36 | +10 px | +1.8 cm |
| left | y = 82 | y = 52 | +30 px | +5.1 cm |
| right | y = 93 | y = 48 | +45 px | **+7.7 cm** |
| back | y = 193 | y = 163 | +30 px | +5.8 cm |

**(b) The ankle joint was used as the floor.** The lateral malleolus sits
≈4.6% of stature above ground (ISO 7250 / ANSUR II), so the pixel reference
was short and every centimetre came out ~4–5% large.

**(c) Nothing checked the body was inside the frame.** `visibility ≥ 0.4`
was treated as an in-frame test. It is not — it scores occlusion *by the
body* and stays high for a joint clamped to the border. **All four stored
captures have the feet cut off** (silhouette bottom row = 1079 of 1080) with
ankle visibility 0.80–0.96, and all four passed the old gate.

The consequence, measured:

| | front | back |
|---|---|---|
| Implied stature (px) | 1075 | 944 |
| Implied cm/px | 0.1723 | 0.2008 |

**A 13.8% scale disagreement between two photos of the same person taken
seconds apart.** That is the entire explanation for the front-vs-back
shoulder split the old cross-check reported (37.5 cm vs 44.1 cm = 17.6%)
and could not diagnose.

### 1.3 Widths were not measured on the body

```python
chest_left_x = l_shoulder[0] + (l_hip[0] - l_shoulder[0]) * 0.35
chest_width_px = abs(chest_right_x - chest_left_x)
```

This is the distance between two points on the line joining the **shoulder
joint centre** to the **hip joint centre** — both inside the body. It is not
the outline and barely varies with build. On the stored front capture it
gives **36.5 cm at the shoulder line where the real silhouette is 49.3 cm**
(a 26% under-read).

`shirt_outline_detector.segment_shirt_grabcut()` existed but its mask was
only ever drawn on the live preview; it never reached a measurement. The
MediaPipe `enable_segmentation` flag was never set.

### 1.4 Circumference was a constant

```python
CHEST_FROM_SHOULDER_FACTOR = 2.20
chest = across_shoulder * 2.20 * (measured_width_ratio / 0.80)
WAIST_FROM_SHOULDER_FACTOR = 1.95
COLLAR_FROM_SHOULDER_FACTOR = 0.85
```

The "individual adjustment" term was built from the joint-interpolated width
of §1.3, which barely varies, so the output collapsed onto the constant. On
the stored capture the term evaluated to 0.578/0.72 = 0.80 and produced a
**60.9 cm waist — 24 inches — for an adult male**.

Body **depth** was never measured anywhere, so no circumference model was
possible even in principle.

### 1.5 The side and back views contributed almost nothing

| View | What it produced |
|---|---|
| front | shoulder, sleeve, length, chest, waist, collar |
| left | `left_sleeve_length` — nothing else |
| right | `right_sleeve_length` — nothing else |
| back | `back_across_shoulder`, used only for a pass/fail tag |

Three photographs for two arm lengths and one cross-check.

Stored left vs right sleeve: **56.0 cm vs 59.9 cm, 7% apart** — from scale
differences between the two views, not from the subject's arms.

### 1.6 The pose gate could not detect the poses that matter

* No true orientation test. `abs(l_sh.y − r_sh.y) < 0.04` accepts a subject
  rotated 25° about the vertical, foreshortening every width by 9%.
* No front/back discrimination.
* The side-view turn test compared a **normalised** shoulder gap against a
  fixed 0.10, so the threshold meant a different angle at every distance.
* No lean test, no bend test, no arms-clear-of-torso test, no lighting test.

### 1.7 Nothing was validated, and nothing carried a confidence

No ground-truth data, no error metrics, no tests of any kind. The constants
2.20 / 1.95 / 0.85 / 0.80 / 0.72 / 0.52 / 1.20 / 0.55 were unfalsifiable.
Every output was printed to one decimal place regardless of capture quality;
the only quality signal was a boolean against a **15%** threshold, so two
photos of the same shoulder 14.9% apart read as "Consistent".

---

## 2. What changed

### Files added

| File | Purpose |
|---|---|
| `camera_calibration.py` | Intrinsics, distortion, undistortion, resolution rescaling, pinhole distance relations, chessboard calibration CLI |
| `scale_reference.py` | ArUco / chessboard / stature scale with depth awareness and uncertainty |
| `body_segmentation.py` | Silhouette construction, sub-pixel edges, ROI re-segmentation, guided-filter refinement, quality metrics, clothing looseness |
| `capture_validation.py` | The quality gate: framing, distance, orientation, posture, arms, lighting, segmentation |
| `anatomy.py` | Anatomical level detection and cross-view level correspondence |
| `circumference.py` | Superellipse cross-section model with numerical error propagation |
| `multiview.py` | Four-view fusion, cross-view checks, asymmetry policy |
| `measurement_confidence.py` | Per-measurement confidence and the release gate |
| `measurement_pipeline.py` | Orchestrator (`MeasurementEngine`) |
| `calibration_profile.py` | Storage for measurement calibration (shape exponents, fitted biases) |
| `validation.py` | Ground-truth dataset, MAE/RMSE/bias metrics, guarded correction fitting |
| `make_marker.py` | Printable ArUco scale reference |
| `tests_geometry.py`, `tests_pipeline.py`, `tests_calibration.py` | Test suites |

### Files modified

| File | Change |
|---|---|
| `measurements.py` | Internals replaced; public API, landmark constants, helpers and value shape preserved |
| `side_measurements.py` | Internals replaced; now extracts body depth; API preserved |
| `app.py` | Segmentation enabled, engine wired in, live guidance separated from the gate, `build_summary` replaced, three routes added |
| `draw_overlay.py` | `draw_view_overlay()` added; the three existing functions untouched |
| `static/script.js`, `templates/index.html`, `static/style.css` | Confidence, uncertainty, quality gate, ground-truth capture |

### Functions modified

`compute_measurements`, `compute_scale_cm_per_px`, `compute_side_scale_cm_per_px`,
`compute_left_view_measurement`, `compute_right_view_measurement`,
`compute_back_view_measurement`, `check_alignment`, `check_side_alignment`,
`build_summary`, `camera_loop` (capture branch), `start`, `reset`,
`retake_current`, `status`.

### Constants removed

`CHEST_FROM_SHOULDER_FACTOR` (2.20), `WAIST_FROM_SHOULDER_FACTOR` (1.95),
`COLLAR_FROM_SHOULDER_FACTOR` (0.85), `BASELINE_CHEST_WIDTH_RATIO` (0.80),
`BASELINE_WAIST_WIDTH_RATIO` (0.72), `CHEST_LEVEL_FRACTION` (0.35),
`WAIST_LEVEL_FRACTION` (0.95), `HEAD_TO_HIP_HEIGHT_RATIO` (0.52),
`SHIRT_LENGTH_EXTENSION_FACTOR` (1.20), the `0.55` head-vertex offset, and
`CROSS_CHECK_THRESHOLD_PCT` (15).

**One anthropometric constant remains:** `ANKLE_HEIGHT_STATURE_FRACTION =
0.046`, used only for diagnostics and never in a released measurement — the
floor is observed from the silhouette.

**Model parameters that remain, declared as such:** the per-level
superellipse exponents (`chest` 2.30, `waist` 2.20, `hip` 2.15, `neck` 2.00).
These describe cross-section shape, are documented, are refittable from
ground-truth data by `validation.fit_shape_exponents()`, and setting them all
to 2.0 reduces the model to a plain ellipse with no tuned value at all.

---

## 3. Algorithms and formulas

### 3.1 Scale

```
marker:   cm_per_px = marker_side_cm / mean(|corner_i − corner_{i+1}|)
stature:  cm_per_px = user_height_cm / (floor_row − vertex_row)
distance: Z = f · X / x            scale(Z) = Z / f
```

Vertex and floor rows come from the segmentation silhouette. Scale is only
valid at one depth, so a marker must stand at the subject's own standing
plane; `verify_reference_depth()` checks this via PnP when intrinsics exist.

### 3.2 Anatomical levels

| Level | Definition | How it is found |
|---|---|---|
| Acromion (across shoulder) | Shoulder tip where the trapezius slope breaks into the arm | Point of maximum concavity on the outer contour between neck and axilla, refined by intersecting the two straight segments either side |
| Axilla | Where arm and torso separate | First row where the mask goes from 1 foreground run to 3 |
| Chest | Fullest chest under the arms | Max torso width from axilla to 40% of the way to the hip line |
| Waist | Natural waist | Min torso width between chest and hip line |
| Hip | Fullest hip | Max torso width between waist and crotch |
| Crotch | Where the legs separate | First row where the mask goes from 1 run to 2 |
| Neck base | Where the neck flares into the trapezius | Break in the width profile below the narrowest neck row, with a plausibility guard |
| Inseam | Crotch to floor | Level difference |
| Sleeve | Shoulder → elbow → wrist | Summed in that arm's own profile view |

Torso widths use the **middle** foreground run, so arms are excluded.

### 3.3 Cross-view correspondence

```
t = (y − vertex_y) / (floor_y − vertex_y)
```

Levels are located in the front/back views (where the width profile is
informative) and transferred to the side views by `t`. This is scale- and
framing-independent, so a small difference in the subject's distance between
shots still hits the same anatomical height.

### 3.4 Circumference

Cross-section modelled as a superellipse `|2x/w|ⁿ + |2y/d|ⁿ = 1`, perimeter by
arc-length integration over one quadrant × 4. At n = 2 this reduces to
Ramanujan's ellipse approximation:

```
h = ((a−b)/(a+b))²
C = π(a+b)[1 + 3h/(10 + √(4−3h))]
```

`w` from front+back, `d` from left+right. n > 2 flattens the flanks and adds
perimeter; ellipse (n = 2) is a lower bound for a human torso.

Uncertainty is propagated numerically: `σ_C = √((∂C/∂w · σ_w)² + (∂C/∂d · σ_d)²)`.

**Why not a multiplier:** a `width × constant` model implicitly fixes d/w.
Measured d/w at the chest spans roughly 0.45–0.75 across adults — a ±15%
circumference spread for identical width, which is exactly the error the side
views eliminate.

### 3.5 Fusion rules

| Measurement | Rule | Reason |
|---|---|---|
| Across shoulder | Front + back, inverse-variance | Both observe the same biacromial span |
| Chest / waist / hip | Width (front+back) × depth (left+right) → superellipse | Each view supplies what it can see |
| Sleeve | **Reported per arm**; sizing value = `max(left, right)` | A sleeve must fit the longer arm; averaging destroys real asymmetry |
| Height | Inverse-variance over all four | Independent observations |
| Inseam / torso length | Front view | Crotch and floor are crispest there |

Left/right **depth** difference is a rotation-error signal (both views measure
the same thickness), not anatomy — it lowers confidence rather than being
preserved. Left/right **limb length** difference may be real and is preserved.

### 3.6 Confidence

Geometric mean of calibration, scale, pose, segmentation, view-consistency and
landmark factors, times the clothing multiplier. Geometric so one bad factor
drags the result down instead of being averaged away.

---

## 4. Requirements

### Calibration requirements

```bash
python camera_calibration.py capture   # 15–20 chessboard views, all frame corners
python camera_calibration.py solve
python camera_calibration.py show      # fx, fy, cx, cy, dist, RMS, FOV, distortion shift
python make_marker.py                  # printable scale reference
```

* Calibrate in **the exact capture mode** — a phone's 1×, 0.5× and front
  cameras are three different optical systems and each needs its own profile.
* Aim for RMS reprojection error < 0.5 px. The pipeline warns above 1.0 px.
* Aspect-ratio mismatch between calibration and capture is detected and
  lowers the calibration confidence factor.

### Capture requirements — enforced, not advisory

| Condition | Threshold |
|---|---|
| Whole body in frame | silhouette must not touch **any** border |
| Subject fills frame height | 60–88% |
| Horizontal centring | 32–68% |
| Yaw, front/back | ≤ 12° off square |
| Yaw, profiles | 90° ± 15° |
| Torso lean | ≤ 6° |
| Shoulder tilt | ≤ 6° |
| Knee angle | ≥ 160° |
| Arms clear of torso | 3 foreground runs at the waist row |
| Body brightness | mean 45–225 |
| Outline sharpness | boundary transition < 9 px |

Setup: mark the standing spot on the floor; tripod at chest height, level, 2.5–3.5 m
away; fixed zoom; same spot for all four views; shoes off; fitted clothing.

---

## 5. Validation procedure

```bash
python validation.py init          # create validation_data/ground_truth.csv
# capture subjects, enter tape measurements in the UI, click Save
python validation.py report        # MAE, RMSE, MAPE, bias, std, max error
python validation.py fit-shape     # refit superellipse exponents (needs 12+ subjects)
python validation.py fit-bias      # fit per-measurement offsets (needs 8+ subjects)
```

Bias fitting is guarded three ways: a minimum subject count, a significance
test (|bias| > 2 SEM), and per-measurement rather than global. A correction
fitted on one person encodes that person's anatomy and would make the system
worse while making its self-reported error look better.

### Test suites

```bash
python tests_geometry.py       # 23 checks — measurement maths vs known truth
python tests_pipeline.py       # 16 checks — full engine, including refusals
python tests_calibration.py    # 25 checks — intrinsics, undistortion, ArUco
python tests_capture_loop.py   # 13 checks — capture state machine (see §6a)
```

Current status: **77/77 passing.**

---

## 6. Expected accuracy

**No accuracy is claimed against real tape measurements**, because no
ground-truth dataset exists yet. That is the point of §5. What *has* been
measured:

**Against synthetic subjects with exactly known dimensions** (`tests_geometry.py`):

| Quantity | Error |
|---|---|
| Recovered scale | < 0.3% |
| Chest / waist / hip width | +0.26 to +0.32 cm |
| Chest / waist / hip depth | +0.22 to +0.23 cm |
| Across shoulder | +0.25 cm |
| Level positions (t) | < 0.005 stature |
| Circumference vs model | +0.79 to +0.89 cm |

**Against synthetic cameras with known intrinsics** (`tests_calibration.py`):

| Quantity | Error |
|---|---|
| fx, fy | < 1% |
| cx, cy | < 15 px |
| k1 | < 0.002 |
| ArUco scale at 2.5 m | 0.10% |
| ArUco scale at 4.0 m | 0.23% |

**Realistic expectation on real subjects**, reasoning from the error budget
(scale uncertainty + edge localisation + cross-section model):

| Measurement | Expected error, marker scale + calibrated camera | Expected error, height-based scale |
|---|---|---|
| Height | ±0.5 cm | (equals what you typed) |
| Across shoulder | ±1.0–1.5 cm | ±1.5–2.5 cm |
| Chest | ±2–3 cm | ±3–4 cm |
| Waist | ±2–3 cm | ±3–4 cm |
| Hip | ±2–3 cm | ±3–4 cm |
| Sleeve | ±1.5–2.5 cm | ±2–3 cm |
| Inseam | ±1.5–2.5 cm | ±2–3 cm |
| Collar | ±2–3 cm, indicative only | ±3 cm |

These are projections from the measured error budget, **not validated
results**. Replace them with §5's numbers once you have them.

---

## 6a. Capture-loop fix (countdown never fired)

**Symptom reported:** the countdown runs 3, 2, 1, shows "Hold still...", then
restarts — forever, with no photo and no explanation.

**Cause — a defect introduced by this rework.** The countdown was armed by
the cheap per-frame checks (`check_alignment` / `check_side_alignment`) while
the photo itself was judged by the full `validate_capture()`. The cheap
checks are a strict subset, so a frame could pass them, run the entire
countdown, and be refused at the last instant. And the refusal message
written into `state["message"]` was overwritten roughly 30 ms later by the
aligning branch, which rewrites that field on every frame — so the reason was
never visible.

Reproduced on a synthetic subject with arms resting against the torso (a
condition only the full gate tests): **6 countdowns started, 0 photos taken,
final on-screen message `"Hold still... capturing in 3"`.** After the fix:
**0 countdowns started**, and the reason — "Move your arms about 15–20 cm away
from your body…" — is shown immediately and continuously.

**Changes:**

1. **The same gate now arms the countdown and judges the photo.**
   `run_live_gate()` runs the real `validate_capture()` in the preview loop
   every `GATE_EVERY_N_FRAMES` (3) frames, on a fast silhouette
   (`cross_check=False, refine=False`, ~19 ms instead of ~69 ms). The
   countdown starts only when that gate passes, so it can no longer start a
   count it cannot finish. The fast silhouette has a *softer* boundary than
   the capture path's, so its sharpness score is lower — the live gate is
   marginally stricter than the capture gate, which is the safe direction.

2. **A `rejected` mode holds refusals on screen** for
   `REJECTED_PAUSE_SECONDS` (3 s) with a full-frame banner, instead of
   dropping straight back into the branch that overwrites the message.

3. **Every blocking reason is shown, live**, on the video overlay
   (`draw_gate_hud`) and in the browser (`blocking_reasons` in `/status` →
   the blockers panel), from whichever gate tier produced it — so all the
   problems can be fixed at once rather than one per countdown cycle.

4. **Preview pose model dropped back to `model_complexity=1`.** Measured at
   1080p on this machine: complexity 0 = 11 ms, 1 = 16 ms, 2 = 85 ms.
   Raising the preview loop to complexity 2 earlier in this rework cut it to
   ~12 fps and made the hold-still period take almost twice as long as
   intended. The heavy model now runs once per view, on the captured still,
   via `capture_still_pose()` (`static_image_mode=True, model_complexity=2`)
   — so the measurement still gets the best landmarks and mask.

Regression test: `tests_capture_loop.py` (13 checks) drives the state machine
headlessly and asserts that a valid subject is photographed exactly once, that
neither an arms-closed nor a feet-clipped subject ever starts a countdown, and
that a capture-time refusal stays on screen.

---

## 7. Remaining limitations

1. **No ground-truth data yet.** Every accuracy figure above is either
   synthetic or projected. Collect 10–20 subjects before trusting any of it.
2. **Segmentation resolution.** MediaPipe's mask is generated at 256×256 and
   upsampled; the boundary spreads over ~7 px at 1080p. ROI re-segmentation
   and guided filtering bring it to ~5 px. Sub-pixel edge interpolation makes
   the *systematic* error small, but the random error is real — roughly
   ±0.4 cm per width. A higher-resolution matting model would be the next
   substantive gain.
3. **Clothing is flagged, never subtracted.** Loose fabric lowers confidence.
   Estimating how much cloth to remove would be inventing data.
4. **Tape compression.** A tape is pulled snug and compresses soft tissue; an
   optical outline does not. Expect a small positive bias, quantifiable per
   measurement by `validation.fit_bias_corrections()`.
5. **Two-parameter cross-section.** Width and depth cannot distinguish two
   people with the same w and d but different front/back flatness.
6. **Self-reported height, when no marker is used, is undetectable.** Every
   view shares it, so a 2 cm error biases everything by 1.1% invisibly. Only a
   physical marker removes this.
7. **Landmarks are computed on the distorted frame.** They bracket search
   windows and supply angles, both distortion-tolerant; the measurements
   themselves come from the silhouette on the undistorted frame. Running pose
   on the undistorted frame would be marginally cleaner.
8. **The four views are not registered into a single 3D model.** Levels
   correspond by stature-normalised height, which assumes the subject stood
   with the same posture in each shot — enforced by the lean and knee gates,
   but not verified per-landmark.
9. **Collar is the weakest measurement** and is excluded from the release
   gate's core set.
10. **Rejection rate.** The gate is deliberately strict — all four of this
    project's stored captures are refused. That is correct behaviour, but it
    means the capture environment has to be set up properly before the system
    will produce anything at all.
