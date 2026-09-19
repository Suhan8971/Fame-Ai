"""
measurement_confidence.py
=========================
NEW MODULE. Per-measurement confidence and the final release gate.

AUDIT FINDING THIS MODULE ADDRESSES
-----------------------------------
The old pipeline reported every number to one decimal place with no
qualification whatsoever - "Waist: 60.9 cm" was presented exactly like a
good measurement even though it came from a cropped-feet calibration, a
joint-interpolated width and a fixed multiplier. The only quality signal
anywhere was a boolean "Consistent / Recheck" tag on two cross-checks,
computed against a 15% threshold: a 14.9% disagreement between two photos
of the same shoulder read as "Consistent".

WHAT THIS MODULE PROVIDES
-------------------------
A confidence in [0,1] per measurement, built from the factors the user
listed, each of which is an actual measured quantity in this pipeline:

    calibration quality  camera profile present, matching resolution, RMS
    scale quality        method (marker > stature) and its uncertainty
    pose quality         from capture_validation, continuous
    segmentation quality edge sharpness x model agreement
    clothing             looseness multiplier
    view consistency     scale agreement across the four views
    cross-view agreement front/back width, left/right depth
    landmark confidence  minimum visibility over the required landmarks

and a release gate that refuses to publish a measurement set that is not
good enough, naming what to fix.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

import numpy as np

# Release thresholds. A measurement below MIN_RELEASE_CONFIDENCE is
# reported as "needs recapture" rather than as a number.
MIN_RELEASE_CONFIDENCE = 0.60
MIN_CORE_CONFIDENCE = 0.65          # for chest/waist/shoulder specifically
CORE_MEASUREMENTS = ("across_shoulder", "chest", "waist", "hip")


@dataclass
class ConfidenceFactors:
    calibration: float = 0.6
    scale: float = 0.7
    pose: float = 0.8
    segmentation: float = 0.8
    clothing: float = 1.0
    view_consistency: float = 1.0
    landmarks: float = 0.9

    def combined(self) -> float:
        """Geometric mean of the independent factors, times the clothing
        multiplier.

        Geometric rather than arithmetic: these are multiplicative
        reliability terms, and one bad factor SHOULD drag the result down
        instead of being averaged away by six good ones. A capture with
        perfect pose but an unusable outline is not 85% trustworthy.
        """
        vals = np.array([self.calibration, self.scale, self.pose,
                         self.segmentation, self.view_consistency,
                         self.landmarks], dtype=float)
        vals = np.clip(vals, 0.01, 1.0)
        return float(np.clip(np.exp(np.mean(np.log(vals))) * self.clothing, 0.0, 1.0))

    def as_dict(self) -> dict:
        return {k: round(float(v), 3) for k, v in self.__dict__.items()}


def calibration_factor(profile, warnings: List[str]) -> float:
    """How much the camera calibration can be trusted."""
    if profile is None:
        # Uncalibrated is not fatal - the marker-based scale still works -
        # but lens distortion is unremoved and no distance check is
        # possible, so cap the ceiling.
        return 0.55
    f = 1.0
    rms = getattr(profile, "rms_reproj_error", float("nan"))
    if rms == rms:                     # not NaN
        f *= float(np.clip(1.15 - rms * 0.45, 0.4, 1.0))
    if getattr(profile, "n_views", 0) < 10:
        f *= 0.9
    for w in warnings:
        if "aspect" in w.lower():
            f *= 0.75
    return float(np.clip(f, 0.2, 1.0))


def scale_factor(scale_estimate) -> float:
    base = {"aruco": 1.00, "chessboard": 0.97, "stature": 0.78}.get(
        scale_estimate.method, 0.6)
    unc = float(np.clip(1.0 - scale_estimate.relative_uncertainty * 12.0, 0.3, 1.0))
    return float(np.clip(base * unc * scale_estimate.confidence ** 0.5, 0.1, 1.0))


def segmentation_factor(sil) -> float:
    return float(np.clip(sil.edge_sharpness ** 0.5 * sil.model_agreement ** 0.5, 0.1, 1.0))


@dataclass
class ReleaseDecision:
    release: bool
    reasons: List[str] = field(default_factory=list)
    per_measurement: Dict[str, float] = field(default_factory=dict)
    overall: float = 0.0
    recapture_views: List[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"release": self.release, "overall_confidence": round(self.overall, 3),
                "overall_confidence_pct": int(round(self.overall * 100)),
                "reasons": list(self.reasons),
                "recapture_views": list(self.recapture_views),
                "per_measurement": {k: round(v, 3) for k, v in self.per_measurement.items()}}


def decide_release(body_model, per_view_factors: Dict[str, ConfidenceFactors]
                   ) -> ReleaseDecision:
    """The final gate: publish these measurements, or ask for a recapture?

    Deliberately conservative. The brief for this system is accuracy and
    repeatability over always producing an answer, so a marginal capture
    returns instructions rather than a plausible-looking number.
    """
    dec = ReleaseDecision(release=True)
    ms = body_model.measurements
    if not ms:
        return ReleaseDecision(False, ["No measurements could be computed."], {}, 0.0,
                               list(per_view_factors.keys()))

    for name, m in ms.items():
        dec.per_measurement[name] = m.confidence
    core = [ms[n].confidence for n in CORE_MEASUREMENTS if n in ms]
    dec.overall = float(np.min(core)) if core else float(np.mean(list(dec.per_measurement.values())))

    missing = [n for n in CORE_MEASUREMENTS if n not in ms]
    if missing:
        dec.release = False
        dec.reasons.append(f"Could not measure: {', '.join(missing)}.")

    for n in CORE_MEASUREMENTS:
        if n in ms and ms[n].confidence < MIN_CORE_CONFIDENCE:
            dec.release = False
            dec.reasons.append(
                f"{n.replace('_', ' ').title()} confidence is "
                f"{ms[n].confidence*100:.0f}% (need "
                f"{MIN_CORE_CONFIDENCE*100:.0f}%).")

    if body_model.scale_consistency < 0.6:
        dec.release = False
        dec.reasons.append(
            "The four photos disagree about your size - you were not standing "
            "in the same place each time.")

    for view, f in per_view_factors.items():
        if f.combined() < MIN_RELEASE_CONFIDENCE:
            dec.recapture_views.append(view)
    if dec.recapture_views and not dec.release:
        dec.reasons.append("Retake: " + ", ".join(dec.recapture_views) + ".")

    for w in body_model.warnings:
        if w not in dec.reasons:
            dec.reasons.append(w)
    return dec
