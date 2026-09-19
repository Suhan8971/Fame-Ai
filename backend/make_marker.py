"""
make_marker.py
==============
NEW. Generates the printable ArUco scale reference.

WHY THIS EXISTS
---------------
The pixel-to-centimetre scale is the single largest source of error in this
system, and without a physical reference it can only come from the
subject's self-reported height. That number is rounded, misremembered and
measured in shoes; a 2cm error on a 175cm subject biases EVERY measurement
by 1.1%, and nothing inside a capture session can detect it because all
four views share it.

A printed marker of known size, standing at the subject's own spot, removes
that dependency entirely: the scale becomes an observation instead of an
input.

    python make_marker.py                    # 20cm marker, A4 sheet
    python make_marker.py --side-cm 25       # bigger marker

PRINTING AND PLACEMENT - both matter more than people expect
------------------------------------------------------------
  * Print at 100% / "actual size". "Fit to page" silently rescales by a few
    percent and that error goes straight into every measurement.
  * MEASURE the printed black square with a ruler and pass the real number
    to the app (calibration/measurement_calibration.json -> marker_side_cm)
    if it differs from the nominal size.
  * Mount it FLAT and facing the camera. A tilted marker is foreshortened
    and reads small; the detector reports side-length spread and warns, but
    flat is better than warned.
  * Stand it at the SUBJECT'S OWN STANDING SPOT, at the same depth from the
    camera - not on the floor in front, not on the wall behind. Scale
    depends on depth as scale = Z/f, so a marker 40cm closer than the
    subject at 250cm makes every measurement 16% too small.
"""

from __future__ import annotations

import argparse

import cv2
import numpy as np

DPI = 300
A4_W_MM, A4_H_MM = 210.0, 297.0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--side-cm", type=float, default=16.0,
                    help="printed side length of the black marker square (cm)")
    ap.add_argument("--marker-id", type=int, default=0)
    ap.add_argument("--dict", default="DICT_5X5_100")
    ap.add_argument("--out", default="calibration/scale_marker.png")
    args = ap.parse_args()

    px_per_mm = DPI / 25.4
    page = np.full((int(A4_H_MM * px_per_mm), int(A4_W_MM * px_per_mm)), 255, np.uint8)
    side_px = int(round(args.side_cm * 10 * px_per_mm))
    if side_px > page.shape[1] - int(30 * px_per_mm):
        raise SystemExit(f"{args.side_cm}cm does not fit on A4 with the quiet "
                         f"zone ArUco detection needs. Use --side-cm 16 or "
                         f"smaller, or print on A3.")

    tag = cv2.aruco.generateImageMarker(
        cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, args.dict)),
        args.marker_id, side_px)
    x0 = (page.shape[1] - side_px) // 2
    y0 = int(40 * px_per_mm)
    page[y0:y0 + side_px, x0:x0 + side_px] = tag

    ty = y0 + side_px + int(14 * px_per_mm)
    for line in (
        f"SCALE REFERENCE - {args.dict} id {args.marker_id}",
        f"Black square side = {args.side_cm:.1f} cm  (PRINT AT 100%, NOT 'fit to page')",
        "Measure the printed square with a ruler and use the real value.",
        "Stand this flat, facing the camera, at YOUR standing spot -",
        "same distance from the camera as you, not in front or behind.",
    ):
        cv2.putText(page, line, (x0 - int(8 * px_per_mm), ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, 0, 2, cv2.LINE_AA)
        ty += int(9 * px_per_mm)

    # A ruler strip so the print scale can be verified without a tape.
    ry = ty + int(12 * px_per_mm)
    for i in range(0, 101, 10):
        x = x0 + int(i * px_per_mm)
        cv2.line(page, (x, ry), (x, ry + int((7 if i % 50 else 12) * px_per_mm)), 0, 3)
    cv2.line(page, (x0, ry), (x0 + int(100 * px_per_mm), ry), 0, 3)
    cv2.putText(page, "10 cm check strip", (x0, ry + int(20 * px_per_mm)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, 0, 2, cv2.LINE_AA)

    import os
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cv2.imwrite(args.out, page)
    print(f"Wrote {args.out}  ({args.side_cm}cm marker, {DPI} dpi A4)")
    print("Print at 100% scale, then verify the check strip really measures 10cm.")


if __name__ == "__main__":
    main()
