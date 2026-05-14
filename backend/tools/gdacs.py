"""GDACS (Global Disaster Alert and Coordination System) tool.

Free API, no key needed. Provides real-time earthquake, flood, cyclone,
drought, and volcano alerts worldwide. We filter for events near the
configured city.
"""
from __future__ import annotations

from typing import Optional

import httpx
from langchain_core.tools import tool

from backend.core.config import settings
from backend.tools.osm_router import haversine

GDACS_API = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"


@tool
def get_gdacs_alerts(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: Optional[float] = None,
    limit: int = 10,
) -> dict:
    """Fetch recent disaster alerts from GDACS (earthquakes, floods, cyclones, etc.)
    near the given coordinates.

    Defaults to the configured city center and radius if not specified.
    Returns alerts with type, severity, coordinates, affected area, and description.
    """
    lat = lat or settings.city.lat
    lng = lng or settings.city.lng
    radius_km = radius_km or settings.city.radius_km

    try:
        resp = httpx.get(
            GDACS_API,
            params={"alertlevel": "Green;Orange;Red", "limit": 50},
            timeout=10.0,
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"error": f"GDACS API unreachable: {e}", "available": False}

    features = data.get("features", [])
    nearby = []

    for feature in features:
        geom = feature.get("geometry", {})
        coords = geom.get("coordinates", [])
        if len(coords) < 2:
            continue

        event_lng, event_lat = coords[0], coords[1]
        dist = haversine(lat, lng, event_lat, event_lng)

        if dist <= radius_km:
            props = feature.get("properties", {})
            nearby.append({
                "event_id": props.get("eventid"),
                "event_type": props.get("eventtype", "unknown"),
                "alert_level": props.get("alertlevel", "unknown"),
                "severity": props.get("severity", {}).get("severity", "unknown"),
                "name": props.get("name", ""),
                "description": props.get("description", ""),
                "coordinates": [event_lat, event_lng],
                "distance_km": round(dist, 1),
                "country": props.get("country", ""),
                "from_date": props.get("fromdate"),
                "to_date": props.get("todate"),
                "population_affected": props.get("population", {}).get("value"),
            })

    nearby.sort(key=lambda x: x["distance_km"])

    return {
        "available": True,
        "alert_count": len(nearby[:limit]),
        "search_center": [lat, lng],
        "search_radius_km": radius_km,
        "alerts": nearby[:limit],
    }
