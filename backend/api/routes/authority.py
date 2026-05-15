"""Authority-facing API routes.

Endpoints for the Authority dashboard: agent logs, missions,
stats, and hazard zone management.
"""
from __future__ import annotations

import os

from fastapi import APIRouter

from backend.core.config import settings
from backend.core.event_bus import get_bus
from backend.core.ws_manager import get_ws
from backend.core.mission_tracker import get_tracker
from backend.core import citizen_store
from backend.tools.resource_db import get_bases_raw

router = APIRouter()


@router.get("/agent-log")
async def get_agent_log(limit: int = 100):
    """Return the most recent agent reasoning and tool-call events."""
    bus = get_bus()
    events = bus.reasoning_history(limit)
    return {"events": [e.to_dict() for e in events]}


@router.get("/stats")
async def get_stats():
    """Return system-wide statistics."""
    bus = get_bus()
    ws = get_ws()
    tracker = get_tracker()
    return {
        "total_events": bus.event_count,
        "authority_connections": ws.authority_count,
        "citizen_connections": ws.citizen_count,
        "connected_citizens": ws.citizen_ids,
        "missions": tracker.stats,
    }


@router.get("/dashboard")
async def dashboard():
    """Full dashboard data: recent events + active missions + stats."""
    bus = get_bus()
    ws = get_ws()
    tracker = get_tracker()
    return {
        "recent_events": [e.to_dict() for e in bus.reasoning_history(50)],
        "active_missions": [m.to_dict() for m in tracker.active_missions()],
        "stats": {
            "total_events": bus.event_count,
            "connections": {
                "authority": ws.authority_count,
                "citizen": ws.citizen_count,
            },
            "missions": tracker.stats,
        },
    }


@router.get("/resources")
async def list_resources():
    """Rescue bases / teams catalogue served from `rescue_bases.json`."""
    bases = get_bases_raw()
    total_teams = sum(int(b.get("teams_available", 0)) for b in bases)
    by_type: dict = {}
    for b in bases:
        t = b.get("type", "other")
        by_type[t] = by_type.get(t, 0) + 1
    return {
        "city": settings.city.name,
        "base_count": len(bases),
        "total_teams_available": total_teams,
        "by_type": by_type,
        "bases": bases,
    }


@router.get("/citizens")
async def list_citizen_reports(limit_per_citizen: int = 5):
    """Snapshot of citizens that have interacted with the system.

    Returned newest-first, with the most recent N reports per citizen so
    the Authority "Reports" view can render an audit log without exposing
    the full history file.
    """
    citizens = citizen_store.list_citizens()

    def _last_seen(c: dict) -> str:
        return c.get("last_seen") or c.get("created_at") or ""

    citizens.sort(key=_last_seen, reverse=True)

    trimmed = []
    total_reports = 0
    total_sos = 0
    for c in citizens:
        reports = c.get("reports", []) or []
        total_reports += int(c.get("report_count", 0))
        total_sos += int(c.get("sos_count", 0))
        trimmed.append(
            {
                "citizen_id": c.get("citizen_id"),
                "created_at": c.get("created_at"),
                "last_seen": c.get("last_seen"),
                "last_location": c.get("last_location"),
                "report_count": int(c.get("report_count", 0)),
                "sos_count": int(c.get("sos_count", 0)),
                "recent_reports": reports[:limit_per_citizen],
            }
        )

    return {
        "citizen_count": len(trimmed),
        "total_reports": total_reports,
        "total_sos": total_sos,
        "citizens": trimmed,
    }


@router.get("/data-feeds")
async def list_data_feeds():
    """Reports the live status of every external data source the agents pull from.

    'configured' = the API key / endpoint is present in env. We do not probe
    the upstream service here — that would block the dashboard and cost RPS;
    actual outages surface as `agent.error` events from the tools that use them.
    """
    cfg = settings

    def _has(env_key: str) -> bool:
        return bool(os.getenv(env_key))

    feeds = [
        {
            "id": "tomtom",
            "name": "TomTom Traffic & Routing",
            "kind": "routing",
            "configured": _has("TOMTOM_API_KEY"),
            "auth": "api-key",
            "purpose": "Live traffic flow + ETA validation for hazard-aware routes.",
            "used_by": ["route_optimizer"],
        },
        {
            "id": "open_meteo",
            "name": "Open-Meteo",
            "kind": "weather",
            "configured": True,  # keyless
            "auth": "none",
            "purpose": "Hourly weather for hazard escalation & re-eval loop.",
            "used_by": ["situation_awareness", "hazard_assessment", "reeval_loop"],
        },
        {
            "id": "gdacs",
            "name": "GDACS",
            "kind": "disaster_alerts",
            "configured": True,  # public RSS
            "auth": "none",
            "purpose": "Global disaster alert corroboration.",
            "used_by": ["situation_awareness"],
        },
        {
            "id": "usgs",
            "name": "USGS Earthquake API",
            "kind": "seismic",
            "configured": True,  # public
            "auth": "none",
            "purpose": "Real-time earthquake feed.",
            "used_by": ["situation_awareness", "hazard_assessment"],
        },
        {
            "id": "gnews",
            "name": "GNews",
            "kind": "news",
            "configured": _has("GNEWS_API_KEY"),
            "auth": "api-key",
            "purpose": "News corroboration for ground-truth signals.",
            "used_by": ["situation_awareness"],
        },
        {
            "id": "google_maps",
            "name": "Google Maps Geocoding",
            "kind": "geocoding",
            "configured": _has("GOOGLE_MAPS_API_KEY"),
            "auth": "api-key",
            "purpose": "Convert citizen-typed locations into coordinates.",
            "used_by": ["situation_awareness"],
        },
        {
            "id": "vertex",
            "name": "Vertex AI · Gemini 2.5 Flash",
            "kind": "llm",
            "configured": bool(cfg.keys.google_cloud_project),
            "auth": "service-account",
            "purpose": "Reasoning + tool-calling brain for every agent.",
            "used_by": [
                "supervisor",
                "situation_awareness",
                "hazard_assessment",
                "dispatch_strategist",
                "route_optimizer",
                "communications",
                "field_commander",
            ],
        },
        {
            "id": "osm_graph",
            "name": "OpenStreetMap Road Graph",
            "kind": "routing",
            "configured": True,  # local pickle
            "auth": "none",
            "purpose": "Hazard-aware shortest-path routing (NetworkX).",
            "used_by": ["route_optimizer"],
        },
    ]
    return {"feed_count": len(feeds), "feeds": feeds}
