"""Async pub/sub event bus.

Agents subscribe to event types and react autonomously.
Handlers run as independent asyncio tasks so a slow agent never blocks others.
Every event is logged for full observability.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Awaitable, Callable, Optional

from backend.core.events import Event, EventType

logger = logging.getLogger(__name__)

EventHandler = Callable[[Event], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[EventType, list[EventHandler]] = defaultdict(list)
        self._broadcasters: list[EventHandler] = []
        self._log: list[Event] = []

    def subscribe(self, event_type: EventType, handler: EventHandler) -> None:
        self._subscribers[event_type].append(handler)
        logger.debug(
            "Subscribed %s to %s", getattr(handler, "__qualname__", "?"), event_type.value
        )

    def add_broadcaster(self, handler: EventHandler) -> None:
        """Broadcaster receives EVERY event (used for WebSocket fan-out)."""
        self._broadcasters.append(handler)

    async def publish(self, event: Event) -> None:
        self._log.append(event)
        logger.info(
            "EVT %-30s from=%s",
            event.type.value,
            event.source_agent or "system",
        )

        for handler in self._broadcasters:
            asyncio.create_task(self._safe_call(handler, event))

        for handler in self._subscribers.get(event.type, []):
            asyncio.create_task(self._safe_call(handler, event))

    @staticmethod
    async def _safe_call(handler: EventHandler, event: Event) -> None:
        try:
            await handler(event)
        except Exception:
            logger.exception("Handler failed for event %s", event.type.value)

    def history(self, limit: int = 500) -> list[Event]:
        return self._log[-limit:]

    def reasoning_history(self, limit: int = 200) -> list[Event]:
        observable = {
            EventType.AGENT_REASONING,
            EventType.AGENT_TOOL_CALL,
            EventType.AGENT_ERROR,
            EventType.SITUATION_ASSESSED,
            EventType.HAZARD_ZONE_PROPOSED,
            EventType.HAZARD_ZONE_CONFIRMED,
            EventType.HAZARD_ZONE_UPDATED,
            EventType.MISSION_PROPOSED,
            EventType.MISSION_ACCEPTED,
            EventType.MISSION_DECLINED,
            EventType.MISSION_COUNTER_PROPOSED,
            EventType.ROUTE_COMPUTED,
            EventType.ROUTE_INVALIDATED,
            EventType.ROUTE_RECOMPUTED,
            EventType.PUBLIC_ALERT_BROADCAST,
            EventType.CITIZEN_REPORT_SUBMITTED,
            EventType.SOS_TRIGGERED,
            EventType.EXTERNAL_ALERT_RECEIVED,
        }
        return [e for e in self._log if e.type in observable][-limit:]

    @property
    def event_count(self) -> int:
        return len(self._log)

    async def publish_replay(self, event: Event) -> None:
        """Re-broadcast a captured event WITHOUT re-running agent handlers.

        Used by the demo replay endpoint: subscribers (situation /
        hazard / dispatch / etc.) would re-trigger LLM calls which is
        the very thing replay is designed to avoid. Broadcasters
        (WebSocket fan-out, observability) DO run so the UI lights up
        exactly as it did during the original recording.
        """
        self._log.append(event)
        for handler in self._broadcasters:
            asyncio.create_task(self._safe_call(handler, event))


_bus: Optional[EventBus] = None


def get_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
