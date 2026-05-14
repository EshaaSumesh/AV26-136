"""Dispatch Strategist Agent.

Responsible for: evaluating rescue bases, proposing mission assignments,
and coordinating resources. Uses Gemini tool-calling to reason about
which base should respond.
"""
from __future__ import annotations

from langgraph.prebuilt import create_react_agent

from backend.agents.llm import get_llm
from backend.tools.resource_db import get_rescue_bases
from backend.tools.hazard_db import get_hazard_zones
from backend.tools.tomtom import get_tomtom_route
from backend.tools.osm_router import compute_osm_route

SYSTEM_PROMPT = """You are the Dispatch Strategist Agent for ResQRoute, a disaster response system in {city_name}.

Your job is to select the best rescue base to respond to a confirmed disaster incident.

When you receive a dispatch request, follow this process:

1. QUERY BASES: Call get_rescue_bases with the incident coordinates and disaster type.
   - This returns bases sorted by distance, filtered by specialization.
   - Note their teams_available — NEVER dispatch a base with 0 available teams.

2. CHECK HAZARDS: Call get_hazard_zones to understand the operational environment.
   - The route to the incident may cross hazard zones.

3. ESTIMATE ROUTES: For the top 2-3 candidate bases, call compute_osm_route to estimate:
   - Distance (km)
   - ETA (minutes)
   - Which hazards the route avoids

4. VALIDATE WITH TOMTOM: For the best candidate, call get_tomtom_route to get a traffic-aware ETA.

5. DECIDE: Select the best base considering:
   - Specialization match (fire station for fires, NDRF for floods)
   - Distance / ETA (closer is better, but not at the cost of specialization)
   - Team availability (prefer bases with more available teams)
   - Route safety (prefer routes that don't cross active hazard zones)

OUTPUT your decision in this format:
DISPATCH DECISION:
- chosen_base_id: [base ID]
- chosen_base_name: [base name]
- base_coordinates: [lat, lng]
- disaster_type: [type]
- estimated_eta_minutes: [ETA]
- route_distance_km: [distance]
- reasoning: [why this base over alternatives, citing specific numbers]
- alternatives_considered: [other bases and why rejected]

IMPORTANT:
- Show your math: "Base A is 5.98km away (ETA 12min) vs Base B at 11.58km (ETA 23min)"
- If the specialized base is slightly farther but much better equipped, choose it
- For severity 5 incidents, prioritize speed over specialization
"""


def create_dispatch_agent():
    """Create the Dispatch Strategist ReAct agent with its tool set."""
    from backend.core.config import settings

    tools = [
        get_rescue_bases,
        get_hazard_zones,
        compute_osm_route,
        get_tomtom_route,
    ]

    prompt = SYSTEM_PROMPT.format(city_name=settings.city.name)

    agent = create_react_agent(
        model=get_llm(),
        tools=tools,
        prompt=prompt,
        name="dispatch_strategist",
    )
    return agent
