"""
calibration_profile.py
======================
NEW MODULE. Storage for MEASUREMENT calibration - as distinct from CAMERA
calibration (camera_calibration.py). Two different things that the old
code's docstrings used the same word for.

Holds:
  * shape_exponents   - per-level superellipse exponents for the
                        circumference model (see circumference.py).
  * bias_corrections  - per-measurement systematic offsets fitted from a
                        ground-truth dataset by validation.py.
  * marker_side_cm    - the printed size of the scale reference in use.

DESIGN RULE
-----------
Nothing in here is shipped pre-filled with tuned numbers except the
documented default shape exponents. `bias_corrections` starts EMPTY and is
only written by validation.fit_bias_corrections(), which refuses to fit
below a minimum subject count. A correction derived from one person
encodes that person's body, not a property of the system, and applying it
to everyone else makes the system worse while making its self-reported
error look better.
"""

from __future__ import annotations

import json
import os
import time

from circumference import DEFAULT_SHAPE_EXPONENTS

CALIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "calibration")
MEASUREMENT_CALIB_PATH = os.path.join(CALIB_DIR, "measurement_calibration.json")

# Below this many distinct subjects, a fitted bias is noise.
MIN_SUBJECTS_FOR_BIAS = 8
MIN_SUBJECTS_FOR_SHAPE = 12


def default_calibration() -> dict:
    return {
        "version": 1,
        "marker_side_cm": 16.0,   # matches make_marker.py's A4 default
        "shape_exponents": dict(DEFAULT_SHAPE_EXPONENTS),
        "bias_corrections": {},
        "fitted_at": None,
        "n_subjects": 0,
        "notes": "Defaults. bias_corrections stay empty until validation.py "
                 "fits them from a real ground-truth dataset.",
    }


def load_measurement_calibration(path: str = MEASUREMENT_CALIB_PATH) -> dict:
    if not os.path.exists(path):
        return default_calibration()
    try:
        with open(path) as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return default_calibration()
    base = default_calibration()
    base.update(data)
    merged = dict(DEFAULT_SHAPE_EXPONENTS)
    merged.update(data.get("shape_exponents") or {})
    base["shape_exponents"] = merged
    return base


def save_measurement_calibration(data: dict, path: str = MEASUREMENT_CALIB_PATH) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = dict(data)
    data["fitted_at"] = time.time()
    with open(path, "w") as fh:
        json.dump(data, fh, indent=2)
    return path
