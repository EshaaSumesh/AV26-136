"""Observability API routes.

Exposes metrics: agent latency, tool usage, success rates, collaboration graph,
and recent trace entries for the live demo and Authority dashboard.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter

from backend.agents.llm import region_health
from backend.core.metrics import get_metrics

router = APIRouter()


@router.get("/llm/regions")
async def llm_regions():
    """Show the Vertex AI region pool currently powering the agents."""
    return region_health()


@router.get("/summary")
async def metrics_summary():
    return get_metrics().summary


@router.get("/agents")
async def agent_metrics():
    return {"agents": get_metrics().agent_stats}


@router.get("/tools")
async def tool_metrics():
    return {"tools": get_metrics().tool_stats}


@router.get("/collaboration")
async def collaboration_graph():
    """Agent-to-agent collaboration graph for visualization."""
    m = get_metrics()
    return {
        "graph": m.collaboration_graph,
        "agent_tools": m.agent_tool_usage,
    }


@router.get("/traces")
async def recent_traces(limit: int = 100, kind: Optional[str] = None):
    return {"traces": get_metrics().recent_traces(limit=limit, kind=kind)}


@router.get("/overview")
async def overview():
    """Combined view for the dashboard metrics panel."""
    m = get_metrics()
    return {
        "summary": m.summary,
        "agents": m.agent_stats,
        "tools": m.tool_stats,
        "collaboration": m.collaboration_graph,
        "agent_tool_usage": m.agent_tool_usage,
    }
