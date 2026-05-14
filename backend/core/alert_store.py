"""In-memory alert store with file-backed persistence and haversine dedup.

Stores all processed incidents. Alerts within 500m of the same disaster type
are merged into a single alert with an incremented report_count.
"""
from __future__ import annotations

import json
import logging
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from backend.core.config import settings

logger = logging.getLogger(__name__)

DEDUP_RADIUS_KM = 0.5


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


class AlertStore:
    def __init__(self) -> None:
        self.alerts: dict[str, dict[str, Any]] = {}
        self._file = settings.city.data_dir / "alerts.json"
        self._load_from_file()

    def _load_from_file(self) -> None:
        if self._file.exists():
            try:
                with open(self._file) as f:
                    data = json.load(f)
                for a in data:
                    self.alerts[a["id"]] = a
                logger.info("Loaded %d alerts from %s", len(self.alerts), self._file)
            except Exception as e:
                logger.warning("Failed to load alerts: %s", e)

    def _save_to_file(self) -> None:
        try:
            self._file.parent.mkdir(parents=True, exist_ok=True)
            with open(self._file, "w") as f:
                json.dump(list(self.alerts.values()), f, indent=2, default=str)
        except Exception as e:
            logger.warning("Failed to save alerts: %s", e)

    def add(self, data: dict[str, Any]) -> dict[str, Any]:
        """Add or merge an alert. Returns the alert dict."""
        coords = data.get("coordinates")
        dtype = data.get("disaster_type", "unknown")

        if coords:
            for existing in self.alerts.values():
                ec = existing.get("coordinates")
                if not ec:
                    continue
                if existing.get("disaster_type") != dtype:
                    continue
                if haversine(coords[0], coords[1], ec[0], ec[1]) <= DEDUP_RADIUS_KM:
                    existing["report_count"] = existing.get("report_count", 1) + 1
                    existing["severity"] = max(
                        existing.get("severity", 1), data.get("severity", 1)
                    )
                    existing["last_updated"] = datetime.now(timezone.utc).isoformat()
                    self._save_to_file()
                    return existing

        alert_id = f"alert_{uuid.uuid4().hex[:8]}"
        alert = {
            "id": alert_id,
            "report_count": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_updated": datetime.now(timezone.utc).isoformat(),
            **data,
        }
        self.alerts[alert_id] = alert
        self._save_to_file()
        return alert

    def get(self, alert_id: str) -> Optional[dict]:
        return self.alerts.get(alert_id)

    def get_all(self) -> list[dict]:
        return list(self.alerts.values())

    def update(self, alert_id: str, updates: dict) -> Optional[dict]:
        alert = self.alerts.get(alert_id)
        if alert:
            alert.update(updates)
            alert["last_updated"] = datetime.now(timezone.utc).isoformat()
            self._save_to_file()
        return alert

    def update_route(self, alert_id: str, route_data: dict) -> None:
        alert = self.alerts.get(alert_id)
        if alert:
            alert["route"] = route_data
            alert["last_updated"] = datetime.now(timezone.utc).isoformat()
            self._save_to_file()

    def clear(self) -> None:
        self.alerts.clear()
        self._save_to_file()
