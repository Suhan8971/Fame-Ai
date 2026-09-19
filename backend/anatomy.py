"""
anatomy.py
==========
NEW MODULE. Locates anatomical measurement levels on the silhouette and
extracts the widths/depths a tailor would take there.

AUDIT FINDING THIS MODULE ADDRESSES
-----------------------------------
The old code placed its measurement levels with two hardcoded fractions:

    CHEST_LEVEL_FRACTION = 0.35     # 35% of the way from shoulder to hip
    WAIST_LEVEL_FRACTION = 0.95     # 95% of the way -> basically the hips

Neither is an anatomical location. 0.95 of shoulder-to-hip lands on the
hip joint line, not the natural waist, which is why the old pipeline
reported a 60.9cm waist for an adult male on this repo's own capture -
a 24 inch waist. And because the "width" at those levels was the gap
between two interpolated *joint centres* (see body_segmentation.py's
audit note), moving the level barely changed the number anyway.

WHAT THIS MODULE PROVIDES
-------------------------
Levels found from the body itself, each with a stated definition:

  ACROMION / shoulder  Corner of the upper silhouette contour where the
                       near-horizontal shoulder slope breaks into the
                       near-vertical arm. Detected as the point of maximum
                       turning on the smoothed upper contour. This is the
                       tailor's across-shoulder endpoint. MediaPipe's
                       LEFT/RIGHT_SHOULDER are glenohumeral joint centres,
                       ~4-6cm inboard of it on each side, which is why the
                       old landmark span read 36.5cm where the acromion
                       span is ~45cm.
  AXILLA (armpit)      Row where the mask topology changes from one
                       foreground run (head/torso) to three (arm|torso|arm).
                       A real, observable landmark, not a fraction.
  CHEST                Fullest torso width in the band from the axilla down
                       to 40% of axilla->waist. Matches "around the fullest
                       part of the chest, under the arms".
  WAIST                Narrowest torso width between the chest level and the
                       hip landmark line - the standard "natural waist"
                       definition a tailor uses.
  HIP                  Widest width between the waist and the crotch.
  CROTCH               Row where the mask splits from one run into two legs.
  NECK BASE            Narrowest width between the chin and the shoulder line.
  INSEAM               Crotch row to floor contact row.

Every level is also stored as a STATURE-NORMALISED coordinate,
    t = (y - vertex_y) / (floor_y - vertex_y)
so the same anatomical level can be located in the side views, where the
width profile alone cannot identify a waist. That normalised coordinate is
the correspondence mechanism between the four views.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple

import numpy as np

from body_segmentation import Silhouette

# MediaPipe Pose landmark indices (kept identical to measurements.py so the
# two modules stay interchangeable).
NOSE = 0
LEFT_EAR, RIGHT_EAR = 7, 8
LEFT_SHOULDER, RIGHT_SHOULDER = 11, 12
LEFT_ELBOW, RIGHT_ELBOW = 13, 14
LEFT_WRIST, RIGHT_WRIST = 15, 16
LEFT_HIP, RIGHT_HIP = 23, 24
LEFT_KNEE, RIGHT_KNEE = 25, 26
LEFT_ANKLE, RIGHT_ANKLE = 27, 28
LEFT_HEEL, RIGHT_HEEL = 29, 30
LEFT_FOOT_INDEX, RIGHT_FOOT_INDEX = 31, 32


class AnatomyError(Exception):
    pass


@dataclass
class Level:
    """One anatomical measurement level in one view."""
    name: str
    y: float                       # image row
    t: float                       # stature-normalised position, 0=vertex 1=floor
    width_px: float                # silhouette extent at this level
    left_x: float = 0.0
    right_x: float = 0.0
    method: str = ""               # how the level was located
    confidence: float = 1.0

    def as_dict(self) -> dict:
        return {"name": self.name, "y": round(self.y, 1), "t": round(self.t, 4),
                "width_px": round(self.width_px, 2), "method": self.method,
                "confidence": round(self.confidence, 3)}


@dataclass
class ViewAnatomy:
    """All levels + key points found in a single view."""
    view: str
    levels: Dict[str, Level] = field(default_factory=dict)
    points: Dict[str, Tuple[float, float]] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    stature_px: float = 0.0
    vertex_y: float = 0.0
    floor_y: float = 0.0

    def t_to_y(self, t: float) -> float:
        return self.vertex_y + t * self.stature_px

    def y_to_t(self, y: float) -> float:
        return (y - self.vertex_y) / self.stature_px if self.stature_px else 0.0


# ---------------------------------------------------------------------------
# Topological landmarks: axilla and crotch
# ---------------------------------------------------------------------------

def find_axilla_y(sil: Silhouette, shoulder_y: float, hip_y: float) -> Tuple[Optional[float], str]:
    """First row below the shoulders where arm and torso separate.

    Scanning down, a person with arms slightly away from the body shows
    one foreground run across the shoulders and three (left arm | torso |
    right arm) once past the armpit. The transition row IS the axilla.
    If the arms never separate the caller is told, because then the chest
    and waist widths include the arms and are not measurable.
    """
    y0, y1 = int(shoulder_y), int(min(hip_y, sil.height - 1))
    for y in range(y0, y1):
        if len(sil.runs_at(float(y))) >= 3:
            return float(y), "run_split"
    return None, "arms_not_separated"


def find_crotch_y(sil: Silhouette, hip_y: float) -> Tuple[Optional[float], str]:
    """First row below the hips where the silhouette splits into two legs."""
    y0, y1 = int(hip_y), int(sil.bottom_y)
    for y in range(y0, y1):
        runs = sil.runs_at(float(y), min_run=4)
        if len(runs) >= 2:
            return float(y), "leg_split"
    return None, "legs_not_separated"


# ---------------------------------------------------------------------------
# Acromion detection on the upper contour
# ---------------------------------------------------------------------------

def find_acromia(sil: Silhouette, neck_y: float, axilla_y: float
                 ) -> Tuple[Optional[Tuple[float, float]], Optional[Tuple[float, float]], str]:
    """Locate the left/right acromion (the tailor's shoulder points).

    Between the neck and the armpit, the silhouette edge on each side runs
    outward and slightly down along the trapezius, then turns sharply
    downward at the shoulder tip. We take the edge trace x(y) on each side
    and pick the row of maximum curvature - i.e. where |d2x/dy2| peaks -
    which is that turn. This is derived from the person's own outline, so
    a broad-shouldered and a sloping-shouldered subject give different
    answers, unlike a fixed offset from the pose landmark.
    """
    y0, y1 = int(neck_y), int(axilla_y)
    if y1 - y0 < 8:
        return None, None, "span_too_short"

    ys, lefts, rights = [], [], []
    for y in range(y0, y1 + 1):
        e = sil.edges_at(float(y))
        if e is None:
            continue
        ys.append(y); lefts.append(e[0]); rights.append(e[1])
    if len(ys) < 8:
        return None, None, "insufficient_contour"

    ys = np.asarray(ys, float)
    k = max(3, (len(ys) // 8) | 1)          # odd smoothing window

    def smooth(arr: np.ndarray) -> np.ndarray:
        """Zero-phase moving average with EDGE-REPLICATED padding.

        numpy's mode='same' pads with zeros, which drags the smoothed trace
        toward 0 at both ends and plants a huge spurious second derivative
        just inside the trim margin - the corner detector would then lock
        onto the padding artefact instead of the shoulder.
        """
        pad = k // 2
        ext = np.concatenate([np.full(pad, arr[0]), arr, np.full(pad, arr[-1])])
        return np.convolve(ext, np.ones(k) / k, mode="valid")

    def corner(trace: List[float], outward_sign: int) -> Tuple[float, float]:
        """Row where the contour stops running outward and starts running down.

        `outward_sign` is +1 for the right-hand edge (x grows outward) and
        -1 for the left. Traced downward from the neck, the outer edge
        climbs along the trapezius and then flattens onto the arm: at the
        acromion the trace is CONCAVE toward the body, i.e.
        outward_sign * d2x/dy2 < 0. Requiring that sign is what separates
        the shoulder tip from the head-to-neck step above it, which is a
        convex minimum of the same magnitude and would otherwise win.
        """
        arr = np.asarray(trace, float)
        sm = smooth(arr)
        d2 = np.gradient(np.gradient(sm)) * outward_sign
        # Trim a full window at each end: replicate padding flattens the
        # curve there and leaves a curvature step at the boundary.
        trim = k
        if len(d2) > 2 * trim + 3:
            core, off = d2[trim:-trim], trim
        else:
            core, off = d2, 0
        i = int(np.argmin(core)) + off        # most concave point

        # Smoothing rounds the corner, so the concavity peak sits a little
        # ABOVE the true acromion, where the trapezius has not yet reached
        # full width. Measured on the synthetic subject that biases the
        # across-shoulder low by ~1.4cm (3%). Refine by fitting the two
        # straight segments either side of the corner and intersecting
        # them - the standard fix, and it removes the bias because the
        # intersection does not depend on the smoothing window.
        n = len(arr)
        up = (max(0, i - 2 * k), max(2, i - k // 2))
        dn = (min(n - 3, i + k // 2), min(n, i + 2 * k))
        if up[1] - up[0] >= 3 and dn[1] - dn[0] >= 3:
            try:
                a1, b1 = np.polyfit(ys[up[0]:up[1]], arr[up[0]:up[1]], 1)
                a2, b2 = np.polyfit(ys[dn[0]:dn[1]], arr[dn[0]:dn[1]], 1)
                if abs(a1 - a2) > 1e-6:
                    y_int = (b2 - b1) / (a1 - a2)
                    # Only accept an intersection inside the search span;
                    # near-parallel segments can project it far away.
                    if ys[0] <= y_int <= ys[-1]:
                        return float(a1 * y_int + b1), float(y_int)
            except (np.linalg.LinAlgError, ValueError):
                pass
        return float(sm[i]), float(ys[i])

    lx, ly = corner(lefts, -1)      # left edge: x decreases outward
    rx, ry = corner(rights, +1)     # right edge: x increases outward
    return (lx, ly), (rx, ry), "contour_curvature"


# ---------------------------------------------------------------------------
# Width-profile levels: chest, waist, hip, neck
# ---------------------------------------------------------------------------

def _smooth_profile(sil: Silhouette, y0: float, y1: float, win: int = 9
                    ) -> Tuple[np.ndarray, np.ndarray]:
    """Torso width profile, smoothed to suppress per-row segmentation noise
    without moving the extrema (odd, symmetric, zero-phase window)."""
    ys = np.arange(int(round(y0)), int(round(y1)) + 1, dtype=np.int32)
    if ys.size == 0:
        return ys.astype(float), np.zeros(0)
    ws = np.array([sil.width_at(float(y)) for y in ys], dtype=np.float64)
    if ws.size >= win:
        kern = np.ones(win) / win
        ws = np.convolve(ws, kern, mode="same")
        # convolve edges are biased low; trim them from consideration
        ws[:win // 2] = ws[win // 2]
        ws[-(win // 2):] = ws[-(win // 2) - 1]
    return ys.astype(float), ws


def _torso_width_profile(sil: Silhouette, y0: float, y1: float, win: int = 9):
    """Width profile of the TORSO ONLY.

    Below the axilla the outermost silhouette edges belong to the arms, so
    the plain full-width profile would measure arm-to-arm, not the torso.
    When three runs are present we take the middle run; otherwise we fall
    back to full width and the caller is warned.
    """
    ys = np.arange(int(round(y0)), int(round(y1)) + 1, dtype=np.int32)
    ws, edges, arms_merged = [], [], False
    for y in ys:
        runs = sil.runs_at(float(y))
        if len(runs) >= 3:
            runs = sorted(runs, key=lambda r: r[1] - r[0], reverse=True)
            s, e = sorted(runs[:3], key=lambda r: r[0])[1]
            ws.append(float(e - s))
            edges.append((float(s), float(e)))
        else:
            ws.append(sil.width_at(float(y)))
            ed = sil.edges_at(float(y))
            edges.append(ed if ed else (0.0, 0.0))
            arms_merged = True
    ws = np.asarray(ws, dtype=np.float64)
    if ws.size >= win:
        kern = np.ones(win) / win
        sm = np.convolve(ws, kern, mode="same")
        sm[:win // 2] = ws[:win // 2]
        sm[-(win // 2):] = ws[-(win // 2):]
        ws = sm
    return ys.astype(float), ws, edges, arms_merged


# ---------------------------------------------------------------------------
# Main entry points
# ---------------------------------------------------------------------------

def analyse_frontal_view(sil: Silhouette, landmarks, view: str = "front") -> ViewAnatomy:
    """Find every anatomical level in a front or back view.

    `landmarks` is a MediaPipe NormalizedLandmarkList; it is used only to
    bracket the search regions (roughly where the shoulders and hips are).
    The levels themselves come from the silhouette, so landmark jitter
    shifts a search window rather than the measurement.
    """
    h, w = sil.height, sil.width
    lm = landmarks.landmark
    ana = ViewAnatomy(view=view, vertex_y=sil.vertex_y, floor_y=sil.bottom_y,
                      stature_px=sil.stature_span_px)
    if ana.stature_px <= 0:
        raise AnatomyError("Degenerate silhouette (zero stature span).")

    sh_y = (lm[LEFT_SHOULDER].y + lm[RIGHT_SHOULDER].y) / 2 * h
    hip_y = (lm[LEFT_HIP].y + lm[RIGHT_HIP].y) / 2 * h
    nose_y = lm[NOSE].y * h

    # --- neck base ------------------------------------------------------
    # A collar is measured at the BASE of the neck, just above where it
    # flares into the shoulders - not at the neck's narrowest point, which
    # sits higher and can even land on the jaw. So we find the narrowest row
    # first (that is somewhere in the neck), then walk down to where the
    # width profile breaks upward into the trapezius, and take THAT row.
    # The break is located by intersecting the two straight segments either
    # side of it, the same construction find_acromia() uses, which makes it
    # independent of the smoothing window.
    neck_y = sh_y
    neck_lo = max(sil.vertex_y + 1, nose_y)
    if sh_y - neck_lo > 10:
        ys, ws = _smooth_profile(sil, neck_lo, sh_y, win=5)
        valid = ws > 0
        if valid.any():
            i_min = int(np.argmin(np.where(valid, ws, np.inf)))
            neck_y = float(ys[i_min])
            neck_w = float(ws[i_min])
            method = "min_width_chin_to_shoulder"

            # Flare break between the narrowest row and the shoulder line
            seg_y, seg_w = ys[i_min:], ws[i_min:]
            if seg_y.size >= 10:
                n = seg_y.size
                a_lo, a_hi = 0, max(3, n // 3)
                b_lo, b_hi = min(n - 3, (2 * n) // 3), n
                try:
                    m1, c1 = np.polyfit(seg_y[a_lo:a_hi], seg_w[a_lo:a_hi], 1)
                    m2, c2 = np.polyfit(seg_y[b_lo:b_hi], seg_w[b_lo:b_hi], 1)
                    if abs(m1 - m2) > 1e-9:
                        y_break = (c2 - c1) / (m1 - m2)
                        w_break = float(max(m1 * y_break + c1, neck_w))
                        # Guard: the neck base is modestly wider than the
                        # narrowest point of the neck, not dramatically so.
                        # If the fit lands far up the trapezius ramp (which
                        # happens when there is no straight neck section to
                        # anchor the upper segment) the break is meaningless
                        # and the narrowest row is the safer answer.
                        if (seg_y[0] <= y_break <= seg_y[-1]
                                and w_break <= 1.35 * neck_w):
                            neck_y = float(y_break)
                            neck_w = w_break
                            method = "neck_base_at_trapezius_flare"
                except (np.linalg.LinAlgError, ValueError):
                    pass

            e = sil.edges_at(neck_y)
            ana.levels["neck"] = Level(
                "neck", neck_y, ana.y_to_t(neck_y), neck_w,
                left_x=e[0] if e else 0.0, right_x=e[1] if e else 0.0,
                method=method)

    # --- axilla ---
    axilla_y, axilla_method = find_axilla_y(sil, sh_y, hip_y)
    if axilla_y is None:
        ana.warnings.append(
            "Your arms are touching your body, so your chest and waist "
            "outline cannot be separated from your arms. Stand with your "
            "arms 15-20cm away from your sides.")
        # Bracket search anyway so a low-confidence result is still possible
        axilla_y = sh_y + 0.35 * (hip_y - sh_y)
    _e = sil.edges_at(axilla_y)
    ana.levels["axilla"] = Level("axilla", axilla_y, ana.y_to_t(axilla_y),
                                 sil.width_at(axilla_y),
                                 left_x=_e[0] if _e else 0.0,
                                 right_x=_e[1] if _e else 0.0,
                                 method=axilla_method,
                                 confidence=1.0 if axilla_method == "run_split" else 0.4)

    # --- acromia / across shoulder ---
    la, ra, acr_method = find_acromia(sil, neck_y, axilla_y)
    if la and ra:
        ana.points["acromion_left"] = la
        ana.points["acromion_right"] = ra
        acr_y = (la[1] + ra[1]) / 2.0
        ana.levels["shoulder"] = Level(
            "shoulder", acr_y, ana.y_to_t(acr_y), abs(ra[0] - la[0]),
            left_x=min(la[0], ra[0]), right_x=max(la[0], ra[0]),
            method=acr_method)
    else:
        ana.warnings.append("Could not locate shoulder points on the outline.")
        ana.levels["shoulder"] = Level(
            "shoulder", sh_y, ana.y_to_t(sh_y), sil.width_at(sh_y),
            method="silhouette_at_shoulder_landmark", confidence=0.5)

    # --- crotch ---
    crotch_y, crotch_method = find_crotch_y(sil, hip_y)
    if crotch_y is not None:
        ana.levels["crotch"] = Level("crotch", crotch_y, ana.y_to_t(crotch_y),
                                     sil.width_at(crotch_y), method=crotch_method)

    # --- torso profile below the axilla ---
    torso_bottom = crotch_y if crotch_y else hip_y + 0.10 * ana.stature_px
    tys, tws, tedges, arms_merged = _torso_width_profile(sil, axilla_y, torso_bottom)
    if arms_merged:
        ana.warnings.append("Arms overlap the torso outline on part of the "
                            "torso; chest/waist width may include your arms.")
    if tys.size < 10:
        raise AnatomyError("Torso region too small to measure.")

    def band(lo_t, hi_t):
        return (tys >= ana.t_to_y(lo_t)) & (tys <= ana.t_to_y(hi_t))

    axilla_t, hip_t = ana.y_to_t(axilla_y), ana.y_to_t(hip_y)

    # CHEST: fullest torso width from the axilla down to 40% of the way to
    # the hip line. Restricting the band stops a wide hip from being
    # reported as the chest.
    chest_hi = axilla_t + 0.40 * (hip_t - axilla_t)
    m = (tys >= axilla_y) & (tys <= ana.t_to_y(chest_hi))
    if m.any():
        i = int(np.argmax(np.where(m, tws, -np.inf)))
        ana.levels["chest"] = Level("chest", float(tys[i]), ana.y_to_t(tys[i]),
                                    float(tws[i]),
                                    left_x=tedges[i][0], right_x=tedges[i][1],
                                    method="max_torso_width_below_axilla")

    # WAIST: narrowest torso width between the chest and the hip line -
    # the natural waist.
    chest_y = ana.levels["chest"].y if "chest" in ana.levels else axilla_y
    m = (tys > chest_y) & (tys <= hip_y)
    if m.any():
        i = int(np.argmin(np.where(m, tws, np.inf)))
        ana.levels["waist"] = Level("waist", float(tys[i]), ana.y_to_t(tys[i]),
                                    float(tws[i]),
                                    left_x=tedges[i][0], right_x=tedges[i][1],
                                    method="min_torso_width_chest_to_hip")
    else:
        ana.warnings.append("Waist region not resolvable.")

    # HIP: widest width between the waist and the crotch.
    waist_y = ana.levels["waist"].y if "waist" in ana.levels else hip_y
    hi = crotch_y if crotch_y else torso_bottom
    m = (tys > waist_y) & (tys <= hi)
    if m.any():
        i = int(np.argmax(np.where(m, tws, -np.inf)))
        ana.levels["hip"] = Level("hip", float(tys[i]), ana.y_to_t(tys[i]),
                                    float(tws[i]),
                                    left_x=tedges[i][0], right_x=tedges[i][1],
                                    method="max_torso_width_waist_to_crotch")

    # --- key points carried through for overlays and lengths ---
    for name, idx in (("shoulder_l", LEFT_SHOULDER), ("shoulder_r", RIGHT_SHOULDER),
                      ("elbow_l", LEFT_ELBOW), ("elbow_r", RIGHT_ELBOW),
                      ("wrist_l", LEFT_WRIST), ("wrist_r", RIGHT_WRIST),
                      ("hip_l", LEFT_HIP), ("hip_r", RIGHT_HIP),
                      ("ankle_l", LEFT_ANKLE), ("ankle_r", RIGHT_ANKLE)):
        ana.points[name] = (lm[idx].x * w, lm[idx].y * h)
    ana.points["vertex"] = ((sil.mask[int(sil.vertex_y)].nonzero()[0].mean()
                             if sil.mask[int(sil.vertex_y)].any() else w / 2),
                            sil.vertex_y)
    return ana


def analyse_profile_view(sil: Silhouette, landmarks, side: str,
                         level_ts: Dict[str, float]) -> ViewAnatomy:
    """Measure body DEPTH at levels transferred from the frontal view.

    A side view cannot find a waist on its own - the antero-posterior
    depth profile has no reliable minimum there (the abdomen often makes
    it a maximum). So the levels are handed in as stature-normalised
    coordinates `t` found in the front view and converted into this
    view's own pixel rows using this view's own vertex/floor. That makes
    the correspondence scale- and framing-independent: the subject may be
    a little nearer or further in the side shot and the same anatomical
    level is still hit.

    This is the depth information the old pipeline never collected - the
    side views produced only a sleeve length, so circumference had nothing
    to work with and fell back on multiplying the shoulder width by a
    constant.
    """
    h, w = sil.height, sil.width
    lm = landmarks.landmark
    ana = ViewAnatomy(view=side, vertex_y=sil.vertex_y, floor_y=sil.bottom_y,
                      stature_px=sil.stature_span_px)
    if ana.stature_px <= 0:
        raise AnatomyError("Degenerate silhouette (zero stature span).")

    for name, t in level_ts.items():
        y = ana.t_to_y(t)
        if y < sil.vertex_y or y > sil.bottom_y:
            continue
        runs = sil.runs_at(y)
        if not runs:
            continue
        # In profile the arm hangs in front of or behind the torso. The
        # torso is the widest run at this row; taking the widest run rather
        # than the full extent stops a swinging arm from being counted as
        # body depth.
        s, e = max(runs, key=lambda r: r[1] - r[0])
        depth = float(e - s)
        full = sil.width_at(y)
        ana.levels[name] = Level(
            name, y, t, depth, left_x=float(s), right_x=float(e),
            method="widest_run_at_transferred_level",
            confidence=1.0 if len(runs) == 1 or depth / max(full, 1) > 0.6 else 0.7)

    sh_idx = LEFT_SHOULDER if side == "left" else RIGHT_SHOULDER
    el_idx = LEFT_ELBOW if side == "left" else RIGHT_ELBOW
    wr_idx = LEFT_WRIST if side == "left" else RIGHT_WRIST
    ana.points["shoulder"] = (lm[sh_idx].x * w, lm[sh_idx].y * h)
    ana.points["elbow"] = (lm[el_idx].x * w, lm[el_idx].y * h)
    ana.points["wrist"] = (lm[wr_idx].x * w, lm[wr_idx].y * h)
    return ana
