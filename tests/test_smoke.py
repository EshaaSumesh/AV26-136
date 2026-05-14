"""Smoke tests — verify the system boots, imports, and exposes routes.

These are fast (no LLM calls) and run against the loaded application object.
Run with: ./.venv/bin/python -m pytest tests/test_smoke.py -v
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from backend.api.main import app
    with TestClient(app) as c:
        yield c


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["city"]
    assert len(data["agents"]) == 5
    assert len(data["tools_available"]) >= 15


def test_authority_dashboard(client):
    r = client.get("/authority/dashboard")
    assert r.status_code == 200
    data = r.json()
    assert "recent_events" in data
    assert "active_missions" in data
    assert "stats" in data


def test_hazards_endpoint(client):
    r = client.get("/hazards/")
    assert r.status_code == 200
    data = r.json()
    assert "zones" in data
    assert "zone_count" in data


def test_missions_endpoints(client):
    r = client.get("/missions/active")
    assert r.status_code == 200
    assert "missions" in r.json()

    r = client.get("/missions/stats")
    assert r.status_code == 200
    stats = r.json()
    assert "total" in stats
    assert "by_status" in stats


def test_metrics_endpoints(client):
    for path in [
        "/metrics/summary",
        "/metrics/agents",
        "/metrics/tools",
        "/metrics/collaboration",
        "/metrics/overview",
        "/metrics/traces",
    ]:
        r = client.get(path)
        assert r.status_code == 200, f"{path} returned {r.status_code}"


def test_demo_scenarios_list(client):
    r = client.get("/demo/scenarios")
    assert r.status_code == 200
    data = r.json()
    assert "scenarios" in data
    assert len(data["scenarios"]) >= 3
    ids = {s["id"] for s in data["scenarios"]}
    assert "koramangala_flood" in ids
    assert "whitefield_fire" in ids
    assert "indiranagar_sos" in ids


def test_citizen_report_accepted(client):
    payload = {
        "citizen_id": "smoke_test_user",
        "disaster_type": "flood",
        "description": "Smoke test report",
        "coordinates": [12.97, 77.59],
        "severity_hint": 2,
    }
    r = client.post("/citizen/report", json=payload)
    assert r.status_code == 200
    assert r.json()["accepted"] is True


def test_citizen_nearby(client):
    r = client.get("/citizen/nearby?lat=12.9716&lng=77.5946&radius_km=3")
    assert r.status_code == 200
    data = r.json()
    assert "alerts" in data
    assert "hazards" in data
