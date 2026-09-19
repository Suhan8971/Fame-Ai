"""
Shirt Outline Detector
-----------------------
Detects a person in front of the webcam using MediaPipe Pose, works out the
torso/shirt region from the shoulder & hip landmarks, segments the shirt out
of that region using GrabCut, and draws a live outline around it.

Install dependencies first:
    pip install opencv-python mediapipe numpy

Run:
    python shirt_outline_detector.py

Press 'q' to quit.
"""

import cv2
import mediapipe as mp
import numpy as np

mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils


def get_torso_box(landmarks, frame_w, frame_h, pad=0.15):
    """
    Use shoulder + hip landmarks to compute a bounding box around the torso
    (i.e. where the shirt is). Returns (x1, y1, x2, y2) in pixel coords, or
    None if the required landmarks aren't visible.
    """
    lm = landmarks.landmark
    needed = [
        mp_pose.PoseLandmark.LEFT_SHOULDER,
        mp_pose.PoseLandmark.RIGHT_SHOULDER,
        mp_pose.PoseLandmark.LEFT_HIP,
        mp_pose.PoseLandmark.RIGHT_HIP,
    ]

    # Basic visibility check
    if any(lm[p].visibility < 0.4 for p in needed):
        return None

    xs = [lm[p].x for p in needed]
    ys = [lm[p].y for p in needed]

    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)

    # pad the box a bit so we don't clip the shirt edges
    w = x2 - x1
    h = y2 - y1
    x1 -= w * pad
    x2 += w * pad
    y1 -= h * 0.1          # a little padding above shoulders (collar)
    y2 += h * 0.35          # extend down to cover more of the torso/shirt

    # convert to pixel coords and clamp to frame
    x1 = int(max(0, x1 * frame_w))
    x2 = int(min(frame_w - 1, x2 * frame_w))
    y1 = int(max(0, y1 * frame_h))
    y2 = int(min(frame_h - 1, y2 * frame_h))

    if x2 <= x1 or y2 <= y1:
        return None

    return x1, y1, x2, y2


def segment_shirt_grabcut(frame, box, iterations=3):
    """
    Run GrabCut inside the torso bounding box to separate the shirt
    (foreground) from skin/background. Returns a binary mask (uint8, 0/255)
    the same size as the frame.
    """
    x1, y1, x2, y2 = box
    mask = np.zeros(frame.shape[:2], np.uint8)

    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    rect = (x1, y1, x2 - x1, y2 - y1)

    try:
        cv2.grabCut(frame, mask, rect, bgd_model, fgd_model, iterations, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None

    # Treat probable+definite foreground as the shirt
    binary_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype("uint8")

    # Clean up noise
    kernel = np.ones((5, 5), np.uint8)
    binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_OPEN, kernel)
    binary_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_CLOSE, kernel)

    return binary_mask


def draw_shirt_outline(frame, mask, color=(0, 255, 0), thickness=2):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return frame

    # Keep only the largest contour (the shirt), ignore small noise blobs
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < 500:
        return frame

    cv2.drawContours(frame, [largest], -1, color, thickness)
    return frame


def main():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Could not open webcam.")
        return

    frame_count = 0
    cached_mask = None
    RECOMPUTE_EVERY = 5  # GrabCut is slow; only run it every N frames

    with mp_pose.Pose(
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)  # mirror for a natural webcam feel
            h, w = frame.shape[:2]

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(rgb)

            if results.pose_landmarks:
                box = get_torso_box(results.pose_landmarks, w, h)

                if box is not None:
                    x1, y1, x2, y2 = box
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 0, 0), 1)

                    if frame_count % RECOMPUTE_EVERY == 0:
                        cached_mask = segment_shirt_grabcut(frame, box)

                    if cached_mask is not None:
                        frame = draw_shirt_outline(frame, cached_mask)

                mp_drawing.draw_landmarks(
                    frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS
                )
            else:
                cached_mask = None

            frame_count += 1

            cv2.imshow("Shirt Outline Detector - press q to quit", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
