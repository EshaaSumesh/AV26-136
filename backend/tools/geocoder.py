"""Geocoding tool — resolve location text to coordinates.

Two-tier approach:
1. Google Maps Geocoding (if key available) — best for Indian addresses
2. OSM Nominatim (free fallback) — decent global coverage
"""
from __future__ import annotations

import httpx
from langchain_core.tools import tool

from backend.core.config import settings

NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search"
GOOGLE_GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json"


@tool
def geocode_location(location_text: str) -> dict:
    """Convert a location name or address into GPS coordinates.

    Tries Google Maps Geocoding first (if API key available), then
    falls back to OpenStreetMap Nominatim.

    Returns coordinates, formatted address, confidence tier (1=Google, 2=Nominatim),
    and whether geocoding succeeded.
    """
    if not location_text or not location_text.strip():
        return {
            "success": False,
            "coordinates": None,
            "error": "Empty location text provided",
        }

    city = settings.city.name
    query = location_text.strip()
    if city.lower() not in query.lower():
        query = f"{query}, {city}"

    if settings.keys.available("google_maps"):
        result = _google_geocode(query)
        if result["success"]:
            return result

    return _nominatim_geocode(query)


def _google_geocode(query: str) -> dict:
    try:
        resp = httpx.get(
            GOOGLE_GEOCODE_BASE,
            params={"address": query, "key": settings.keys.google_maps},
            timeout=8.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"success": False, "coordinates": None, "error": f"Google Geocoding error: {e}"}

    results = data.get("results", [])
    if not results:
        return {"success": False, "coordinates": None, "error": "No results from Google"}

    loc = results[0]["geometry"]["location"]
    return {
        "success": True,
        "coordinates": [loc["lat"], loc["lng"]],
        "formatted_address": results[0].get("formatted_address", ""),
        "tier": 1,
        "source": "google",
    }


def _nominatim_geocode(query: str) -> dict:
    try:
        resp = httpx.get(
            NOMINATIM_BASE,
            params={"q": query, "format": "json", "limit": 1},
            headers={"User-Agent": "ResQRoute/1.0"},
            timeout=8.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"success": False, "coordinates": None, "error": f"Nominatim error: {e}"}

    if not data:
        return {
            "success": False,
            "coordinates": None,
            "error": f"No geocoding results for '{query}'",
        }

    result = data[0]
    return {
        "success": True,
        "coordinates": [float(result["lat"]), float(result["lon"])],
        "formatted_address": result.get("display_name", ""),
        "tier": 2,
        "source": "nominatim",
    }
