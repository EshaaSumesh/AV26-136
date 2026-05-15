"""FastAPI application — ResQRoute multi-agent backend.

Boot sequence:
1. Load road graph (OSMnx pickle) for hazard-aware routing
2. Initialize event bus + WebSocket manager
3. Register LangGraph agent scaffolds
4. Wire WebSocket broadcasters for real-time frontend updates
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.core.config import settings
from backend.core.event_bus import get_bus
from backend.core.events import Event, EventType
from backend.core.ws_manager import get_ws
from backend.core.mission_tracker import get_tracker
from backend.tools.osm_router import load_graph
from backend.api.routes import citizen, authority, hazards, missions, observability, demo

logging.basicConfig(
    level=getattr(logging, settings.server.log_level, logging.INFO),
    format="%(asctime)s %(levelname)-8s %(name)s :: %(message)s",
)
logger = logging.getLogger(__name__)

_agents: list = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Boot: load graph, register agents, wire WebSocket broadcasters."""
    load_graph()

    bus = get_bus()
    ws = get_ws()

    from backend.agents import register_all_agents
    registered = register_all_agents(bus)
    _agents.extend(registered)
    logger.info("Registered %d agent scaffolds", len(_agents))

    from backend.agents.reeval_loop import start_reeval_loop
    start_reeval_loop()
    logger.info("Continuous re-evaluation loop started")

    async def _authority_broadcast(event: Event) -> None:
        await ws.broadcast_authority({
            "type": "agent_event",
            "data": event.to_dict(),
        })
        if event.type == EventType.HAZARD_ZONE_CONFIRMED:
            await ws.broadcast_authority({
                "type": "new_hazard",
                "data": event.payload.get("zone", {}),
            })
        if event.type == EventType.ROUTE_COMPUTED:
            # Both the LLM agent and the deterministic OSM fallback publish
            # this event. Accept any with a `path` attached so the map can
            # render it; treat status="ok" or legacy found=True as valid.
            payload = event.payload or {}
            path = payload.get("path") or []
            ok = (
                payload.get("status") == "ok"
                or payload.get("found")
                or len(path) >= 2
            )
            if ok:
                await ws.broadcast_authority({
                    "type": "new_route",
                    "data": {
                        "mission_id": payload.get("mission_id"),
                        "incident_id": payload.get("incident_id"),
                        "path": path,
                        "distance_km": payload.get("distance_km"),
                        "eta_minutes": payload.get("eta_minutes"),
                        "avoided_hazards": payload.get("avoided_hazards", []),
                        "fallback": payload.get("fallback", False),
                    },
                })

    bus.add_broadcaster(_authority_broadcast)

    async def _citizen_dispatch(event: Event) -> None:
        if event.type != EventType.PUBLIC_ALERT_BROADCAST:
            return
        recipients = event.payload.get("recipient_ids") or []
        msg = {"type": "public_alert", "data": event.payload}
        if recipients:
            await ws.send_citizens(recipients, msg)
        else:
            await ws.broadcast_all_citizens(msg)

    bus.add_broadcaster(_citizen_dispatch)

    # Forward incident-tagged agent events to the citizen who owns that
    # incident, so the citizen page can render full per-stage reasoning.
    _PER_INCIDENT_TYPES = {
        EventType.AGENT_REASONING,
        EventType.AGENT_TOOL_CALL,
        EventType.AGENT_ERROR,
        EventType.MISSION_PROPOSED,
        EventType.MISSION_ACCEPTED,
        EventType.MISSION_DECLINED,
        EventType.MISSION_COUNTER_PROPOSED,
        EventType.MISSION_COMPLETED,
        EventType.ROUTE_COMPUTED,
        EventType.SOCIAL_SIGNAL_SCORED,
    }

    async def _citizen_incident_stream(event: Event) -> None:
        if event.type not in _PER_INCIDENT_TYPES:
            return
        citizen_id = event.payload.get("citizen_id")
        incident_id = event.payload.get("incident_id")
        if not citizen_id or not incident_id:
            return
        await ws.send_citizens(
            [citizen_id],
            {"type": "incident.agent_event", "data": event.to_dict()},
        )

    bus.add_broadcaster(_citizen_incident_stream)

    yield

    from backend.agents.reeval_loop import stop_reeval_loop
    stop_reeval_loop()
    logger.info("Re-evaluation loop stopped")


app = FastAPI(
    title="ResQRoute API",
    description="AI-driven rescue route optimization with autonomous agents",
    version="1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(citizen.router, prefix="/citizen", tags=["citizen"])
app.include_router(authority.router, prefix="/authority", tags=["authority"])
app.include_router(hazards.router, prefix="/hazards", tags=["hazards"])
app.include_router(missions.router, prefix="/missions", tags=["missions"])
app.include_router(observability.router, prefix="/metrics", tags=["metrics"])
app.include_router(demo.router, prefix="/demo", tags=["demo"])

_uploads_dir = settings.city.data_dir / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


@app.websocket("/ws")
async def authority_ws(ws: WebSocket):
    """Authority WebSocket — receives all agent events in real time."""
    manager = get_ws()
    await manager.connect_authority(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect_authority(ws)


@app.websocket("/ws/citizen/{citizen_id}")
async def citizen_ws(ws: WebSocket, citizen_id: str):
    """Citizen WebSocket — receives geofenced public alerts."""
    manager = get_ws()
    await manager.connect_citizen(ws, citizen_id)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect_citizen(citizen_id)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0",
        "city": settings.city.name,
        "agents": [getattr(a, "name", str(a)) for a in _agents],
        "tools_available": _list_tools(),
    }


def _list_tools() -> list[str]:
    from backend.tools import weather, tomtom, osm_router, gdacs, gnews, usgs
    from backend.tools import geocoder, hazard_db, resource_db, broadcast, vision, social_signals
    tools = []
    for mod in [weather, tomtom, osm_router, gdacs, gnews, usgs, geocoder, hazard_db,
                resource_db, broadcast, vision, social_signals]:
        for name in dir(mod):
            obj = getattr(mod, name)
            if hasattr(obj, "name") and hasattr(obj, "description"):
                tools.append(obj.name)
    return sorted(set(tools))
