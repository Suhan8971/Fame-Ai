"""
virtual_tryon.py
----------------
Modular Virtual Shirt Try-On Engine.
Takes a front-view photo of a person (BGR numpy array) and a shirt image
(bytes, file path, PIL image, or RGBA/BGRA numpy array), aligns the shirt
to the person's body pose (shoulders, chest, torso, waist) detected via
MediaPipe Pose, and overlays the shirt onto the person's body realistically.

Does NOT modify or rely on any existing measurement modules.
"""

import io
import cv2
import numpy as np
import mediapipe as mp
from PIL import Image, ImageOps

from shirt_outline_detector import get_torso_box, segment_shirt_grabcut

mp_pose = mp.solutions.pose


def load_shirt_as_bgra(shirt_input):
    """
    Loads any image format (AVIF, WEBP, PNG, JPG, etc.) into a BGRA numpy array.
    """
    if isinstance(shirt_input, np.ndarray):
        if shirt_input.ndim == 2:
            return cv2.cvtColor(shirt_input, cv2.COLOR_GRAY2BGRA)
        elif shirt_input.shape[2] == 3:
            return cv2.cvtColor(shirt_input, cv2.COLOR_BGR2BGRA)
        elif shirt_input.shape[2] == 4:
            return shirt_input.copy()

    img_pil = None
    try:
        if isinstance(shirt_input, bytes):
            img_pil = Image.open(io.BytesIO(shirt_input))
        elif isinstance(shirt_input, str):
            img_pil = Image.open(shirt_input)
    except Exception:
        pass

    if img_pil is not None:
        img_pil = ImageOps.exif_transpose(img_pil)
        img_pil = img_pil.convert("RGBA")
        rgba_np = np.array(img_pil)
        return cv2.cvtColor(rgba_np, cv2.COLOR_RGBA2BGRA)

    # Fallback OpenCV read
    if isinstance(shirt_input, str):
        bgr = cv2.imread(shirt_input, cv2.IMREAD_UNCHANGED)
        if bgr is not None:
            if bgr.ndim == 2:
                bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGRA)
            elif bgr.shape[2] == 3:
                bgr = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
            return bgr

    raise ValueError("Could not load shirt image. Format may be unsupported or file corrupted.")


def remove_solid_background(shirt_bgra):
    """
    Strips white/solid background if the shirt image is opaque (e.g. JPEG uploads),
    returning a clean BGRA image with transparent alpha channel.
    """
    b, g, r, a = cv2.split(shirt_bgra)

    # If alpha is mostly opaque, run background extraction
    if np.mean(a) > 220:
        h, w = b.shape

        # Sample border pixels to determine background color
        borders = np.concatenate([
            shirt_bgra[0, :, :3],
            shirt_bgra[h - 1, :, :3],
            shirt_bgra[:, 0, :3],
            shirt_bgra[:, w - 1, :3],
        ])
        bg_color = np.median(borders, axis=0)

        # Distance from background color
        diff = np.sqrt(
            (b.astype(float) - bg_color[0]) ** 2
            + (g.astype(float) - bg_color[1]) ** 2
            + (r.astype(float) - bg_color[2]) ** 2
        )

        # White/light threshold fallback
        is_white = (r > 230) & (g > 230) & (b > 230)
        bg_mask = (diff < 40) | is_white

        new_a = a.copy()
        new_a[bg_mask] = 0

        # Morphological filtering to clean noise
        kernel = np.ones((3, 3), np.uint8)
        new_a = cv2.morphologyEx(new_a, cv2.MORPH_OPEN, kernel)
        shirt_bgra = cv2.merge([b, g, r, new_a])

    return shirt_bgra


def find_shirt_content_bounds(shirt_bgra):
    """
    Crops the shirt image tightly to its non-transparent garment pixels.
    Returns (cropped_bgra, info_dict).
    """
    alpha = shirt_bgra[:, :, 3]
    nonzero_coords = np.argwhere(alpha > 20)

    if len(nonzero_coords) == 0:
        return shirt_bgra, {"width": shirt_bgra.shape[1], "height": shirt_bgra.shape[0]}

    y_min, x_min = nonzero_coords.min(axis=0)
    y_max, x_max = nonzero_coords.max(axis=0)

    margin = 2
    y_min = max(0, y_min - margin)
    y_max = min(shirt_bgra.shape[0] - 1, y_max + margin)
    x_min = max(0, x_min - margin)
    x_max = min(shirt_bgra.shape[1] - 1, x_max + margin)

    cropped = shirt_bgra[y_min : y_max + 1, x_min : x_max + 1]
    ch, cw = cropped.shape[:2]

    return cropped, {"width": cw, "height": ch}


def overlay_shirt_on_body(person_bgr, shirt_input):
    """
    Performs pose-guided virtual try-on overlay of shirt_input onto person_bgr.

    person_bgr: cv2 BGR image array (person's front view photo)
    shirt_input: filepath, bytes, PIL Image, or numpy array
    """
    shirt_bgra = load_shirt_as_bgra(shirt_input)
    if shirt_bgra is None or shirt_bgra.size == 0:
        raise ValueError("Empty or invalid shirt image.")

    shirt_bgra = remove_solid_background(shirt_bgra)
    cropped_shirt, _crop_info = find_shirt_content_bounds(shirt_bgra)
    s_ch, s_cw = cropped_shirt.shape[:2]

    h_p, w_p = person_bgr.shape[:2]

    # Detect body pose using MediaPipe Pose with multi-pass confidence fallback
    results = None
    for min_conf in [0.35, 0.15, 0.05]:
        try:
            with mp_pose.Pose(
                static_image_mode=True,
                model_complexity=1,
                min_detection_confidence=min_conf,
            ) as pose:
                rgb_person = cv2.cvtColor(person_bgr, cv2.COLOR_BGR2RGB)
                res = pose.process(rgb_person)
                if res and res.pose_landmarks:
                    results = res
                    break
        except Exception:
            pass

    use_landmarks = False
    if results and results.pose_landmarks:
        lm = results.pose_landmarks.landmark
        PL = mp_pose.PoseLandmark
        l_sh = lm[PL.LEFT_SHOULDER]
        r_sh = lm[PL.RIGHT_SHOULDER]
        l_hp = lm[PL.LEFT_HIP]
        r_hp = lm[PL.RIGHT_HIP]

        if l_sh.visibility > 0.10 and r_sh.visibility > 0.10:
            use_landmarks = True

    if use_landmarks:
        # Convert landmarks to canvas pixel points
        pt1 = np.array([l_sh.x * w_p, l_sh.y * h_p])
        pt2 = np.array([r_sh.x * w_p, r_sh.y * h_p])

        if pt1[0] < pt2[0]:
            sh_left_img, sh_right_img = pt1, pt2
        else:
            sh_left_img, sh_right_img = pt2, pt1

        h_pt1 = np.array([l_hp.x * w_p, l_hp.y * h_p])
        h_pt2 = np.array([r_hp.x * w_p, r_hp.y * h_p])

        if h_pt1[0] < h_pt2[0]:
            hip_left_img, hip_right_img = h_pt1, h_pt2
        else:
            hip_left_img, hip_right_img = h_pt2, h_pt1

        # Calculate body geometry vectors
        shoulder_vec = sh_right_img - sh_left_img
        shoulder_span = np.linalg.norm(shoulder_vec)
        shoulder_mid = (sh_left_img + sh_right_img) / 2.0
        hip_mid = (hip_left_img + hip_right_img) / 2.0

        torso_vec = hip_mid - shoulder_mid
        torso_height = np.linalg.norm(torso_vec)

        shoulder_dir = shoulder_vec / (shoulder_span + 1e-5)
        torso_dir = torso_vec / (torso_height + 1e-5)

        pad_shoulder_x = shoulder_span * 0.08
        raise_collar_y = torso_height * 0.10

        target_top_left = sh_left_img - shoulder_dir * pad_shoulder_x - torso_dir * raise_collar_y
        target_top_right = sh_right_img + shoulder_dir * pad_shoulder_x - torso_dir * raise_collar_y

        # Hip landmarks already sit at roughly the natural waist/hem line, so
        # the hem should land close to torso_height, not well past it.
        hem_length = torso_height * 1.02
        target_bottom_left = target_top_left + torso_dir * hem_length
        target_bottom_right = target_top_right + torso_dir * hem_length
    else:
        # Fallback upper-body torso positioning when pose landmarks are unreadable
        target_top_left = np.array([w_p * 0.20, h_p * 0.18])
        target_top_right = np.array([w_p * 0.80, h_p * 0.18])
        target_bottom_left = np.array([w_p * 0.20, h_p * 0.65])
        target_bottom_right = np.array([w_p * 0.80, h_p * 0.65])

    # Source corners on crop
    src_pts = np.float32([
        [0, 0],
        [s_cw, 0],
        [0, s_ch],
        [s_cw, s_ch],
    ])

    # Destination corners on person photo
    dst_pts = np.float32([
        target_top_left,
        target_top_right,
        target_bottom_left,
        target_bottom_right,
    ])

    # Compute Perspective Transformation Matrix
    matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)

    # Perspective warp shirt image onto person image size
    warped_shirt = cv2.warpPerspective(
        cropped_shirt,
        matrix,
        (w_p, h_p),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )

    warped_bgr = warped_shirt[:, :, :3]
    warped_alpha = warped_shirt[:, :, 3].astype(float) / 255.0

    # Soften alpha edges for seamless realistic blending
    alpha_blurred = cv2.GaussianBlur(warped_alpha, (3, 3), 0)
    alpha_3d = np.dstack([alpha_blurred, alpha_blurred, alpha_blurred])

    # Alpha composite shirt onto person front view photo
    output_bgr = person_bgr.astype(float) * (1.0 - alpha_3d) + warped_bgr.astype(float) * alpha_3d
    output_bgr = np.clip(output_bgr, 0, 255).astype(np.uint8)

    return output_bgr


def build_garment_agnostic_mask(person_bgr):
    """
    Builds a binary "region to replace" mask for a person photo, for use as
    the inpainting mask input to a real diffusion-based try-on model
    (e.g. CatVTON), without needing detectron2/densepose for human parsing.

    White (255) = shirt/torso region to regenerate. Black (0) = keep as-is.

    Reuses shirt_outline_detector.py's existing MediaPipe-landmark torso box
    + GrabCut foreground segmentation (already used for the live shirt-
    outline preview), falling back to the plain padded torso box if GrabCut
    fails to find a clean foreground.
    """
    h_p, w_p = person_bgr.shape[:2]

    results = None
    for min_conf in [0.35, 0.15, 0.05]:
        try:
            with mp_pose.Pose(
                static_image_mode=True,
                model_complexity=1,
                min_detection_confidence=min_conf,
            ) as pose:
                rgb_person = cv2.cvtColor(person_bgr, cv2.COLOR_BGR2RGB)
                res = pose.process(rgb_person)
                if res and res.pose_landmarks:
                    results = res
                    break
        except Exception:
            pass

    if results is None or not results.pose_landmarks:
        raise ValueError("Could not detect a person in the photo to build a try-on mask.")

    box = get_torso_box(results.pose_landmarks, w_p, h_p)
    if box is None:
        raise ValueError("Could not locate shoulders/hips in the photo to build a try-on mask.")

    mask = segment_shirt_grabcut(person_bgr, box, iterations=3)
    if mask is None or cv2.countNonZero(mask) < 500:
        # GrabCut found nothing usable -- fall back to a filled torso box.
        x1, y1, x2, y2 = box
        mask = np.zeros((h_p, w_p), np.uint8)
        mask[y1:y2, x1:x2] = 255

    return Image.fromarray(mask, mode="L")
