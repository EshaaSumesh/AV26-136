"""Citizen-facing API routes.

Endpoints for the Citizen mode: submit reports, trigger SOS,
fetch nearby alerts, request safe routes, subscribe to notifications,
upload incident photos, and retrieve a citizen's report history.
"""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from backend.core import citizen_store
from backend.core.event_bus import get_bus
from backend.core.events import Event, EventType
from backend.core.image_store import get_image_meta, save_image
from backend.tools.broadcast import register_citizen_location, unregister_citizen

router = APIRouter()


class CitizenReport(BaseModel):
    citizen_id: str
    disaster_type: str
    description: str
    location_text: Optional[str] = None
    coordinates: Optional[List[float]] = None
    severity_hint: int = 3
    image_id: Optional[str] = None


class SOSPayload(BaseModel):
    citizen_id: str
    coordinates: List[float]
    note: Optional[str] = None
    disaster_type: Optional[str] = "sos_distress"
    image_id: Optional[str] = None


class SubscribePayload(BaseModel):
    citizen_id: str
    lat: float
    lng: float


@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    citizen_id: Optional[str] = Form(None),
):
    """Upload a disaster photo. Returns ``image_id`` to attach to a report."""
    try:
        content = await file.read()
        meta = save_image(content, file.content_type or "", citizen_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if citizen_id:
        citizen_store.ensure_citizen(citizen_id)
    return {
        "image_id": meta["image_id"],
        "url": meta["url"],
        "content_type": meta["content_type"],
        "size_bytes": meta["size_bytes"],
    }


@router.post("/report")
async def submit_report(report: CitizenReport):
    """Submit a citizen disaster report into the agent pipeline."""
    citizen_store.ensure_citizen(report.citizen_id)

    image_meta = None
    if report.image_id:
        image_meta = get_image_meta(report.image_id)

    # Allocate the incident_id here so the citizen-history entry can be
    # linked to the eventual pipeline outcome via update_report_outcome().
    incident_id = f"inc_{uuid.uuid4().hex[:8]}"

    bus = get_bus()
    await bus.publish(
        Event(
            type=EventType.CITIZEN_REPORT_SUBMITTED,
            payload={
                "citizen_id": report.citizen_id,
                "disaster_type": report.disaster_type,
                "description": report.description,
                "location_text": report.location_text,
                "coordinates": report.coordinates,
                "severity_hint": report.severity_hint,
                "image_id": report.image_id,
                "image_url": image_meta["url"] if image_meta else None,
                "incident_id": incident_id,
            },
            source_agent=f"citizen.{report.citizen_id}",
        )
    )

    history_entry = citizen_store.record_report(
        report.citizen_id,
        {
            "kind": "report",
            "incident_id": incident_id,
            "disaster_type": report.disaster_type,
            "description": report.description,
            "location_text": report.location_text,
            "coordinates": report.coordinates,
            "severity_hint": report.severity_hint,
            "image_id": report.image_id,
            "image_url": image_meta["url"] if image_meta else None,
            "status": "submitted",
        },
    )
    return {
        "accepted": True,
        "message": "Report submitted to agent pipeline",
        "incident_id": incident_id,
        "history_entry": history_entry,
    }


@router.post("/sos")
async def trigger_sos(sos: SOSPayload):
    """Trigger an SOS distress signal — highest priority."""
    citizen_store.ensure_citizen(sos.citizen_id)
    image_meta = get_image_meta(sos.image_id) if sos.image_id else None
    incident_id = f"inc_{uuid.uuid4().hex[:8]}"
    bus = get_bus()
    await bus.publish(
        Event(
            type=EventType.SOS_TRIGGERED,
            payload={
                "citizen_id": sos.citizen_id,
                "coordinates": sos.coordinates,
                "note": sos.note,
                "disaster_type": sos.disaster_type or "sos_distress",
                "image_id": sos.image_id,
                "image_url": image_meta["url"] if image_meta else None,
                "incident_id": incident_id,
            },
            source_agent=f"citizen.{sos.citizen_id}",
        )
    )
    citizen_store.record_report(
        sos.citizen_id,
        {
            "kind": "sos",
            "incident_id": incident_id,
            "disaster_type": sos.disaster_type or "sos_distress",
            "description": sos.note,
            "coordinates": sos.coordinates,
            "severity_hint": 5,
            "image_id": sos.image_id,
            "image_url": image_meta["url"] if image_meta else None,
            "status": "submitted",
        },
    )
    return {"accepted": True, "message": "SOS dispatched to agents", "incident_id": incident_id}


@router.get("/nearby")
async def get_nearby(lat: float, lng: float, radius_km: float = 3.0):
    """Return alerts and hazards near a citizen's location."""
    from backend.core.alert_store import AlertStore
    from backend.tools.hazard_db import _read_zones
    from backend.tools.osm_router import haversine

    store = AlertStore()
    alerts = store.get_all()
    out_alerts = []
    for a in alerts:
        coords = a.get("coordinates")
        if not coords:
            continue
        d = haversine(lat, lng, coords[0], coords[1])
        if d <= radius_km:
            out_alerts.append({**a, "distance_km": round(d, 2)})

    zones = _read_zones()
    nearby_hazards = []
    for h in zones:
        center = h.get("geometry", {}).get("center")
        if not center:
            continue
        d = haversine(lat, lng, center[0], center[1])
        zone_radius = h.get("geometry", {}).get("radius_km", 0)
        if d <= radius_km + zone_radius:
            nearby_hazards.append({**h, "distance_km": round(d, 2)})

    return {"alerts": out_alerts, "hazards": nearby_hazards}


@router.post("/subscribe")
async def subscribe(payload: SubscribePayload):
    """Register citizen location for geofenced notifications."""
    register_citizen_location(payload.citizen_id, payload.lat, payload.lng)
    citizen_store.ensure_citizen(payload.citizen_id)
    citizen_store.update_location(payload.citizen_id, payload.lat, payload.lng)
    return {"subscribed": True}


@router.post("/unsubscribe")
async def unsubscribe(citizen_id: str):
    unregister_citizen(citizen_id)
    return {"unsubscribed": True}


@router.get("/{citizen_id}/profile")
async def citizen_profile(citizen_id: str):
    """Return the citizen's profile (creation date, totals, last location)."""
    rec = citizen_store.ensure_citizen(citizen_id)
    profile = {k: v for k, v in rec.items() if k != "reports"}
    return profile


@router.get("/{citizen_id}/history")
async def citizen_history(citizen_id: str, limit: int = 20):
    """Return the citizen's most recent reports (newest first)."""
    rec = citizen_store.get_citizen(citizen_id)
    if rec is None:
        return {"citizen_id": citizen_id, "reports": [], "exists": False}
    return {
        "citizen_id": citizen_id,
        "exists": True,
        "report_count": rec.get("report_count", 0),
        "sos_count": rec.get("sos_count", 0),
        "created_at": rec.get("created_at"),
        "last_seen": rec.get("last_seen"),
        "last_location": rec.get("last_location"),
        "reports": rec.get("reports", [])[:limit],
    }
