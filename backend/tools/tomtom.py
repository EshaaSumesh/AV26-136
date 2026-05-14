"""TomTom Traffic Flow + Routing tools — primary traffic data source.

Uses TomTom's free-tier APIs:
- Traffic Flow: real-time speed/congestion on road segments
- Routing: turn-by-turn route with traffic-aware ETA
- Incidents: accidents, road closures, construction
"""
from __future__ import annotations

from typing import List, Optional

import httpx
from langchain_core.tools import tool

from backend.core.config import settings

TOMTOM_BASE = "https://api.tomtom.com"


def _tomtom_key() -> str:
    return settings.keys.require("tomtom")


@tool
def get_traffic_flow(lat: float, lng: float) -> dict:
    """Get real-time traffic flow data for a road segment near the given coordinates.

    Returns current speed, free flow speed, congestion level, and confidence.
    Use this to check if a specific road segment is congested.
    """
    key = _tomtom_key()
    url = (
        f"{TOMTOM_BASE}/traffic/services/4/flowSegmentData/"
        f"absolute/10/json"
    )
    params = {"point": f"{lat},{lng}", "key": key, "unit": "KMPH"}

    try:
        resp = httpx.get(url, params=params, timeout=8.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"error": f"TomTom Traffic Flow API error: {e}", "available": False}

    flow = data.get("flowSegmentData", {})
    current_speed = flow.get("currentSpeed", 0)
    free_flow = flow.get("freeFlowSpeed", 0)

    congestion = 0.0
    if free_flow > 0:
        congestion = round(1.0 - (current_speed / free_flow), 2)

    return {
        "available": True,
        "coordinates": [lat, lng],
        "current_speed_kmh": current_speed,
        "free_flow_speed_kmh": free_flow,
        "congestion_ratio": congestion,
        "congestion_level": (
            "severe" if congestion > 0.6
            else "moderate" if congestion > 0.3
            else "light" if congestion > 0.1
            else "free_flow"
        ),
        "confidence": flow.get("confidence", 0),
        "road_closure": flow.get("roadClosure", False),
    }


@tool
def get_tomtom_route(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    avoid_areas: Optional[List[dict]] = None,
) -> dict:
    """Calculate a route using TomTom Routing API with real-time traffic.

    Returns path coordinates, distance, ETA with traffic, and travel time
    without traffic for comparison. Use this to validate ETAs from OSM routing.

    avoid_areas: optional list of {"lat": float, "lng": float, "radius_m": int}
    """
    key = _tomtom_key()
    url = (
        f"{TOMTOM_BASE}/routing/1/calculateRoute/"
        f"{origin_lat},{origin_lng}:{dest_lat},{dest_lng}/json"
    )
    params = {
        "key": key,
        "traffic": "true",
        "travelMode": "car",
        "routeType": "fastest",
        "maxAlternatives": 2,
    }

    if avoid_areas:
        # TomTom expects rectangles, not circles: minLat,minLon:maxLat,maxLon
        # joined with ':' and multiple rectangles joined with ':' as well.
        # We convert each (lat,lng,radius_m) into an approximate bbox.
        rects = []
        for area in avoid_areas[:5]:
            try:
                lat = float(area["lat"])
                lng = float(area["lng"])
                radius_m = float(area.get("radius_m", 500))
            except (KeyError, TypeError, ValueError):
                continue
            # ~111_320 m per degree latitude; longitude scaled by cos(lat)
            import math
            dlat = radius_m / 111_320.0
            dlng = radius_m / (111_320.0 * max(math.cos(math.radians(lat)), 0.01))
            rects.append(
                f"{lat - dlat:.6f},{lng - dlng:.6f}:{lat + dlat:.6f},{lng + dlng:.6f}"
            )
        if rects:
            # TomTom delimits multiple bounding boxes with ':' between rects too,
            # which is ambiguous with the in-rect ':'. Their API actually
            # accepts a single rectangle reliably; for multiple, the safest
            # approach is to send just the most relevant one.
            params["avoidAreas"] = rects[0]

    try:
        resp = httpx.get(url, params=params, timeout=12.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"error": f"TomTom Routing API error: {e}", "available": False}

    routes = data.get("routes", [])
    if not routes:
        return {"available": True, "found": False, "note": "No route found by TomTom"}

    results = []
    for i, route in enumerate(routes):
        summary = route.get("summary", {})
        legs = route.get("legs", [])
        points = []
        for leg in legs:
            for pt in leg.get("points", []):
                points.append([pt["latitude"], pt["longitude"]])

        results.append({
            "label": f"TomTom route {i + 1}",
            "path": points,
            "distance_km": round(summary.get("lengthInMeters", 0) / 1000, 2),
            "eta_minutes_with_traffic": round(
                summary.get("travelTimeInSeconds", 0) / 60, 1
            ),
            "eta_minutes_no_traffic": round(
                summary.get("noTrafficTravelTimeInSeconds", 0) / 60, 1
            ),
            "traffic_delay_minutes": round(
                summary.get("trafficDelayInSeconds", 0) / 60, 1
            ),
            "departure_time": summary.get("departureTime"),
            "arrival_time": summary.get("arrivalTime"),
        })

    return {
        "available": True,
        "found": True,
        "route_count": len(results),
        "routes": results,
    }


@tool
def get_traffic_incidents(
    lat: float, lng: float, radius_km: float = 5.0
) -> dict:
    """Get real-time traffic incidents (accidents, road closures, construction)
    near given coordinates.

    Returns a list of incidents with type, severity, location, and description.
    """
    key = _tomtom_key()
    delta = radius_km / 111.0
    bbox = f"{lng - delta},{lat - delta},{lng + delta},{lat + delta}"

    url = f"{TOMTOM_BASE}/traffic/services/5/incidentDetails"
    params = {
        "key": key,
        "bbox": bbox,
        "fields": (
            "{incidents{type,geometry{type,coordinates},"
            "properties{iconCategory,magnitudeOfDelay,events{description},"
            "startTime,endTime,from,to}}}"
        ),
        "language": "en-US",
    }

    try:
        resp = httpx.get(url, params=params, timeout=8.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"error": f"TomTom Incidents API error: {e}", "available": False}

    incidents = data.get("incidents", [])
    results = []
    for inc in incidents[:20]:
        props = inc.get("properties", {})
        geom = inc.get("geometry", {})
        coords = geom.get("coordinates", [])
        point = coords[0] if coords else None

        events = props.get("events", [])
        descriptions = [ev.get("description", "") for ev in events]

        results.append({
            "type": props.get("iconCategory", "unknown"),
            "delay_magnitude": props.get("magnitudeOfDelay", 0),
            "from_road": props.get("from", ""),
            "to_road": props.get("to", ""),
            "description": "; ".join(descriptions),
            "coordinates": [point[1], point[0]] if point else None,
            "start_time": props.get("startTime"),
            "end_time": props.get("endTime"),
        })

    return {
        "available": True,
        "incident_count": len(results),
        "incidents": results,
    }
