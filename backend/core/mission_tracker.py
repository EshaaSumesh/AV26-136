"""Mission Tracker — manages active/completed missions and negotiation history.

Each mission goes through:
  PROPOSED -> NEGOTIATING -> ACCEPTED -> EN_ROUTE -> ON_SITE -> COMPLETED
  (or PROPOSED -> DECLINED -> REASSIGNED -> ...)
"""
from __future__ import annotations

import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class MissionStatus(str, Enum):
    PROPOSED = "proposed"
    NEGOTIATING = "negotiating"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EN_ROUTE = "en_route"
    ON_SITE = "on_site"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


@dataclass
class NegotiationEntry:
    """A single step in the negotiation history."""
    timestamp: str
    agent: str
    action: str  # propose, accept, decline, counter_propose
    reasoning: str
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "agent": self.agent,
            "action": self.action,
            "reasoning": self.reasoning,
            "details": self.details,
        }


@dataclass
class Mission:
    """Represents a single rescue mission from proposal to completion."""
    mission_id: str
    incident_id: str
    disaster_type: str
    severity: int
    incident_coordinates: List[float]
    status: MissionStatus = MissionStatus.PROPOSED
    assigned_base_id: Optional[str] = None
    assigned_base_name: Optional[str] = None
    assigned_commander: Optional[str] = None
    route_path: Optional[List[List[float]]] = None
    route_distance_km: Optional[float] = None
    route_eta_minutes: Optional[float] = None
    negotiation_history: List[NegotiationEntry] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None

    def add_negotiation(self, agent: str, action: str, reasoning: str, details: Optional[dict] = None):
        entry = NegotiationEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            agent=agent,
            action=action,
            reasoning=reasoning,
            details=details or {},
        )
        self.negotiation_history.append(entry)
        self.updated_at = entry.timestamp

    def to_dict(self) -> dict:
        return {
            "mission_id": self.mission_id,
            "incident_id": self.incident_id,
            "disaster_type": self.disaster_type,
            "severity": self.severity,
            "incident_coordinates": self.incident_coordinates,
            "status": self.status.value,
            "assigned_base_id": self.assigned_base_id,
            "assigned_base_name": self.assigned_base_name,
            "assigned_commander": self.assigned_commander,
            "route_path": self.route_path,
            "route_distance_km": self.route_distance_km,
            "route_eta_minutes": self.route_eta_minutes,
            "negotiation_history": [n.to_dict() for n in self.negotiation_history],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
        }


class MissionTracker:
    """In-memory mission state manager."""

    def __init__(self) -> None:
        self._missions: Dict[str, Mission] = {}

    def create_mission(
        self,
        incident_id: str,
        disaster_type: str,
        severity: int,
        incident_coordinates: List[float],
    ) -> Mission:
        mission_id = f"msn_{uuid.uuid4().hex[:8]}"
        mission = Mission(
            mission_id=mission_id,
            incident_id=incident_id,
            disaster_type=disaster_type,
            severity=severity,
            incident_coordinates=incident_coordinates,
        )
        self._missions[mission_id] = mission
        logger.info("Mission created: %s for incident %s", mission_id, incident_id)
        return mission

    def get_mission(self, mission_id: str) -> Optional[Mission]:
        return self._missions.get(mission_id)

    def get_missions_by_incident(self, incident_id: str) -> List[Mission]:
        return [m for m in self._missions.values() if m.incident_id == incident_id]

    def active_missions(self) -> List[Mission]:
        active_statuses = {
            MissionStatus.PROPOSED,
            MissionStatus.NEGOTIATING,
            MissionStatus.ACCEPTED,
            MissionStatus.EN_ROUTE,
            MissionStatus.ON_SITE,
        }
        return [m for m in self._missions.values() if m.status in active_statuses]

    def update_status(self, mission_id: str, status: MissionStatus) -> Optional[Mission]:
        mission = self._missions.get(mission_id)
        if mission:
            mission.status = status
            mission.updated_at = datetime.now(timezone.utc).isoformat()
            if status == MissionStatus.COMPLETED:
                mission.completed_at = mission.updated_at
        return mission

    def all_missions(self) -> List[Mission]:
        return sorted(self._missions.values(), key=lambda m: m.created_at, reverse=True)

    @property
    def stats(self) -> dict:
        statuses = {}
        for m in self._missions.values():
            statuses[m.status.value] = statuses.get(m.status.value, 0) + 1
        return {
            "total": len(self._missions),
            "by_status": statuses,
        }


_tracker: Optional[MissionTracker] = None


def get_tracker() -> MissionTracker:
    global _tracker
    if _tracker is None:
        _tracker = MissionTracker()
    return _tracker
