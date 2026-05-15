"use client";

/**
 * useReplayState — polls /demo/status every 2 s and surfaces the active
 * REPLAY run (if any). The cinema overlay subscribes to this so every
 * visual flourish (camera tour, narration, weather veil, etc.) only
 * activates while a replay is mid-flight. Live operations stay clean.
 *
 * We poll instead of websocket because /demo/status was already there,
 * 2 s granularity is fine for kicking off cinema mode, and the WS is
 * already saturated with agent-event traffic during a replay.
 */

import { useEffect, useState } from "react";
import { api } from "./api";

export interface ActiveReplay {
  run_id: string;
  scenario_id: string;
  title: string;
  started_at: string;
  /** ms since first observed; cinema overlay uses this for the timeline strip. */
  observed_at: number;
}

export function useReplayState(): ActiveReplay | null {
  const [replay, setReplay] = useState<ActiveReplay | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await api.demoStatus();
        const r = (res.active || []).find((a) => a.kind === "replay");
        if (cancelled) return;
        if (r) {
          setReplay((prev) =>
            prev && prev.run_id === r.run_id
              ? prev
              : {
                  run_id: r.run_id,
                  scenario_id: r.scenario_id,
                  title: r.title,
                  started_at: r.started_at,
                  observed_at: Date.now(),
                },
          );
        } else {
          setReplay(null);
        }
      } catch {
        // network blip; try again shortly
      }
      if (!cancelled) timer = setTimeout(tick, 2000);
    }
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return replay;
}
