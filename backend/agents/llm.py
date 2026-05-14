"""Shared LLM for all agents — multi-region pool with round-robin.

Vertex AI quotas are scoped to (project, region, model). By spreading
requests across many regions we multiply the effective RPM/TPM ceiling
and dramatically reduce 429 ResourceExhausted errors.

Strategy
--------
1. Build one ``ChatVertexAI`` client per region listed in
   ``settings.vertex_locations`` (configurable via ``VERTEX_LOCATIONS`` env).
2. Each call to ``get_llm()`` returns the next region's client in a
   thread-safe round-robin rotation.
3. ``create_react_agent`` holds onto the returned ``ChatVertexAI`` for the
   duration of one agent invocation (typically a few seconds and a handful
   of Gemini calls). The next agent invocation pulls a fresh region, so
   parallel pipelines naturally spread across the pool.
4. LangChain's built-in retry layer still handles transient 429s with
   exponential backoff within a single region call.

We return a real ``ChatVertexAI`` (a ``BaseChatModel``) — not a wrapped
Runnable — because ``langgraph.prebuilt.create_react_agent`` requires a
``BaseChatModel`` or ``RunnableBinding`` (see chat_agent_executor._get_model).
"""
from __future__ import annotations

import itertools
import logging
import threading
from typing import List

from langchain_google_vertexai import ChatVertexAI

from backend.core.config import settings

logger = logging.getLogger(__name__)

_clients: List[ChatVertexAI] = []
_clients_lock = threading.Lock()
_rotation = None  # itertools.cycle, populated lazily


def _build_clients() -> List[ChatVertexAI]:
    """Instantiate one ChatVertexAI per configured region."""
    regions = settings.vertex_locations
    project = settings.keys.google_cloud_project
    model = settings.gemini_model

    clients: List[ChatVertexAI] = []
    for region in regions:
        try:
            c = ChatVertexAI(
                model=model,
                project=project,
                location=region,
                temperature=0.1,
                max_output_tokens=4096,
            )
            clients.append(c)
            logger.info("LLM region client ready: %s @ %s", model, region)
        except Exception as exc:
            logger.warning(
                "Failed to init ChatVertexAI in region %s: %s", region, exc
            )
    if not clients:
        raise RuntimeError(
            f"Could not initialize any Vertex AI client across regions {regions}"
        )
    return clients


def _ensure_clients() -> List[ChatVertexAI]:
    global _clients, _rotation
    with _clients_lock:
        if not _clients:
            _clients = _build_clients()
            _rotation = itertools.cycle(range(len(_clients)))
    return _clients


def get_llm() -> ChatVertexAI:
    """Return the next region's ChatVertexAI client (round-robin).

    Each agent invocation in ``create_react_agent`` pulls one of these and
    uses it for the duration of its ReAct loop. Successive agents — and
    successive parallel pipelines — pick different regions, multiplying
    the effective Vertex AI quota.
    """
    clients = _ensure_clients()
    if len(clients) == 1:
        return clients[0]
    with _clients_lock:
        idx = next(_rotation)
    chosen = clients[idx]
    logger.debug("LLM dispatched to region %s", chosen.location)
    return chosen


def region_health() -> dict:
    """Diagnostic snapshot for /metrics or debugging."""
    clients = _ensure_clients()
    return {
        "model": settings.gemini_model,
        "project": settings.keys.google_cloud_project,
        "regions": [c.location for c in clients],
        "region_count": len(clients),
    }
