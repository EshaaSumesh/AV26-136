"""Gemini vision tool — analyze citizen-uploaded disaster photos.

Exposed to the Situation Awareness agent as ``analyze_disaster_image``.
The agent supplies an ``image_id`` (returned by ``POST /citizen/upload``);
this tool loads the bytes from disk, base64-encodes them, and asks Gemini
2.5 Flash for a structured visual assessment.

The output is a short, structured text the agent can paste into its
ASSESSMENT block (or override).
"""
from __future__ import annotations

import base64
import logging
from typing import Optional

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from backend.agents.llm import get_llm
from backend.core.image_store import absolute_path, get_image_meta

logger = logging.getLogger(__name__)


_VISION_INSTRUCTION = (
    "You are a disaster-response visual analyst. Examine the image and "
    "return a CONCISE, structured analysis with these labels on separate "
    "lines:\n"
    "VISUAL_DISASTER_TYPE: one of [flood, fire, earthquake, building_collapse, "
    "road_block, landslide, cyclone, medical, other, none]. Use 'none' if "
    "the image does not appear to show a disaster.\n"
    "VISIBLE_SEVERITY: 1-5 estimate based ONLY on what you can see.\n"
    "PEOPLE_AT_RISK: yes/no/unclear (any people visibly in danger or "
    "stranded).\n"
    "VEHICLES_INVOLVED: yes/no/unclear.\n"
    "INFRASTRUCTURE_DAMAGE: brief description (collapsed wall, flooded road, "
    "blocked lane, fire on building, etc.) or 'none'.\n"
    "ENVIRONMENTAL_CONTEXT: weather visible (rain, smoke, dust, clear).\n"
    "CONFIDENCE: 0.0-1.0 — how confident you are in the disaster type.\n"
    "EVIDENCE_SUMMARY: 1-2 sentences of what you actually see in the image.\n"
    "CAVEATS: any reason this image might be misleading (cropped, old "
    "photo, staged, low resolution, etc.).\n"
)


@tool
def analyze_disaster_image(
    image_id: str,
    citizen_hint: Optional[str] = None,
) -> dict:
    """Analyze a citizen-uploaded disaster photo with Gemini vision.

    Args:
        image_id: ID returned by POST /citizen/upload (e.g. 'img_ab12cd34').
        citizen_hint: Optional context the citizen provided alongside the
            photo (their description / claimed disaster type).

    Returns a dict with ``available`` (bool), ``analysis`` (the structured
    text from Gemini), and ``meta`` (image filename / size for traceability).
    On failure, returns ``available: False`` with an ``error`` key.
    """
    meta = get_image_meta(image_id)
    if not meta:
        return {
            "available": False,
            "error": f"Unknown image_id: {image_id!r}. "
            "Make sure the citizen uploaded an image and the ID is correct.",
        }

    path = absolute_path(image_id)
    if path is None or not path.exists():
        return {
            "available": False,
            "error": f"Image bytes for {image_id} are missing on disk.",
        }

    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as exc:
        return {"available": False, "error": f"Failed to read image: {exc}"}

    b64 = base64.b64encode(raw).decode("utf-8")
    data_url = f"data:{meta['content_type']};base64,{b64}"

    text_part = _VISION_INSTRUCTION
    if citizen_hint:
        text_part += f"\nCitizen wrote: \"{citizen_hint.strip()[:400]}\""

    message = HumanMessage(
        content=[
            {"type": "text", "text": text_part},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]
    )

    try:
        llm = get_llm()
        result = llm.invoke([message])
        analysis_text = result.content if hasattr(result, "content") else str(result)
        if isinstance(analysis_text, list):
            # Multimodal/parts response — flatten to text.
            analysis_text = "\n".join(
                p.get("text", "") if isinstance(p, dict) else str(p)
                for p in analysis_text
            )
    except Exception as exc:
        logger.exception("Gemini vision failed for %s", image_id)
        return {
            "available": False,
            "error": f"Gemini vision call failed: {exc}",
            "meta": meta,
        }

    return {
        "available": True,
        "image_id": image_id,
        "analysis": analysis_text,
        "meta": {
            "content_type": meta["content_type"],
            "size_bytes": meta["size_bytes"],
            "saved_at": meta["saved_at"],
        },
    }
