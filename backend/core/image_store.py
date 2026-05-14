"""Disk-backed image store for citizen-uploaded disaster photos.

Images are saved under ``backend/data/cities/<city>/uploads/`` with a UUID name.
We keep a minimal metadata index so they can be referenced by ID later and
served back via the static-mounted ``/uploads/...`` path on the FastAPI app.
"""
from __future__ import annotations

import json
import logging
import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.core.config import settings

logger = logging.getLogger(__name__)

# Cap inbound image size — protects the agent loop and avoids gigantic Gemini
# vision payloads. ~6 MB is plenty for a phone photo at acceptable quality.
MAX_IMAGE_BYTES = 6 * 1024 * 1024

ALLOWED_MIME = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}


def _uploads_dir() -> Path:
    p = settings.city.data_dir / "uploads"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _index_path() -> Path:
    return _uploads_dir() / "_index.json"


def _read_index() -> dict:
    p = _index_path()
    if not p.exists():
        return {}
    try:
        with open(p) as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("image index unreadable: %s", exc)
        return {}


def _write_index(idx: dict) -> None:
    try:
        with open(_index_path(), "w") as f:
            json.dump(idx, f, indent=2, default=str)
    except Exception as exc:
        logger.warning("image index write failed: %s", exc)


def save_image(content: bytes, content_type: str, citizen_id: Optional[str] = None) -> dict:
    """Persist an uploaded image and return its metadata.

    Returns a dict with ``image_id``, ``url`` (relative to backend root),
    ``content_type``, ``size_bytes``, ``saved_at``.
    """
    if len(content) > MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image too large ({len(content)} bytes); max {MAX_IMAGE_BYTES}"
        )

    ct = (content_type or "").lower().split(";")[0].strip()
    if ct not in ALLOWED_MIME:
        raise ValueError(f"Unsupported image content-type: {ct!r}")

    ext = mimetypes.guess_extension(ct) or ".bin"
    if ext == ".jpe":
        ext = ".jpg"

    image_id = f"img_{uuid.uuid4().hex[:12]}"
    rel_name = f"{image_id}{ext}"
    abs_path = _uploads_dir() / rel_name

    with open(abs_path, "wb") as f:
        f.write(content)

    meta = {
        "image_id": image_id,
        "filename": rel_name,
        "url": f"/uploads/{rel_name}",
        "content_type": ct,
        "size_bytes": len(content),
        "citizen_id": citizen_id,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }

    idx = _read_index()
    idx[image_id] = meta
    _write_index(idx)
    return meta


def get_image_meta(image_id: str) -> Optional[dict]:
    return _read_index().get(image_id)


def absolute_path(image_id: str) -> Optional[Path]:
    meta = get_image_meta(image_id)
    if not meta:
        return None
    return _uploads_dir() / meta["filename"]
