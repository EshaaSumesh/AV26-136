"""Centralized configuration loaded from environment variables.

All API keys, city settings, and feature flags live here.
Modules import `settings` from this module instead of reading os.environ directly.
"""
from __future__ import annotations

from typing import Tuple

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env", override=True)


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _env_float(key: str, default: float = 0.0) -> float:
    raw = os.getenv(key)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class CityConfig:
    name: str = _env("CITY_NAME", "Bengaluru")
    lat: float = _env_float("CITY_LAT", 12.9716)
    lng: float = _env_float("CITY_LNG", 77.5946)
    radius_km: float = _env_float("CITY_RADIUS_KM", 30.0)

    @property
    def center(self) -> tuple[float, float]:
        return (self.lat, self.lng)

    @property
    def data_dir(self) -> Path:
        slug = self.name.lower().replace(" ", "_")
        return PROJECT_ROOT / "backend" / "data" / "cities" / slug


@dataclass(frozen=True)
class APIKeys:
    google_cloud_project: str = _env("GOOGLE_CLOUD_PROJECT")
    google_credentials_path: str = _env("GOOGLE_APPLICATION_CREDENTIALS")
    tomtom: str = _env("TOMTOM_API_KEY")
    google_maps: str = _env("GOOGLE_MAPS_API_KEY")
    mapbox: str = _env("MAPBOX_ACCESS_TOKEN")
    gnews: str = _env("GNEWS_API_KEY")

    def require(self, key_name: str) -> str:
        """Return the key value or raise with a clear message."""
        val = getattr(self, key_name, "")
        if not val:
            raise EnvironmentError(
                f"Required API key '{key_name}' is not set. "
                f"Add it to your .env file."
            )
        return val

    def available(self, key_name: str) -> bool:
        return bool(getattr(self, key_name, ""))


@dataclass(frozen=True)
class ServerConfig:
    host: str = _env("HOST", "0.0.0.0")
    port: int = int(_env("PORT", "8000"))
    log_level: str = _env("LOG_LEVEL", "INFO")


@dataclass(frozen=True)
class Settings:
    city: CityConfig = field(default_factory=CityConfig)
    keys: APIKeys = field(default_factory=APIKeys)
    server: ServerConfig = field(default_factory=ServerConfig)

    @property
    def gemini_model(self) -> str:
        # Override via GEMINI_MODEL env var. Defaults to GA Gemini 2.5 Flash.
        return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    @property
    def vertex_locations(self) -> tuple:
        """Pool of Vertex AI regions to round-robin across.

        Each region has an independent (project, region, model) quota bucket,
        so spreading requests multiplies the effective RPM/TPM ceiling.
        Override via VERTEX_LOCATIONS=region1,region2,... env var.
        """
        raw = os.getenv(
            "VERTEX_LOCATIONS",
            "us-central1,us-east1,us-east4,us-east5,us-west1,us-west4,"
            "europe-west1,europe-west4,asia-northeast1,asia-south1,asia-southeast1",
        )
        regions = tuple(r.strip() for r in raw.split(",") if r.strip())
        return regions or ("us-central1",)


settings = Settings()
