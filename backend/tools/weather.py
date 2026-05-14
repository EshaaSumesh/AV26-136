"""Open-Meteo weather tool — real-time precipitation and severe weather.

Free API, no key needed. Returns current conditions + hourly forecast
for the configured city or arbitrary coordinates.
"""
from __future__ import annotations

from typing import Optional

import httpx
from langchain_core.tools import tool

from backend.core.config import settings

OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast"


@tool
def get_weather(lat: Optional[float] = None, lng: Optional[float] = None) -> dict:
    """Fetch real-time weather conditions (precipitation, wind, temperature)
    for given coordinates. Defaults to city center if no coordinates provided.

    Returns precipitation_mm, wind_speed_kmh, temperature_c, weather_code,
    and a human-readable description.
    """
    lat = lat or settings.city.lat
    lng = lng or settings.city.lng

    params = {
        "latitude": lat,
        "longitude": lng,
        "current": "precipitation,rain,temperature_2m,wind_speed_10m,weather_code",
        "hourly": "precipitation_probability,rain",
        "forecast_hours": 6,
        "timezone": "auto",
    }

    try:
        resp = httpx.get(OPEN_METEO_BASE, params=params, timeout=8.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"error": f"Open-Meteo API unreachable: {e}", "available": False}

    current = data.get("current", {})
    hourly = data.get("hourly", {})

    precip = current.get("precipitation", 0.0)
    rain = current.get("rain", 0.0)
    wind = current.get("wind_speed_10m", 0.0)
    temp = current.get("temperature_2m", 0.0)
    code = current.get("weather_code", 0)

    description = _weather_description(code, precip, wind)

    precip_probs = hourly.get("precipitation_probability", [])
    max_precip_prob = max(precip_probs) if precip_probs else 0

    return {
        "available": True,
        "coordinates": [lat, lng],
        "precipitation_mm": precip,
        "rain_mm": rain,
        "wind_speed_kmh": wind,
        "temperature_c": temp,
        "weather_code": code,
        "description": description,
        "flood_risk": precip > 5.0 or rain > 5.0,
        "high_wind": wind > 50.0,
        "forecast_6h_max_precip_probability": max_precip_prob,
    }


def _weather_description(code: int, precip: float, wind: float) -> str:
    if code == 0:
        desc = "Clear sky"
    elif code in (1, 2, 3):
        desc = "Partly cloudy"
    elif code in (45, 48):
        desc = "Foggy"
    elif code in (51, 53, 55):
        desc = "Drizzle"
    elif code in (61, 63, 65):
        desc = "Rain"
    elif code in (71, 73, 75, 77):
        desc = "Snow"
    elif code in (80, 81, 82):
        desc = "Rain showers"
    elif code in (95, 96, 99):
        desc = "Thunderstorm"
    else:
        desc = f"Weather code {code}"

    if precip > 10:
        desc += " (heavy precipitation)"
    if wind > 60:
        desc += " (strong winds)"
    return desc
