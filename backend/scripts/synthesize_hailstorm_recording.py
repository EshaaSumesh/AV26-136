"""Synthesize a canonical, fully-populated demo recording for the
`bengaluru_2026_hailstorm` flagship scenario.

The live recording produced by running the scenario through the agents
is at the mercy of Vertex AI quotas — partway through the cell, the
LLM may 429 and the pipeline stalls. For a demo we need a recording
that is GUARANTEED to play back richly, with all of:

  * 3 incidents firing in sequence (ORR pile-up, Jayanagar tree, Indira SOS)
  * All 8 agents producing reasoning + tool-calls in the right order
  * 3 missions PROPOSED → ACCEPTED → routed
  * Hazard zones for each incident
  * Social-media legitimacy scoring
  * Public alerts broadcast for the worst zones
  * Closing IMD external alert tying the cell together

This script writes that recording to
    backend/data/demo_recordings/bengaluru_2026_hailstorm.json

…replacing whatever is there. Run from the repo root:

    python -m backend.scripts.synthesize_hailstorm_recording

The replay endpoint will then play it back without ever calling Gemini.
"""
from __future__ import annotations

import json
import math
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple


# Deterministic ID generation. Re-running the synthesis produces the
# same JSON file, which means the replay's dedupe (by mission/hazard
# id) keeps working across re-renders. If you need a fresh set, bump
# the seed.
_rng = random.Random(0xC0FFEE)


def _hex(n: int) -> str:
    return "".join(_rng.choice("0123456789abcdef") for _ in range(n))


def _ev_id() -> str:
    return f"evt_{_hex(12)}"


def _msn_id() -> str:
    return f"msn_{_hex(8)}"


def _inc_id() -> str:
    return f"inc_{_hex(8)}"


def _hz_id() -> str:
    return f"hz_{_hex(8)}"


# Static run identity. Re-running this script overwrites the file in-place.
RUN_ID = "synth_hailstorm_v1"
SCENARIO_ID = "bengaluru_2026_hailstorm"
RECORDED_AT = "2026-04-30T18:42:00+00:00"  # cosmetically the date of the cell

# Timeline anchor: epoch=0 corresponds to t=0 of the demo. We build the
# event list as (offset_ms, event_dict) tuples and convert to ISO
# timestamps relative to the anchor.
ANCHOR = datetime(2026, 4, 30, 18, 42, 0, tzinfo=timezone.utc)


def _iso_at(offset_ms: int) -> str:
    return (
        ANCHOR.fromtimestamp(ANCHOR.timestamp() + offset_ms / 1000.0, tz=timezone.utc)
        .isoformat()
    )


# ────────────────────────────────────────────────────────────────────
# Incident scaffolding

# Incident A — ORR pile-up at Bellandur flyover, severity 5 vehicle accident.
# Incident B — Jayanagar tree-fall blocking 30th Cross, severity 3 road block.
# Incident C — Indiranagar SOS, severity 5 medical (skylight injury).

INCIDENT_A = {
    "incident_id": _inc_id(),
    "citizen_id": "demo_blr26_orr_pileup",
    "disaster_type": "vehicle_accident",
    "severity": 5,
    "coordinates": [12.9569, 77.7011],
    "location_name": "Outer Ring Road · Bellandur flyover, near Marathahalli",
    "description": (
        "Massive hail just hit Outer Ring Road near Marathahalli. "
        "Hailstones the size of golf balls. Multiple cars have skidded "
        "and crashed into each other in the Bellandur flyover stretch. "
        "Windshields completely smashed. People are out of cars trying "
        "to take shelter."
    ),
    "image_id": "img_b5f4e0c707ce",
    "image_url": "/uploads/img_b5f4e0c707ce.jpg",
    # Dispatch picks Fire Station Marathahalli (base_006) for vehicle_accident.
    "base_id": "base_006",
    "base_name": "Fire Station Marathahalli",
    "base_coords": [12.9568, 77.7011],
    "commander": "Inspector R. Kulkarni",
    "alt_bases": [
        {
            "name": "Traffic Police Quick-Clearance Fleet ORR",
            "reason": (
                "Closer for traffic clearance but lacks fire+rescue capability "
                "needed for mangled vehicles with possible fuel leaks."
            ),
        },
        {
            "name": "Manipal Hospital Old Airport Road",
            "reason": (
                "Strong medical fit but 7.4km away and the situation calls "
                "for fire-rescue extraction first; ambulance is being staged."
            ),
        },
    ],
    "hazard": {
        "id": _hz_id(),
        "type": "vehicle_accident",
        "severity": "critical",
        "radius_km": 0.6,
        "label": "Multi-vehicle pile-up on ORR Bellandur flyover, hail damage",
        "blocked": True,
    },
    "social": {
        "score": 84.0,
        "verdict": "verified",
        "axes": {
            "source_credibility": 90.0,
            "recency": 95.0,
            "geo_relevance": 90.0,
            "corroboration": 80.0,
            "media_evidence": 75.0,
            "sentiment_urgency": 90.0,
        },
        "evidence_count": {"reddit": 3, "rss": 2, "gnews": 5, "synthetic_tweets": 4},
        "top_signals": [
            ("Times of India", "https://timesofindia.indiatimes.com/city/bengaluru/hail-storm-orr-pileup"),
            ("Deccan Herald", "https://www.deccanherald.com/india/karnataka/bengaluru-hailstorm-april-2026"),
            ("r/bangalore", "https://www.reddit.com/r/bangalore/comments/hailstorm_now"),
        ],
    },
}

INCIDENT_B = {
    "incident_id": _inc_id(),
    "citizen_id": "demo_blr26_jayanagar_tree",
    "disaster_type": "tree_fall",
    "severity": 3,
    "coordinates": [12.9241, 77.5829],
    "location_name": "30th Cross, Jayanagar 4th block",
    "description": (
        "Huge rain-tree has fallen across 30th Cross in Jayanagar 4th block. "
        "Completely blocking the road in both directions. Power lines are "
        "down too — sparks visible. The hail and wind brought it down. "
        "Nobody hurt that I can see but people can't leave the area."
    ),
    # Dispatch picks BBMP Disaster Response Cell Mayo Hall (base_014) for tree_fall.
    "base_id": "base_014",
    "base_name": "BBMP Disaster Response Cell Mayo Hall",
    "base_coords": [12.9728, 77.6094],
    "commander": "Engineer S. Reddy",
    "alt_bases": [
        {
            "name": "Fire Station Rajajinagar",
            "reason": (
                "Carries chainsaws and tree_fall specialism but is 9.1km away "
                "with rush-hour traffic; BBMP has dedicated heavy-clearance fleet closer."
            ),
        },
        {
            "name": "Traffic Police Quick-Clearance Fleet ORR",
            "reason": (
                "Best for arterial clearance but ORR-based units would have "
                "to cross the city through hail-affected zones."
            ),
        },
    ],
    "hazard": {
        "id": _hz_id(),
        "type": "tree_fall",
        "severity": "high",
        "radius_km": 0.3,
        "label": "Heritage rain-tree fallen on 30th Cross Jayanagar; live wire",
        "blocked": True,
    },
    "social": {
        "score": 71.0,
        "verdict": "likely_real",
        "axes": {
            "source_credibility": 70.0,
            "recency": 90.0,
            "geo_relevance": 85.0,
            "corroboration": 60.0,
            "media_evidence": 40.0,
            "sentiment_urgency": 80.0,
        },
        "evidence_count": {"reddit": 2, "rss": 1, "gnews": 3, "synthetic_tweets": 4},
        "top_signals": [
            ("The Hindu", "https://www.thehindu.com/news/cities/bangalore/hail-storm-tree-fall"),
            ("r/bangalore", "https://www.reddit.com/r/bangalore/comments/jayanagar_tree"),
            ("Bangalore Mirror", "https://bangaloremirror.indiatimes.com/bangalore/civic/hail-damage"),
        ],
    },
}

INCIDENT_C = {
    "incident_id": _inc_id(),
    "citizen_id": "demo_blr26_indira_skylight",
    "disaster_type": "medical",
    "severity": 5,
    "coordinates": [12.9719, 77.6412],
    "location_name": "12th Main, Indiranagar 1st stage",
    "description": (
        "My grandfather is hurt — the skylight in our living room shattered "
        "from the hail and glass fell on him. He's bleeding from his head "
        "and shoulder. We are at 12th Main Indiranagar 1st stage. Please "
        "send an ambulance fast."
    ),
    "is_sos": True,
    # Dispatch picks Manipal Hospital Old Airport Road (base_010) for medical.
    "base_id": "base_010",
    "base_name": "Manipal Hospital Old Airport Road",
    "base_coords": [12.9591, 77.6499],
    "commander": "Dr. P. Iyer",
    "alt_bases": [
        {
            "name": "Victoria Hospital (Govt) Fort",
            "reason": (
                "Public-hospital trauma capacity is excellent but 7.0km away vs "
                "Manipal at 1.6km; Glasgow Coma stabilization needs a fast handoff."
            ),
        },
        {
            "name": "Apollo Hospital Bannerghatta Road",
            "reason": (
                "High specialism match but 11.2km south through hail zone; ETA "
                "would exceed safe window for elderly patient with active bleed."
            ),
        },
    ],
    "hazard": {
        "id": _hz_id(),
        "type": "building_collapse",
        "severity": "high",
        "radius_km": 0.2,
        "label": "Skylight shatter — structural hazard at residence, Indiranagar",
        "blocked": False,
        "penalty_multiplier": 3.0,
    },
    "social": {
        "score": 92.0,
        "verdict": "verified",
        "axes": {
            "source_credibility": 95.0,
            "recency": 100.0,
            "geo_relevance": 100.0,
            "corroboration": 80.0,
            "media_evidence": 70.0,
            "sentiment_urgency": 100.0,
        },
        "evidence_count": {"reddit": 1, "rss": 0, "gnews": 2, "synthetic_tweets": 4},
        "top_signals": [
            ("The Hindu", "https://www.thehindu.com/news/cities/bangalore/hailstorm-injuries"),
            ("Times of India", "https://timesofindia.indiatimes.com/city/bengaluru/hail-injuries"),
        ],
    },
}


# ────────────────────────────────────────────────────────────────────
# Realistic-looking mock route (densified curve from base → incident).

def _great_circle_path(start: List[float], end: List[float], n: int = 14) -> List[List[float]]:
    """Return a list of [lat, lng] points walking from start → end with a
    light sinusoidal kink so the line doesn't look perfectly straight on
    the map. The frontend just renders coordinates verbatim."""
    s_lat, s_lng = start
    e_lat, e_lng = end
    pts = []
    # Perpendicular unit vector (rough flat-Earth) for the kink.
    dlat = e_lat - s_lat
    dlng = e_lng - s_lng
    plat, plng = -dlng, dlat  # 90° rotation
    norm = math.hypot(plat, plng) or 1.0
    plat, plng = plat / norm, plng / norm
    for i in range(n + 1):
        t = i / n
        # Sinusoidal kink, max ~150m offset (~0.0015°)
        kink = math.sin(t * math.pi) * 0.0015
        lat = s_lat + dlat * t + plat * kink
        lng = s_lng + dlng * t + plng * kink
        pts.append([round(lat, 6), round(lng, 6)])
    return pts


def _route_for(incident: Dict[str, Any]) -> Dict[str, Any]:
    base = incident["base_coords"]
    target = incident["coordinates"]
    path = _great_circle_path(base, target, n=14)
    # Crude distance & ETA from haversine over the segments.
    dist_km = 0.0
    R = 6371.0
    for a, b in zip(path[:-1], path[1:]):
        la1, lo1 = math.radians(a[0]), math.radians(a[1])
        la2, lo2 = math.radians(b[0]), math.radians(b[1])
        d = 2 * R * math.asin(math.sqrt(
            math.sin((la2 - la1) / 2) ** 2
            + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
        ))
        dist_km += d
    # Assume average 22 km/h emergency vehicle in dense Bengaluru traffic.
    eta_min = (dist_km / 22.0) * 60.0
    return {
        "path": path,
        "distance_km": round(dist_km, 2),
        "eta_minutes": round(eta_min, 1),
    }


# ────────────────────────────────────────────────────────────────────
# Event factories

def E(t_ms: int, etype: str, payload: Dict[str, Any], source: str) -> Dict[str, Any]:
    return {
        "offset_ms": t_ms,
        "event": {
            "id": _ev_id(),
            "type": etype,
            "payload": payload,
            "source_agent": source,
            "timestamp": _iso_at(t_ms),
        },
    }


def reasoning(t_ms: int, agent: str, thought: str, incident: Dict[str, Any]) -> Dict[str, Any]:
    return E(
        t_ms,
        "agent.reasoning",
        {
            "agent": agent,
            "thought": thought,
            "context": {},
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
        },
        agent,
    )


def tool_call(t_ms: int, agent: str, tool: str, args: Dict[str, Any], incident: Dict[str, Any]) -> Dict[str, Any]:
    return E(
        t_ms,
        "agent.tool_call",
        {
            "agent": agent,
            "tool": tool,
            "args": args,
            "result_summary": "completed",
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
        },
        agent,
    )


def citizen_report(t_ms: int, incident: Dict[str, Any], step: int, run_id: str) -> Dict[str, Any]:
    payload = {
        "citizen_id": incident["citizen_id"],
        "disaster_type": incident["disaster_type"],
        "description": incident["description"],
        "coordinates": incident["coordinates"],
        "severity_hint": incident["severity"],
        "demo_run_id": run_id,
        "demo_step": step,
    }
    if incident.get("image_id"):
        payload["image_id"] = incident["image_id"]
        payload["image_url"] = incident["image_url"]
    return E(
        t_ms,
        "citizen.report.submitted",
        payload,
        f"demo.{incident['citizen_id']}",
    )


def sos_triggered(t_ms: int, incident: Dict[str, Any], step: int, run_id: str) -> Dict[str, Any]:
    return E(
        t_ms,
        "citizen.sos.triggered",
        {
            "citizen_id": incident["citizen_id"],
            "coordinates": incident["coordinates"],
            "note": incident["description"],
            "disaster_type": incident["disaster_type"],
            "demo_run_id": run_id,
            "demo_step": step,
        },
        f"demo.{incident['citizen_id']}",
    )


def situation_assessed(t_ms: int, incident: Dict[str, Any]) -> Dict[str, Any]:
    return E(
        t_ms,
        "situation.assessed",
        {
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
            "is_disaster": True,
            "disaster_type": incident["disaster_type"],
            "severity": incident["severity"],
            "confidence": 0.92,
            "coordinates": incident["coordinates"],
            "location_name": incident["location_name"],
        },
        "situation_awareness",
    )


def hazard_proposed(t_ms: int, incident: Dict[str, Any]) -> Dict[str, Any]:
    hz = incident["hazard"]
    return E(
        t_ms,
        "hazard.zone.proposed",
        {
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
            "zone": _build_zone(incident),
        },
        "hazard_assessment",
    )


def hazard_confirmed(t_ms: int, incident: Dict[str, Any]) -> Dict[str, Any]:
    return E(
        t_ms,
        "hazard.zone.confirmed",
        {
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
            "zone": _build_zone(incident),
        },
        "hazard_assessment",
    )


def _build_zone(incident: Dict[str, Any]) -> Dict[str, Any]:
    hz = incident["hazard"]
    color = {
        "critical": "#ff0000",
        "high": "#ff4444",
        "medium": "#ffaa00",
        "low": "#ffee00",
    }.get(hz["severity"], "#888888")
    z = {
        "id": hz["id"],
        "type": hz["type"],
        "label": hz["label"],
        "geometry": {
            "type": "circle",
            "center": incident["coordinates"],
            "radius_km": hz["radius_km"],
        },
        "severity": hz["severity"],
        "blocked": hz["blocked"],
        "color": color,
    }
    if "penalty_multiplier" in hz:
        z["penalty_multiplier"] = hz["penalty_multiplier"]
    return z


def mission_proposed(t_ms: int, incident: Dict[str, Any], mission_id: str, round_n: int = 1) -> Dict[str, Any]:
    # `disaster_type`/`severity`/`incident_coordinates` are not present on
    # the live bus event for mission.proposed — the supervisor seeds them
    # directly into MissionTracker. Replay can't do that, so we ALSO
    # carry them on the synthesized event so the seeder reconstructs the
    # mission with full fidelity (proper colour/icon/severity-driven UI).
    return E(
        t_ms,
        "mission.proposed",
        {
            "mission_id": mission_id,
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
            "base_id": incident["base_id"],
            "base_name": incident["base_name"],
            "round": round_n,
            "disaster_type": incident["disaster_type"],
            "severity": incident["severity"],
            "incident_coordinates": incident["coordinates"],
        },
        "supervisor",
    )


def mission_accepted(t_ms: int, incident: Dict[str, Any], mission_id: str) -> Dict[str, Any]:
    return E(
        t_ms,
        "mission.accepted",
        {
            "mission_id": mission_id,
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
            "base_id": incident["base_id"],
            "base_name": incident["base_name"],
            "commander": incident["commander"],
            "disaster_type": incident["disaster_type"],
            "severity": incident["severity"],
            "incident_coordinates": incident["coordinates"],
        },
        "supervisor",
    )


def route_computed(t_ms: int, incident: Dict[str, Any], mission_id: str, route: Dict[str, Any]) -> Dict[str, Any]:
    return E(
        t_ms,
        "route.computed",
        {
            "mission_id": mission_id,
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
            "distance_km": route["distance_km"],
            "eta_minutes": route["eta_minutes"],
            "path": route["path"],
            "status": "ok",
            "avoided_hazards": [incident["hazard"]["id"]],
            "candidates": [
                {"label": "Primary (hazard-aware)", "distance_km": route["distance_km"], "eta_minutes": route["eta_minutes"]},
                {"label": "Alternate (avoiding ORR)", "distance_km": route["distance_km"] * 1.18, "eta_minutes": route["eta_minutes"] * 1.22},
            ],
        },
        "route_optimizer",
    )


def social_signal_scored(t_ms: int, incident: Dict[str, Any]) -> Dict[str, Any]:
    s = incident["social"]
    raw = (
        f"SOCIAL_INTEL:\n"
        f"- legitimacy_score: {s['score']}\n"
        f"- verdict: {s['verdict']}\n"
        f"- axis_scores:\n"
        + "".join(
            f"    {k}: {v}\n"
            for k, v in s["axes"].items()
        )
        + f"- evidence_count: {json.dumps(s['evidence_count'])}\n"
        f"- top_signals:\n"
        + "".join(f"    - platform: {p}\n      url: {u}\n" for p, u in s["top_signals"])
    )
    return E(
        t_ms,
        "social.signal.scored",
        {
            "incident_id": incident["incident_id"],
            "citizen_id": incident["citizen_id"],
            "legitimacy_score": s["score"],
            "verdict": s["verdict"],
            "axis_scores": s["axes"],
            "evidence_count": s["evidence_count"],
            "raw": raw,
        },
        "social_media_intel",
    )


def public_alert(t_ms: int, incident: Dict[str, Any]) -> Dict[str, Any]:
    return E(
        t_ms,
        "public.alert.broadcast",
        {
            "incident_id": incident["incident_id"],
            "headline": f"Emergency alert near {incident['location_name']}",
            "message": (
                f"{incident['disaster_type'].replace('_', ' ').title()} reported at "
                f"{incident['location_name']}. Avoid the area; rescue units inbound. "
                f"Follow official advisories."
            ),
            "severity": incident["severity"],
            "coordinates": incident["coordinates"],
            "radius_km": 1.5,
        },
        "communications",
    )


# ────────────────────────────────────────────────────────────────────
# Per-incident event sequence builder

def build_pipeline(
    incident: Dict[str, Any],
    base_offset_ms: int,
    *,
    is_sos: bool,
    step: int,
    run_id: str,
) -> Tuple[List[Dict[str, Any]], str, Dict[str, Any]]:
    """Return (events, mission_id, route) for a single incident's full pipeline.

    Pipeline timing inside `base_offset_ms` window (~ 22-26 seconds):
      0       → ingest event
      +50ms   → situation_awareness reasoning kickoff
      +50ms   → social_media_intel reasoning kickoff (parallel)
      +1500   → situation tool_calls (weather, news, gdacs, hazards)
      +3000   → social_media_intel tool_calls (reddit, rss, gnews, tweets)
      +4500   → situation.assessed
      +5500   → social.signal.scored
      +6500   → hazard_assessment reasoning + proposal
      +7500   → hazard.zone.confirmed
      +9000   → dispatch_strategist reasoning + tool_calls
      +12000  → DISPATCH DECISION reasoning
      +12100  → supervisor: mission created
      +12200  → mission.proposed
      +13500  → field_commander reasoning (accepts)
      +14000  → mission.accepted
      +15000  → route_optimizer reasoning + tool_calls
      +17500  → route.computed
      +18500  → communications reasoning + public.alert.broadcast
    """
    inc = incident
    events: List[Dict[str, Any]] = []
    t = base_offset_ms

    # Ingest
    if is_sos:
        events.append(sos_triggered(t, inc, step, run_id))
    else:
        events.append(citizen_report(t, inc, step, run_id))

    # Situation + social parallel
    events.append(reasoning(
        t + 50,
        "situation_awareness",
        f"Analyzing report: '{inc['description'][:100]}…'",
        inc,
    ))
    events.append(reasoning(
        t + 50,
        "social_media_intel",
        f"Pulling public chatter for '{inc['description'][:80]}…'",
        inc,
    ))

    # Situation tool calls (parallel ReAct)
    for off, tool, args in [
        (1500, "get_weather", {"lat": inc["coordinates"][0], "lng": inc["coordinates"][1]}),
        (1600, "search_disaster_news", {"query": f"{inc['disaster_type']} Bengaluru hail"}),
        (1700, "get_gdacs_alerts", {"lat": inc["coordinates"][0], "lng": inc["coordinates"][1], "radius_km": 5.0}),
        (1800, "get_recent_earthquakes", {"lat": inc["coordinates"][0], "lng": inc["coordinates"][1], "radius_km": 5.0}),
        (1900, "get_hazard_zones", {"lat": inc["coordinates"][0], "lng": inc["coordinates"][1], "radius_km": 1.0}),
    ]:
        events.append(tool_call(t + off, "situation_awareness", tool, args, inc))

    # Social tool calls
    short_desc = inc["description"].split(".")[0]
    for off, tool, args in [
        (3000, "search_reddit_posts", {"query": f"hail {inc['location_name'].split(',')[0]} Bengaluru", "max_results": 8.0, "hours_back": 24.0}),
        (3100, "fetch_local_rss_feeds", {"keyword": "hail"}),
        (3200, "search_disaster_news", {"query": f"hail {inc['disaster_type']} Bengaluru", "max_results": 5.0}),
        (3300, "generate_realistic_tweets", {"incident_summary": short_desc, "location": "Bengaluru", "count": 4.0}),
    ]:
        events.append(tool_call(t + off, "social_media_intel", tool, args, inc))

    # Situation assessment
    events.append(reasoning(
        t + 4500,
        "situation_awareness",
        (
            f"ASSESSMENT:\n"
            f"- is_disaster: true\n"
            f"- disaster_type: {inc['disaster_type']}\n"
            f"- severity: {inc['severity']}\n"
            f"- confidence: 0.92\n"
            f"- coordinates: {inc['coordinates']}\n"
            f"- location_name: {inc['location_name']}\n"
            f"- reasoning: Citizen description corroborated by IMD severe-storm "
            f"warning over Bengaluru urban district and matching reports on "
            f"GNews + r/bangalore. High confidence."
        ),
        inc,
    ))
    events.append(situation_assessed(t + 4600, inc))

    # Social score
    events.append(reasoning(
        t + 5500,
        "social_media_intel",
        (
            f"SOCIAL_INTEL:\n- legitimacy_score: {inc['social']['score']}\n"
            f"- verdict: {inc['social']['verdict']}\n"
            f"- evidence_count: {json.dumps(inc['social']['evidence_count'])}"
        ),
        inc,
    ))
    events.append(social_signal_scored(t + 5600, inc))

    # Hazard assessment
    events.append(reasoning(
        t + 6500,
        "hazard_assessment",
        (
            f"Establishing hazard polygon around {inc['location_name']}: "
            f"radius {inc['hazard']['radius_km']}km, severity {inc['hazard']['severity']}, "
            f"blocked={inc['hazard']['blocked']}. This hazard will be honored by "
            f"the route optimizer when planning incoming rescue paths."
        ),
        inc,
    ))
    events.append(tool_call(
        t + 6700,
        "hazard_assessment",
        "create_hazard_zone",
        {
            "disaster_type": inc["hazard"]["type"],
            "center_lat": inc["coordinates"][0],
            "center_lng": inc["coordinates"][1],
            "radius_km": inc["hazard"]["radius_km"],
            "severity": inc["hazard"]["severity"],
            "label": inc["hazard"]["label"],
            "blocked": inc["hazard"]["blocked"],
        },
        inc,
    ))
    events.append(hazard_proposed(t + 6800, inc))
    events.append(hazard_confirmed(t + 7500, inc))

    # Dispatch
    events.append(reasoning(
        t + 9000,
        "dispatch_strategist",
        (
            f"Evaluating bases for {inc['disaster_type']} severity {inc['severity']} "
            f"at {inc['location_name']}. Querying nearby bases & checking specialism match."
        ),
        inc,
    ))
    for off, tool, args in [
        (9300, "get_rescue_bases", {"disaster_type": inc["disaster_type"], "near_lat": inc["coordinates"][0], "near_lng": inc["coordinates"][1]}),
        (9500, "get_hazard_zones", {"lat": inc["coordinates"][0], "lng": inc["coordinates"][1], "radius_km": 5.0}),
        (10500, "get_tomtom_route", {"origin_lat": inc["base_coords"][0], "origin_lng": inc["base_coords"][1], "dest_lat": inc["coordinates"][0], "dest_lng": inc["coordinates"][1]}),
    ]:
        events.append(tool_call(t + off, "dispatch_strategist", tool, args, inc))

    alts_lines = ""
    for alt in inc["alt_bases"]:
        alts_lines += f"  - {alt['name']}: {alt['reason']}\n"
    events.append(reasoning(
        t + 12000,
        "dispatch_strategist",
        (
            f"DISPATCH DECISION:\n"
            f"- chosen_base_id: {inc['base_id']}\n"
            f"- chosen_base_name: {inc['base_name']}\n"
            f"- base_coordinates: {inc['base_coords']}\n"
            f"- disaster_type: {inc['disaster_type']}\n"
            f"- estimated_eta_minutes: ~estimating~\n"
            f"- reasoning: {inc['base_name']} provides the strongest specialism "
            f"match for {inc['disaster_type']} with available teams and the "
            f"shortest hazard-aware ETA after considering active hazard zones.\n"
            f"- considered_alternatives:\n{alts_lines}"
        ),
        inc,
    ))

    mission_id = _msn_id()

    # Supervisor → mission proposed
    events.append(reasoning(
        t + 12100,
        "supervisor",
        f"Mission {mission_id} created. Starting negotiation with {inc['base_name']}…",
        inc,
    ))
    events.append(reasoning(
        t + 12150,
        "supervisor",
        f"Negotiation round 1: Proposing mission to {inc['base_name']}…",
        inc,
    ))
    events.append(mission_proposed(t + 12200, inc, mission_id, round_n=1))

    # Field commander accepts
    events.append(reasoning(
        t + 13500,
        "field_commander",
        (
            f"Field Commander {inc['commander']} at {inc['base_name']}: "
            f"team available, equipment matches {inc['disaster_type']} profile. "
            f"ACCEPTING mission {mission_id}."
        ),
        inc,
    ))
    events.append(mission_accepted(t + 14000, inc, mission_id))

    # Route optimizer
    events.append(reasoning(
        t + 15000,
        "route_optimizer",
        (
            f"Computing hazard-aware route from {inc['base_name']} → "
            f"{inc['location_name']}. Avoiding hazard zone {inc['hazard']['id']}."
        ),
        inc,
    ))
    route = _route_for(inc)
    events.append(tool_call(
        t + 15500,
        "route_optimizer",
        "compute_osm_route",
        {
            "origin_lat": inc["base_coords"][0],
            "origin_lng": inc["base_coords"][1],
            "dest_lat": inc["coordinates"][0],
            "dest_lng": inc["coordinates"][1],
            "hazard_zones": [_build_zone(inc)],
        },
        inc,
    ))
    events.append(tool_call(
        t + 16000,
        "route_optimizer",
        "get_tomtom_route",
        {
            "origin_lat": inc["base_coords"][0],
            "origin_lng": inc["base_coords"][1],
            "dest_lat": inc["coordinates"][0],
            "dest_lng": inc["coordinates"][1],
        },
        inc,
    ))
    events.append(reasoning(
        t + 17000,
        "route_optimizer",
        (
            f"ROUTE: {route['distance_km']} km, ETA ≈ {route['eta_minutes']} min. "
            f"Primary route avoids hazard {inc['hazard']['id']}; one alternate "
            f"considered (+18% distance, +22% ETA) and rejected."
        ),
        inc,
    ))
    events.append(route_computed(t + 17500, inc, mission_id, route))

    # Communications
    events.append(reasoning(
        t + 18500,
        "communications",
        (
            f"Drafting public alert for {inc['location_name']} (severity "
            f"{inc['severity']}, radius 1.5 km)."
        ),
        inc,
    ))
    events.append(public_alert(t + 19000, inc))

    return events, mission_id, route


# ────────────────────────────────────────────────────────────────────
# Compose the full timeline.

def build_recording() -> Dict[str, Any]:
    all_events: List[Dict[str, Any]] = []

    # Incident A — ORR pile-up (t=0)
    a_events, a_mid, a_route = build_pipeline(INCIDENT_A, 0, is_sos=False, step=1, run_id=RUN_ID)
    all_events.extend(a_events)

    # Incident B — Jayanagar tree (t=25s, parallel pipeline)
    b_events, b_mid, b_route = build_pipeline(INCIDENT_B, 25_000, is_sos=False, step=2, run_id=RUN_ID)
    all_events.extend(b_events)

    # Incident C — Indiranagar SOS (t=50s, the SOS escalation)
    c_events, c_mid, c_route = build_pipeline(INCIDENT_C, 50_000, is_sos=True, step=3, run_id=RUN_ID)
    all_events.extend(c_events)

    # IMD external alert (t=80s) — corroborating cross-cell weather alert
    all_events.append(E(
        80_000,
        "external.alert.received",
        {
            "source": "imd_weather",
            "headline": (
                "IMD: Severe thunderstorm with large hail moving across Bengaluru "
                "urban district; gusts up to 80 km/h reported."
            ),
            "category": "severe_weather",
            "coordinates": [12.9716, 77.5946],
            "severity_hint": 4,
            "demo_run_id": RUN_ID,
            "demo_step": 4,
        },
        "demo.external",
    ))
    # Situation agent picks up the alert and corroborates the cell.
    all_events.append(E(
        80_500,
        "agent.reasoning",
        {
            "agent": "situation_awareness",
            "thought": (
                "External IMD alert corroborates the citywide hail cell. "
                "All three active incidents (ORR pile-up, Jayanagar tree-fall, "
                "Indiranagar skylight injury) tagged as a single weather-driven "
                "cluster. Recommending sustained vigilance for the next 45 min."
            ),
            "context": {},
        },
        "situation_awareness",
    ))

    # Closing supervisor summary at t=85s
    all_events.append(E(
        85_000,
        "agent.reasoning",
        {
            "agent": "supervisor",
            "thought": (
                "Demo cluster summary — 3 missions accepted, 3 rescue routes "
                "computed avoiding active hazards, 1 IMD external alert. All "
                "field commanders confirmed en-route. Re-evaluation loop will "
                "tick in 30s to reassess weather corroboration and ETAs."
            ),
            "context": {},
        },
        "supervisor",
    ))

    # Sort by offset_ms (everything already ordered, but defensive).
    all_events.sort(key=lambda e: e["offset_ms"])

    duration_ms = all_events[-1]["offset_ms"] + 1000

    return {
        "scenario_id": SCENARIO_ID,
        "run_id": RUN_ID,
        "recorded_at": RECORDED_AT,
        "duration_ms": duration_ms,
        "event_count": len(all_events),
        "events": all_events,
        "synthesized": True,
    }


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "data" / "demo_recordings" / f"{SCENARIO_ID}.json"
    out.parent.mkdir(parents=True, exist_ok=True)

    recording = build_recording()
    out.write_text(json.dumps(recording, default=str, indent=2))

    print(f"Wrote synthesized recording: {out}")
    print(f"  scenario_id : {recording['scenario_id']}")
    print(f"  event_count : {recording['event_count']}")
    print(f"  duration_ms : {recording['duration_ms']}")
    # Print event-type breakdown for sanity.
    from collections import Counter
    c = Counter(e["event"]["type"] for e in recording["events"])
    print("  event-type breakdown:")
    for t, n in c.most_common():
        print(f"    {n:3d}  {t}")


if __name__ == "__main__":
    main()
