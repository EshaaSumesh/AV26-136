"""Hazard zone management routes."""
from __future__ import annotations

from fastapi import APIRouter

from backend.tools.hazard_db import _read_zones

router = APIRouter()


@router.get("/")
async def list_hazards():
    """Return all active hazard zones."""
    zones = _read_zones()
    return {"zone_count": len(zones), "zones": zones}
