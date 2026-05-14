"use client";

import { useEffect, useRef, useState } from "react";
import { WS_BASE } from "./api";
import type { AgentEvent } from "./types";

export interface WsMessage {
  type: string;
  data: any;
}

export function useAuthorityWS() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [hazards, setHazards] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(`${WS_BASE}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        try {
          const parsed: WsMessage = JSON.parse(msg.data);
          if (parsed.type === "agent_event") {
            setEvents((prev) => [parsed.data, ...prev].slice(0, 200));
          } else if (parsed.type === "new_hazard") {
            setHazards((prev) => [parsed.data, ...prev].slice(0, 50));
          } else if (parsed.type === "new_route") {
            setRoutes((prev) => [parsed.data, ...prev].slice(0, 20));
          }
        } catch {
          // ignore malformed
        }
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  return { connected, events, hazards, routes };
}

export function useCitizenWS(citizenId: string) {
  const [connected, setConnected] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    if (!citizenId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(`${WS_BASE}/ws/citizen/${citizenId}`);

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        try {
          const parsed: WsMessage = JSON.parse(msg.data);
          if (parsed.type === "public_alert") {
            setAlerts((prev) => [parsed.data, ...prev].slice(0, 20));
          }
        } catch {
          // ignore
        }
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [citizenId]);

  return { connected, alerts };
}
