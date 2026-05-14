"""Agent registration — called at server startup.

Registers event handlers that trigger the agent pipeline when
incidents arrive on the event bus.
"""
from __future__ import annotations

import logging

from backend.core.event_bus import EventBus

logger = logging.getLogger(__name__)

AGENT_NAMES = [
    "situation_awareness",
    "hazard_assessment",
    "dispatch_strategist",
    "route_optimizer",
    "communications",
]


class AgentHandle:
    """Lightweight handle representing a registered agent scaffold."""

    def __init__(self, name: str) -> None:
        self.name = name

    def __repr__(self) -> str:
        return f"AgentHandle({self.name!r})"


def register_all_agents(bus: EventBus) -> list:
    """Register agent event handlers with the bus.

    LangGraph agent creation is deferred to first invocation
    to avoid slow startup (Vertex AI auth happens on first LLM call).
    """
    from backend.agents.event_handlers import register_event_handlers
    register_event_handlers(bus)

    handles = []
    for name in AGENT_NAMES:
        handles.append(AgentHandle(name))
        logger.info("Registered agent scaffold: %s", name)
    return handles
