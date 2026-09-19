"""
validation.py
=============
NEW MODULE. Ground-truth validation against tape measurements, plus the
only sanctioned route to fitting measurement-specific corrections.

AUDIT FINDING THIS MODULE ADDRESSES
-----------------------------------
There was no validation of any kind in the project: no ground-truth data,
no error metrics, no test comparing an output against a tape measure. The
constants in the old measurements.py (2.20, 1.95, 0.85, 0.80, 0.72, 0.52,
1.20, 0.55) were therefore unfalsifiable - nothing could ever show them to
be wrong, and the docstring's advice was "If you compare against a real
tape measurement and find yours runs consistently high/low, adjust these
constants," by hand, with no procedure.

WHAT THIS MODULE PROVIDES
-------------------------
  * A ground-truth file format (CSV) pairing a subject with their tape
    measurements and their four captured images.
  * `run_validation()` - runs the real pipeline over each subject's images
    offline (no camera) and produces MAE, RMSE, mean percentage error,
    max error, standard deviation and bias, per measurement.
  * `fit_bias_corrections()` - fits a per-measurement systematic offset,
    but ONLY when the dataset has enough distinct subjects, and reports
    whether the offset is statistically distinguishable from zero.
  * `fit_shape_exponents()` - refits the circumference model's per-level
    superellipse exponents against tape circumferences, which is the
    physically meaningful parameter to tune (it describes cross-section
    shape) rather than a blanket multiplier.

CLI
---
    python validation.py report                 # metrics table
    python validation.py fit-bias               # fit + save offsets
    python validation.py fit-shape              # fit + save exponents
"""

from __future__ import annotations

import csv
import json
import math
import os
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "validation_data")
GROUND_TRUTH_CSV = os.path.join(DATA_DIR, "ground_truth.csv")
REPORT_JSON = os.path.join(DATA_DIR, "validation_report.json")

# Measurements we validate. Keys match multiview.BodyModel.measurements.
VALIDATED = ("across_shoulder", "chest", "waist", "hip", "collar",
             "sleeve_length", "left_sleeve_length", "right_sleeve_length",
             "inseam", "torso_length", "height")

CSV_COLUMNS = (["subject_id", "height_cm", "notes",
                "front_image", "left_image", "right_image", "back_image"] +
               [f"tape_{m}_cm" for m in VALIDATED])


class ValidationError(Exception):
    pass


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

def write_template(path: str = GROUND_TRUTH_CSV) -> str:
    """Create an empty ground-truth CSV with the right columns."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_COLUMNS)
        w.writerow(["example_01", "175.0", "fitted t-shirt, shoes off",
                    "validation_data/images/s01_front.jpg",
                    "validation_data/images/s01_left.jpg",
                    "validation_data/images/s01_right.jpg",
                    "validation_data/images/s01_back.jpg"] +
                   ["" for _ in VALIDATED])
    return path


def load_ground_truth(path: str = GROUND_TRUTH_CSV) -> List[dict]:
    if not os.path.exists(path):
        raise ValidationError(
            f"No ground-truth file at {path}. Create one with:\n"
            f"    python validation.py init\n"
            f"then fill in one row per subject: their tape measurements and "
            f"the four image paths.")
    rows = []
    with open(path) as fh:
        for row in csv.DictReader(fh):
            if not (row.get("subject_id") or "").strip():
                continue
            if not any((row.get(f"tape_{m}_cm") or "").strip() for m in VALIDATED):
                continue          # template/example row with no tape data
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Running the real pipeline offline
# ---------------------------------------------------------------------------

def measure_subject(row: dict, require_marker: bool = False,
                    strict: bool = True, mirrored: bool = False) -> dict:
    """Run the production pipeline over one subject's four stored images.

    `mirrored=False` by default because saved files are normally stored
    un-mirrored; app.py's live feed is mirrored and passes mirrored=True.
    Getting this wrong flips the front/back discrimination, so it is an
    explicit argument rather than a guess.
    """
    import cv2
    import mediapipe as mp
    from measurement_pipeline import MeasurementEngine

    height = float(row["height_cm"]) if (row.get("height_cm") or "").strip() else None
    engine = MeasurementEngine(user_height_cm=height, require_marker=require_marker,
                               mirrored=mirrored, strict=strict)

    # Front first: the side views need its anatomical levels.
    order = ["front", "back", "left", "right"]
    view_errors = {}
    with mp.solutions.pose.Pose(static_image_mode=True, model_complexity=2,
                                enable_segmentation=True,
                                min_detection_confidence=0.5) as pose:
        for view in order:
            path = (row.get(f"{view}_image") or "").strip()
            if not path:
                view_errors[view] = "no image path in ground truth row"
                continue
            if not os.path.isabs(path):
                path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
            img = cv2.imread(path)
            if img is None:
                view_errors[view] = f"could not read {path}"
                continue
            res = pose.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            if not res.pose_landmarks:
                view_errors[view] = "no person detected"
                continue
            vr = engine.process_view(view, img, res.pose_landmarks,
                                     res.pose_world_landmarks,
                                     res.segmentation_mask)
            if not vr.ok:
                view_errors[view] = vr.message

    out = engine.finalize()
    out["view_errors"] = view_errors
    return out


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

@dataclass
class MetricSet:
    measurement: str
    n: int
    mae: float
    rmse: float
    mean_pct_error: float
    mean_abs_pct_error: float
    max_abs_error: float
    bias: float                  # signed mean (AI - tape); + means over-reads
    std: float                   # std of the signed error
    bias_significant: bool       # |bias| > 2 * SEM
    pairs: List[Tuple[str, float, float]] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"measurement": self.measurement, "n": self.n,
                "MAE_cm": round(self.mae, 2), "RMSE_cm": round(self.rmse, 2),
                "mean_pct_error": round(self.mean_pct_error, 2),
                "MAPE_pct": round(self.mean_abs_pct_error, 2),
                "max_abs_error_cm": round(self.max_abs_error, 2),
                "bias_cm": round(self.bias, 2), "std_cm": round(self.std, 2),
                "bias_significant": self.bias_significant}


def compute_metrics(measurement: str,
                    pairs: List[Tuple[str, float, float]]) -> Optional[MetricSet]:
    """pairs = [(subject_id, tape_cm, ai_cm), ...]"""
    if not pairs:
        return None
    tape = np.array([p[1] for p in pairs], float)
    ai = np.array([p[2] for p in pairs], float)
    err = ai - tape
    n = len(pairs)
    sem = float(np.std(err, ddof=1) / math.sqrt(n)) if n > 1 else float("inf")
    return MetricSet(
        measurement=measurement, n=n,
        mae=float(np.mean(np.abs(err))),
        rmse=float(np.sqrt(np.mean(err ** 2))),
        mean_pct_error=float(np.mean(err / tape * 100)),
        mean_abs_pct_error=float(np.mean(np.abs(err) / tape * 100)),
        max_abs_error=float(np.max(np.abs(err))),
        bias=float(np.mean(err)),
        std=float(np.std(err, ddof=1)) if n > 1 else 0.0,
        bias_significant=bool(n > 1 and abs(float(np.mean(err))) > 2 * sem),
        pairs=pairs,
    )


def run_validation(path: str = GROUND_TRUTH_CSV, save: bool = True,
                   **kwargs) -> dict:
    """Measure every subject and score the results against their tape data."""
    rows = load_ground_truth(path)
    if not rows:
        raise ValidationError(
            f"{path} has no usable rows. Each row needs a subject_id, four "
            f"image paths and at least one tape_*_cm value.")

    per_subject, collected = [], {m: [] for m in VALIDATED}
    for row in rows:
        sid = row["subject_id"]
        try:
            result = measure_subject(row, **kwargs)
        except Exception as exc:                      # noqa: BLE001
            per_subject.append({"subject_id": sid, "ok": False, "error": str(exc)})
            continue

        ms = result.get("measurements", {})
        entry = {"subject_id": sid, "ok": bool(result.get("ok")),
                 "released": bool(result.get("ok")),
                 "view_errors": result.get("view_errors", {}),
                 "overall_confidence": result.get("release", {}).get("overall_confidence"),
                 "comparisons": {},
                 # width/depth actually measured at each level, needed by
                 # fit_shape_exponents() to refit the cross-section model
                 "detail": {k: (ms[k].get("detail") or {})
                            for k in ("chest", "waist", "hip") if k in ms}}
        for m in VALIDATED:
            raw = (row.get(f"tape_{m}_cm") or "").strip()
            if not raw or m not in ms:
                continue
            tape = float(raw)
            ai = float(ms[m]["cm"])
            entry["comparisons"][m] = {
                "tape_cm": tape, "ai_cm": ai,
                "abs_error_cm": round(abs(ai - tape), 2),
                "pct_error": round((ai - tape) / tape * 100, 2),
                "confidence": ms[m].get("confidence"),
            }
            collected[m].append((sid, tape, ai))
        per_subject.append(entry)

    metrics = {}
    for m, pairs in collected.items():
        ms_ = compute_metrics(m, pairs)
        if ms_:
            metrics[m] = ms_.as_dict()

    all_err = [abs(ai - tape) for pairs in collected.values() for _, tape, ai in pairs]
    report = {
        "n_subjects": len(rows),
        "n_measured": sum(1 for s in per_subject if s.get("ok")),
        "overall": {
            "n_comparisons": len(all_err),
            "MAE_cm": round(float(np.mean(all_err)), 2) if all_err else None,
            "RMSE_cm": round(float(np.sqrt(np.mean(np.square(all_err)))), 2) if all_err else None,
            "max_abs_error_cm": round(float(np.max(all_err)), 2) if all_err else None,
        },
        "per_measurement": metrics,
        "per_subject": per_subject,
    }
    if save:
        os.makedirs(os.path.dirname(REPORT_JSON), exist_ok=True)
        with open(REPORT_JSON, "w") as fh:
            json.dump(report, fh, indent=2)
        report["report_path"] = REPORT_JSON
    return report


def format_report(report: dict) -> str:
    lines = [
        f"Subjects: {report['n_subjects']}   measured successfully: {report['n_measured']}",
        "",
        f"{'Measurement':<22}{'n':>4}{'MAE':>8}{'RMSE':>8}{'MAPE%':>8}"
        f"{'Bias':>8}{'Std':>8}{'MaxErr':>9}  {'Bias sig?':>9}",
        "-" * 92,
    ]
    for m, d in sorted(report["per_measurement"].items(),
                       key=lambda kv: -kv[1]["MAE_cm"]):
        lines.append(
            f"{m:<22}{d['n']:>4}{d['MAE_cm']:>8.2f}{d['RMSE_cm']:>8.2f}"
            f"{d['MAPE_pct']:>8.2f}{d['bias_cm']:>+8.2f}{d['std_cm']:>8.2f}"
            f"{d['max_abs_error_cm']:>9.2f}  {'YES' if d['bias_significant'] else 'no':>9}")
    o = report["overall"]
    lines += ["-" * 92,
              f"OVERALL  n={o['n_comparisons']}  MAE={o['MAE_cm']}cm  "
              f"RMSE={o['RMSE_cm']}cm  max={o['max_abs_error_cm']}cm"]
    failed = [s for s in report["per_subject"] if not s.get("ok")]
    if failed:
        lines += ["", f"{len(failed)} subject(s) rejected by the quality gate:"]
        for s in failed[:10]:
            reason = s.get("error") or "; ".join(
                f"{v}: {e}" for v, e in (s.get("view_errors") or {}).items()) or "gate"
            lines.append(f"  {s['subject_id']}: {reason}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Fitting corrections - guarded
# ---------------------------------------------------------------------------

def fit_bias_corrections(report: Optional[dict] = None,
                         min_subjects: Optional[int] = None,
                         save: bool = True) -> dict:
    """Fit a per-measurement systematic offset from validation data.

    Guarded three ways, all deliberate:
      * a minimum subject count (default 8) - below that the "bias" is one
        person's anatomy;
      * a significance test - the offset must exceed 2 standard errors, so
        a mean that is really zero is not encoded as a correction;
      * per-measurement, never global - the audit brief is explicit that
        one correction cannot serve every measurement, and the error
        sources genuinely differ (shoulder is a width, chest is a modelled
        circumference, sleeve is a limb length).
    """
    from calibration_profile import (load_measurement_calibration,
                                     save_measurement_calibration,
                                     MIN_SUBJECTS_FOR_BIAS)
    min_subjects = min_subjects or MIN_SUBJECTS_FOR_BIAS
    report = report or run_validation(save=False)

    fitted, skipped = {}, {}
    for m, d in report["per_measurement"].items():
        if d["n"] < min_subjects:
            skipped[m] = (f"only {d['n']} subject(s); need {min_subjects}. "
                          f"Observed bias {d['bias_cm']:+.2f}cm is NOT applied.")
            continue
        if not d["bias_significant"]:
            skipped[m] = (f"bias {d['bias_cm']:+.2f}cm is within noise "
                          f"(std {d['std_cm']:.2f}cm over {d['n']} subjects).")
            continue
        fitted[m] = {"offset_cm": d["bias_cm"], "n_subjects": d["n"],
                     "std_cm": d["std_cm"],
                     "note": "AI minus tape; subtracted from future outputs."}

    calib = load_measurement_calibration()
    calib["bias_corrections"] = fitted
    calib["n_subjects"] = report["n_subjects"]
    if save and fitted:
        save_measurement_calibration(calib)
    return {"fitted": fitted, "skipped": skipped, "saved": bool(save and fitted)}


def fit_shape_exponents(report: Optional[dict] = None, save: bool = True) -> dict:
    """Refit the superellipse exponents for chest/waist/hip against tape data.

    This is preferable to a blanket multiplier because the exponent has a
    physical meaning - how rectangular the cross-section is - so fitting it
    stays inside the model instead of bolting a fudge factor onto it. For
    each level we solve for the n that minimises squared error against the
    tape circumferences, given the widths and depths the pipeline measured.
    """
    from calibration_profile import (load_measurement_calibration,
                                     save_measurement_calibration,
                                     MIN_SUBJECTS_FOR_SHAPE)
    from circumference import superellipse_circumference

    report = report or run_validation(save=False)
    fitted, skipped = {}, {}

    for level in ("chest", "waist", "hip"):
        samples = []
        for s in report["per_subject"]:
            c = (s.get("comparisons") or {}).get(level)
            det = (s.get("detail") or {})
            if not c:
                continue
            wd = det.get(level)
            if wd and wd.get("width_cm") and wd.get("depth_cm"):
                samples.append((wd["width_cm"], wd["depth_cm"], c["tape_cm"]))
        if len(samples) < MIN_SUBJECTS_FOR_SHAPE:
            skipped[level] = (f"{len(samples)} usable sample(s); need "
                              f"{MIN_SUBJECTS_FOR_SHAPE} before refitting the "
                              f"cross-section model.")
            continue
        grid = np.linspace(1.8, 3.2, 57)
        errs = [np.mean([(superellipse_circumference(w, d, n) - t) ** 2
                         for w, d, t in samples]) for n in grid]
        fitted[level] = round(float(grid[int(np.argmin(errs))]), 3)

    if fitted:
        calib = load_measurement_calibration()
        calib["shape_exponents"].update(fitted)
        if save:
            save_measurement_calibration(calib)
    return {"fitted": fitted, "skipped": skipped}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    try:
        if cmd == "init":
            print("wrote", write_template())
        elif cmd == "report":
            print(format_report(run_validation()))
        elif cmd == "fit-bias":
            print(json.dumps(fit_bias_corrections(), indent=2))
        elif cmd == "fit-shape":
            print(json.dumps(fit_shape_exponents(), indent=2))
        else:
            print(__doc__)
    except ValidationError as exc:
        # A missing or empty dataset is the normal starting state, not a
        # crash. Say what to do about it.
        print(f"\n{exc}\n", file=sys.stderr)
        sys.exit(1)
