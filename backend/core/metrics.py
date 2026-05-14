"""Observability metrics for agent latency, tool calls, and collaboration.

Tracks per-agent invocations (duration, success/failure), per-tool call latencies,
and agent-to-agent message edges (for the collaboration graph). Everything is
in-memory and bounded — designed for a live demo, not long-term storage.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Deque, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

MAX_TRACE_ENTRIES = 1000


@dataclass
class TraceEntry:
    """A single recorded operation."""
    kind: str  # "agent" | "tool"
    name: str  # agent name or tool name
    started_at: str
    duration_ms: float
    success: bool
    parent: Optional[str] = None  # for tools: the agent that called it
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "name": self.name,
            "started_at": self.started_at,
            "duration_ms": round(self.duration_ms, 2),
            "success": self.success,
            "parent": self.parent,
            "extra": self.extra,
        }


@dataclass
class AggregateStats:
    """Rolling stats for a single agent or tool."""
    count: int = 0
    success_count: int = 0
    failure_count: int = 0
    total_ms: float = 0.0
    min_ms: float = float("inf")
    max_ms: float = 0.0

    def record(self, duration_ms: float, success: bool) -> None:
        self.count += 1
        self.total_ms += duration_ms
        self.min_ms = min(self.min_ms, duration_ms)
        self.max_ms = max(self.max_ms, duration_ms)
        if success:
            self.success_count += 1
        else:
            self.failure_count += 1

    def to_dict(self) -> dict:
        avg = self.total_ms / self.count if self.count else 0.0
        return {
            "count": self.count,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "success_rate": round(self.success_count / self.count, 3) if self.count else None,
            "avg_ms": round(avg, 2),
            "min_ms": round(self.min_ms, 2) if self.count else 0.0,
            "max_ms": round(self.max_ms, 2),
            "total_ms": round(self.total_ms, 2),
        }


class MetricsStore:
    """Singleton metrics collector. Bounded in-memory."""

    def __init__(self) -> None:
        self._traces: Deque[TraceEntry] = deque(maxlen=MAX_TRACE_ENTRIES)
        self._agent_stats: Dict[str, AggregateStats] = defaultdict(AggregateStats)
        self._tool_stats: Dict[str, AggregateStats] = defaultdict(AggregateStats)
        # Collaboration edges: (source_agent, target_agent) -> count
        self._edges: Dict[Tuple[str, str], int] = defaultdict(int)
        # Tool usage per agent: agent -> tool -> count
        self._agent_tools: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self._started_at = datetime.now(timezone.utc).isoformat()

    def record_agent(self, name: str, duration_ms: float, success: bool, extra: Optional[dict] = None):
        entry = TraceEntry(
            kind="agent",
            name=name,
            started_at=datetime.now(timezone.utc).isoformat(),
            duration_ms=duration_ms,
            success=success,
            extra=extra or {},
        )
        self._traces.append(entry)
        self._agent_stats[name].record(duration_ms, success)

    def record_tool(
        self,
        name: str,
        duration_ms: float,
        success: bool,
        parent_agent: Optional[str] = None,
        extra: Optional[dict] = None,
    ):
        entry = TraceEntry(
            kind="tool",
            name=name,
            started_at=datetime.now(timezone.utc).isoformat(),
            duration_ms=duration_ms,
            success=success,
            parent=parent_agent,
            extra=extra or {},
        )
        self._traces.append(entry)
        self._tool_stats[name].record(duration_ms, success)
        if parent_agent:
            self._agent_tools[parent_agent][name] += 1

    def record_edge(self, source: str, target: str) -> None:
        """Record an agent-to-agent collaboration (e.g., supervisor -> situation)."""
        if source and target and source != target:
            self._edges[(source, target)] += 1

    @property
    def agent_stats(self) -> dict:
        return {name: s.to_dict() for name, s in self._agent_stats.items()}

    @property
    def tool_stats(self) -> dict:
        return {name: s.to_dict() for name, s in self._tool_stats.items()}

    @property
    def collaboration_graph(self) -> dict:
        nodes = set()
        edges = []
        for (src, tgt), count in self._edges.items():
            nodes.add(src)
            nodes.add(tgt)
            edges.append({"source": src, "target": tgt, "count": count})
        return {
            "nodes": [{"id": n} for n in sorted(nodes)],
            "edges": edges,
        }

    @property
    def agent_tool_usage(self) -> dict:
        return {a: dict(tools) for a, tools in self._agent_tools.items()}

    def recent_traces(self, limit: int = 100, kind: Optional[str] = None) -> list:
        items = list(self._traces)[-limit:]
        if kind:
            items = [t for t in items if t.kind == kind]
        return [t.to_dict() for t in items]

    @property
    def summary(self) -> dict:
        total_agent_calls = sum(s.count for s in self._agent_stats.values())
        total_tool_calls = sum(s.count for s in self._tool_stats.values())
        total_failures = sum(s.failure_count for s in self._agent_stats.values()) + \
                         sum(s.failure_count for s in self._tool_stats.values())
        return {
            "started_at": self._started_at,
            "total_agent_invocations": total_agent_calls,
            "total_tool_invocations": total_tool_calls,
            "total_failures": total_failures,
            "unique_agents": len(self._agent_stats),
            "unique_tools": len(self._tool_stats),
            "collaboration_edges": len(self._edges),
        }


_store: Optional[MetricsStore] = None


def get_metrics() -> MetricsStore:
    global _store
    if _store is None:
        _store = MetricsStore()
    return _store


class Timer:
    """Context manager for timing operations.

    Note: `duration_ms` is only valid AFTER the `with` block exits.
    Inside a `finally:` clause (which runs before __exit__) it will be 0.
    For that case, use `t.elapsed_ms` (live property).

    Usage:
        with Timer() as t:
            await some_op()
        metrics.record_agent("name", t.duration_ms, t.success)
    """

    def __init__(self) -> None:
        self.duration_ms: float = 0.0
        self.success: bool = True
        self._start: float = 0.0
        self._end: Optional[float] = None

    @property
    def elapsed_ms(self) -> float:
        end = self._end if self._end is not None else time.perf_counter()
        return (end - self._start) * 1000

    def __enter__(self) -> "Timer":
        self._start = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self._end = time.perf_counter()
        self.duration_ms = (self._end - self._start) * 1000
        self.success = exc_type is None
