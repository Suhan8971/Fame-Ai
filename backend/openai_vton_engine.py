"""
openai_vton_engine.py
----------------------
Cloud-based virtual try-on via OpenAI's gpt-image-2 multi-image edit
endpoint (images.edit(image=[person, garment], prompt=...)). Tried FIRST
in vton_engine.py's engine chain when OPENAI_API_KEY is configured, since
it sidesteps every local-hardware problem this session hit with CatVTON
(MPS "Invalid buffer size" crashes, CPU inference measured at 15-20+
min/request) by moving generation to OpenAI's infrastructure.

NOTE: unlike CatVTON / the geometric fallback, this sends the user's photo
and garment photo to a third-party API. Only active when OPENAI_API_KEY is
explicitly configured -- with no key set, is_ready() is False and
vton_engine.py falls through to the local engines exactly as before.

gpt-image-2, not gpt-image-1.5: 1.5 is scheduled for API removal on
2026-12-01 per OpenAI's own docs (checked at build time); gpt-image-2 is
the actively supported replacement with the same multi-image edit
capability (up to 16 reference images per request).
"""

import os
import io
import base64
import logging
import time
from typing import Tuple, Dict, Any

from PIL import Image

logger = logging.getLogger("OpenAIVTONEngine")

OPENAI_AVAILABLE = False
OpenAI = None
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError as e:
    logger.warning(f"openai package not found ({e}).")

MODEL_NAME = "gpt-image-2"

# images.edit only accepts these fixed canvas sizes -- picking the one whose
# orientation matches the input photo keeps the model from inventing extra
# top/bottom or left/right framing the original photo never had.
SUPPORTED_SIZES = ("1024x1024", "1024x1536", "1536x1024")


def closest_supported_size(width: int, height: int) -> str:
    ratio = width / height
    if ratio > 1.15:
        return "1536x1024"  # landscape
    if ratio < 0.87:
        return "1024x1536"  # portrait
    return "1024x1024"  # near-square

TRYON_PROMPT = (
    "Take the shirt from the second image and realistically dress the "
    "person in the first image with it. Preserve the person's face, body "
    "proportions, pose, hairstyle, background, lighting, and identity. "
    "Make the shirt fit naturally around the person's body with realistic "
    "folds, shadows, texture, and perspective."
)


def _load_dotenv_if_present():
    """
    Minimal .env loader (no python-dotenv dependency) so OPENAI_API_KEY can
    be kept in a local .env file instead of exported in the shell. Sets
    KEY=VALUE lines from ./.env without overriding variables already
    present in the real environment. .env is expected to be gitignored.
    """
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv_if_present()


class OpenAIVTONEngine:
    """Singleton wrapper mirroring VTONInferenceEngine's lifecycle pattern."""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(OpenAIVTONEngine, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.client = None
        self.status = "uninitialized"
        self._initialized = True
        self._load_client()

    def _load_client(self):
        if not OPENAI_AVAILABLE:
            self.status = "Unavailable (openai package not importable)"
            logger.warning(self.status)
            return

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            self.status = "Not configured (set OPENAI_API_KEY to enable)"
            logger.info(self.status)
            return

        try:
            self.client = OpenAI(api_key=api_key)
            self.status = f"Ready ({MODEL_NAME})"
            logger.info(self.status)
        except Exception as e:
            self.status = f"Client init error: {e}"
            logger.error(self.status)

    def is_ready(self) -> bool:
        return self.client is not None

    def run_inference(
        self,
        person_image: Image.Image,
        garment_image: Image.Image,
        size: str = "1024x1536",
        quality: str = "medium",
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        if not self.is_ready():
            raise RuntimeError(f"OpenAI VTON engine not ready: {self.status}")

        start_time = time.time()

        person_buf = io.BytesIO()
        person_image.convert("RGB").save(person_buf, format="PNG")
        person_buf.seek(0)
        person_buf.name = "person.png"

        garment_buf = io.BytesIO()
        garment_image.convert("RGB").save(garment_buf, format="PNG")
        garment_buf.seek(0)
        garment_buf.name = "garment.png"

        result = self.client.images.edit(
            model=MODEL_NAME,
            image=[person_buf, garment_buf],
            prompt=TRYON_PROMPT,
            size=size,
            quality=quality,
        )

        b64_data = result.data[0].b64_json
        output_pil = Image.open(io.BytesIO(base64.b64decode(b64_data))).convert("RGB")

        elapsed = time.time() - start_time
        meta = {
            "engine": f"OpenAI {MODEL_NAME} (Cloud)",
            "device": "OpenAI API",
            "inference_time_sec": round(elapsed, 2),
            "status": "Success",
        }
        return output_pil, meta
