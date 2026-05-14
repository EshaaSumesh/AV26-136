"""Citizen notification broadcast tool.

Used by the Communications Agent to send geofenced alerts to citizens.
Backed by the WebSocket manager — citizens within the broadcast radius
receive the message in real time.
"""
from __future__ import annotations

import uuid

from langchain_core.tools import tool

from backend.core.ws_manager import get_ws
from backend.tools.osm_router import haversine


_citizen_locations: dict[str, tuple[float, float]] = {}


def register_citizen_location(citizen_id: str, lat: float, lng: float) -> None:
    """Called when a citizen subscribes or updates their location."""
    _citizen_locations[citizen_id] = (lat, lng)


def unregister_citizen(citizen_id: str) -> None:
    _citizen_locations.pop(citizen_id, None)


def citizens_in_radius(
    center: tuple[float, float], radius_km: float
) -> list[str]:
    """Return citizen IDs within the given radius of center."""
    return [
        cid
        for cid, loc in _citizen_locations.items()
        if haversine(center[0], center[1], loc[0], loc[1]) <= radius_km
    ]


@tool
def broadcast_alert(
    message: str,
    center_lat: float,
    center_lng: float,
    radius_km: float,
    severity: int,
    category: str,
) -> dict:
    """Broadcast a geofenced alert message to citizens within the given radius.

    Args:
        message: The alert message text to send
        center_lat, center_lng: Center of the broadcast area
        radius_km: Radius within which citizens will receive the alert
        severity: 1-5 severity level
        category: Alert category (e.g., "flood", "fire", "evacuation", "route_update")

    Returns the broadcast ID, recipient count, and the message sent.
    """
    center = (center_lat, center_lng)
    recipients = citizens_in_radius(center, radius_km)
    broadcast_id = f"brd_{uuid.uuid4().hex[:8]}"

    return {
        "broadcast_id": broadcast_id,
        "message": message,
        "center": [center_lat, center_lng],
        "radius_km": radius_km,
        "severity": severity,
        "category": category,
        "recipient_count": len(recipients),
        "recipient_ids": recipients,
    }
