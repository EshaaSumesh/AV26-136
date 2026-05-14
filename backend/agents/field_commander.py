"""Field Commander Agent.

Each rescue base has a Field Commander — an LLM agent that reasons about
whether to ACCEPT, DECLINE, or COUNTER-PROPOSE a mission assignment.

Unlike the old system which used fixed distance thresholds, the commander
considers capacity, specialization, current deployments, and disaster context.
"""
from __future__ import annotations

import logging
from typing import Optional

from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage

from backend.agents.llm import get_llm
from backend.tools.resource_db import get_rescue_bases
from backend.tools.hazard_db import get_hazard_zones
from backend.tools.weather import get_weather
from backend.tools.tomtom import get_traffic_flow

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a Field Commander for rescue base "{base_name}" ({base_type}) in {city_name}.

Your base is located at coordinates [{base_lat}, {base_lng}].
Your specializations: {specializations}
Current teams available: {teams_available}

When you receive a MISSION PROPOSAL, you must evaluate it and make ONE decision:

1. ACCEPT — You have capacity and your base is well-suited for this mission.
   - You should accept if:
     * The disaster type matches your specialization
     * You have >= 1 team available
     * The ETA is reasonable (under 30 minutes for severity 4-5, under 45 for 1-3)
     * No extreme weather or hazard on route

2. DECLINE — You cannot or should not take this mission.
   - Valid reasons to decline:
     * 0 teams available (ALWAYS decline in this case)
     * Disaster type completely outside your capability
     * Another active high-priority mission depletes your reserves
   - If declining, MUST suggest an alternative base

3. COUNTER-PROPOSE — You can partially help, or suggest a modification.
   - You might suggest: sending a smaller team, requesting backup from another base,
     suggesting a staging area closer to the incident, or proposing a joint response.

Your reasoning must be SPECIFIC and cite your capacity. For example:
- "I have 3 teams available, 2 already deployed on flood response in Whitefield.
   I can spare 1 team for this Severity-4 building collapse, but recommend requesting
   NDRF backup given the structural risk."

OUTPUT FORMAT:
COMMANDER DECISION: [ACCEPT/DECLINE/COUNTER_PROPOSE]
- base_id: {base_id}
- base_name: {base_name}
- teams_available: [current count]
- teams_to_deploy: [number you'd send]
- reasoning: [your specific reasoning with capacity numbers]
- alternative_base: [if declining, which base should handle it]
- counter_proposal: [if counter-proposing, what modification]
- weather_concern: [any weather factor affecting your decision]
"""


def create_field_commander(base: dict) -> object:
    """Create a Field Commander agent for a specific rescue base."""
    from backend.core.config import settings

    tools = [
        get_rescue_bases,
        get_hazard_zones,
        get_weather,
        get_traffic_flow,
    ]

    prompt = SYSTEM_PROMPT.format(
        base_name=base["name"],
        base_type=base["type"],
        base_id=base["id"],
        base_lat=base["coordinates"][0],
        base_lng=base["coordinates"][1],
        specializations=", ".join(base.get("specialization", [])),
        teams_available=base.get("teams_available", 0),
        city_name=settings.city.name,
    )

    agent = create_react_agent(
        model=get_llm(),
        tools=tools,
        prompt=prompt,
        name=f"field_commander_{base['id']}",
    )
    return agent


_commanders = {}


def get_commander(base: dict) -> object:
    """Get or lazily create a Field Commander for a base."""
    base_id = base["id"]
    if base_id not in _commanders:
        _commanders[base_id] = create_field_commander(base)
        logger.info("Created Field Commander for %s", base["name"])
    return _commanders[base_id]


async def propose_mission_to_commander(
    base: dict,
    incident: dict,
    dispatch_context: str,
) -> dict:
    """Send a mission proposal to a base's Field Commander and get their decision."""
    from backend.core.metrics import Timer, get_metrics

    commander = get_commander(base)
    prompt = _build_proposal_prompt(base, incident, dispatch_context)

    metrics = get_metrics()
    commander_name = f"field_commander_{base['id']}"
    metrics.record_edge("dispatch_strategist", commander_name)

    import time as _time
    start = _time.perf_counter()
    success = True
    result = None
    try:
        result = await commander.ainvoke({"messages": [HumanMessage(content=prompt)]})
    except Exception:
        success = False
        raise
    finally:
        duration_ms = (_time.perf_counter() - start) * 1000
        metrics.record_agent(commander_name, duration_ms, success)

    final_message = result["messages"][-1].content if result.get("messages") else ""

    decision = "accept"
    if "DECLINE" in final_message.upper():
        decision = "decline"
    elif "COUNTER_PROPOSE" in final_message.upper() or "COUNTER-PROPOSE" in final_message.upper():
        decision = "counter_propose"

    return {
        "base_id": base["id"],
        "base_name": base["name"],
        "decision": decision,
        "full_response": final_message,
        "commander_name": commander_name,
    }


def _build_proposal_prompt(base: dict, incident: dict, dispatch_context: str) -> str:
    parts = [
        "INCOMING MISSION PROPOSAL:\n",
        f"Disaster Type: {incident.get('disaster_type', 'unknown')}",
        f"Severity: {incident.get('severity_hint', 3)}/5",
        f"Incident Location: {incident.get('coordinates', 'unknown')}",
        f"Description: \"{incident.get('description', 'No description')}\"",
    ]
    if incident.get("is_sos"):
        parts.append("THIS IS AN SOS DISTRESS SIGNAL — HIGHEST PRIORITY.")
    parts.append(f"\nDispatch Assessment:\n{dispatch_context[:500]}")
    parts.append("\nEvaluate this proposal and issue your decision.")
    return "\n".join(parts)
