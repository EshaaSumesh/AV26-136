"""WebSocket connection manager for real-time event streaming.

Maintains two pools:
- Authority clients: receive every agent event
- Citizen clients: receive only geofenced public alerts
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WSManager:
    def __init__(self) -> None:
        self._authority: list[WebSocket] = []
        self._citizens: dict[str, WebSocket] = {}

    async def connect_authority(self, ws: WebSocket) -> None:
        await ws.accept()
        self._authority.append(ws)
        logger.info("Authority WS connected (%d total)", len(self._authority))

    async def disconnect_authority(self, ws: WebSocket) -> None:
        if ws in self._authority:
            self._authority.remove(ws)
        logger.info("Authority WS disconnected (%d remaining)", len(self._authority))

    async def connect_citizen(self, ws: WebSocket, citizen_id: str) -> None:
        await ws.accept()
        self._citizens[citizen_id] = ws
        logger.info("Citizen WS connected: %s (%d total)", citizen_id, len(self._citizens))

    async def disconnect_citizen(self, citizen_id: str) -> None:
        self._citizens.pop(citizen_id, None)
        logger.info("Citizen WS disconnected: %s", citizen_id)

    async def broadcast_authority(self, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in self._authority:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in self._authority:
                self._authority.remove(ws)

    async def send_citizens(
        self, citizen_ids: list[str], message: dict[str, Any]
    ) -> None:
        for cid in citizen_ids:
            ws = self._citizens.get(cid)
            if ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    self._citizens.pop(cid, None)

    async def broadcast_all_citizens(self, message: dict[str, Any]) -> None:
        dead: list[str] = []
        for cid, ws in self._citizens.items():
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(cid)
        for cid in dead:
            self._citizens.pop(cid, None)

    @property
    def authority_count(self) -> int:
        return len(self._authority)

    @property
    def citizen_count(self) -> int:
        return len(self._citizens)

    @property
    def citizen_ids(self) -> list[str]:
        return list(self._citizens.keys())


_ws: Optional[WSManager] = None


def get_ws() -> WSManager:
    global _ws
    if _ws is None:
        _ws = WSManager()
    return _ws
