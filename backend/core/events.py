"""Event type definitions for the agent event bus."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional


class EventType(str, Enum):
    # Ingestion
    CITIZEN_REPORT_SUBMITTED = "citizen.report.submitted"
    SOS_TRIGGERED = "citizen.sos.triggered"
    EXTERNAL_ALERT_RECEIVED = "external.alert.received"

    # Situation awareness
    SITUATION_ASSESSED = "situation.assessed"

    # Hazard management
    HAZARD_ZONE_PROPOSED = "hazard.zone.proposed"
    HAZARD_ZONE_CONFIRMED = "hazard.zone.confirmed"
    HAZARD_ZONE_UPDATED = "hazard.zone.updated"
    HAZARD_ZONE_CLEARED = "hazard.zone.cleared"

    # Dispatch & missions
    MISSION_PROPOSED = "mission.proposed"
    MISSION_ACCEPTED = "mission.accepted"
    MISSION_DECLINED = "mission.declined"
    MISSION_COUNTER_PROPOSED = "mission.counter_proposed"
    MISSION_COMPLETED = "mission.completed"

    # Routing
    ROUTE_COMPUTED = "route.computed"
    ROUTE_INVALIDATED = "route.invalidated"
    ROUTE_RECOMPUTED = "route.recomputed"

    # Communications
    PUBLIC_ALERT_BROADCAST = "public.alert.broadcast"

    # Social intel
    SOCIAL_SIGNAL_SCORED = "social.signal.scored"

    # Agent observability
    AGENT_REASONING = "agent.reasoning"
    AGENT_TOOL_CALL = "agent.tool_call"
    AGENT_ERROR = "agent.error"


@dataclass
class Event:
    type: EventType
    payload: dict
    source_agent: Optional[str] = None
    id: str = field(default_factory=lambda: f"evt_{uuid.uuid4().hex[:12]}")
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "payload": self.payload,
            "source_agent": self.source_agent,
            "timestamp": self.timestamp,
        }
