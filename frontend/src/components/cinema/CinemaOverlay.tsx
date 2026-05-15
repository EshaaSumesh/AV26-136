"use client";

/**
 * CinemaOverlay — page-level cinematic chrome that activates only while
 * a replay is in flight. Sits on top of the map but outside it (these
 * elements aren't tied to a geographic anchor; they're DOM chrome).
 *
 * Three sub-elements:
 *   • <IntroCard>     — a 4 s slide-in title card at the start of the
 *                       replay introducing the scenario.
 *   • <Chyron>        — lower-third caption strip showing the current
 *                       incident number, category, severity, and the
 *                       active agent. Updates live off the event stream.
 *   • <WeatherVeil>   — animated translucent hail/rain texture, only
 *                       enabled for severe-weather scenarios. Currently
 *                       triggered by scenario_id matches `*hailstorm*`.
 *
 * Everything is `pointer-events: none` so the operator can still click
 * pins and the missions panel underneath.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/types";
import type { ActiveReplay } from "@/lib/useReplayState";

interface Props {
  replay: ActiveReplay | null;
  events: AgentEvent[];
}

export default function CinemaOverlay({ replay, events }: Props) {
  if (!replay) return null;

  const isHailstorm = replay.scenario_id.includes("hailstorm");
  const isFlood = replay.scenario_id.includes("flood");
  const showWeather = isHailstorm || isFlood;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      {showWeather && (
        <WeatherVeil
          kind={isHailstorm ? "hail" : "rain"}
          startedAt={replay.observed_at}
        />
      )}
      <IntroCard replay={replay} />
      <Chyron replay={replay} events={events} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * <IntroCard>
 * ──────────────────────────────────────────────────────────────── */

const INTRO_VISIBLE_MS = 4500;

function IntroCard({ replay }: { replay: ActiveReplay }) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");
  useEffect(() => {
    setPhase("in");
    const t1 = window.setTimeout(() => setPhase("hold"), 600);
    const t2 = window.setTimeout(() => setPhase("out"), INTRO_VISIBLE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [replay.run_id]);

  const elapsed = Date.now() - replay.observed_at;
  if (elapsed > INTRO_VISIBLE_MS + 1200) return null;

  // Pretty-format the scenario id → title (the title is also passed
  // through `replay.title`, but it's prefixed "REPLAY · " by the bus
  // so we strip that and prefer the recording's display title).
  const cleanTitle = replay.title.replace(/^REPLAY\s*[·:]\s*/i, "");
  const subtitle =
    replay.scenario_id === "bengaluru_2026_hailstorm"
      ? "Apr 30 2026 · Citywide hail cell · 3 incidents"
      : replay.scenario_id === "bengaluru_2019_flood_cascade"
        ? "Aug 2019 · Bellandur → HSR → Sarjapur Rd"
        : "Replaying recorded scenario";

  const opacity = phase === "in" ? 0.95 : phase === "hold" ? 0.95 : 0;
  const translate =
    phase === "in" ? "translateY(-8px)" : phase === "out" ? "translateY(-12px)" : "translateY(0)";

  return (
    <div
      style={{
        position: "absolute",
        top: "12vh",
        left: "50%",
        transform: `translateX(-50%) ${translate}`,
        opacity,
        transition: "opacity 600ms ease, transform 600ms ease",
      }}
    >
      <div
        style={{
          background: "rgba(14, 22, 18, 0.92)",
          border: "1px solid rgba(232,226,210,0.18)",
          padding: "18px 28px",
          minWidth: 460,
          maxWidth: 720,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          backdropFilter: "blur(6px)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono), monospace",
            fontSize: 10,
            letterSpacing: ".22em",
            color: "#A9C2B5",
            marginBottom: 8,
          }}
        >
          REPLAY · CINEMA MODE
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif), Georgia, serif",
            fontSize: 28,
            lineHeight: 1.15,
            color: "#E8E2D2",
            fontWeight: 600,
          }}
        >
          {cleanTitle}
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--font-serif), Georgia, serif",
            fontStyle: "italic",
            fontSize: 13,
            color: "#A9C2B5",
          }}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * <Chyron>
 * Lower-third strip. Watches the event stream and surfaces the
 * latest incident + active agent. Updates ~250ms.
 * ──────────────────────────────────────────────────────────────── */

const INCIDENT_TRIGGERS = new Set([
  "citizen.report.submitted",
  "citizen.sos.triggered",
  "external.alert.received",
]);

function Chyron({
  replay,
  events,
}: {
  replay: ActiveReplay;
  events: AgentEvent[];
}) {
  const visible = Date.now() - replay.observed_at > 2000; // give the intro card room

  // Pick the most recent incident trigger from the live stream, plus
  // the most recent agent reasoning/tool call tied to that incident
  // for the "doing" line.
  const { incidentLine, agentLine, ordinal, severity, kind } = useMemo(() => {
    let latestIncident: AgentEvent | null = null;
    const incidentChain: AgentEvent[] = [];
    for (const ev of events) {
      if (INCIDENT_TRIGGERS.has(ev.type)) {
        incidentChain.unshift(ev);
        if (!latestIncident) latestIncident = ev;
      }
    }
    const ord = incidentChain.findIndex(
      (e) => e.id === latestIncident?.id,
    );
    let agentEvent: AgentEvent | null = null;
    if (latestIncident) {
      const incId = latestIncident.payload?.incident_id;
      for (const ev of events) {
        if (
          (ev.type === "agent.reasoning" || ev.type === "agent.tool_call") &&
          (!incId || ev.payload?.incident_id === incId)
        ) {
          agentEvent = ev;
          break;
        }
      }
    }

    let kindStr = "—";
    let severityNum: number | null = null;
    let incidentTitle = "Awaiting first incident…";
    if (latestIncident) {
      const cat =
        (latestIncident.payload?.disaster_type as string) ||
        (latestIncident.payload?.category as string) ||
        "incident";
      severityNum = (latestIncident.payload?.severity_hint as number) ?? null;
      kindStr =
        latestIncident.type === "citizen.sos.triggered"
          ? "SOS"
          : latestIncident.type === "external.alert.received"
            ? "EXT ALERT"
            : "REPORT";
      const desc =
        (latestIncident.payload?.description as string) ||
        (latestIncident.payload?.note as string) ||
        (latestIncident.payload?.headline as string) ||
        "";
      incidentTitle = `${cat.replace(/_/g, " ").toUpperCase()} · ${truncate(desc, 80)}`;
    }

    let agentStr = "Pipeline idle";
    if (agentEvent) {
      const who = (agentEvent.payload?.agent ||
        agentEvent.source_agent ||
        "agent") as string;
      const what = agentEvent.payload?.thought || agentEvent.payload?.tool;
      agentStr = `${prettyAgent(who)} → ${truncate(String(what ?? "thinking"), 110)}`;
    }

    return {
      incidentLine: incidentTitle,
      agentLine: agentStr,
      ordinal: ord >= 0 ? ord + 1 : 0,
      severity: severityNum,
      kind: kindStr,
    };
  }, [events]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        background: "rgba(14, 22, 18, 0.94)",
        border: "1px solid rgba(232,226,210,0.18)",
        backdropFilter: "blur(6px)",
        padding: "14px 22px",
        minWidth: 640,
        maxWidth: "min(92vw, 1024px)",
        boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          fontFamily: "var(--font-mono), monospace",
          fontSize: 10,
          letterSpacing: ".22em",
          color: "#A9C2B5",
          marginBottom: 6,
        }}
      >
        <span>REPLAY</span>
        {ordinal > 0 && <span>· INCIDENT {ordinal}</span>}
        <span>· {kind}</span>
        {severity !== null && <span>· SEV {severity}</span>}
        <span style={{ flex: 1 }} />
        <ElapsedTicker startedAt={replay.observed_at} />
      </div>
      <div
        style={{
          fontFamily: "var(--font-serif), Georgia, serif",
          fontSize: 17,
          lineHeight: 1.25,
          color: "#E8E2D2",
          fontWeight: 600,
        }}
      >
        {incidentLine}
      </div>
      <div
        style={{
          marginTop: 4,
          fontFamily: "var(--font-mono), monospace",
          fontSize: 12,
          color: "#A9C2B5",
        }}
      >
        {agentLine}
      </div>
    </div>
  );
}

function ElapsedTicker({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => (n + 1) % 1024), 500);
    return () => window.clearInterval(id);
  }, []);
  const ms = Date.now() - startedAt;
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return <span>· T+{mm}:{ss}</span>;
}

function prettyAgent(s: string): string {
  if (s.startsWith("field_commander")) return "Field Commander";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

/* ────────────────────────────────────────────────────────────────
 * <WeatherVeil>
 * Canvas overlay that animates falling hail or rain across the entire
 * map area. Translucent, pointer-events:none, never blocks UI.
 * ──────────────────────────────────────────────────────────────── */

interface VeilProps {
  kind: "hail" | "rain";
  startedAt: number;
}

const PARTICLE_COUNTS: Record<VeilProps["kind"], number> = {
  hail: 110,
  rain: 220,
};

function WeatherVeil({ kind }: VeilProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    type P = {
      x: number;
      y: number;
      vy: number;
      vx: number;
      r: number;
      tint: string;
    };
    const N = PARTICLE_COUNTS[kind];
    const particles: P[] = Array.from({ length: N }).map(() =>
      makeParticle(canvas.width, canvas.height, kind),
    );

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Slight blur over the whole scene for atmosphere.
      ctx.fillStyle =
        kind === "hail"
          ? "rgba(170, 200, 220, 0.04)"
          : "rgba(120, 160, 200, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y > canvas.height + 12 || p.x > canvas.width + 20) {
          Object.assign(
            p,
            makeParticle(canvas.width, canvas.height, kind, true),
          );
        }
        if (kind === "hail") {
          ctx.beginPath();
          ctx.fillStyle = p.tint;
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = p.tint;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 1.6, p.y - p.vy * 1.6);
          ctx.stroke();
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
    };
  }, [kind]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.5,
        mixBlendMode: "screen",
        pointerEvents: "none",
      }}
    />
  );
}

function makeParticle(
  w: number,
  h: number,
  kind: "hail" | "rain",
  recycled = false,
): { x: number; y: number; vx: number; vy: number; r: number; tint: string } {
  if (kind === "hail") {
    return {
      x: Math.random() * w,
      y: recycled ? -10 : Math.random() * h,
      vx: 0.3 + Math.random() * 0.6,
      vy: 4 + Math.random() * 3,
      r: 1.4 + Math.random() * 1.8,
      tint: "rgba(225, 235, 245, 0.85)",
    };
  }
  return {
    x: Math.random() * w,
    y: recycled ? -6 : Math.random() * h,
    vx: 1.2 + Math.random() * 0.6,
    vy: 8 + Math.random() * 5,
    r: 1,
    tint: "rgba(160, 195, 220, 0.7)",
  };
}
