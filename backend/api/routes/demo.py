"""Demo scenario runner.

Provides pre-scripted scenarios for hackathon demos. Each scenario publishes
a sequence of citizen reports / SOS / external alerts with realistic delays
so the audience can watch the agent pipeline react in real time.

Also supports REPLAY MODE: a recorder hooked onto the event bus captures
every event during a scenario run, persists it to disk, and a /replay
endpoint can later re-broadcast that recording at original timing
WITHOUT calling Gemini. This is the demo-day insurance policy against
quota-exhaustion mid-presentation.
"""
from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import time
import uuid
from datetime import datetime, timezone
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

# ── Replay recorder ────────────────────────────────────────────
# When a scenario is run with `record=True` we attach a broadcaster
# to the bus that captures every event tagged with this run_id (best
# effort — events without a run_id but emitted during the active
# window are also captured) and writes them to a JSON file. The
# recordings live under backend/data/demo_recordings/<scenario_id>.json
# and overwrite each other so the latest "good" run wins.

_recordings_lock = asyncio.Lock()
_active_recorders: Dict[str, "_Recorder"] = {}


class _Recorder:
    """In-memory event accumulator for a single demo run."""

    def __init__(self, run_id: str, scenario_id: str):
        self.run_id = run_id
        self.scenario_id = scenario_id
        self.started_at = time.monotonic()
        self.started_iso = datetime.now(timezone.utc).isoformat()
        self.events: List[Dict[str, Any]] = []
        self._handler = self._make_handler()

    def _make_handler(self):
        async def handler(event: Event) -> None:
            try:
                offset_ms = int((time.monotonic() - self.started_at) * 1000)
                self.events.append(
                    {
                        "offset_ms": offset_ms,
                        "event": event.to_dict(),
                    }
                )
            except Exception as exc:
                logger.debug("recorder handler error: %s", exc)
        return handler


def _recordings_dir() -> Path:
    p = Path(__file__).resolve().parents[2] / "data" / "demo_recordings"
    p.mkdir(parents=True, exist_ok=True)
    return p


async def _start_recording(run_id: str, scenario_id: str) -> _Recorder:
    rec = _Recorder(run_id, scenario_id)
    async with _recordings_lock:
        _active_recorders[run_id] = rec
    bus = get_bus()
    bus.add_broadcaster(rec._handler)
    logger.info("Recording scenario '%s' (run_id=%s)", scenario_id, run_id)
    return rec


async def _stop_recording(run_id: str) -> Optional[Dict[str, Any]]:
    """Detach the recorder, persist to disk, return summary metadata."""
    async with _recordings_lock:
        rec = _active_recorders.pop(run_id, None)
    if not rec:
        return None

    # Detach the handler so it stops accumulating. We do this by
    # filtering the bus's broadcaster list — the bus has no remove
    # API today and adding one is overkill.
    bus = get_bus()
    try:
        bus._broadcasters = [h for h in bus._broadcasters if h is not rec._handler]  # noqa: SLF001
    except Exception:
        pass

    path = _recordings_dir() / f"{rec.scenario_id}.json"
    payload = {
        "scenario_id": rec.scenario_id,
        "run_id": rec.run_id,
        "recorded_at": rec.started_iso,
        "duration_ms": int((time.monotonic() - rec.started_at) * 1000),
        "event_count": len(rec.events),
        "events": rec.events,
    }
    try:
        path.write_text(json.dumps(payload, default=str))
        logger.info(
            "Wrote recording: %s (%d events, %d ms)",
            path.name, payload["event_count"], payload["duration_ms"],
        )
    except Exception as exc:
        logger.warning("failed to write recording %s: %s", path, exc)
        return None

    return {
        "scenario_id": rec.scenario_id,
        "event_count": payload["event_count"],
        "duration_ms": payload["duration_ms"],
        "path": str(path),
    }


def _list_recordings() -> List[Dict[str, Any]]:
    out = []
    for p in sorted(_recordings_dir().glob("*.json")):
        try:
            data = json.loads(p.read_text())
            out.append({
                "scenario_id": data.get("scenario_id", p.stem),
                "recorded_at": data.get("recorded_at"),
                "event_count": data.get("event_count", 0),
                "duration_ms": data.get("duration_ms", 0),
            })
        except Exception:
            continue
    return out


async def _execute_replay(scenario_id: str, run_id: str, speed: float = 1.0):
    """Replay a previously recorded run by re-broadcasting events to WS.

    Speed > 1 plays faster (compresses gaps), speed < 1 plays slower.
    We sleep between events using the original `offset_ms` deltas so
    timing matches the live run. Subscribers (the agents) are NOT
    invoked — replay uses `publish_replay` for that exact reason.

    Replay also SEEDS the in-memory mission tracker and the on-disk
    hazard registry as it walks the event stream. Without this, the
    polled `/authority/dashboard` would return zero missions/hazards
    during a replay because the agent handlers that normally write to
    those stores never ran. Mission pins, the missions panel, and the
    hazard pulse circles would all be empty — even though the route
    line and the agent reasoning ticker would update from the WS fan-
    out. With seeding, replay is a true 1:1 reproduction of the live
    run's UI state. Stores are cleared at the END of replay so the
    box is left in a clean state for the next demo.
    """
    path = _recordings_dir() / f"{scenario_id}.json"
    if not path.exists():
        logger.warning("no recording for %s — replay aborted", scenario_id)
        async with _run_lock:
            _active_runs.pop(run_id, None)
        return

    try:
        data = json.loads(path.read_text())
    except Exception as exc:
        logger.warning("recording unreadable: %s", exc)
        async with _run_lock:
            _active_runs.pop(run_id, None)
        return

    # Lazy imports — avoid cycles at module import time.
    from backend.core.mission_tracker import (  # type: ignore  # noqa: WPS433
        Mission,
        MissionStatus,
        get_tracker,
    )
    from backend.tools import hazard_db  # type: ignore  # noqa: WPS433

    tracker = get_tracker()
    seeded_mission_ids: List[str] = []
    seeded_hazard_ids: List[str] = []

    def _seed_from_event(ev_dict: Dict[str, Any]) -> None:
        """Mutate tracker / hazard store based on a replayed event."""
        etype = ev_dict.get("type")
        payload = ev_dict.get("payload") or {}
        try:
            if etype == "hazard.zone.confirmed":
                zone = payload.get("zone") or {}
                if not zone.get("id"):
                    return
                zones = hazard_db._read_zones()
                if not any(z.get("id") == zone["id"] for z in zones):
                    zones.append(zone)
                    hazard_db._write_zones(zones)
                    seeded_hazard_ids.append(zone["id"])
                return

            if etype == "mission.proposed":
                mid = payload.get("mission_id")
                inc_id = payload.get("incident_id")
                if not mid or not inc_id:
                    return
                if tracker.get_mission(mid) is not None:
                    return
                m = Mission(
                    mission_id=mid,
                    incident_id=inc_id,
                    disaster_type=payload.get("disaster_type", "unknown"),
                    severity=int(payload.get("severity", 0) or 0),
                    incident_coordinates=list(payload.get("incident_coordinates") or [0, 0]),
                    status=MissionStatus.PROPOSED,
                    assigned_base_id=payload.get("base_id"),
                    assigned_base_name=payload.get("base_name"),
                )
                tracker._missions[mid] = m  # noqa: SLF001 — internal seed
                seeded_mission_ids.append(mid)
                return

            if etype == "mission.accepted":
                mid = payload.get("mission_id")
                if not mid:
                    return
                m = tracker.get_mission(mid)
                if m is None:
                    # Accept can arrive before propose if the recording
                    # is partial; create a stub so the dashboard sees it.
                    m = Mission(
                        mission_id=mid,
                        incident_id=payload.get("incident_id", "inc_unknown"),
                        disaster_type=payload.get("disaster_type", "unknown"),
                        severity=int(payload.get("severity", 0) or 0),
                        incident_coordinates=list(
                            payload.get("incident_coordinates") or [0, 0]
                        ),
                    )
                    tracker._missions[mid] = m  # noqa: SLF001
                    seeded_mission_ids.append(mid)
                m.status = MissionStatus.ACCEPTED
                m.assigned_base_id = payload.get("base_id") or m.assigned_base_id
                m.assigned_base_name = payload.get("base_name") or m.assigned_base_name
                m.assigned_commander = payload.get("commander") or m.assigned_commander
                return

            if etype == "route.computed":
                mid = payload.get("mission_id")
                if not mid:
                    return
                m = tracker.get_mission(mid)
                if m is None:
                    return
                m.route_path = payload.get("path") or m.route_path
                m.route_distance_km = payload.get("distance_km") or m.route_distance_km
                m.route_eta_minutes = payload.get("eta_minutes") or m.route_eta_minutes
                # Bump status so the UI shows the mission as en-route.
                if m.status in (
                    MissionStatus.PROPOSED,
                    MissionStatus.NEGOTIATING,
                    MissionStatus.ACCEPTED,
                ):
                    m.status = MissionStatus.EN_ROUTE
                return

            # Best-effort capture of the dispatch reasoning text so the
            # mission detail drawer has rich content during replay.
            if etype == "agent.reasoning":
                agent = payload.get("agent")
                inc_id = payload.get("incident_id")
                thought = payload.get("thought") or ""
                if (
                    agent == "dispatch_strategist"
                    and "DISPATCH DECISION" in thought
                    and inc_id
                ):
                    # Attach to whichever mission matches this incident
                    # (created later when mission.proposed fires).
                    for m in tracker._missions.values():  # noqa: SLF001
                        if m.incident_id == inc_id and not m.dispatch_reasoning:
                            m.dispatch_reasoning = thought
                            break
        except Exception as exc:
            logger.debug("seed skipped for %s: %s", etype, exc)

    bus = get_bus()
    try:
        last_offset = 0
        for entry in data.get("events", []):
            off = int(entry.get("offset_ms", 0))
            delta = max(0, off - last_offset)
            if delta > 0:
                await asyncio.sleep((delta / 1000.0) / max(0.1, speed))
            last_offset = off

            ev_dict = entry.get("event") or {}
            # Seed BEFORE re-broadcasting so a /authority/dashboard poll
            # arriving microseconds later already sees the new state.
            _seed_from_event(ev_dict)

            try:
                event = Event(
                    type=EventType(ev_dict.get("type")),
                    payload=ev_dict.get("payload") or {},
                    source_agent=ev_dict.get("source_agent"),
                    id=ev_dict.get("id") or f"replay_{uuid.uuid4().hex[:8]}",
                    timestamp=ev_dict.get("timestamp")
                    or datetime.now(timezone.utc).isoformat(),
                )
            except Exception as exc:
                logger.debug("skip malformed replay event: %s", exc)
                continue
            await bus.publish_replay(event)
    finally:
        # Hold the seeded state for a generous window AFTER playback
        # finishes so the operator can keep narrating, hover pins, and
        # explain mission details before everything is swept. 5 minutes
        # is plenty for a demo. If we cleaned up the instant playback
        # ended, mission pins would vanish 0.5 s after the last event —
        # exactly when the audience is still looking.
        async def _delayed_cleanup() -> None:
            await asyncio.sleep(300)  # 5 minutes
            try:
                if seeded_mission_ids:
                    for mid in seeded_mission_ids:
                        tracker._missions.pop(mid, None)  # noqa: SLF001
                if seeded_hazard_ids:
                    zones = hazard_db._read_zones()
                    pruned = [
                        z for z in zones if z.get("id") not in set(seeded_hazard_ids)
                    ]
                    if len(pruned) != len(zones):
                        hazard_db._write_zones(pruned)
                logger.info(
                    "Replay state cleared for '%s' (missions=%d, hazards=%d)",
                    scenario_id,
                    len(seeded_mission_ids),
                    len(seeded_hazard_ids),
                )
            except Exception as exc:
                logger.warning("replay cleanup failed: %s", exc)

        # Free the run slot immediately so a fresh replay can start.
        async with _run_lock:
            _active_runs.pop(run_id, None)
        logger.info(
            "Replay '%s' finished (run_id=%s, missions=%d, hazards=%d) — "
            "state will linger 5min for narration",
            scenario_id,
            run_id,
            len(seeded_mission_ids),
            len(seeded_hazard_ids),
        )

        if seeded_mission_ids or seeded_hazard_ids:
            asyncio.create_task(_delayed_cleanup())


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
    # Quick category coverage — single-incident drills covering the
    # rest of the realistic Bengaluru civic-rescue category load. Each
    # one demonstrates how the agents reason about a different
    # disaster type, and exercises a different specialist base
    # (medical → ambulance, gas leak → fire+utility, etc.).
    # ─────────────────────────────────────────────────────────────────

    "jayanagar_medical": {
        "title": "Jayanagar Medical Emergency",
        "category": "quick",
        "description": (
            "Cardiac event at home. Tests the medical-base routing path: "
            "ambulance dispatch with hospital handoff, no hazard zone."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "sos",
                "payload": {
                    "citizen_id": "demo_jayanagar_medical",
                    "coordinates": [12.9258, 77.5832],
                    "note": (
                        "My father just collapsed at home — I think it's a heart "
                        "attack. He's breathing but unresponsive. We're at 11th "
                        "Main, Jayanagar 4th Block. Please send an ambulance NOW."
                    ),
                    "disaster_type": "medical",
                    "severity_hint": 5,
                },
            },
        ],
    },

    "yelahanka_quake_aftermath": {
        "title": "Yelahanka Quake Aftermath",
        "category": "quick",
        "description": (
            "Light tremor (~M4.6) felt across north Bengaluru with reports of "
            "structural damage in older buildings. Tests USGS earthquake-tool "
            "corroboration and multi-zone hazard correlation."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_yelahanka_quake1",
                    "disaster_type": "earthquake",
                    "description": (
                        "Strong tremor just felt in Yelahanka New Town. "
                        "Cracks visible on the side wall of our 4-storey "
                        "apartment, plaster falling. People are out on the "
                        "street. Lasted maybe 8 seconds."
                    ),
                    "coordinates": [13.1006, 77.5963],
                    "severity_hint": 4,
                },
            },
            {
                "delay_s": 18,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_yelahanka_quake2",
                    "disaster_type": "earthquake",
                    "description": (
                        "Same tremor felt strongly in Hebbal too. An old "
                        "boundary wall behind a school has collapsed. "
                        "Children evacuated, no injuries reported yet."
                    ),
                    "coordinates": [13.0359, 77.5970],
                    "severity_hint": 3,
                },
            },
        ],
    },

    "domlur_gas_leak": {
        "title": "Domlur Gas Leak",
        "category": "quick",
        "description": (
            "LPG tanker leak near a residential pocket. Tests fire+utility "
            "joint dispatch and a tight evacuation hazard zone."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_domlur_gas",
                    "disaster_type": "gas_leak",
                    "description": (
                        "An LPG tanker has overturned on the Domlur flyover "
                        "ramp and gas is hissing out loudly. The smell is very "
                        "strong, eyes burning. I can see the driver waving at "
                        "people to move back. No fire yet but the area is "
                        "thick with the smell. Please act fast."
                    ),
                    "coordinates": [12.9618, 77.6386],
                    "severity_hint": 5,
                },
            },
        ],
    },

    "silk_board_pileup": {
        "title": "Silk Board Multi-Vehicle Pile-up",
        "category": "quick",
        "description": (
            "Rear-end chain accident on the elevated road during morning "
            "rush. Tests traffic-clearance + ambulance + police triage and "
            "the route optimizer's avoidance of the closure."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_silkboard_accident",
                    "disaster_type": "road_accident",
                    "description": (
                        "Major pile-up just happened on the Silk Board "
                        "elevated road heading towards Hosur Road. At least "
                        "five cars and a Tempo Traveller. Two of the cars are "
                        "smoking. People injured, some can't get out. "
                        "Traffic completely blocked behind us."
                    ),
                    "coordinates": [12.9166, 77.6228],
                    "severity_hint": 4,
                },
            },
        ],
    },

    "rajajinagar_landslide": {
        "title": "Rajajinagar Hill-Cut Landslide",
        "category": "quick",
        "description": (
            "Section of a metro construction hill-cut slumps onto the road "
            "after heavy rain. Tests engineering + traffic-clearance "
            "negotiation and a moderate hazard zone with re-routing."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_rajaji_landslide",
                    "disaster_type": "landslide",
                    "description": (
                        "Part of the cut slope at the Rajajinagar metro work "
                        "site has slid down onto the road below. Heavy mud "
                        "and rocks blocking three lanes. A tea stall is half "
                        "buried. Owner is missing. The whole face of the cut "
                        "still looks unstable."
                    ),
                    "coordinates": [12.9886, 77.5527],
                    "severity_hint": 4,
                },
            },
        ],
    },

    "btm_electrocution": {
        "title": "BTM Layout Electrocution Risk",
        "category": "quick",
        "description": (
            "Live wire fallen onto a flooded lane during rain. Tests "
            "utility (BESCOM) + flood-rescue coordination, and a tight "
            "evacuation footprint."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "sos",
                "payload": {
                    "citizen_id": "demo_btm_electrocution",
                    "coordinates": [12.9166, 77.6097],
                    "note": (
                        "A 11kV line has snapped and is dangling into the "
                        "flooded lane behind 16th Main BTM 2nd Stage. "
                        "Sparks visible. Two scooters parked in the water. "
                        "An auto-rickshaw driver may have been shocked — "
                        "he's slumped over but we are afraid to approach. "
                        "Power to the lane is still ON."
                    ),
                    "disaster_type": "electrocution",
                    "severity_hint": 5,
                },
            },
        ],
    },

    "cubbon_park_treefall": {
        "title": "Cubbon Park Heritage Tree-Fall",
        "category": "quick",
        "description": (
            "100-year-old tamarind tree falls on a parked car after wind "
            "gusts. Tests civic-rescue + traffic-clearance dispatch with "
            "no medical urgency."
        ),
        "steps": [
            {
                "delay_s": 0,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_cubbon_treefall",
                    "disaster_type": "tree_fall",
                    "description": (
                        "Massive heritage tamarind tree has just come down "
                        "on Kasturba Road along the edge of Cubbon Park. "
                        "It's crushed two parked cars and is blocking one "
                        "side of the road. Nobody appears to be hurt — the "
                        "cars were empty. But the tree is huge and going "
                        "to need heavy clearing equipment."
                    ),
                    "coordinates": [12.9758, 77.5963],
                    "severity_hint": 2,
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

    # ─────────────────────────────────────────────────────────────────
    # FLAGSHIP DEMO #3 — Bengaluru Under Siege (citywide multi-category)
    # 5 distinct incidents in 5 different categories over 90s. The aim
    # is to show the agents triage AND prioritise across types in
    # parallel — medical SOS competes with a fire, then a flood, then
    # a road accident, then a gas leak. With 3-way concurrency the
    # supervisor must keep base-allocation fair across specialists.
    # ─────────────────────────────────────────────────────────────────
    "bengaluru_under_siege": {
        "title": "Bengaluru Under Siege — Citywide Multi-Category",
        "category": "flagship",
        "subtitle": "5 incidents · 5 categories · 90 seconds",
        "description": (
            "Five near-simultaneous incidents across Bengaluru, each in a "
            "different category — medical, fire, flash flood, road accident, "
            "gas leak. Stresses cross-category prioritisation, parallel "
            "specialist-base negotiation, and the route optimizer's ability "
            "to keep crews from converging on the same arterial."
        ),
        "steps": [
            {
                # 0s — medical SOS first; sets a high bar for priority.
                "delay_s": 0,
                "kind": "sos",
                "payload": {
                    "citizen_id": "demo_siege_medical",
                    "coordinates": [12.9352, 77.6117],
                    "note": (
                        "My mother had a stroke — one side of her face has "
                        "drooped, she can't speak. We're at Koramangala 6th "
                        "Block, 80 Feet Road. Need an ambulance immediately."
                    ),
                    "disaster_type": "medical",
                    "severity_hint": 5,
                },
            },
            {
                # 18s — major fire across town. Different specialist base.
                "delay_s": 18,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_siege_fire",
                    "disaster_type": "fire",
                    "description": (
                        "Major fire at a paint godown on Mysore Road near "
                        "Nayandahalli. Black smoke covering half the sky, "
                        "explosions audible from cans bursting. Adjoining "
                        "shops have shutters down but workers are still inside."
                    ),
                    "coordinates": [12.9434, 77.5251],
                    "severity_hint": 5,
                },
            },
            {
                # 36s — flash flood in the south. Tests parallel hazard zones.
                "delay_s": 18,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_siege_flood",
                    "disaster_type": "flood",
                    "description": (
                        "Flash flood after the cloudburst — Bommanahalli "
                        "underpass on Hosur Road is fully submerged. Two "
                        "cars and a bike are stuck inside, water rising. "
                        "We can see one driver waving for help."
                    ),
                    "coordinates": [12.9061, 77.6201],
                    "severity_hint": 4,
                    "demo_image": "flood_street",
                },
            },
            {
                # 54s — road accident in the east. Stresses dispatch fairness.
                "delay_s": 18,
                "kind": "citizen_report",
                "payload": {
                    "citizen_id": "demo_siege_accident",
                    "disaster_type": "road_accident",
                    "description": (
                        "Bus and a tempo collided head-on at the Marathahalli "
                        "junction. Front of the bus smashed in, driver pinned. "
                        "About 20 passengers, several walking wounded, two not "
                        "moving on the floor of the bus. Traffic backed up "
                        "all the way to Kundalahalli."
                    ),
                    "coordinates": [12.9569, 77.7011],
                    "severity_hint": 5,
                },
            },
            {
                # 72s — gas leak in the north. Worst-case load on supervisor.
                "delay_s": 18,
                "kind": "sos",
                "payload": {
                    "citizen_id": "demo_siege_gas",
                    "coordinates": [13.0359, 77.5970],
                    "note": (
                        "Smell of gas everywhere on the ground floor of our "
                        "Hebbal apartment. Building manager says a main pipe "
                        "ruptured during the road digging. We have 40 flats. "
                        "Started evacuating but elderly residents on upper "
                        "floors can't come down quickly."
                    ),
                    "disaster_type": "gas_leak",
                    "severity_hint": 5,
                },
            },
            {
                # 90s — cooldown corroboration: a news beat that ties the
                # cluster together for the situation agent's narrative.
                "delay_s": 18,
                "kind": "external_alert",
                "payload": {
                    "source": "deccan_herald",
                    "headline": (
                        "Multiple emergencies reported across Bengaluru in the "
                        "last hour amid heavy rain; civic agencies coordinating."
                    ),
                    "category": "civic_news",
                    "coordinates": [12.9716, 77.5946],
                    "severity_hint": 3,
                },
            },
        ],
    },
}


class ScenarioRequest(BaseModel):
    scenario_id: str
    run_id: Optional[str] = None
    # When True, attach a recorder to the bus and persist this run's
    # event stream to disk. Lets you replay it later WITHOUT calling
    # Gemini — the demo-day insurance policy.
    record: bool = False


class ReplayRequest(BaseModel):
    scenario_id: str
    run_id: Optional[str] = None
    # 1.0 = original timing. 2.0 = twice as fast (compresses gaps).
    # 0.5 = half-speed (good for narrating slowly).
    speed: float = 1.0


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


@router.get("/recordings")
async def demo_recordings():
    """List available demo recordings. Useful for the UI to know which
    scenarios can be replayed without burning Gemini quota."""
    return {"recordings": _list_recordings()}


@router.post("/replay")
async def replay_scenario(req: ReplayRequest):
    """Replay a previously recorded scenario.

    Re-broadcasts the captured event stream at original timing (modulated
    by `speed`) without invoking any agent / LLM. The dashboard sees
    exactly what it saw during the original run. Demo-day insurance.
    """
    path = _recordings_dir() / f"{req.scenario_id}.json"
    if not path.exists():
        return {
            "accepted": False,
            "reason": "no_recording",
            "message": f"No recording found for '{req.scenario_id}'. Run "
                       f"the scenario once with record=true first.",
        }

    async with _run_lock:
        if len(_active_runs) >= 3:
            return {
                "accepted": False,
                "reason": "concurrency_cap_reached",
                "active": list(_active_runs.values()),
                "max_concurrent": 3,
            }
        run_id = req.run_id or f"replay_{uuid.uuid4().hex[:8]}"
        _active_runs[run_id] = {
            "run_id": run_id,
            "scenario_id": req.scenario_id,
            "title": f"REPLAY · {req.scenario_id}",
            "started_at": _now_iso(),
            "kind": "replay",
        }

    asyncio.create_task(
        _execute_replay(req.scenario_id, run_id, speed=max(0.1, req.speed)),
    )
    return {
        "accepted": True,
        "run_id": run_id,
        "scenario_id": req.scenario_id,
        "speed": req.speed,
        "kind": "replay",
    }


@router.post("/run")
async def run_scenario(req: ScenarioRequest):
    """Trigger a demo scenario asynchronously.

    Refuses to start a new run if another scenario is already in progress —
    Gemini quotas are tight and stacking pipelines blows the budget.
    """
    scenario = SCENARIOS.get(req.scenario_id)
    if not scenario:
        return {"error": f"Unknown scenario: {req.scenario_id}"}

    # Concurrency cap. Gemini quota is the binding constraint, but the
    # multi-region pool comfortably tolerates 3 pipelines in flight. Anything
    # more risks 429s without obvious demo benefit.
    MAX_CONCURRENT_RUNS = 3

    async with _run_lock:
        if len(_active_runs) >= MAX_CONCURRENT_RUNS:
            running = list(_active_runs.values())
            return {
                "accepted": False,
                "reason": "concurrency_cap_reached",
                "active": running,
                "max_concurrent": MAX_CONCURRENT_RUNS,
                "message": (
                    f"{len(running)} scenarios already in flight (max "
                    f"{MAX_CONCURRENT_RUNS}). Wait for one to finish before "
                    f"launching another to avoid Gemini quota exhaustion."
                ),
            }
        # Block re-launching the SAME scenario though — that would just
        # collide events on the bus and double-count base allocations.
        same = [r for r in _active_runs.values() if r["scenario_id"] == req.scenario_id]
        if same:
            return {
                "accepted": False,
                "reason": "same_scenario_already_running",
                "active": same[0],
                "message": (
                    f"Scenario '{req.scenario_id}' is still running "
                    f"(started {same[0]['started_at']}). Pick a different "
                    f"scenario or wait for this one to finish."
                ),
            }
        run_id = req.run_id or f"run_{uuid.uuid4().hex[:8]}"
        _active_runs[run_id] = {
            "run_id": run_id,
            "scenario_id": req.scenario_id,
            "title": scenario["title"],
            "started_at": _now_iso(),
        }

    asyncio.create_task(
        _execute_scenario(req.scenario_id, scenario, run_id, record=req.record),
    )

    return {
        "accepted": True,
        "run_id": run_id,
        "scenario_id": req.scenario_id,
        "title": scenario["title"],
        "step_count": len(scenario["steps"]),
        "recording": bool(req.record),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _execute_scenario(
    scenario_id: str,
    scenario: dict,
    run_id: str,
    record: bool = False,
):
    """Run a scenario's steps with their configured delays.

    Holds the run in `_active_runs` for the duration of step dispatch PLUS
    a cooldown window so back-to-back clicks can't stack Gemini calls.

    If `record=True`, attaches a recorder broadcaster onto the bus so we
    capture every event for later replay. The recorder is detached and
    flushed to disk in the finally block — including on errors — so an
    aborted run still leaves a usable partial recording.
    """
    bus = get_bus()
    logger.info(
        "Demo scenario '%s' started (run_id=%s, record=%s)",
        scenario_id, run_id, record,
    )

    if record:
        await _start_recording(run_id, scenario_id)

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
        if record:
            try:
                summary = await _stop_recording(run_id)
                if summary:
                    logger.info("Recording saved: %s", summary)
            except Exception as exc:
                logger.warning("stop_recording failed: %s", exc)
        async with _run_lock:
            _active_runs.pop(run_id, None)
        logger.info("Demo scenario '%s' run slot released (run_id=%s)", scenario_id, run_id)
