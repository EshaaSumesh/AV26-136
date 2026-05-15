"""Supervisor Agent — orchestrates the multi-agent pipeline with negotiation.

Flow (Phase 3):
  CITIZEN_REPORT / SOS / EXTERNAL_ALERT
    -> Situation Awareness (classify, geocode, corroborate)
    -> [if disaster] Hazard Assessment (zone management)
    -> [always after hazard] Communications (geofenced alerts)
    -> [if severity >= 3] Dispatch Strategist (base selection)
    -> [if dispatched] NEGOTIATION: Field Commanders accept/decline/counter
    -> [if accepted] Route Optimizer (multi-candidate routing)
    -> Mission created and tracked for continuous re-evaluation
"""
from __future__ import annotations

import contextvars
import json
import logging
import re
from typing import Any, List, Optional

from langchain_core.messages import HumanMessage

from backend.agents.llm import get_llm
from backend.agents.situation_awareness import create_situation_agent
from backend.agents.hazard_assessment import create_hazard_agent
from backend.agents.dispatch_strategist import create_dispatch_agent
from backend.agents.route_optimizer import create_route_agent
from backend.agents.communications import create_communications_agent
from backend.agents.field_commander import propose_mission_to_commander
from backend.core.events import Event, EventType
from backend.core.event_bus import get_bus
from backend.core.metrics import Timer, get_metrics
from backend.core.mission_tracker import get_tracker, MissionStatus

logger = logging.getLogger(__name__)

# Lazy-initialized agent singletons
_situation_agent = None
_hazard_agent = None
_dispatch_agent = None
_route_agent = None
_comms_agent = None

MAX_NEGOTIATION_ROUNDS = 3

# Per-task context: lets every nested emit call pick up the current
# incident_id / citizen_id without threading it through every signature.
# Set by `process_incident` for the lifetime of one pipeline run.
_current_incident: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "_current_incident", default=None
)


def _ctx_incident_meta() -> dict:
    inc = _current_incident.get()
    if not inc:
        return {}
    meta = {}
    if inc.get("incident_id"):
        meta["incident_id"] = inc["incident_id"]
    if inc.get("citizen_id"):
        meta["citizen_id"] = inc["citizen_id"]
    return meta


def _get_situation():
    global _situation_agent
    if _situation_agent is None:
        _situation_agent = create_situation_agent()
    return _situation_agent


def _get_hazard():
    global _hazard_agent
    if _hazard_agent is None:
        _hazard_agent = create_hazard_agent()
    return _hazard_agent


def _get_dispatch():
    global _dispatch_agent
    if _dispatch_agent is None:
        _dispatch_agent = create_dispatch_agent()
    return _dispatch_agent


def _get_route():
    global _route_agent
    if _route_agent is None:
        _route_agent = create_route_agent()
    return _route_agent


def _get_comms():
    global _comms_agent
    if _comms_agent is None:
        _comms_agent = create_communications_agent()
    return _comms_agent


async def _emit_reasoning(agent_name: str, thought: str, context: Optional[dict] = None):
    bus = get_bus()
    payload = {
        "agent": agent_name,
        "thought": thought,
        "context": context or {},
        **_ctx_incident_meta(),
    }
    await bus.publish(Event(
        type=EventType.AGENT_REASONING,
        payload=payload,
        source_agent=agent_name,
    ))


# ── Citizen-facing stage updates ───────────────────────────────────────────
#
# Pipeline progress is also pushed directly to the citizen who submitted
# the incident, so the citizen page can render a per-incident progress
# tracker. We bypass the event bus here because these messages are
# strictly per-citizen and shouldn't be persisted in the agent log.

async def _emit_stage(
    incident: dict,
    stage: str,
    status: str,
    caption: str,
    extra: Optional[dict] = None,
) -> None:
    """Push a stage update to the owning citizen's WebSocket.

    `stage` is one of:
        situation_awareness, hazard_assessment, communications,
        dispatch_strategist, negotiation, route_optimizer, supervisor.
    `status` is one of: running, done, skipped, error.
    """
    citizen_id = incident.get("citizen_id")
    if not citizen_id:
        return
    from backend.core.ws_manager import get_ws

    payload = {
        "incident_id": incident.get("incident_id"),
        "citizen_id": citizen_id,
        "stage": stage,
        "status": status,
        "caption": caption,
    }
    if extra:
        payload.update(extra)

    try:
        await get_ws().send_citizens(
            [citizen_id],
            {"type": "incident.stage", "data": payload},
        )
    except Exception as exc:  # pragma: no cover — best-effort delivery
        logger.debug("citizen stage emit failed: %s", exc)


async def _emit_tool_call(agent_name: str, tool: str, args: dict, result_summary: str):
    bus = get_bus()
    payload = {
        "agent": agent_name,
        "tool": tool,
        "args": args,
        "result_summary": result_summary,
        **_ctx_incident_meta(),
    }
    await bus.publish(Event(
        type=EventType.AGENT_TOOL_CALL,
        payload=payload,
        source_agent=agent_name,
    ))


async def _emit_mission_event(event_type: EventType, mission_id: str, payload: dict):
    bus = get_bus()
    full_payload = {
        "mission_id": mission_id,
        **_ctx_incident_meta(),
        **payload,
    }
    await bus.publish(Event(type=event_type, payload=full_payload, source_agent="supervisor"))


def _extract_agent_steps(result: dict) -> list:
    steps = []
    messages = result.get("messages", [])
    for msg in messages:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                steps.append({"type": "tool_call", "tool": tc.get("name", "unknown"), "args": tc.get("args", {})})
        if hasattr(msg, "content") and msg.content and hasattr(msg, "type"):
            if msg.type == "ai":
                steps.append({"type": "reasoning", "content": msg.content[:500]})
    return steps


async def _run_agent(agent, prompt: str, agent_name: str) -> dict:
    """Invoke a ReAct agent and emit its reasoning/tool steps to the bus.

    Captures latency for the whole agent invocation and per-tool latencies,
    plus records the collaboration edge (supervisor -> agent).
    """
    metrics = get_metrics()
    metrics.record_edge("supervisor", agent_name)

    import time as _time
    start = _time.perf_counter()
    success = True
    result = None
    try:
        result = await agent.ainvoke({"messages": [HumanMessage(content=prompt)]})
    except Exception:
        success = False
        raise
    finally:
        duration_ms = (_time.perf_counter() - start) * 1000
        metrics.record_agent(agent_name, duration_ms, success)

    steps = _extract_agent_steps(result)
    final_message = result["messages"][-1].content if result.get("messages") else ""

    for step in steps:
        if step["type"] == "tool_call":
            tool_name = step["tool"]
            metrics.record_tool(tool_name, 0.0, True, parent_agent=agent_name)
            await _emit_tool_call(agent_name, tool_name, step["args"], "completed")
        elif step["type"] == "reasoning":
            await _emit_reasoning(agent_name, step["content"])

    return {"result": final_message, "steps": steps}


def _extract_base_id_from_dispatch(dispatch_text: str) -> Optional[str]:
    """Parse the chosen base ID from the Dispatch Strategist's output."""
    match = re.search(r"chosen_base_id:\s*(base_\w+)", dispatch_text, re.IGNORECASE)
    return match.group(1) if match else None


def _extract_base_coords_from_dispatch(dispatch_text: str) -> Optional[list]:
    """Parse base coordinates from dispatch output."""
    match = re.search(r"base_coordinates:\s*\[([0-9.,\s]+)\]", dispatch_text, re.IGNORECASE)
    if match:
        try:
            return [float(x.strip()) for x in match.group(1).split(",")]
        except ValueError:
            pass
    return None


# --- Individual agent runners ---

async def run_situation_assessment(incident: dict) -> dict:
    await _emit_reasoning("situation_awareness", f"Analyzing report: '{incident.get('description', '')[:100]}...'")
    return await _run_agent(_get_situation(), _build_situation_prompt(incident), "situation_awareness")


async def run_hazard_assessment(situation_result: str, incident: dict) -> dict:
    await _emit_reasoning("hazard_assessment", "Evaluating hazard zone implications...")
    return await _run_agent(_get_hazard(), _build_hazard_prompt(situation_result, incident), "hazard_assessment")


async def run_dispatch(situation_result: str, hazard_result: str, incident: dict) -> dict:
    await _emit_reasoning("dispatch_strategist", "Evaluating rescue base options...")
    return await _run_agent(_get_dispatch(), _build_dispatch_prompt(situation_result, hazard_result, incident), "dispatch_strategist")


async def run_route_optimization(
    dispatch_result: str,
    incident: dict,
    accepted_base: Optional[dict] = None,
    mission=None,
) -> dict:
    """Compute the rescue route.

    Primary path: run the route_optimizer ReAct agent (LLM + tool calls).
    Fallback: if the LLM blows up (Gemini quota / network / timeout), call
    the deterministic OSM router directly so the stage still completes,
    populates `mission.route_*` fields, and emits the path to the bus.
    """
    await _emit_reasoning(
        "route_optimizer",
        "Computing candidate routes with hazard avoidance...",
    )
    try:
        return await _run_agent(
            _get_route(),
            _build_route_prompt(dispatch_result, incident),
            "route_optimizer",
        )
    except Exception as exc:
        # Don't let a flaky / rate-limited LLM block the rescue.
        logger.warning(
            "route_optimizer LLM agent failed (%s) — falling back to "
            "deterministic OSM router.",
            type(exc).__name__,
        )
        return await _route_fallback_osm(incident, accepted_base, mission, exc)


async def _route_fallback_osm(
    incident: dict,
    accepted_base: Optional[dict],
    mission,
    failure_exc: Exception,
) -> dict:
    """Deterministic route computation when the LLM agent is unavailable.

    We pull live hazard zones from the in-memory store, run NetworkX over
    the cached OSM graph, populate the mission's route fields, and emit a
    transparent reasoning event so the operator knows the LLM was bypassed.
    """
    from backend.tools.osm_router import compute_osm_route as _osm_route_tool
    from backend.tools.hazard_db import get_hazard_zones as _get_hz

    incident_coords = incident.get("coordinates")
    if not (
        accepted_base
        and isinstance(accepted_base.get("coordinates"), (list, tuple))
        and len(accepted_base["coordinates"]) >= 2
        and isinstance(incident_coords, (list, tuple))
        and len(incident_coords) >= 2
    ):
        msg = "Cannot run fallback: missing base or incident coordinates."
        await _emit_reasoning("route_optimizer", msg)
        return {"result": msg, "steps": [], "fallback": True}

    base_lat, base_lng = accepted_base["coordinates"][0], accepted_base["coordinates"][1]
    inc_lat, inc_lng = incident_coords[0], incident_coords[1]

    # Pull hazard zones for avoidance
    try:
        raw_hz = _get_hz.invoke({"include_expired": False})
        if isinstance(raw_hz, dict):
            hazard_zones = raw_hz.get("zones", []) or []
        elif isinstance(raw_hz, list):
            hazard_zones = raw_hz
        else:
            hazard_zones = []
    except Exception:
        hazard_zones = []

    await _emit_tool_call(
        "route_optimizer",
        "compute_osm_route",
        {
            "origin_lat": base_lat,
            "origin_lng": base_lng,
            "dest_lat": inc_lat,
            "dest_lng": inc_lng,
            "hazard_zones": f"{len(hazard_zones)} zones",
            "strategy": "all_hazards",
            "_fallback_reason": type(failure_exc).__name__,
        },
        "deterministic OSM fallback",
    )

    try:
        route_result = _osm_route_tool.invoke({
            "origin_lat": float(base_lat),
            "origin_lng": float(base_lng),
            "dest_lat": float(inc_lat),
            "dest_lng": float(inc_lng),
            "hazard_zones": hazard_zones,
            "strategy": "all_hazards",
        })
    except Exception as exc:
        msg = f"Deterministic OSM router also failed: {type(exc).__name__}: {exc}"
        await _emit_reasoning("route_optimizer", msg)
        return {"result": msg, "steps": [], "fallback": True}

    distance_km = route_result.get("distance_km")
    eta_min = route_result.get("eta_minutes")
    status = route_result.get("status", "ok")
    path_len = len(route_result.get("path") or [])
    avoided = route_result.get("avoided_hazards") or []

    # Populate mission fields so the supervisor's downstream emit works.
    if mission is not None:
        if isinstance(distance_km, (int, float)):
            mission.route_distance_km = float(distance_km)
        if isinstance(eta_min, (int, float)):
            mission.route_eta_minutes = float(eta_min)

    summary = (
        f"Fallback route ready: {distance_km} km, ~{eta_min} min, "
        f"{path_len} waypoints"
        + (f", avoided {len(avoided)} hazard zone(s)" if avoided else "")
        + ". (LLM agent skipped — Gemini quota / error.)"
    )
    await _emit_reasoning("route_optimizer", summary)

    # Emit ROUTE_COMPUTED event so frontend map can draw the path.
    try:
        await get_bus().publish(Event(
            type=EventType.ROUTE_COMPUTED,
            payload={
                "mission_id": getattr(mission, "mission_id", None),
                "incident_id": incident.get("incident_id"),
                "citizen_id": incident.get("citizen_id"),
                "distance_km": distance_km,
                "eta_minutes": eta_min,
                "path": route_result.get("path"),
                "status": status,
                "avoided_hazards": avoided,
                "fallback": True,
            },
            source_agent="route_optimizer",
        ))
    except Exception as exc:
        logger.debug("route fallback ROUTE_COMPUTED emit failed: %s", exc)

    return {
        "result": summary,
        "steps": [{"type": "tool_call", "tool": "compute_osm_route", "args": {}}],
        "fallback": True,
        "raw": route_result,
    }


async def run_communications(situation_result: str, hazard_result: str, incident: dict) -> dict:
    await _emit_reasoning("communications", "Composing geofenced citizen alert...")
    return await _run_agent(_get_comms(), _build_comms_prompt(situation_result, hazard_result, incident), "communications")


# --- Negotiation Protocol ---

async def negotiate_mission(
    dispatch_text: str,
    incident: dict,
    mission,  # Mission object
) -> dict:
    """Run the negotiation protocol with Field Commanders.

    The Dispatch Strategist chose a base. We now ask that base's
    Field Commander to ACCEPT, DECLINE, or COUNTER-PROPOSE.
    If declined, we try the next best base (up to MAX_NEGOTIATION_ROUNDS).
    """
    import json as _json
    from backend.tools.resource_db import get_rescue_bases

    base_id = _extract_base_id_from_dispatch(dispatch_text)

    raw_bases = get_rescue_bases.invoke({
        "near_lat": incident["coordinates"][0] if incident.get("coordinates") else 12.9716,
        "near_lng": incident["coordinates"][1] if incident.get("coordinates") else 77.5946,
        "disaster_type": incident.get("disaster_type", ""),
        "max_results": 5,
    })
    if isinstance(raw_bases, str):
        all_bases = _json.loads(raw_bases)
    elif isinstance(raw_bases, dict):
        all_bases = raw_bases.get("bases", [raw_bases])
    elif isinstance(raw_bases, list):
        all_bases = raw_bases
    else:
        all_bases = _json.loads(str(raw_bases))

    bases_by_id = {b["id"]: b for b in all_bases}

    tried_bases = set()
    accepted_by = None

    for round_num in range(MAX_NEGOTIATION_ROUNDS):
        if base_id and base_id in bases_by_id:
            target_base = bases_by_id[base_id]
        else:
            remaining = [b for b in all_bases if b["id"] not in tried_bases]
            if not remaining:
                break
            target_base = remaining[0]
            base_id = target_base["id"]

        tried_bases.add(base_id)

        await _emit_reasoning(
            "supervisor",
            f"Negotiation round {round_num + 1}: Proposing mission to {target_base['name']}...",
        )

        await _emit_mission_event(
            EventType.MISSION_PROPOSED,
            mission.mission_id,
            {"base_id": base_id, "base_name": target_base["name"], "round": round_num + 1},
        )

        mission.status = MissionStatus.NEGOTIATING
        mission.add_negotiation(
            agent="supervisor",
            action="propose",
            reasoning=f"Proposing to {target_base['name']} (round {round_num + 1})",
            details={"base_id": base_id},
        )

        response = await propose_mission_to_commander(target_base, incident, dispatch_text)

        decision = response["decision"]
        commander_name = response["commander_name"]

        mission.add_negotiation(
            agent=commander_name,
            action=decision,
            reasoning=response["full_response"][:500],
            details={"base_id": base_id},
        )

        if decision == "accept":
            await _emit_reasoning(
                commander_name,
                f"ACCEPTED mission. {response['full_response'][:200]}",
            )
            await _emit_mission_event(
                EventType.MISSION_ACCEPTED,
                mission.mission_id,
                {"base_id": base_id, "base_name": target_base["name"], "commander": commander_name},
            )
            mission.status = MissionStatus.ACCEPTED
            mission.assigned_base_id = base_id
            mission.assigned_base_name = target_base["name"]
            mission.assigned_commander = commander_name
            accepted_by = target_base
            break

        elif decision == "decline":
            await _emit_reasoning(
                commander_name,
                f"DECLINED mission. {response['full_response'][:200]}",
            )
            await _emit_mission_event(
                EventType.MISSION_DECLINED,
                mission.mission_id,
                {"base_id": base_id, "base_name": target_base["name"], "commander": commander_name},
            )
            alt_match = re.search(r"alternative.*?(base_\w+)", response["full_response"], re.IGNORECASE)
            base_id = alt_match.group(1) if alt_match else None

        elif decision == "counter_propose":
            await _emit_reasoning(
                commander_name,
                f"COUNTER-PROPOSED. {response['full_response'][:200]}",
            )
            await _emit_mission_event(
                EventType.MISSION_COUNTER_PROPOSED,
                mission.mission_id,
                {"base_id": base_id, "base_name": target_base["name"], "commander": commander_name,
                 "counter_proposal": response["full_response"][:300]},
            )
            mission.status = MissionStatus.ACCEPTED
            mission.assigned_base_id = base_id
            mission.assigned_base_name = target_base["name"]
            mission.assigned_commander = commander_name
            accepted_by = target_base
            break

    return {
        "accepted": accepted_by is not None,
        "base": accepted_by,
        "rounds": len(tried_bases),
        "negotiation_history": [n.to_dict() for n in mission.negotiation_history],
    }


# --- Main Pipeline ---

async def process_incident(incident: dict) -> dict:
    """Full pipeline with negotiation: process an incident through all agents."""
    results = {"incident": incident, "agent_outputs": {}}
    tracker = get_tracker()

    # Bind incident_id / citizen_id to this asyncio task so all nested
    # emits (reasoning, tool calls, mission events) carry the same metadata.
    token = _current_incident.set(incident)
    try:
        return await _process_incident_inner(incident, results, tracker)
    finally:
        _current_incident.reset(token)


async def _process_incident_inner(incident: dict, results: dict, tracker) -> dict:
    await _emit_stage(
        incident,
        "supervisor",
        "running",
        "Report received. Coordinating six agents to evaluate your incident.",
    )

    # Step 1: Situation Awareness
    await _emit_stage(
        incident,
        "situation_awareness",
        "running",
        "Reading your description, geocoding, and corroborating with weather, news, and disaster feeds.",
    )
    situation = await run_situation_assessment(incident)
    results["agent_outputs"]["situation"] = situation
    situation_text = situation.get("result", "")
    await _emit_stage(
        incident,
        "situation_awareness",
        "done",
        "Situation classified.",
    )

    is_disaster = "is_disaster: true" in situation_text.lower() or \
                  "severity" in situation_text.lower()

    if not is_disaster and "not a disaster" in situation_text.lower():
        await _emit_reasoning("supervisor", "Situation classified as non-disaster. Pipeline terminated.")
        await _emit_stage(
            incident,
            "supervisor",
            "done",
            "Classified as non-emergency. No dispatch needed — stay alert and call 112 if conditions change.",
            {"outcome": "non_disaster"},
        )
        results["terminated_at"] = "situation_awareness"
        return results

    # Step 2: Hazard Assessment
    await _emit_stage(
        incident,
        "hazard_assessment",
        "running",
        "Deciding whether to declare or update a hazard zone around your location.",
    )
    hazard = await run_hazard_assessment(situation_text, incident)
    results["agent_outputs"]["hazard"] = hazard
    hazard_text = hazard.get("result", "")
    await _emit_stage(
        incident,
        "hazard_assessment",
        "done",
        "Hazard zone evaluated.",
    )

    # Step 3: Communications
    await _emit_stage(
        incident,
        "communications",
        "running",
        "Drafting an alert for nearby citizens.",
    )
    comms = await run_communications(situation_text, hazard_text, incident)
    results["agent_outputs"]["communications"] = comms
    await _emit_stage(
        incident,
        "communications",
        "done",
        "Public alert dispatched to citizens in the geofence.",
    )

    # Step 4: Dispatch + Negotiation (if severity warrants it)
    severity_high = any(
        kw in situation_text.lower()
        for kw in ["severity: 3", "severity: 4", "severity: 5",
                    "severity\":3", "severity\":4", "severity\":5",
                    "high", "critical"]
    )

    if severity_high:
        await _emit_stage(
            incident,
            "dispatch_strategist",
            "running",
            "Selecting the best rescue base for your incident.",
        )
        dispatch = await run_dispatch(situation_text, hazard_text, incident)
        results["agent_outputs"]["dispatch"] = dispatch
        dispatch_text = dispatch.get("result", "")
        await _emit_stage(
            incident,
            "dispatch_strategist",
            "done",
            "Candidate base chosen.",
        )

        if "chosen_base" in dispatch_text.lower() or "dispatch" in dispatch_text.lower():
            severity_num = incident.get("severity_hint", 3)
            for s in ["5", "4", "3", "2", "1"]:
                if f"severity: {s}" in situation_text.lower() or f"severity\":{s}" in situation_text.lower():
                    severity_num = int(s)
                    break

            mission = tracker.create_mission(
                incident_id=incident.get("incident_id", "unknown"),
                disaster_type=incident.get("disaster_type", "unknown"),
                severity=severity_num,
                incident_coordinates=incident.get("coordinates", [0, 0]),
            )

            await _emit_reasoning("supervisor", f"Mission {mission.mission_id} created. Starting negotiation...")
            await _emit_stage(
                incident,
                "negotiation",
                "running",
                "Asking the Field Commander to accept this mission.",
                {"mission_id": mission.mission_id},
            )

            # Step 5: Negotiation with Field Commanders
            negotiation = await negotiate_mission(dispatch_text, incident, mission)
            results["agent_outputs"]["negotiation"] = negotiation

            # Step 6: Route Optimization (if a base accepted)
            if negotiation["accepted"]:
                accepted_base = negotiation.get("base") or {}
                await _emit_stage(
                    incident,
                    "negotiation",
                    "done",
                    f"{accepted_base.get('name', 'A nearby base')} accepted the mission.",
                    {
                        "mission_id": mission.mission_id,
                        "base_name": accepted_base.get("name"),
                        "rounds": negotiation.get("rounds"),
                    },
                )

                await _emit_stage(
                    incident,
                    "route_optimizer",
                    "running",
                    "Computing the safest, fastest route while avoiding hazard zones.",
                )
                route = await run_route_optimization(
                    dispatch_text,
                    incident,
                    accepted_base=accepted_base,
                    mission=mission,
                )
                results["agent_outputs"]["route"] = route

                mission.status = MissionStatus.EN_ROUTE
                mission.add_negotiation(
                    agent="supervisor",
                    action="en_route",
                    reasoning="Route computed, team dispatched.",
                )

                eta_msg = (
                    f"ETA {mission.route_eta_minutes:.0f} min"
                    if getattr(mission, "route_eta_minutes", None)
                    else "Route ready"
                )
                await _emit_stage(
                    incident,
                    "route_optimizer",
                    "done",
                    f"{eta_msg}. Team is en route from {accepted_base.get('name', 'the rescue base')}.",
                    {
                        "mission_id": mission.mission_id,
                        "base_name": accepted_base.get("name"),
                        "eta_minutes": getattr(mission, "route_eta_minutes", None),
                        "distance_km": getattr(mission, "route_distance_km", None),
                    },
                )

                await _emit_stage(
                    incident,
                    "supervisor",
                    "done",
                    f"Help is on the way from {accepted_base.get('name', 'a nearby base')}.",
                    {"outcome": "dispatched", "mission_id": mission.mission_id},
                )
            else:
                await _emit_reasoning(
                    "supervisor",
                    f"All bases declined mission {mission.mission_id}. Escalating.",
                )
                await _emit_stage(
                    incident,
                    "negotiation",
                    "error",
                    "All nearby bases are unavailable. Operator has been notified to escalate.",
                    {"mission_id": mission.mission_id},
                )
                await _emit_stage(
                    incident,
                    "supervisor",
                    "error",
                    "No team could accept the mission immediately — your report has been escalated.",
                    {"outcome": "escalated"},
                )
                mission.status = MissionStatus.CANCELLED
    else:
        await _emit_reasoning("supervisor", "Severity below dispatch threshold. Advisory-only mode.")
        await _emit_stage(
            incident,
            "dispatch_strategist",
            "skipped",
            "Severity below dispatch threshold — advisory-only.",
        )
        await _emit_stage(
            incident,
            "supervisor",
            "done",
            "Logged as advisory. Stay alert; call 112 if the situation worsens.",
            {"outcome": "advisory"},
        )

    await _emit_reasoning("supervisor", "Incident processing complete.")
    return results


# --- Prompt builders ---

def _build_situation_prompt(incident: dict) -> str:
    parts = ["Analyze this incoming disaster report:\n"]
    if incident.get("description"):
        parts.append(f"Description: \"{incident['description']}\"")
    if incident.get("disaster_type"):
        parts.append(f"Reported disaster type: {incident['disaster_type']}")
    if incident.get("coordinates"):
        parts.append(f"Coordinates: {incident['coordinates']}")
    if incident.get("location_text"):
        parts.append(f"Location text: \"{incident['location_text']}\"")
    if incident.get("severity_hint"):
        parts.append(f"Citizen severity estimate: {incident['severity_hint']}/5")
    if incident.get("image_id"):
        parts.append(
            f"Citizen-uploaded image attached. image_id={incident['image_id']}. "
            "Call analyze_disaster_image with this image_id BEFORE other tools."
        )
    if incident.get("citizen_history"):
        ch = incident["citizen_history"]
        parts.append(
            f"Citizen history: {ch.get('report_count', 0)} prior reports, "
            f"{ch.get('sos_count', 0)} prior SOS, first seen {ch.get('first_seen')}."
        )
        if ch.get("recent"):
            parts.append(f"Recent activity: {ch['recent']}")
    if incident.get("is_sos"):
        parts.append("THIS IS AN SOS DISTRESS SIGNAL — treat as highest priority.")
    parts.append("\nPerform your full analysis using your tools, then provide your structured assessment.")
    return "\n".join(parts)


def _build_hazard_prompt(situation_result: str, incident: dict) -> str:
    parts = [
        "Based on this situation assessment, evaluate and manage hazard zones:\n",
        f"Situation Assessment:\n{situation_result}\n",
    ]
    if incident.get("coordinates"):
        parts.append(f"Incident coordinates: {incident['coordinates']}")
    if incident.get("disaster_type"):
        parts.append(f"Disaster type: {incident['disaster_type']}")
    parts.append("\nDecide whether to CREATE, UPGRADE, DOWNGRADE, CLEAR, or take NO ACTION on hazard zones.")
    return "\n".join(parts)


def _build_dispatch_prompt(situation_result: str, hazard_result: str, incident: dict) -> str:
    parts = [
        "A disaster incident requires dispatch. Select the best rescue base:\n",
        f"Situation: {situation_result[:500]}\n",
        f"Hazard Status: {hazard_result[:300]}\n",
    ]
    if incident.get("coordinates"):
        parts.append(f"Incident location: {incident['coordinates']}")
    if incident.get("disaster_type"):
        parts.append(f"Disaster type: {incident['disaster_type']}")
    parts.append("\nQuery available bases, evaluate options, and propose a dispatch.")
    return "\n".join(parts)


def _build_route_prompt(dispatch_result: str, incident: dict) -> str:
    parts = [
        "A rescue team has been dispatched. Compute the optimal route:\n",
        f"Dispatch Info: {dispatch_result[:500]}\n",
    ]
    if incident.get("coordinates"):
        parts.append(f"Destination (incident): {incident['coordinates']}")
    parts.append(
        "\nCompute multiple candidate routes, check traffic, "
        "validate with TomTom, and select the best one with justification."
    )
    return "\n".join(parts)


def _build_comms_prompt(situation_result: str, hazard_result: str, incident: dict) -> str:
    parts = [
        "Compose and broadcast a citizen alert for this incident:\n",
        f"Situation: {situation_result[:400]}\n",
        f"Hazard: {hazard_result[:300]}\n",
    ]
    if incident.get("coordinates"):
        parts.append(f"Incident location: {incident['coordinates']}")
    if incident.get("disaster_type"):
        parts.append(f"Disaster type: {incident['disaster_type']}")
    parts.append("\nCompose an appropriate alert and broadcast it to nearby citizens.")
    return "\n".join(parts)
