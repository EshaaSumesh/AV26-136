"""Unit tests for the metrics module."""
from __future__ import annotations

from backend.core.metrics import MetricsStore, Timer


def test_timer_measures_duration():
    import time
    with Timer() as t:
        time.sleep(0.01)
    assert t.duration_ms >= 10
    assert t.success is True


def test_record_agent_aggregates():
    m = MetricsStore()
    m.record_agent("foo", 100.0, True)
    m.record_agent("foo", 200.0, True)
    m.record_agent("foo", 50.0, False)
    stats = m.agent_stats["foo"]
    assert stats["count"] == 3
    assert stats["success_count"] == 2
    assert stats["failure_count"] == 1
    assert stats["avg_ms"] == 116.67
    assert stats["min_ms"] == 50.0
    assert stats["max_ms"] == 200.0
    assert stats["success_rate"] == 0.667


def test_collaboration_edges():
    m = MetricsStore()
    m.record_edge("supervisor", "situation_awareness")
    m.record_edge("supervisor", "situation_awareness")
    m.record_edge("supervisor", "hazard_assessment")
    m.record_edge("dispatch_strategist", "field_commander_base_002")
    graph = m.collaboration_graph
    assert len(graph["nodes"]) == 5
    assert len(graph["edges"]) == 3
    # check edge counts
    edge_counts = {(e["source"], e["target"]): e["count"] for e in graph["edges"]}
    assert edge_counts[("supervisor", "situation_awareness")] == 2


def test_self_edge_ignored():
    m = MetricsStore()
    m.record_edge("agent_a", "agent_a")
    m.record_edge("", "agent_b")
    m.record_edge("agent_c", "")
    assert m.collaboration_graph["edges"] == []


def test_tool_usage_per_agent():
    m = MetricsStore()
    m.record_tool("get_weather", 15.0, True, parent_agent="situation_awareness")
    m.record_tool("get_weather", 12.0, True, parent_agent="situation_awareness")
    m.record_tool("geocode_location", 8.0, True, parent_agent="situation_awareness")
    assert m.agent_tool_usage["situation_awareness"]["get_weather"] == 2
    assert m.agent_tool_usage["situation_awareness"]["geocode_location"] == 1


def test_summary_counts():
    m = MetricsStore()
    m.record_agent("a1", 100, True)
    m.record_agent("a2", 200, False)
    m.record_tool("t1", 10, True)
    summary = m.summary
    assert summary["total_agent_invocations"] == 2
    assert summary["total_tool_invocations"] == 1
    assert summary["total_failures"] == 1
    assert summary["unique_agents"] == 2
    assert summary["unique_tools"] == 1
