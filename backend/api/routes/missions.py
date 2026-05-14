"""Mission management API routes.

Provides endpoints for the Authority dashboard to view active missions,
negotiation history, and mission lifecycle events.
"""
from __future__ import annotations

from fastapi import APIRouter

from backend.core.mission_tracker import get_tracker, MissionStatus

router = APIRouter()


@router.get("/")
async def list_missions(status: str = None):
    """List all missions, optionally filtered by status."""
    tracker = get_tracker()
    if status:
        try:
            target_status = MissionStatus(status)
            missions = [m for m in tracker.all_missions() if m.status == target_status]
        except ValueError:
            return {"error": f"Invalid status: {status}"}
    else:
        missions = tracker.all_missions()
    return {"missions": [m.to_dict() for m in missions]}


@router.get("/active")
async def active_missions():
    """List all currently active missions."""
    tracker = get_tracker()
    return {"missions": [m.to_dict() for m in tracker.active_missions()]}


@router.get("/stats")
async def mission_stats():
    """Mission statistics."""
    tracker = get_tracker()
    return tracker.stats


@router.get("/{mission_id}")
async def get_mission(mission_id: str):
    """Get a specific mission with full negotiation history."""
    tracker = get_tracker()
    mission = tracker.get_mission(mission_id)
    if not mission:
        return {"error": "Mission not found"}
    return mission.to_dict()


@router.get("/{mission_id}/negotiation")
async def get_negotiation_history(mission_id: str):
    """Get just the negotiation history for a mission."""
    tracker = get_tracker()
    mission = tracker.get_mission(mission_id)
    if not mission:
        return {"error": "Mission not found"}
    return {
        "mission_id": mission_id,
        "status": mission.status.value,
        "history": [n.to_dict() for n in mission.negotiation_history],
    }


@router.post("/{mission_id}/complete")
async def complete_mission(mission_id: str):
    """Mark a mission as completed."""
    tracker = get_tracker()
    mission = tracker.update_status(mission_id, MissionStatus.COMPLETED)
    if not mission:
        return {"error": "Mission not found"}
    return {"status": "completed", "mission": mission.to_dict()}
