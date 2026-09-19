"""
vton_engine.py
--------------
Virtual Try-On Engine & Preprocessing Manager.

Engine priority (tried in order, each falling through to the next on
failure or if not configured):
1. OpenAI gpt-image-2 (openai_vton_engine.py) -- cloud-based, only active
   if OPENAI_API_KEY is configured. Sidesteps every local-hardware problem
   the other two engines hit (see below) by running on OpenAI's
   infrastructure instead of this machine.
2. CatVTON (https://github.com/Zheng-Chong/CatVTON, vendored in catvton/),
   licensed CC BY-NC-SA 4.0 -- NON-COMMERCIAL USE ONLY. We switched to it
   from FASHN VTON v1.5 (Apache-2.0) because fashn_vton could not run on
   this host: it requires Python >=3.10 (this host runs 3.9.6) and
   hard-depends on onnxruntime-gpu, which has no macOS wheel at all.
   Currently disabled on non-CUDA hosts here -- CPU inference measured at
   15-20+ min/request, MPS crashes at the default resolution (fixable via
   a lower-res checkpoint, tracked separately). Do not deploy commercially
   without swapping in a permissively-licensed model.
3. Pose-guided geometric fallback (virtual_tryon.py) -- always available,
   fast, deterministic.

Also handles Image Preprocessing & Validation (orientation, size, aspect
ratio, transparency) shared by all three engines.
"""

import os
import io
import time
import logging
from typing import Tuple, Dict, Any, Optional, Union
from PIL import Image, ImageOps
import numpy as np

from openai_vton_engine import OpenAIVTONEngine

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("VTONEngine")

# Hardware detection
TORCH_AVAILABLE = False
CUDA_AVAILABLE = False
MPS_AVAILABLE = False
torch = None

try:
    import torch
    TORCH_AVAILABLE = True
    CUDA_AVAILABLE = torch.cuda.is_available()
    MPS_AVAILABLE = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
except ImportError:
    logger.warning("PyTorch is not installed. CPU fallback mode will be active.")

# Attempt importing the vendored CatVTON pipeline
CATVTON_AVAILABLE = False
CatVTONPipeline = None

try:
    from catvton.pipeline import CatVTONPipeline
    CATVTON_AVAILABLE = True
    logger.info("catvton library successfully imported.")
except ImportError as e:
    logger.warning(f"catvton library not found ({e}). Falling back to development try-on engine.")

CATVTON_BASE_CKPT = "booksforcharlie/stable-diffusion-inpainting"
CATVTON_ATTN_CKPT = "zhengchong/CatVTON"


class VTONInferenceEngine:
    """
    Singleton Manager for CatVTON Model Inference.
    Ensures the model is loaded once and reused across all requests.
    """
    _instance = None

    def __new__(cls, weights_dir: str = "./weights"):
        if cls._instance is None:
            cls._instance = super(VTONInferenceEngine, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, weights_dir: str = "./weights"):
        if self._initialized:
            return

        self.weights_dir = os.path.abspath(weights_dir)
        self.pipeline = None
        self.device = "cuda" if CUDA_AVAILABLE else ("mps" if MPS_AVAILABLE else "cpu")
        self.status = "uninitialized"
        self.openai_engine = OpenAIVTONEngine()
        self._initialized = True
        self._load_model()

    def _load_model(self):
        """Loads the CatVTON pipeline (weights auto-download/cache via Hugging Face Hub)."""
        logger.info(f"Initializing VTON Engine on device: {self.device.upper()}")

        if not CATVTON_AVAILABLE:
            logger.info("catvton package not importable. Using pose-guided development fallback.")
            self.status = "Development Engine Active (catvton package not importable)"
            return

        # Measured directly on this host: CPU inference is ~50-100+ sec PER
        # DENOISING STEP (climbing over the run, likely thermal throttling)
        # -- a 20-step request takes 15-20+ minutes and pegs all CPU cores
        # the whole time. That's unusable for an interactive app and a real
        # risk to the host if left enabled by default. MPS loads fine but
        # crashes fast on inference ("Invalid buffer size: 36 GiB") -- see
        # project notes. Until a fast working device path is confirmed
        # (tracked separately), do NOT auto-load the real model on
        # CPU-only hosts; stay on the fast pose-guided fallback instead.
        if not CUDA_AVAILABLE:
            logger.warning(
                "No CUDA GPU available. CatVTON CPU inference is measured at "
                "15-20+ min/request on this host -- refusing to auto-load it. "
                "Staying on the pose-guided fallback engine."
            )
            self.status = "Development Engine Active (CatVTON CPU inference too slow to be usable -- see project notes)"
            return

        devices_to_try = ["cuda"]

        last_error = None
        for device in devices_to_try:
            try:
                logger.info(f"Loading CatVTON weights on {device.upper()} (base={CATVTON_BASE_CKPT}, attn={CATVTON_ATTN_CKPT})...")
                self.pipeline = CatVTONPipeline(
                    base_ckpt=CATVTON_BASE_CKPT,
                    attn_ckpt=CATVTON_ATTN_CKPT,
                    attn_ckpt_version="mix",
                    weight_dtype=torch.float32,
                    device=device,
                    skip_safety_check=True,
                    use_tf32=False,
                )
                self.device = device
                self.status = f"CatVTON Ready ({device.upper()})"
                logger.info(f"CatVTON model loaded successfully on {device.upper()}.")
                return
            except Exception as e:
                last_error = e
                logger.error(f"Failed to load CatVTON pipeline on {device.upper()}: {e}")

        self.status = f"Model load error: {last_error}"

    def is_real_model_ready(self) -> bool:
        """Returns True if any real neural engine (OpenAI or CatVTON) is ready."""
        return self.openai_engine.is_ready() or self.pipeline is not None

    def active_engine_description(self) -> str:
        """Human-readable description of which engine will actually run next."""
        if self.openai_engine.is_ready():
            return self.openai_engine.status
        if self.pipeline is not None:
            return self.status
        return f"Pose-Guided Fallback ({self.device.upper()})"

    def run_inference(
        self,
        person_image: Image.Image,
        garment_image: Image.Image,
        category: str = "tops",
        num_timesteps: int = 30,
        guidance_scale: float = 2.5,
        target_size: str = "1024x1536",
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        """
        Executes virtual try-on inference.
        Tries OpenAI (if configured), then the real CatVTON neural
        pipeline (if loaded), then falls back to the pose-guided
        geometric warp.

        target_size: the OpenAI images.edit canvas size to request,
        chosen by the caller (app.py) to match the original photo's
        orientation -- does not affect CatVTON/fallback, which always
        operate on their own fixed model resolution.
        """
        start_time = time.time()

        if self.openai_engine.is_ready():
            try:
                logger.info("Running OpenAI cloud inference...")
                return self.openai_engine.run_inference(person_image, garment_image, size=target_size)
            except Exception as e:
                logger.error(f"OpenAI inference error: {e}. Falling back to local engine.")

        if self.pipeline is not None:
            try:
                logger.info("Running CatVTON neural inference...")
                person_prep = prepare_person_image(person_image, target_w=768, target_h=1024)
                garment_prep = prepare_garment_image(garment_image, target_w=768, target_h=1024)

                import cv2
                from virtual_tryon import build_garment_agnostic_mask
                person_bgr = cv2.cvtColor(np.array(person_prep), cv2.COLOR_RGB2BGR)
                mask_pil = build_garment_agnostic_mask(person_bgr)

                result_images = self.pipeline(
                    image=person_prep,
                    condition_image=garment_prep,
                    mask=mask_pil,
                    num_inference_steps=num_timesteps,
                    guidance_scale=guidance_scale,
                    height=1024,
                    width=768,
                )
                output_pil = result_images[0]
                elapsed = time.time() - start_time
                meta = {
                    "engine": "CatVTON (Neural)",
                    "device": self.device.upper(),
                    "inference_time_sec": round(elapsed, 2),
                    "status": "Success",
                }
                return output_pil, meta
            except Exception as e:
                logger.error(f"CatVTON inference error: {e}. Falling back to pose engine.")

        # Fallback execution when neural weights/library are missing or failing
        logger.info("Executing pose-guided Virtual Try-On engine...")
        output_pil = run_pose_guided_fallback(person_image, garment_image)
        elapsed = time.time() - start_time
        meta = {
            "engine": "Pose-Guided Development Fallback",
            "device": self.device.upper(),
            "inference_time_sec": round(elapsed, 2),
            "status": f"Development Engine Active ({self.device.upper()})",
        }
        return output_pil, meta


# ---------------------------------------------------------------------------
# Image Preprocessing & Validation Helpers
# ---------------------------------------------------------------------------

SUPPORTED_FORMATS = {"JPEG", "JPG", "PNG", "WEBP", "AVIF", "BMP"}
MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB max
MIN_DIMENSION = 128


def validate_and_load_image(input_data: Union[str, bytes, Image.Image, np.ndarray]) -> Image.Image:
    """
    Validates image format, file corruption, and dimensions.
    Normalizes EXIF orientation and converts to RGB PIL Image.
    """
    if isinstance(input_data, Image.Image):
        img = input_data
    elif isinstance(input_data, bytes):
        if len(input_data) == 0:
            raise ValueError("Uploaded image file is empty.")
        if len(input_data) > MAX_FILE_SIZE_BYTES:
            raise ValueError("Uploaded image file exceeds size limit (20MB).")
        try:
            img = Image.open(io.BytesIO(input_data))
        except Exception as e:
            raise ValueError("Corrupted or unreadable image file.") from e
    elif isinstance(input_data, str):
        if not os.path.exists(input_data):
            raise ValueError("Specified image file path does not exist.")
        try:
            img = Image.open(input_data)
        except Exception as e:
            raise ValueError(f"Failed to open image file: {str(e)}") from e
    elif isinstance(input_data, np.ndarray):
        if input_data.ndim == 2:
            img = Image.fromarray(input_data).convert("L")
        elif input_data.shape[2] == 3:
            # OpenCV BGR -> RGB
            img = Image.fromarray(input_data[:, :, ::-1])
        elif input_data.shape[2] == 4:
            img = Image.fromarray(input_data[:, :, [2, 1, 0, 3]])
        else:
            raise ValueError("Invalid numpy image dimensions.")
    else:
        raise ValueError("Unsupported image input type.")

    # Fix orientation using EXIF transpose
    img = ImageOps.exif_transpose(img)

    w, h = img.size
    if w < MIN_DIMENSION or h < MIN_DIMENSION:
        raise ValueError(f"Image dimensions ({w}x{h}) are too small. Minimum size is {MIN_DIMENSION}x{MIN_DIMENSION}.")

    return img.convert("RGB")


def prepare_garment_image(garment_img: Image.Image, target_w: int = 768, target_h: int = 1024) -> Image.Image:
    """
    Preprocesses uploaded garment image for virtual try-on model:
    - Handles alpha channel/transparency by compositing on white background.
    - Resizes cleanly maintaining aspect ratio.
    """
    if garment_img.mode in ("RGBA", "LA") or (garment_img.mode == "P" and "transparency" in garment_img.info):
        rgba = garment_img.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        garment_img = Image.alpha_composite(background, rgba).convert("RGB")
    else:
        garment_img = garment_img.convert("RGB")

    garment_resized = garment_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
    return garment_resized


def prepare_person_image(person_img: Image.Image, target_w: int = 768, target_h: int = 1024) -> Image.Image:
    """
    Preprocesses person front-view image for virtual try-on model:
    - Ensures RGB mode.
    - Resizes to standard model input resolution (768x1024).
    """
    person_rgb = person_img.convert("RGB")
    person_resized = person_rgb.resize((target_w, target_h), Image.Resampling.LANCZOS)
    return person_resized


def fit_to_aspect_ratio(img: Image.Image, aspect_ratio: float) -> Image.Image:
    """
    Center-crops img (no stretching) so its width/height ratio matches
    aspect_ratio. Used to make a generated try-on image's canvas match the
    original front-view photo's framing instead of whatever fixed size the
    generation API returned.
    """
    w, h = img.size
    current_ratio = w / h
    if abs(current_ratio - aspect_ratio) < 1e-3:
        return img
    if current_ratio > aspect_ratio:
        new_w = max(1, round(h * aspect_ratio))
        left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h))
    new_h = max(1, round(w / aspect_ratio))
    top = (h - new_h) // 2
    return img.crop((0, top, w, top + new_h))


def run_pose_guided_fallback(person_img: Image.Image, garment_img: Image.Image) -> Image.Image:
    """
    Development Fallback Virtual Try-On Engine.
    Used when neural weights are missing.
    Applies MediaPipe pose detection + seamless garment alignment.
    """
    try:
        import cv2
        from virtual_tryon import overlay_shirt_on_body

        person_bgr = cv2.cvtColor(np.array(person_img.convert("RGB")), cv2.COLOR_RGB2BGR)
        garment_bgr = cv2.cvtColor(np.array(garment_img.convert("RGB")), cv2.COLOR_RGB2BGR)

        result_bgr = overlay_shirt_on_body(person_bgr, garment_bgr)
        result_rgb = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2RGB)
        return Image.fromarray(result_rgb)
    except Exception as e:
        logger.error(f"Fallback try-on exception: {e}")
        # Secondary basic composition fallback if OpenCV/MediaPipe fails completely
        try:
            p_w, p_h = person_img.size
            garment_scaled = garment_img.convert("RGBA").resize((int(p_w * 0.5), int(p_h * 0.45)), Image.Resampling.LANCZOS)
            canvas = person_img.convert("RGBA").copy()
            paste_x = (p_w - garment_scaled.width) // 2
            paste_y = int(p_h * 0.22)
            canvas.paste(garment_scaled, (paste_x, paste_y), garment_scaled)
            return canvas.convert("RGB")
        except Exception:
            return person_img
