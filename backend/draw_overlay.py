"""
draw_overlay.py
----------------
NEW ADDITION. Draws the measurement guide lines (Across Shoulder, Collar,
Chest, Waist, Sleeve Length, Length) on the captured photo, similar in
spirit to the reference measurement-guide diagram.
"""

import cv2


LINE_COLOR = (0, 200, 255)     # orange-yellow (BGR)
TEXT_COLOR = (255, 255, 255)
LINE_THICKNESS = 2
FONT = cv2.FONT_HERSHEY_SIMPLEX


def _line(img, p1, p2, label=None, offset=(10, -10)):
    p1 = tuple(map(int, p1))
    p2 = tuple(map(int, p2))
    cv2.line(img, p1, p2, LINE_COLOR, LINE_THICKNESS)
    cv2.circle(img, p1, 4, LINE_COLOR, -1)
    cv2.circle(img, p2, 4, LINE_COLOR, -1)
    if label:
        mid = ((p1[0] + p2[0]) // 2 + offset[0], (p1[1] + p2[1]) // 2 + offset[1])
        cv2.putText(img, label, mid, FONT, 0.6, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(img, label, mid, FONT, 0.6, TEXT_COLOR, 1, cv2.LINE_AA)


def draw_measurement_overlay(frame, draw_points, results):
    """
    frame: BGR image (the captured still photo)
    draw_points: dict of pixel coordinates from measurements.compute_measurements
    results: dict of computed cm/in values from measurements.compute_measurements
    """
    img = frame.copy()

    p = draw_points

    # Across Shoulder
    _line(img, p["left_shoulder"], p["right_shoulder"],
          f"Shoulder: {results['across_shoulder']['cm']}cm")

    # Chest
    _line(img, p["chest_left"], p["chest_right"],
          f"Chest: {results['chest']['cm']}cm")

    # Waist
    _line(img, p["waist_left"], p["waist_right"],
          f"Waist: {results['waist']['cm']}cm")

    # Length (shoulder midpoint down to hip midpoint)
    _line(img, p["shoulder_mid"], p["hip_mid"],
          f"Length: {results['length']['cm']}cm", offset=(10, 0))

    # Sleeve (right arm: shoulder -> elbow -> wrist)
    _line(img, p["right_shoulder"], p["right_elbow"])
    _line(img, p["right_elbow"], p["right_wrist"],
          f"Sleeve: {results['sleeve_length']['cm']}cm")

    # Collar label near the shoulder midpoint, slightly above
    collar_pt = (int(p["shoulder_mid"][0]), int(p["shoulder_mid"][1]) - 30)
    cv2.putText(img, f"Collar: {results['collar']['cm']}cm", collar_pt,
                FONT, 0.6, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(img, f"Collar: {results['collar']['cm']}cm", collar_pt,
                FONT, 0.6, TEXT_COLOR, 1, cv2.LINE_AA)

    return img


# ---------------------------------------------------------------------------
# NEW: overlays for Left / Right / Back views (front view overlay above is
# unchanged)
# ---------------------------------------------------------------------------

def draw_sleeve_overlay(frame, draw_points, label, value_cm):
    """Draws shoulder -> elbow -> wrist with a sleeve-length label. Used for
    both the Left and Right view captures."""
    img = frame.copy()
    p = draw_points
    _line(img, p["shoulder"], p["elbow"])
    _line(img, p["elbow"], p["wrist"], f"{label}: {value_cm}cm")
    return img


def draw_back_shoulder_overlay(frame, draw_points, value_cm):
    """Draws the shoulder-to-shoulder line for the Back view capture."""
    img = frame.copy()
    p = draw_points
    _line(img, p["left_shoulder"], p["right_shoulder"], f"Back Shoulder: {value_cm}cm")
    return img


# ---------------------------------------------------------------------------
# NEW: overlay driven by the corrected pipeline's anatomical levels
# ---------------------------------------------------------------------------
# The three functions above draw whatever pixel points they are handed and
# are unchanged. What changed is WHAT gets handed to them: the old front
# overlay drew a "chest" line between two points interpolated along the
# shoulder-to-hip joint axis, so the guide line the user saw was not on the
# body outline and did not correspond to the number printed next to it.
# draw_view_overlay() draws the actual detected levels on the actual
# silhouette edges, so the picture and the number agree.

LEVEL_COLORS = {
    "neck":     (255, 200, 0),
    "shoulder": (0, 255, 255),
    "axilla":   (150, 150, 150),
    "chest":    (0, 200, 255),
    "waist":    (0, 255, 120),
    "hip":      (255, 120, 200),
    "crotch":   (200, 200, 200),
}


def _level_line(img, y, x_left, x_right, label, color):
    y, x_left, x_right = int(round(y)), int(round(x_left)), int(round(x_right))
    cv2.line(img, (x_left, y), (x_right, y), color, LINE_THICKNESS)
    for x in (x_left, x_right):
        cv2.line(img, (x, y - 7), (x, y + 7), color, LINE_THICKNESS)
    if label:
        pos = (x_right + 12, y + 5)
        cv2.putText(img, label, pos, FONT, 0.55, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(img, label, pos, FONT, 0.55, color, 1, cv2.LINE_AA)


def draw_view_overlay(frame, view, draw_points, results):
    """Annotate a capture with the levels that were actually measured.

    Works for all four views. For front/back the horizontal spans are body
    WIDTHS; for left/right the same spans are body DEPTHS - the quantity the
    old pipeline never captured and without which no circumference is
    possible. Labelling them differently per view matters, because a 22cm
    line on a side view means something completely different from a 33cm
    line on the front.
    """
    img = frame.copy()
    levels = (draw_points or {}).get("levels") or {}
    sil = (draw_points or {}).get("silhouette")

    if sil is not None:
        contours, _ = cv2.findContours(sil.mask.astype("uint8"), cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            cv2.drawContours(img, [max(contours, key=cv2.contourArea)], -1,
                             (60, 220, 60), 1)

    scale = (results or {}).get("scale") or {}
    cm_per_px = scale.get("cm_per_px")
    is_profile = view in ("left", "right")
    kind = "d" if is_profile else "w"

    for name, (y, lx, rx, width_px) in levels.items():
        if name in ("axilla", "crotch") or width_px <= 0:
            continue
        if lx == rx == 0.0 and sil is not None:
            e = sil.edges_at(y)
            if e is None:
                continue
            lx, rx = e
        label = name.capitalize()
        if cm_per_px:
            label += f" {kind}: {width_px * cm_per_px:.1f}cm"
        _level_line(img, y, lx, rx, label, LEVEL_COLORS.get(name, LINE_COLOR))

    # Stature reference: the head vertex and the floor contact the scale is
    # actually measured between. Drawing it makes a bad capture obvious.
    floor_y = (draw_points or {}).get("floor_y")
    if sil is not None and floor_y:
        for y, tag in ((sil.vertex_y, "head vertex"), (floor_y, "floor")):
            cv2.line(img, (20, int(y)), (img.shape[1] - 20, int(y)), (80, 80, 255), 1)
            cv2.putText(img, tag, (24, int(y) - 6), FONT, 0.5, (80, 80, 255), 1, cv2.LINE_AA)

    if is_profile:
        p = draw_points or {}
        if all(p.get(k) for k in ("shoulder", "elbow", "wrist")):
            key = f"{view}_sleeve_length"
            val = (results or {}).get(key, {}).get("cm")
            _line(img, p["shoulder"], p["elbow"])
            _line(img, p["elbow"], p["wrist"],
                  f"{view.capitalize()} sleeve: {val}cm" if val else None)

    conf = (results or {}).get("confidence")
    header = f"{view.upper()}  scale={scale.get('method', '?')}"
    if conf is not None:
        header += f"  view confidence {conf*100:.0f}%"
    cv2.putText(img, header, (20, 34), FONT, 0.7, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(img, header, (20, 34), FONT, 0.7, (255, 255, 255), 1, cv2.LINE_AA)
    return img
