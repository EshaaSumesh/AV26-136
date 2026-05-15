"""Demo scenario runner.

Provides pre-scripted scenarios for hackathon demos. Each scenario publishes
a sequence of citizen reports / SOS / external alerts with realistic delays
so the audience can watch the agent pipeline react in real time.
"""
from __future__ import annotations

import asyncio
import logging
import mimetypes
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.core.config import settings
from backend.core.events import Event, EventType
from backend.core.event_bus import get_bus
from backend.core import image_store

logger = logging.getLogger(__name__)
router = APIRouter()

# Track currently running demo scenarios to prevent stacking
_active_runs: Dict[str, Dict[str, Any]] = {}
_run_lock = asyncio.Lock()


# ── Demo asset registry ─────────────────────────────────────────────────
# Map stable asset names → on-disk file under data/cities/<city>/demo_assets/
# On first use of an asset, we copy it into the regular upload store so the
# Vision agent can analyse it like any citizen-uploaded photo.

_DEMO_ASSETS: Dict[str, str] = {
    "flood_street": "flood_chennai_2015.jpg",
    "flood_neighborhood": "flood_hyderabad_2020.jpg",
    "hail_car_damage": "hail_damage_perth_2010.jpg",
}

# Resolved {asset_name -> image_id} cache, populated on first lookup.
_resolved_assets: Dict[str, str] = {}
_assets_lock = asyncio.Lock()


def _demo_assets_dir() -> Path:
    return settings.city.data_dir / "demo_assets"


async def _resolve_demo_image(asset_name: Optional[str]) -> Optional[str]:
    """Return a stable image_id for a demo asset, importing it on first use."""
    if not asset_name:
        return None
    filename = _DEMO_ASSETS.get(asset_name)
    if not filename:
        logger.warning("demo asset %s is not registered", asset_name)
        return None

    async with _assets_lock:
        cached = _resolved_assets.get(asset_name)
        if cached and image_store.get_image_meta(cached):
            return cached

        path = _demo_assets_dir() / filename
        if not path.exists():
            logger.warning("demo asset file missing: %s", path)
            return None

        try:
            content = path.read_bytes()
        except Exception as exc:
            logger.warning("could not read demo asset %s: %s", path, exc)
            return None

        ct = mimetypes.guess_type(str(path))[0] or "image/jpeg"
        try:
            meta = image_store.save_image(content, ct, citizen_id="demo")
        except Exception as exc:
            logger.warning("could not import demo asset %s: %s", path, exc)
            return None

        _resolved_assets[asset_name] = meta["image_id"]
        return meta["image_id"]


# --- Scenario definitions ---

SCENARIOS: Dict[str, Dict[str, Any]] = {
    "koramangala_flood": {
        "title": "Koramangala Flash Flood",
        "category": "quick",
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
        "category": "quick",
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
        "category": "quick",
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

    # ─────────────────────────────────────────────────────────────────
    # FLAGSHIP DEMO #1 — 2019 Bengaluru floods (multi-stage cascade)
    # August 2019 — heavy SW-monsoon rains caused lake breaches & wall
    # collapses across Bellandur / HSR / Sarjapur Road. We replay it as
    # 3 sequential reports over ~2 minutes so the audience can watch the
    # hazard zone GROW, cross-incident negotiation kick in, and the
    # route optimizer re-plan around a widening flood polygon.
    # ─────────────────────────────────────────────────────────────────
    "bengaluru_2019_flood_cascade": {
        "title": "Bengaluru 2019 Flood — Multi-Stage Cascade",
        "category": "flagship",
        "subtitle": "Aug 2019 · Bellandur → HSR → Sarjapur Rd",
        "description": (
            "Replay of the August 2019 Bengaluru flooding cascade. Three sequential "
            "incidents over two minutes: a Bellandur lake breach, a compound wall "
            "collapse in HSR Layout caused by saturated soil, and a school bus "
            "stranded on Sarjapur Road. Demonstrates cross-incident hazard "
            "correlation, growing geofenced alert zones, and route re-planning."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_blr19_bellandur",
                    "disaster_type": "flood",
                    "description": (
                        "Bellandur lake bund has breached near Yemalur side. Water "
                        "is gushing onto Outer Ring Road, vehicles stuck, the slip "
                        "road from ORR towards Marathahalli is fully under water. "
                        "Easily 3-4 feet deep already and rising."
                    ),
                    "coordinates": [12.9396, 77.6797],
                    "severity_hint": 5,
                    "demo_image": "flood_neighborhood",
                },
            },
            {
                # 60s later — second incident a few km south, escalates the zone
                "delay_s": 60,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_blr19_hsr",
                    "disaster_type": "building_collapse",
                    "description": (
                        "Compound wall of an apartment in HSR Layout sector 2 has "
                        "collapsed onto a parked auto-rickshaw. Soil is fully "
                        "waterlogged from the rain since last night. Two people "
                        "around it, unclear if anyone is under the debris."
                    ),
                    "coordinates": [12.9116, 77.6473],
                    "severity_hint": 4,
                    "demo_image": "flood_street",
                },
            },
            {
                # 60s later — third incident, the SOS turn
                "delay_s": 60,
                "kind": "sos",
                "payload": {
                    "citizen_id": "demo_blr19_sarjapur",
                    "coordinates": [12.9145, 77.6855],
                    "note": (
                        "School bus stuck in flood water near Kaikondrahalli lake "
                        "junction on Sarjapur Road. About 20 children inside. "
                        "Water touching the bus floor. Driver says engine is dead."
                    ),
                    "disaster_type": "flood",
                },
            },
        ],
    },

    # ─────────────────────────────────────────────────────────────────
    # FLAGSHIP DEMO #2 — Bengaluru hail-storm citywide cascade
    # April 30, 2026 — freak severe hail-storm cell tracked across the
    # city in ~30 min. Multiple simultaneous reports: blocked arterial,
    # vehicle pile-up on ORR, citizen with a skylight breach. Stresses
    # the agents on parallel incident triage + weather corroboration.
    # ─────────────────────────────────────────────────────────────────
    "bengaluru_2026_hailstorm": {
        "title": "Bengaluru Hail-Storm — Apr 30 2026",
        "category": "flagship",
        "subtitle": "Citywide cascade · ORR pile-up · severe hail",
        "description": (
            "Severe hail cell crosses Bengaluru on the evening of 30 Apr 2026. "
            "Three near-simultaneous reports across the city: a multi-car "
            "pile-up on Outer Ring Road from ice on the road, a fallen tree "
            "blocking a major arterial in Jayanagar, and a citizen calling for "
            "help after a skylight shattered onto an elderly resident. Tests "
            "parallel triage, weather-tool corroboration via Open-Meteo, and "
            "cross-base mission negotiation."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_blr26_orr_pileup",
                    "disaster_type": "vehicle_accident",
                    "description": (
                        "Massive hail just hit Outer Ring Road near Marathahalli. "
                        "Hailstones the size of golf balls. Multiple cars have "
                        "skidded and crashed into each other in the Bellandur "
                        "flyover stretch. Windshields completely smashed. People "
                        "are out of cars trying to take shelter."
                    ),
                    "coordinates": [12.9569, 77.7011],
                    "severity_hint": 5,
                    "demo_image": "hail_car_damage",
                },
            },
            {
                "delay_s": 25,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_blr26_jayanagar_tree",
                    "disaster_type": "tree_fall",
                    "description": (
                        "Huge rain-tree has fallen across 30th Cross in Jayanagar "
                        "4th block. Completely blocking the road in both directions. "
                        "Power lines are down too — sparks visible. The hail and "
                        "wind brought it down. Nobody hurt that I can see but "
                        "people can't leave the area."
                    ),
                    "coordinates": [12.9241, 77.5829],
                    "severity_hint": 3,
                },
            },
            {
                "delay_s": 25,
                "kind": "sos",
                "payload": {
                    "citizen_id": "demo_blr26_indira_skylight",
                    "coordinates": [12.9719, 77.6412],
                    "note": (
                        "My grandfather is hurt — the skylight in our living "
                        "room shattered from the hail and glass fell on him. "
                        "He's bleeding from his head and shoulder. We are at "
                        "12th Main Indiranagar 1st stage. Please send an "
                        "ambulance fast."
                    ),
                    "disaster_type": "medical",
                },
            },
            {
                # 30s after the SOS — corroborating external alert showing how the
                # situation agent's news/weather tools see this nationally.
                "delay_s": 30,
                "kind": "external_alert",
                "payload": {
                    "source": "imd_weather",
                    "headline": (
                        "IMD: Severe thunderstorm with large hail moving across "
                        "Bengaluru urban district; gusts up to 80 km/h reported."
                    ),
                    "category": "severe_weather",
                    "coordinates": [12.9716, 77.5946],
                    "severity_hint": 4,
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
                "subtitle": s.get("subtitle"),
                "category": s.get("category", "quick"),
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

            # Resolve the optional demo_image asset → real image_id so the
            # Vision agent treats it like a citizen-uploaded photo.
            asset = payload.pop("demo_image", None)
            if asset:
                image_id = await _resolve_demo_image(asset)
                if image_id:
                    payload["image_id"] = image_id
                    meta = image_store.get_image_meta(image_id) or {}
                    if meta.get("url"):
                        payload["image_url"] = meta["url"]

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
