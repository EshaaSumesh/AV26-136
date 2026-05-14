"""Authority-facing API routes.

Endpoints for the Authority dashboard: agent logs, missions,
stats, and hazard zone management.
"""
from __future__ import annotations

from fastapi import APIRouter

from backend.core.event_bus import get_bus
from backend.core.ws_manager import get_ws
from backend.core.mission_tracker import get_tracker

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
