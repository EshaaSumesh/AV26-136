"""Citizen identity + report-history store.

A minimal JSON-backed registry that tracks each ``citizen_id`` (assigned by
the frontend and persisted in localStorage), their last known location, and
the chronological list of reports/SOS they have submitted. Used to power
``GET /citizen/{citizen_id}/history`` and to enrich agent context with the
citizen's prior activity.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.config import settings

logger = logging.getLogger(__name__)

_lock = threading.Lock()

# Cap how many reports we retain per citizen — prevents unbounded growth.
MAX_HISTORY_PER_CITIZEN = 50


def _store_path() -> Path:
    return settings.city.data_dir / "citizens.json"


def _read_all() -> Dict[str, Any]:
    p = _store_path()
    if not p.exists():
        return {}
    try:
        with open(p) as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("citizen store unreadable: %s", exc)
        return {}


def _write_all(data: Dict[str, Any]) -> None:
    try:
        p = _store_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w") as f:
            json.dump(data, f, indent=2, default=str)
    except Exception as exc:
        logger.warning("citizen store write failed: %s", exc)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_citizen(citizen_id: str) -> dict:
    """Create the citizen record on first sighting; return it."""
    with _lock:
        all_data = _read_all()
        rec = all_data.get(citizen_id)
        if rec is None:
            rec = {
                "citizen_id": citizen_id,
                "created_at": _now(),
                "last_seen": _now(),
                "last_location": None,
                "report_count": 0,
                "sos_count": 0,
                "reports": [],
            }
            all_data[citizen_id] = rec
            _write_all(all_data)
        return rec


def update_location(citizen_id: str, lat: float, lng: float) -> None:
    with _lock:
        all_data = _read_all()
        rec = all_data.get(citizen_id) or {
            "citizen_id": citizen_id,
            "created_at": _now(),
            "report_count": 0,
            "sos_count": 0,
            "reports": [],
        }
        rec["last_location"] = {"lat": lat, "lng": lng}
        rec["last_seen"] = _now()
        all_data[citizen_id] = rec
        _write_all(all_data)


def record_report(citizen_id: str, entry: Dict[str, Any]) -> dict:
    """Append a report/SOS entry to the citizen's history."""
    with _lock:
        all_data = _read_all()
        rec = all_data.get(citizen_id) or {
            "citizen_id": citizen_id,
            "created_at": _now(),
            "report_count": 0,
            "sos_count": 0,
            "reports": [],
        }
        item = {
            "submitted_at": _now(),
            **entry,
        }
        rec["reports"].insert(0, item)
        rec["reports"] = rec["reports"][:MAX_HISTORY_PER_CITIZEN]
        if entry.get("kind") == "sos":
            rec["sos_count"] = rec.get("sos_count", 0) + 1
        else:
            rec["report_count"] = rec.get("report_count", 0) + 1
        rec["last_seen"] = _now()
        if entry.get("coordinates"):
            c = entry["coordinates"]
            try:
                rec["last_location"] = {"lat": float(c[0]), "lng": float(c[1])}
            except (TypeError, ValueError, IndexError):
                pass
        all_data[citizen_id] = rec
        _write_all(all_data)
        return item


def update_report_outcome(
    citizen_id: str, incident_id: str, **updates: Any
) -> None:
    """Patch a single report entry, identified by incident_id."""
    if not citizen_id or not incident_id:
        return
    with _lock:
        all_data = _read_all()
        rec = all_data.get(citizen_id)
        if not rec:
            return
        for r in rec.get("reports", []):
            if r.get("incident_id") == incident_id:
                r.update(updates)
                break
        all_data[citizen_id] = rec
        _write_all(all_data)


def get_citizen(citizen_id: str) -> Optional[dict]:
    return _read_all().get(citizen_id)


def list_citizens() -> List[dict]:
    return list(_read_all().values())
