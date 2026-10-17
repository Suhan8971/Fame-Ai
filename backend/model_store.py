"""
model_store.py
--------------
Fashion-Show integration layer: persists a model's finished 4-view capture
session so recruiters can open it later.

shirt-new-app-1 kept a single capture session in app.py's in-memory `state`
and ran try-on against whatever front view was captured last. Fashion-Show
has many models and a separate recruiter role, so a finished session is
copied out of the transient capture directory into

    static/models/<model_id>/
        front.jpg  left.jpg  right.jpg  back.jpg   annotated captures (overlay lines)
        raw_front.jpg                              clean front photo used for try-on
        session.json                               model info + the fused summary

Only the latest session per model is kept. Nothing here measures anything:
the measurement results stored are exactly what app.build_summary() produced.
"""

import json
import os
import re
import shutil
import threading
import time

VIEW_ORDER = ["front", "left", "right", "back"]

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CAPTURE_DIR = os.path.join(_BASE_DIR, "static", "captures")
MODELS_DIR = os.path.join(_BASE_DIR, "static", "models")
MODELS_URL = "/static/models"

_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_store_lock = threading.Lock()


class ModelStoreError(Exception):
    pass


def safe_model_id(model_id):
    """Model ids become directory names, so only a strict charset is allowed."""
    model_id = str(model_id or "").strip()
    if not _MODEL_ID_RE.match(model_id):
        raise ModelStoreError("Invalid model id.")
    return model_id


def _capture_path_from_url(url):
    """Map a /static/captures/<file> URL back to its file, refusing anything else."""
    name = os.path.basename(str(url or "").split("?")[0])
    if not name:
        return None
    path = os.path.join(CAPTURE_DIR, name)
    return path if os.path.isfile(path) else None


def save_session(model, views_data, summary, height_cm):
    """Copy the finished session's images and summary into the model's folder."""
    model_id = safe_model_id((model or {}).get("id"))
    missing = [v for v in VIEW_ORDER if not (views_data or {}).get(v)]
    if missing:
        raise ModelStoreError(f"Capture session is incomplete (missing: {', '.join(missing)}).")
    if not summary:
        raise ModelStoreError("Measurements have not been computed yet.")

    saved_at = int(time.time())
    model_dir = os.path.join(MODELS_DIR, model_id)
    views = {}

    with _store_lock:
        os.makedirs(model_dir, exist_ok=True)
        for v in VIEW_ORDER:
            src = _capture_path_from_url(views_data[v].get("image_url"))
            if src is None:
                raise ModelStoreError(f"The {v} capture file could not be found on the server.")
            shutil.copyfile(src, os.path.join(model_dir, f"{v}.jpg"))
            views[v] = {"image_url": f"{MODELS_URL}/{model_id}/{v}.jpg?v={saved_at}"}

        raw_src = views_data["front"].get("raw_filepath")
        if not raw_src or not os.path.isfile(raw_src):
            raw_src = _capture_path_from_url(views_data["front"].get("raw_image_url"))
        if raw_src is None:
            raise ModelStoreError("The raw front photo could not be found on the server.")
        shutil.copyfile(raw_src, os.path.join(model_dir, "raw_front.jpg"))
        views["front"]["raw_image_url"] = f"{MODELS_URL}/{model_id}/raw_front.jpg?v={saved_at}"

        record = {
            "model_id": model_id,
            "name": (model or {}).get("name") or "",
            "email": (model or {}).get("email") or "",
            "height_cm": height_cm,
            "saved_at": saved_at,
            "views": views,
            "summary": summary,
        }
        tmp = os.path.join(model_dir, "session.json.tmp")
        with open(tmp, "w") as fh:
            json.dump(record, fh)
        os.replace(tmp, os.path.join(model_dir, "session.json"))
    return record


def load_session(model_id):
    path = os.path.join(MODELS_DIR, safe_model_id(model_id), "session.json")
    if not os.path.isfile(path):
        return None
    with open(path) as fh:
        return json.load(fh)


def raw_front_path(model_id):
    path = os.path.join(MODELS_DIR, safe_model_id(model_id), "raw_front.jpg")
    return path if os.path.isfile(path) else None


def list_models():
    """Lightweight listing for the recruiter model picker, newest first."""
    out = []
    if not os.path.isdir(MODELS_DIR):
        return out
    for entry in os.listdir(MODELS_DIR):
        if not _MODEL_ID_RE.match(entry):
            continue
        try:
            rec = load_session(entry)
        except (OSError, ValueError, ModelStoreError):
            continue
        if not rec:
            continue
        from application_store import is_shortlisted
        if not is_shortlisted(rec["model_id"]):
            continue
        release = (rec.get("summary") or {}).get("release") or {}
        out.append({
            "model_id": rec["model_id"],
            "name": rec.get("name"),
            "email": rec.get("email"),
            "height_cm": rec.get("height_cm"),
            "saved_at": rec.get("saved_at"),
            "views": rec.get("views"),
            "release": release.get("release"),
            "overall_confidence_pct": release.get("overall_confidence_pct"),
        })
    out.sort(key=lambda r: r.get("saved_at") or 0, reverse=True)
    return out
