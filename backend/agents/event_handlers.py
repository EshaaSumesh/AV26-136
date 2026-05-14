"""Event handlers that wire the agent pipeline to the event bus.

When a citizen report, SOS, or external alert arrives on the bus,
these handlers invoke the supervisor pipeline asynchronously.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Optional

from backend.core import citizen_store
from backend.core.alert_store import AlertStore
from backend.core.event_bus import EventBus, get_bus
from backend.core.events import Event, EventType

logger = logging.getLogger(__name__)

_store: Optional[AlertStore] = None


def _get_store() -> AlertStore:
    global _store
    if _store is None:
        _store = AlertStore()
    return _store


def _summarize_history(citizen_id: Optional[str]) -> Optional[dict]:
    """Compact summary of a citizen's prior reports for agent context."""
    if not citizen_id:
        return None
    rec = citizen_store.get_citizen(citizen_id)
    if not rec:
        return None
    reports = rec.get("reports", [])
    return {
        "citizen_id": citizen_id,
        "report_count": rec.get("report_count", 0),
        "sos_count": rec.get("sos_count", 0),
        "first_seen": rec.get("created_at"),
        "recent": [
            {
                "submitted_at": r.get("submitted_at"),
                "kind": r.get("kind"),
                "disaster_type": r.get("disaster_type"),
                "severity_hint": r.get("severity_hint"),
                "status": r.get("status"),
            }
            for r in reports[:5]
        ],
    }


async def on_citizen_report(event: Event) -> None:
    """Handle a citizen-submitted disaster report."""
    payload = event.payload
    logger.info("Processing citizen report from %s", payload.get("citizen_id"))

    incident = {
        "incident_id": payload.get("incident_id") or f"inc_{uuid.uuid4().hex[:8]}",
        "raw_text": payload.get("description", ""),
        "description": payload.get("description", ""),
        "citizen_id": payload.get("citizen_id"),
        "coordinates": payload.get("coordinates"),
        "location_text": payload.get("location_text"),
        "disaster_type": payload.get("disaster_type"),
        "severity_hint": payload.get("severity_hint", 3),
        "image_id": payload.get("image_id"),
        "image_url": payload.get("image_url"),
        "citizen_history": _summarize_history(payload.get("citizen_id")),
        "is_sos": False,
        "submitted_at": event.timestamp,
    }

    asyncio.create_task(_run_pipeline(incident))


async def on_sos_triggered(event: Event) -> None:
    """Handle an SOS distress signal — highest priority."""
    payload = event.payload
    logger.info("SOS triggered by citizen %s", payload.get("citizen_id"))

    incident = {
        "incident_id": payload.get("incident_id") or f"inc_{uuid.uuid4().hex[:8]}",
        "raw_text": payload.get("note", "SOS distress signal"),
        "description": payload.get("note", "SOS distress signal — immediate assistance needed"),
        "citizen_id": payload.get("citizen_id"),
        "coordinates": payload.get("coordinates"),
        "location_text": None,
        "disaster_type": payload.get("disaster_type", "sos_distress"),
        "severity_hint": 5,
        "image_id": payload.get("image_id"),
        "image_url": payload.get("image_url"),
        "citizen_history": _summarize_history(payload.get("citizen_id")),
        "is_sos": True,
        "submitted_at": event.timestamp,
    }

    asyncio.create_task(_run_pipeline(incident))


async def on_external_alert(event: Event) -> None:
    """Handle an alert from external systems (GDACS, USGS, etc.)."""
    payload = event.payload
    logger.info("External alert received: %s", payload.get("source", "unknown"))

    incident = {
        "incident_id": f"inc_{uuid.uuid4().hex[:8]}",
        "raw_text": payload.get("description", ""),
        "description": payload.get("description", ""),
        "citizen_id": None,
        "coordinates": payload.get("coordinates"),
        "location_text": payload.get("location_text"),
        "disaster_type": payload.get("disaster_type"),
        "severity_hint": payload.get("severity", 3),
        "is_sos": False,
        "submitted_at": event.timestamp,
    }

    asyncio.create_task(_run_pipeline(incident))


# Global concurrency limiter — Gemini quotas are tight, so cap parallel
# pipeline runs. Each pipeline already invokes 5+ agents in series.
_pipeline_sem = asyncio.Semaphore(2)


async def _run_pipeline(incident: dict) -> None:
    """Run the full agent pipeline for an incident (concurrency-limited)."""
    from backend.agents.supervisor import process_incident

    async with _pipeline_sem:
        try:
            result = await process_incident(incident)
            logger.info(
                "Pipeline complete for %s. Stages: %s",
                incident["incident_id"],
                list(result.get("agent_outputs", {}).keys()),
            )
            citizen_store.update_report_outcome(
                incident.get("citizen_id"),
                incident["incident_id"],
                status="processed",
                stages=list(result.get("agent_outputs", {}).keys()),
            )
        except Exception as exc:
            logger.exception("Pipeline failed for incident %s", incident["incident_id"])
            error_msg = _humanize_error(exc)
            citizen_store.update_report_outcome(
                incident.get("citizen_id"),
                incident["incident_id"],
                status="failed",
                error=error_msg,
            )
            bus = get_bus()
            await bus.publish(Event(
                type=EventType.AGENT_ERROR,
                payload={
                    "incident_id": incident["incident_id"],
                    "error": error_msg,
                },
                source_agent="supervisor",
            ))


def _humanize_error(exc: BaseException) -> str:
    """Produce a user-friendly error message from an exception chain."""
    msg = str(exc)
    chain = []
    cur: Optional[BaseException] = exc
    while cur is not None:
        chain.append(type(cur).__name__ + ": " + str(cur))
        cur = cur.__cause__ or cur.__context__
        if len(chain) > 5:
            break
    full = " | ".join(chain).lower()

    if "resource_exhausted" in full or "429" in full or "quota" in full:
        return (
            "Gemini API quota exhausted (429). Wait ~60s and try one scenario at a time. "
            "Check Vertex AI quotas in GCP console."
        )
    if "permission" in full or "403" in full:
        return "Vertex AI permission denied — check service account roles."
    if "deadline" in full or "timeout" in full:
        return "Upstream timeout — Gemini took too long to respond."
    if "connection" in full or "network" in full:
        return "Network error reaching an upstream API (Gemini / TomTom / Open-Meteo)."
    return f"Pipeline error: {msg[:200]}"


def register_event_handlers(bus: EventBus) -> None:
    """Subscribe all event handlers to the bus."""
    bus.subscribe(EventType.CITIZEN_REPORT_SUBMITTED, on_citizen_report)
    bus.subscribe(EventType.SOS_TRIGGERED, on_sos_triggered)
    bus.subscribe(EventType.EXTERNAL_ALERT_RECEIVED, on_external_alert)
    logger.info("Event handlers registered: citizen_report, sos, external_alert")
