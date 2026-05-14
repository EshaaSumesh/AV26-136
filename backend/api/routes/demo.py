"""Demo scenario runner.

Provides pre-scripted scenarios for hackathon demos. Each scenario publishes
a sequence of citizen reports / SOS / external alerts with realistic delays
so the audience can watch the agent pipeline react in real time.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.core.events import Event, EventType
from backend.core.event_bus import get_bus

logger = logging.getLogger(__name__)
router = APIRouter()

# Track currently running demo scenarios to prevent stacking
_active_runs: Dict[str, Dict[str, Any]] = {}
_run_lock = asyncio.Lock()


# --- Scenario definitions ---

SCENARIOS: Dict[str, Dict[str, Any]] = {
    "koramangala_flood": {
        "title": "Koramangala Flash Flood",
        "description": (
            "Two citizens report flooding from nearby locations in Koramangala. "
            "Hazard Agent should correlate them; Communications broadcasts a warning; "
            "Dispatch negotiates with NDRF; Route Optimizer plans around the zone."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_kora_user1",
                    "disaster_type": "flood",
                    "description": (
                        "Severe flooding on 80 Feet Road near Koramangala 4th Block. "
                        "Water rising fast, vehicles stalled, drainage overflowing."
                    ),
                    "coordinates": [12.9352, 77.6245],
                    "severity_hint": 4,
                },
            },
            {
                "delay_s": 12,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_kora_user2",
                    "disaster_type": "flood",
                    "description": (
                        "Confirming flood near Sony World Junction Koramangala. "
                        "Knee-deep water, people stranded at bus stop."
                    ),
                    "coordinates": [12.9343, 77.6195],
                    "severity_hint": 4,
                },
            },
        ],
    },
    "whitefield_fire": {
        "title": "Whitefield Industrial Fire",
        "description": (
            "Major fire at a warehouse. Severity 5. Tests negotiation when "
            "specialized base may be far and Field Commander reasons about capacity."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_whitefield_user",
                    "disaster_type": "fire",
                    "description": (
                        "Large warehouse fire near ITPL Main Road, Whitefield. "
                        "Black smoke visible for kilometers, two adjacent buildings affected."
                    ),
                    "coordinates": [12.9698, 77.7500],
                    "severity_hint": 5,
                },
            },
        ],
    },
    "indiranagar_sos": {
        "title": "Indiranagar SOS — Building Collapse",
        "description": (
            "Citizen triggers SOS during a building collapse. Highest priority. "
            "Tests SOS short-circuit through all five core agents."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "sos",
                "payload": {
                    "citizen_id": "demo_indira_sos",
                    "coordinates": [12.9784, 77.6408],
                    "note": "Building collapsed near 100ft Road Indiranagar. People trapped under debris.",
                    "disaster_type": "building_collapse",
                },
            },
        ],
    },
}


class ScenarioRequest(BaseModel):
    scenario_id: str
    run_id: Optional[str] = None


@router.get("/scenarios")
async def list_scenarios():
    """List available demo scenarios."""
    return {
        "scenarios": [
            {
                "id": sid,
                "title": s["title"],
                "description": s["description"],
                "step_count": len(s["steps"]),
            }
            for sid, s in SCENARIOS.items()
        ]
    }


@router.get("/status")
async def demo_status():
    """Return list of currently running demo scenarios."""
    async with _run_lock:
        return {"active": list(_active_runs.values())}


@router.post("/run")
async def run_scenario(req: ScenarioRequest):
    """Trigger a demo scenario asynchronously.

    Refuses to start a new run if another scenario is already in progress —
    Gemini quotas are tight and stacking pipelines blows the budget.
    """
    scenario = SCENARIOS.get(req.scenario_id)
    if not scenario:
        return {"error": f"Unknown scenario: {req.scenario_id}"}

    async with _run_lock:
        if _active_runs:
            running = list(_active_runs.values())[0]
            return {
                "accepted": False,
                "reason": "another_scenario_running",
                "active": running,
                "message": (
                    f"Scenario '{running['scenario_id']}' is still running "
                    f"(started {running['started_at']}). Wait for it to finish "
                    f"to avoid Gemini quota exhaustion."
                ),
            }
        run_id = req.run_id or f"run_{uuid.uuid4().hex[:8]}"
        _active_runs[run_id] = {
            "run_id": run_id,
            "scenario_id": req.scenario_id,
            "title": scenario["title"],
            "started_at": _now_iso(),
        }

    asyncio.create_task(_execute_scenario(req.scenario_id, scenario, run_id))

    return {
        "accepted": True,
        "run_id": run_id,
        "scenario_id": req.scenario_id,
        "title": scenario["title"],
        "step_count": len(scenario["steps"]),
    }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def _execute_scenario(scenario_id: str, scenario: dict, run_id: str):
    """Run a scenario's steps with their configured delays.

    Holds the run in `_active_runs` for the duration of step dispatch PLUS
    a cooldown window so back-to-back clicks can't stack Gemini calls.
    """
    bus = get_bus()
    logger.info("Demo scenario '%s' started (run_id=%s)", scenario_id, run_id)

    try:
        for idx, step in enumerate(scenario["steps"]):
            delay = step.get("delay_s", 0)
            if delay > 0:
                await asyncio.sleep(delay)

            kind = step["kind"]
            payload = dict(step["payload"])
            payload["demo_run_id"] = run_id
            payload["demo_step"] = idx + 1

            if kind == "citizen_report":
                await bus.publish(Event(
                    type=EventType.CITIZEN_REPORT_SUBMITTED,
                    payload=payload,
                    source_agent=f"demo.{payload.get('citizen_id', 'unknown')}",
                ))
            elif kind == "sos":
                await bus.publish(Event(
                    type=EventType.SOS_TRIGGERED,
                    payload=payload,
                    source_agent=f"demo.{payload.get('citizen_id', 'unknown')}",
                ))
            elif kind == "external_alert":
                await bus.publish(Event(
                    type=EventType.EXTERNAL_ALERT_RECEIVED,
                    payload=payload,
                    source_agent="demo.external",
                ))
            else:
                logger.warning("Unknown demo step kind: %s", kind)

        logger.info("Demo scenario '%s' steps dispatched (run_id=%s)", scenario_id, run_id)
        # Cooldown — let the agent pipeline finish before allowing a new run
        await asyncio.sleep(45)
    finally:
        async with _run_lock:
            _active_runs.pop(run_id, None)
        logger.info("Demo scenario '%s' run slot released (run_id=%s)", scenario_id, run_id)
