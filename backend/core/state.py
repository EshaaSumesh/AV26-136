"""Shared agent state schema.

This TypedDict is used as the LangGraph state that flows between agents.
Each agent reads what it needs and writes its outputs.
"""
from __future__ import annotations

from typing import Any, Optional
from typing_extensions import TypedDict


class IncidentState(TypedDict, total=False):
    """State for a single incident flowing through the agent pipeline."""

    # Ingestion
    incident_id: str
    raw_text: str
    citizen_id: Optional[str]
    coordinates: Optional[list[float]]
    location_text: Optional[str]
    photo_b64: Optional[str]
    is_sos: bool
    submitted_at: str

    # Situation assessment
    is_disaster: bool
    disaster_type: Optional[str]
    severity: int
    confidence: float
    affected_entities: list[str]
    situation_reasoning: str
    geocoding_tier: int

    # External corroboration
    gdacs_match: Optional[dict]
    news_corroboration: Optional[dict]
    weather_context: Optional[dict]

    # Hazard zone
    hazard_zone_id: Optional[str]
    hazard_zone: Optional[dict]

    # Dispatch
    mission_id: Optional[str]
    assigned_base_id: Optional[str]
    assigned_base_name: Optional[str]
    assigned_base_coordinates: Optional[list[float]]
    dispatch_reasoning: str

    # Route
    route_path: Optional[list[list[float]]]
    route_distance_km: Optional[float]
    route_eta_minutes: Optional[float]
    route_avoided_hazards: list[str]
    route_candidates: list[dict]
    route_justification: str
    tomtom_validated_eta: Optional[float]

    # Communications
    broadcast_id: Optional[str]
    broadcast_message: Optional[str]
    broadcast_radius_km: Optional[float]

    # Agent trace
    agent_log: list[dict[str, Any]]
    errors: list[str]
