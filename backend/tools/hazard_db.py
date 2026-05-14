"""Hazard zone database tool — read/write active hazard zones.

Agents use these tools to query existing hazard zones, create new ones,
or update/clear them. Backed by a JSON file per city.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Optional

from langchain_core.tools import tool

from backend.core.config import settings
from backend.tools.osm_router import haversine

logger = logging.getLogger(__name__)


def _hazard_file() -> Path:
    return settings.city.data_dir / "hazard_zones.json"


def _read_zones() -> list[dict]:
    path = _hazard_file()
    if not path.exists():
        return []
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return []


def _write_zones(zones: list[dict]) -> None:
    path = _hazard_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(zones, f, indent=2, default=str)


@tool
def get_hazard_zones(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: Optional[float] = None,
) -> dict:
    """Get all active hazard zones, optionally filtered by proximity to coordinates.

    Returns hazard zones with id, type, label, geometry, severity, and status.
    If no coordinates given, returns all zones.
    """
    zones = _read_zones()

    if lat is not None and lng is not None:
        radius = radius_km or 10.0
        nearby = []
        for z in zones:
            center = z.get("geometry", {}).get("center")
            if not center:
                continue
            dist = haversine(lat, lng, center[0], center[1])
            if dist <= radius + z.get("geometry", {}).get("radius_km", 0):
                nearby.append({**z, "distance_km": round(dist, 2)})
        return {"zone_count": len(nearby), "zones": nearby}

    return {"zone_count": len(zones), "zones": zones}


@tool
def create_hazard_zone(
    disaster_type: str,
    center_lat: float,
    center_lng: float,
    radius_km: float,
    severity: str,
    label: str,
    blocked: bool = False,
    penalty_multiplier: Optional[float] = None,
) -> dict:
    """Create a new hazard zone and persist it.

    Args:
        disaster_type: flood, fire, earthquake, building_collapse, etc.
        center_lat, center_lng: Center coordinates of the hazard zone
        radius_km: Radius of the affected area
        severity: "low", "medium", "high", or "critical"
        label: Human-readable description
        blocked: If True, routes will completely avoid this zone
        penalty_multiplier: If set, routes through this zone will be penalized (e.g., 3.0 = 3x slower)

    Returns the created zone with its generated ID.
    """
    zones = _read_zones()
    zone_id = f"hz_{uuid.uuid4().hex[:8]}"

    zone = {
        "id": zone_id,
        "type": disaster_type,
        "label": label,
        "geometry": {
            "type": "circle",
            "center": [center_lat, center_lng],
            "radius_km": radius_km,
        },
        "severity": severity,
        "blocked": blocked,
        "color": _severity_color(severity),
    }
    if penalty_multiplier is not None:
        zone["penalty_multiplier"] = penalty_multiplier

    zones.append(zone)
    _write_zones(zones)
    logger.info("Created hazard zone %s: %s", zone_id, label)

    return {"created": True, "zone": zone}


@tool
def update_hazard_zone(zone_id: str, updates: dict) -> dict:
    """Update an existing hazard zone's properties.

    Pass any fields to update: severity, blocked, penalty_multiplier, label, etc.
    """
    zones = _read_zones()
    for z in zones:
        if z["id"] == zone_id:
            z.update(updates)
            _write_zones(zones)
            return {"updated": True, "zone": z}

    return {"updated": False, "error": f"Zone {zone_id} not found"}


@tool
def clear_hazard_zone(zone_id: str) -> dict:
    """Remove a hazard zone (mark disaster as cleared)."""
    zones = _read_zones()
    original_count = len(zones)
    zones = [z for z in zones if z["id"] != zone_id]

    if len(zones) < original_count:
        _write_zones(zones)
        return {"cleared": True, "zone_id": zone_id}

    return {"cleared": False, "error": f"Zone {zone_id} not found"}


def _severity_color(severity: str) -> str:
    return {
        "critical": "#ff0000",
        "high": "#ff4444",
        "medium": "#ffaa00",
        "low": "#ffee00",
    }.get(severity, "#888888")
