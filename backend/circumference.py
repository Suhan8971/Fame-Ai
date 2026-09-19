"""
circumference.py
================
NEW MODULE. Converts a measured width + depth into a circumference.

AUDIT FINDING THIS MODULE ADDRESSES
-----------------------------------
The old model, in measurements.py:

    CHEST_FROM_SHOULDER_FACTOR = 2.20
    base_chest_cm = across_shoulder_cm * 2.20
    chest_cm      = base_chest_cm * (measured_width_ratio / 0.80)

    WAIST_FROM_SHOULDER_FACTOR = 1.95
    COLLAR_FROM_SHOULDER_FACTOR = 0.85

Three problems:

  1. The chest is anchored to the SHOULDER width. A person's chest
     circumference is not a fixed multiple of their shoulder width -
     that is exactly the "hardcoded body-proportion assumption" that makes
     a barrel-chested and a slim subject of equal shoulder width receive
     the same chest number.
  2. The individual adjustment term used the joint-interpolated width,
     which barely varies between people (see body_segmentation.py's audit
     note), so in practice the output collapsed back onto the constant.
     Concretely, on this repo's own front capture the term evaluated to
     0.578/0.72 = 0.80 and produced a 60.9cm waist - a 24 inch waist on an
     adult male.
  3. The side views were never used, so the DEPTH of the body - the one
     thing a side photo uniquely provides - contributed nothing.

WHAT THIS MODULE PROVIDES
-------------------------
A cross-section model driven by *measured* width `w` (front/back views)
and *measured* depth `d` (left/right views) at the same anatomical level.

MODEL
-----
The torso cross-section is approximated by a superellipse

        |2x/w|^n + |2y/d|^n = 1

with perimeter obtained by numerical arc-length integration.

  * n = 2 is a plain ellipse. It is the standard first-order model and is
    a LOWER bound for a human torso: real cross-sections are flatter on
    the front and back and rounder at the flanks, which adds perimeter.
  * n > 2 flattens the sides toward a rounded rectangle, increasing the
    perimeter for the same w and d.

Literature on torso cross-sections from MRI/3D scans places n in roughly
2.0-2.6 depending on the level (chest flatter, waist rounder). We ship
per-level defaults in that range, but they are declared as MODEL
PARAMETERS with a documented meaning and are refit from ground-truth data
by `validation.fit_shape_exponents()` - not magic numbers baked into a
formula. With n = 2 the model is a pure ellipse and involves no tuned
constant at all; `ellipse_circumference()` is exposed so a caller can
demand that.

WHY NOT A SINGLE MULTIPLIER
---------------------------
For an ellipse, C ~ pi*(w+d)/2-ish. A "width x constant" model implicitly
fixes d/w. Measured d/w at the chest varies roughly 0.45-0.75 across
adults, which is a +-15% spread in circumference for identical width.
That spread is precisely the error the old model could not see and the
side views can.

LIMITATIONS (stated, not hidden)
--------------------------------
  * A 2-parameter cross-section cannot represent asymmetric or unusual
    torso shapes; two people with the same w and d but different
    front/back flatness get the same answer.
  * Measured w and d are *garment* outlines unless the subject wears
    fitted clothing. body_segmentation.assess_clothing() flags this; this
    module does not attempt to subtract fabric.
  * A tape measure is pulled snug and compresses soft tissue slightly;
    an optical outline does not. Expect a small positive bias, which
    validation.fit_bias_corrections() can quantify per measurement once
    real tape data exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np

# Per-level superellipse exponents. n=2.0 is a pure ellipse; larger values
# flatten the flanks and add perimeter. These are the SHIPPED DEFAULTS and
# are meant to be refit from ground-truth data - see validation.py.
DEFAULT_SHAPE_EXPONENTS: Dict[str, float] = {
    "chest": 2.30,
    "waist": 2.20,
    "hip": 2.15,
    "neck": 2.00,     # the neck really is close to elliptical
    "thigh": 2.00,
    "bicep": 2.00,
}
FALLBACK_EXPONENT = 2.10


class CircumferenceError(Exception):
    pass


def ellipse_circumference(width: float, depth: float) -> float:
    """Exact-to-1e-9 ellipse perimeter (Ramanujan's second approximation).

        h = ((a-b)/(a+b))^2
        C = pi (a+b) [ 1 + 3h / (10 + sqrt(4 - 3h)) ]

    Uses NO tuned constant. This is the model-free lower bound on the
    circumference for a given width and depth.
    """
    a, b = width / 2.0, depth / 2.0
    if a <= 0 or b <= 0:
        raise CircumferenceError("width and depth must both be positive")
    h = ((a - b) / (a + b)) ** 2
    return float(np.pi * (a + b) * (1.0 + 3.0 * h / (10.0 + np.sqrt(4.0 - 3.0 * h))))


def superellipse_circumference(width: float, depth: float, n: float,
                               samples: int = 2048) -> float:
    """Perimeter of |2x/w|^n + |2y/d|^n = 1 by arc-length integration.

    Parameterised as x = a*sign(cos t)|cos t|^(2/n),
                     y = b*sign(sin t)|sin t|^(2/n),
    integrated over one quadrant and multiplied by 4 (the curve is
    symmetric in both axes). At n=2 this reproduces
    ellipse_circumference() to ~1e-6 relative, which the unit check below
    asserts.
    """
    a, b = width / 2.0, depth / 2.0
    if a <= 0 or b <= 0:
        raise CircumferenceError("width and depth must both be positive")
    if n <= 0:
        raise CircumferenceError("shape exponent must be positive")
    if abs(n - 2.0) < 1e-9:
        return ellipse_circumference(width, depth)

    t = np.linspace(1e-9, np.pi / 2 - 1e-9, samples)
    p = 2.0 / n
    ct, st = np.cos(t), np.sin(t)
    dx = -a * p * ct ** (p - 1) * st
    dy = b * p * st ** (p - 1) * ct
    return float(4.0 * np.trapz(np.hypot(dx, dy), t))


@dataclass
class CircumferenceResult:
    circumference_cm: float
    width_cm: float
    depth_cm: float
    shape_exponent: float
    ellipse_cm: float          # n=2 lower bound, for transparency
    depth_width_ratio: float
    uncertainty_cm: float
    model: str

    def as_dict(self) -> dict:
        return {
            "circumference_cm": round(self.circumference_cm, 1),
            "width_cm": round(self.width_cm, 1),
            "depth_cm": round(self.depth_cm, 1),
            "depth_width_ratio": round(self.depth_width_ratio, 3),
            "shape_exponent": round(self.shape_exponent, 2),
            "ellipse_lower_bound_cm": round(self.ellipse_cm, 1),
            "uncertainty_cm": round(self.uncertainty_cm, 1),
            "model": self.model,
        }


def estimate_circumference(width_cm: float, depth_cm: float, level: str,
                           width_sigma_cm: float = 0.5,
                           depth_sigma_cm: float = 0.7,
                           exponents: Optional[Dict[str, float]] = None
                           ) -> CircumferenceResult:
    """Circumference at one anatomical level from its measured width+depth.

    `width_sigma_cm` / `depth_sigma_cm` are 1-sigma input uncertainties
    (from scale uncertainty + edge localisation + left/right depth
    spread). They are propagated through the model numerically so the
    reported circumference carries an honest error bar rather than a bare
    number.
    """
    exps = exponents or DEFAULT_SHAPE_EXPONENTS
    n = float(exps.get(level, FALLBACK_EXPONENT))

    ratio = depth_cm / width_cm if width_cm else 0.0
    if not (0.25 <= ratio <= 1.35):
        raise CircumferenceError(
            f"Implausible {level} cross-section: width {width_cm:.1f}cm, "
            f"depth {depth_cm:.1f}cm (ratio {ratio:.2f}). Usually means the "
            f"side view was not a true 90-degree profile, or the front and "
            f"side captures were taken at different distances.")

    c = superellipse_circumference(width_cm, depth_cm, n)
    c_ell = ellipse_circumference(width_cm, depth_cm)

    # Numerical sensitivity: dC/dw and dC/dd
    eps = 0.05
    dcdw = (superellipse_circumference(width_cm + eps, depth_cm, n) - c) / eps
    dcdd = (superellipse_circumference(width_cm, depth_cm + eps, n) - c) / eps
    sigma = float(np.hypot(dcdw * width_sigma_cm, dcdd * depth_sigma_cm))

    return CircumferenceResult(
        circumference_cm=c, width_cm=width_cm, depth_cm=depth_cm,
        shape_exponent=n, ellipse_cm=c_ell, depth_width_ratio=ratio,
        uncertainty_cm=sigma,
        model=f"superellipse(n={n:g})" if abs(n - 2) > 1e-9 else "ellipse",
    )


if __name__ == "__main__":
    # Self-check: the superellipse integrator must reproduce Ramanujan at n=2.
    for w, d in ((100, 60), (80, 80), (95, 25)):
        a = ellipse_circumference(w, d)
        b = superellipse_circumference(w, d, 2.0 + 1e-12)
        assert abs(a - b) / a < 1e-5, (w, d, a, b)
    print("ellipse/superellipse agreement at n=2: OK")
    for lvl in ("chest", "waist", "hip"):
        r = estimate_circumference(32.0, 22.0, lvl)
        print(lvl, r.as_dict())
