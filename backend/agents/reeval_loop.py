"""Continuous Re-evaluation Loop.

A background asyncio task that periodically:
1. Checks if weather/traffic conditions have changed for active missions
2. Asks the Hazard Assessment agent if zones should be updated
3. Triggers route re-computation if conditions have shifted significantly

This is what makes the system truly adaptive — it doesn't just compute once
and forget, it continuously monitors and adjusts.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from backend.core.event_bus import get_bus
from backend.core.events import Event, EventType
from backend.core.mission_tracker import get_tracker, MissionStatus

logger = logging.getLogger(__name__)

_reeval_task: Optional[asyncio.Task] = None
_running = False

REEVAL_INTERVAL_SECONDS = 120  # 2 minutes


async def _reeval_cycle():
    """Single re-evaluation cycle for all active missions."""
    from backend.tools.weather import get_weather
    from backend.tools.tomtom import get_traffic_flow
    from backend.tools.hazard_db import get_hazard_zones

    tracker = get_tracker()
    bus = get_bus()
    active = tracker.active_missions()

    if not active:
        return

    await bus.publish(Event(
        type=EventType.AGENT_REASONING,
        payload={
            "agent": "reeval_loop",
            "thought": f"Re-evaluating {len(active)} active mission(s)...",
            "context": {"mission_ids": [m.mission_id for m in active]},
        },
        source_agent="reeval_loop",
    ))

    for mission in active:
        if mission.status not in {MissionStatus.EN_ROUTE, MissionStatus.ON_SITE, MissionStatus.ACCEPTED}:
            continue

        coords = mission.incident_coordinates
        if not coords or len(coords) < 2:
            continue

        try:
            weather = get_weather.invoke({"lat": coords[0], "lng": coords[1]})

            weather_worsened = False
            if weather.get("precipitation_mm", 0) > 5.0:
                weather_worsened = True
            if weather.get("wind_speed_kmh", 0) > 60:
                weather_worsened = True

            traffic = get_traffic_flow.invoke({"lat": coords[0], "lng": coords[1]})
            traffic_degraded = False
            if isinstance(traffic, dict):
                ratio = traffic.get("congestion_ratio", 0)
                if ratio > 0.6:
                    traffic_degraded = True

            hazards = get_hazard_zones.invoke({
                "lat": coords[0],
                "lng": coords[1],
                "radius_km": 5.0,
            })
            new_hazards = len(hazards) if isinstance(hazards, list) else 0

            if weather_worsened or traffic_degraded:
                reason_parts = []
                if weather_worsened:
                    precip = weather.get("precipitation_mm", 0)
                    wind = weather.get("wind_speed_kmh", 0)
                    reason_parts.append(f"weather degraded (precip={precip}mm, wind={wind}km/h)")
                if traffic_degraded:
                    reason_parts.append(f"traffic congestion increased (ratio={ratio:.2f})")

                reason = "; ".join(reason_parts)

                await bus.publish(Event(
                    type=EventType.ROUTE_INVALIDATED,
                    payload={
                        "mission_id": mission.mission_id,
                        "incident_id": mission.incident_id,
                        "reason": reason,
                        "weather": weather,
                        "new_hazard_count": new_hazards,
                    },
                    source_agent="reeval_loop",
                ))

                await bus.publish(Event(
                    type=EventType.AGENT_REASONING,
                    payload={
                        "agent": "reeval_loop",
                        "thought": f"Route invalidated for mission {mission.mission_id}: {reason}",
                        "context": {"mission_id": mission.mission_id},
                    },
                    source_agent="reeval_loop",
                ))

                mission.add_negotiation(
                    agent="reeval_loop",
                    action="route_invalidated",
                    reasoning=reason,
                    details={"weather": weather},
                )

                logger.warning(
                    "Route invalidated for %s: %s",
                    mission.mission_id,
                    reason,
                )
            else:
                await bus.publish(Event(
                    type=EventType.AGENT_REASONING,
                    payload={
                        "agent": "reeval_loop",
                        "thought": f"Mission {mission.mission_id}: conditions stable, no re-routing needed.",
                        "context": {"mission_id": mission.mission_id},
                    },
                    source_agent="reeval_loop",
                ))

        except Exception:
            logger.exception("Re-eval failed for mission %s", mission.mission_id)


async def _reeval_loop():
    """Main loop — runs indefinitely at the configured interval."""
    global _running
    _running = True
    logger.info("Re-evaluation loop started (interval=%ds)", REEVAL_INTERVAL_SECONDS)

    while _running:
        try:
            await _reeval_cycle()
        except Exception:
            logger.exception("Re-evaluation cycle error")
        await asyncio.sleep(REEVAL_INTERVAL_SECONDS)


def start_reeval_loop():
    """Start the background re-evaluation loop."""
    global _reeval_task
    if _reeval_task is None or _reeval_task.done():
        _reeval_task = asyncio.create_task(_reeval_loop())
        logger.info("Re-evaluation loop task created")


def stop_reeval_loop():
    """Stop the background re-evaluation loop."""
    global _running, _reeval_task
    _running = False
    if _reeval_task and not _reeval_task.done():
        _reeval_task.cancel()
        logger.info("Re-evaluation loop stopped")
