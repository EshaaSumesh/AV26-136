"""Rescue resource database tool — query bases, teams, and specializations.

Agents use this to look up available rescue bases, their team counts,
specializations, and proximity to a target location.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from langchain_core.tools import tool

from backend.core.config import settings
from backend.tools.osm_router import haversine

logger = logging.getLogger(__name__)

_bases: Optional[list] = None


def _load_bases() -> list[dict]:
    global _bases
    if _bases is not None:
        return _bases
    path = settings.city.data_dir / "rescue_bases.json"
    if not path.exists():
        logger.warning("Rescue bases file not found: %s", path)
        return []
    with open(path) as f:
        _bases = json.load(f)
    return _bases


def get_bases_raw() -> list[dict]:
    """Direct access for non-tool contexts (e.g., app startup)."""
    return _load_bases()


@tool
def get_rescue_bases(
    near_lat: Optional[float] = None,
    near_lng: Optional[float] = None,
    disaster_type: Optional[str] = None,
    max_results: int = 10,
) -> dict:
    """Query available rescue bases, optionally filtered by proximity and specialization.

    Args:
        near_lat, near_lng: If provided, results are sorted by distance to this point
        disaster_type: If provided, filters to bases that specialize in this type
        max_results: Maximum number of bases to return

    Returns bases with id, name, coordinates, teams_available, specialization, and distance.
    """
    bases = _load_bases()
    results = []

    for b in bases:
        if disaster_type:
            specs = b.get("specialization", [])
            if disaster_type not in specs:
                continue

        entry = {**b}
        if near_lat is not None and near_lng is not None:
            entry["distance_km"] = round(
                haversine(near_lat, near_lng, b["coordinates"][0], b["coordinates"][1]),
                2,
            )

        results.append(entry)

    if near_lat is not None and near_lng is not None:
        results.sort(key=lambda x: x.get("distance_km", float("inf")))

    return {
        "base_count": len(results[:max_results]),
        "bases": results[:max_results],
    }


@tool
def get_relief_zones(
    near_lat: Optional[float] = None,
    near_lng: Optional[float] = None,
    max_results: int = 5,
) -> dict:
    """Query available relief/evacuation zones for citizen safe routing.

    Returns relief zones sorted by distance if coordinates provided.
    """
    path = settings.city.data_dir / "relief_zones.json"
    if not path.exists():
        return {"zone_count": 0, "zones": [], "note": "No relief zones configured"}

    with open(path) as f:
        zones = json.load(f)

    results = []
    for z in zones:
        entry = {**z}
        if near_lat is not None and near_lng is not None:
            entry["distance_km"] = round(
                haversine(near_lat, near_lng, z["coordinates"][0], z["coordinates"][1]),
                2,
            )
        results.append(entry)

    if near_lat is not None and near_lng is not None:
        results.sort(key=lambda x: x.get("distance_km", float("inf")))

    return {
        "zone_count": len(results[:max_results]),
        "zones": results[:max_results],
    }
