"""USGS Earthquake API tool — real-time seismic event data.

Free, no key needed. Provides earthquake events with magnitude,
depth, location, and tsunami potential.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from langchain_core.tools import tool

from backend.core.config import settings
from backend.tools.osm_router import haversine

USGS_BASE = "https://earthquake.usgs.gov/fdsnws/event/1/query"


@tool
def get_recent_earthquakes(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: Optional[float] = None,
    min_magnitude: float = 2.0,
    hours_back: int = 24,
) -> dict:
    """Fetch recent earthquakes near given coordinates from USGS.

    Returns events with magnitude, depth, coordinates, and tsunami advisory status.
    Defaults to city center if no coordinates provided.
    """
    lat = lat or settings.city.lat
    lng = lng or settings.city.lng
    radius_km = radius_km or settings.city.radius_km

    start_time = (
        datetime.now(timezone.utc) - timedelta(hours=hours_back)
    ).strftime("%Y-%m-%dT%H:%M:%S")

    params = {
        "format": "geojson",
        "latitude": lat,
        "longitude": lng,
        "maxradiuskm": min(radius_km, 500),
        "minmagnitude": min_magnitude,
        "starttime": start_time,
        "orderby": "time",
        "limit": 20,
    }

    try:
        resp = httpx.get(USGS_BASE, params=params, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"error": f"USGS API unreachable: {e}", "available": False}

    features = data.get("features", [])
    events = []

    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry", {})
        coords = geom.get("coordinates", [])
        if len(coords) < 3:
            continue

        event_lng, event_lat, depth = coords[0], coords[1], coords[2]
        dist = haversine(lat, lng, event_lat, event_lng)

        events.append({
            "magnitude": props.get("mag"),
            "place": props.get("place", ""),
            "time": props.get("time"),
            "coordinates": [event_lat, event_lng],
            "depth_km": round(depth, 1),
            "distance_km": round(dist, 1),
            "tsunami": bool(props.get("tsunami")),
            "significance": props.get("sig", 0),
            "alert_level": props.get("alert"),
            "url": props.get("url"),
        })

    return {
        "available": True,
        "event_count": len(events),
        "search_center": [lat, lng],
        "search_radius_km": radius_km,
        "events": events,
    }
