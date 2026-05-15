"use client";

/**
 * AgentCrewPanel
 *
 * Roster-style visualisation of the six core agents — inspired by the
 * "Legal Crew" reference design. Each agent gets its own card showing
 * status (COMPLETE / WORKING / QUEUED / ERROR). Above the grid, a
 * pentagon radar fills as each pipeline stage progresses, so the viewer
 * gets a single-glance "how far through analysis are we" picture.
 *
 * Clicking any card opens a side-drawer with the agent's recent
 * reasoning thoughts and tool-call detail (the same content the old
 * AgentReasoningPanel rendered, but on demand).
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crown,
  Eye,
  Handshake,
  MapPin,
  Megaphone,
  Radar as RadarIcon,
  Search,
  Wrench,
  X,
} from "lucide-react";

import type { AgentEvent } from "@/lib/types";

// ── Agent registry ─────────────────────────────────────────────

type AgentId =
  | "supervisor"
  | "situation_awareness"
  | "hazard_assessment"
  | "dispatch_strategist"
  | "route_optimizer"
  | "communications";

interface AgentDef {
  id: AgentId;
  name: string;          // serif name shown on card
  short: string;         // short label (radar axis)
  role: string;          // one-line role description
  Icon: typeof Brain;
  color: string;
  // matchAgent: returns true if a given event's source_agent belongs here.
  matchAgent: (agent: string | null) => boolean;
  isPipelineStage: boolean; // does this agent represent a radar axis?
}

const AGENTS: AgentDef[] = [
  {
    id: "supervisor",
    name: "Supervisor",
    short: "Supervise",
    role: "Orchestrates the crew",
    Icon: Crown,
    color: "#94a3b8",
    matchAgent: (a) => a === "supervisor",
    isPipelineStage: false,
  },
  {
    id: "situation_awareness",
    name: "Situation",
    short: "Situation",
    role: "Reads the world",
    Icon: Eye,
    color: "#60a5fa",
    matchAgent: (a) => a === "situation_awareness",
    isPipelineStage: true,
  },
  {
    id: "hazard_assessment",
    name: "Hazard",
    short: "Hazard",
    role: "Maps danger zones",
    Icon: RadarIcon,
    color: "#f59e0b",
    matchAgent: (a) => a === "hazard_assessment",
    isPipelineStage: true,
  },
  {
    // NOTE: We intentionally bucket `field_commander_*` events under the
    // dispatch agent because, in our pipeline, field-commander negotiation
    // is logically part of the "Dispatch" stage — the strategist proposes,
    // the field commanders respond. Without this, FC events would be lost
    // in the crew view (no card claims them).
    id: "dispatch_strategist",
    name: "Dispatch",
    short: "Dispatch",
    role: "Picks the team",
    Icon: Search,
    color: "#a78bfa",
    matchAgent: (a) =>
      a === "dispatch_strategist" || (!!a && a.startsWith("field_commander")),
    isPipelineStage: true,
  },
  {
    id: "route_optimizer",
    name: "Route",
    short: "Route",
    role: "Plans hazard-aware path",
    Icon: MapPin,
    color: "#34d399",
    matchAgent: (a) => a === "route_optimizer",
    isPipelineStage: true,
  },
  {
    id: "communications",
    name: "Comms",
    short: "Comms",
    role: "Alerts the public",
    Icon: Megaphone,
    color: "#f472b6",
    matchAgent: (a) => a === "communications",
    isPipelineStage: true,
  },
];

// Pipeline-stage agents only — these become the radar axes (5 of them).
const PIPELINE_AGENTS = AGENTS.filter((a) => a.isPipelineStage);

// ── Event helpers ──────────────────────────────────────────────

function isReasoning(e: AgentEvent) {
  return e.type === "agent.reasoning";
}
function isToolCall(e: AgentEvent) {
  return e.type === "agent.tool_call";
}
function isError(e: AgentEvent) {
  return e.type === "agent.error";
}
function isMission(e: AgentEvent) {
  return e.type.startsWith("mission.");
}

// ── Per-agent state derived from events ────────────────────────

type Status = "queued" | "working" | "complete" | "error";

interface AgentState {
  def: AgentDef;
  status: Status;
  events: AgentEvent[];          // newest-first for this agent
  reasoningCount: number;
  toolCallCount: number;
  errorCount: number;
  lastEventAt: number;           // ms timestamp
  firstEventAt: number;           // ms timestamp
  lastSummary: string;            // most recent reasoning thought / action
}

/**
 * Pipeline order matters: status of each agent is derived from where the
 * pipeline cursor is, NOT just from "who emitted the last event".
 *
 *   QUEUED   — no events for this agent AND no later stage has started
 *   WORKING  — events exist for this stage AND the next stage hasn't started
 *              (or — for the supervisor — any pipeline stage is currently working)
 *   COMPLETE — events exist AND a later stage has begun (i.e. cursor moved past)
 *   ERROR    — agent emitted an `agent.error` event
 *
 * This avoids the bug where, because `dispatch_strategist` happens to fire many
 * events, it stays "working" forever even after route/comms have begun.
 */
function buildAgentStates(events: AgentEvent[]): AgentState[] {
  const byAgent = new Map<AgentId, AgentEvent[]>();
  for (const a of AGENTS) byAgent.set(a.id, []);

  // events are newest-first in our list; preserve that for the per-agent list
  for (const ev of events) {
    for (const a of AGENTS) {
      if (a.matchAgent(ev.source_agent)) {
        byAgent.get(a.id)!.push(ev);
        break;
      }
    }
  }

  // Pipeline cursor: highest-index pipeline stage that has any events.
  const pipelineIndex = (id: AgentId) =>
    PIPELINE_AGENTS.findIndex((a) => a.id === id);

  let cursor = -1;
  PIPELINE_AGENTS.forEach((a, i) => {
    if (byAgent.get(a.id)!.length > 0) cursor = i;
  });

  // Most-recent timestamp across *all* events — used to detect activity stall.
  let lastAnyTs = 0;
  for (const list of byAgent.values()) {
    if (list.length > 0) {
      lastAnyTs = Math.max(lastAnyTs, new Date(list[0].timestamp).getTime());
    }
  }
  const STALE_MS = 90_000; // 90s with no events = pipeline likely paused
  const isPipelineStalled = lastAnyTs > 0 && Date.now() - lastAnyTs > STALE_MS;

  // Final pipeline stage all done? (every stage has events + last stage done >5s ago)
  const allPipelineDone =
    cursor === PIPELINE_AGENTS.length - 1 &&
    PIPELINE_AGENTS.every((a) => byAgent.get(a.id)!.length > 0);

  const states: AgentState[] = AGENTS.map((def) => {
    const list = byAgent.get(def.id)!;
    const reasoningCount = list.filter(isReasoning).length;
    const toolCallCount = list.filter(isToolCall).length;
    const errorCount = list.filter(isError).length;
    const firstEventAt =
      list.length === 0
        ? 0
        : new Date(list[list.length - 1].timestamp).getTime();
    const lastEventAt =
      list.length === 0 ? 0 : new Date(list[0].timestamp).getTime();

    let status: Status;
    if (errorCount > 0) {
      status = "error";
    } else if (def.id === "supervisor") {
      // Supervisor orchestrates the whole run.
      if (cursor === -1) status = "queued";
      else if (allPipelineDone || isPipelineStalled) status = "complete";
      else status = "working";
    } else if (def.isPipelineStage) {
      const idx = pipelineIndex(def.id);
      if (idx === -1 || list.length === 0) {
        // Stage hasn't been touched. If the cursor has already moved beyond
        // this index, we still treat as queued (could happen if route is
        // skipped because negotiation failed, etc.).
        status = "queued";
      } else if (idx < cursor) {
        status = "complete";
      } else {
        // idx === cursor — this stage is the latest one with activity.
        status = isPipelineStalled ? "complete" : "working";
      }
    } else {
      status = list.length === 0 ? "queued" : "complete";
    }

    return {
      def,
      status,
      events: list,
      reasoningCount,
      toolCallCount,
      errorCount,
      lastEventAt,
      firstEventAt,
      lastSummary: list.length > 0 ? summariseEvent(list[0]) : "",
    };
  });

  return states;
}

function summariseEvent(e: AgentEvent): string {
  if (isReasoning(e)) {
    const t = String(e.payload?.thought ?? "");
    return t.length > 110 ? t.slice(0, 107) + "…" : t;
  }
  if (isToolCall(e)) return `Called ${e.payload?.tool ?? "tool"}`;
  if (isMission(e)) {
    const verb = (e.type.split(".").pop() ?? "mission").replace("_", " ");
    const base = (e.payload?.base_name as string) ?? "";
    return `Mission ${verb}${base ? " — " + base : ""}`;
  }
  if (isError(e)) return String(e.payload?.error ?? "Error");
  return e.type;
}

function formatRelative(now: number, ts: number): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function statusLabel(s: Status): string {
  switch (s) {
    case "complete": return "COMPLETE";
    case "working":  return "WORKING";
    case "error":    return "ERROR";
    default:         return "QUEUED";
  }
}

// ── Main component ─────────────────────────────────────────────

export default function AgentCrewPanel({ events }: { events: AgentEvent[] }) {
  const states = useMemo(() => buildAgentStates(events), [events]);
  const [drawerAgent, setDrawerAgent] = useState<AgentId | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  // tick once a second so "Xs ago" stays fresh
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // For the radar: only ONE axis can be the "live" pipeline-stage axis.
  // Prefer a working pipeline-stage agent over the supervisor, since the
  // supervisor is also "working" through the whole run.
  const activePipelineAgent =
    states.find((s) => s.def.isPipelineStage && s.status === "working") ?? null;
  const completed = states.filter(
    (s) => s.def.isPipelineStage && s.status === "complete",
  ).length;
  const totalEvents = events.length;

  const drawerState = drawerAgent
    ? states.find((s) => s.def.id === drawerAgent) ?? null
    : null;

  return (
    <div className="dark-scope flex h-full flex-col overflow-hidden border border-admin-rule bg-onyx">
      {/* Header */}
      <div className="border-b border-admin-rule bg-onyx-2 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-safety-org" />
            <h3 className="font-mono text-[10px] uppercase tracking-[.14em] text-safety-org">
              The Rescue Crew
            </h3>
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
            <span>{totalEvents} events</span>
            <span className="text-steel-light/50">·</span>
            <span>{completed}/{PIPELINE_AGENTS.length} stages</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="scroll-thin flex-1 overflow-y-auto p-4 space-y-5">
        <RadarHero
          states={states}
          activeAgent={activePipelineAgent?.def.id ?? null}
        />

        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[.18em] text-steel-light">
            The Rescue Crew
          </div>
          {totalEvents === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {states.map((s) => (
                <AgentCard
                  key={s.def.id}
                  state={s}
                  now={now}
                  onClick={() => setDrawerAgent(s.def.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Side drawer */}
      {drawerState && (
        <AgentDetailDrawer
          state={drawerState}
          onClose={() => setDrawerAgent(null)}
        />
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <Brain className="mb-2 h-5 w-5 text-steel-light/50" />
      <div className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
        Crew Standing By
      </div>
      <div className="mt-1 max-w-[220px] text-[11px] text-steel-light/70">
        Submit a citizen report or launch a demo scenario to see the agents
        coordinate in real time.
      </div>
    </div>
  );
}

// ── Pentagon radar hero ───────────────────────────────────────

function RadarHero({
  states,
  activeAgent,
}: {
  states: AgentState[];
  activeAgent: AgentId | null;
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2 + 6; // nudge down so labels don't crowd top
  const radius = 78;
  const axes = PIPELINE_AGENTS;
  const N = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;

  // 0..1 fill per axis based on the agent's status
  const fills = axes.map((a) => {
    const st = states.find((s) => s.def.id === a.id)!;
    if (st.status === "complete") return 1.0;
    if (st.status === "error") return 0.6;
    if (st.status === "working") {
      // partial fill — scale by activity (events). 1 event ~ 0.45, 4+ ~ 0.85.
      const n = st.reasoningCount + st.toolCallCount;
      return Math.min(0.85, 0.45 + n * 0.1);
    }
    return 0.05; // queued — barely visible inner blob
  });

  // Polygon points
  const point = (i: number, r: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  };
  const polyOuter = axes.map((_, i) => point(i, radius)).map(([x, y]) => `${x},${y}`).join(" ");
  const polyFill = fills
    .map((f, i) => point(i, radius * Math.max(0.05, f)))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");

  // Gridlines (3 rings)
  const rings = [0.33, 0.66, 1.0].map((scale) =>
    axes.map((_, i) => point(i, radius * scale))
      .map(([x, y]) => `${x},${y}`)
      .join(" "),
  );

  const allWorking = activeAgent !== null;
  const anyComplete = states.some((s) => s.status === "complete");
  const allDone =
    states.filter((s) => s.def.isPipelineStage).every(
      (s) => s.status === "complete",
    );

  let centerLabel = "AWAITING REPORT";
  let centerColor = "#7E9989";
  if (allDone) {
    centerLabel = "ANALYSIS COMPLETE";
    centerColor = "#6BBD95";
  } else if (allWorking) {
    centerLabel = "ANALYSIS IN PROGRESS…";
    centerColor = "#facc15";
  } else if (anyComplete) {
    centerLabel = "ANALYSIS PAUSED";
    centerColor = "#A6D9BC";
  }

  return (
    <div className="relative border border-admin-rule bg-onyx-2/60 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[.18em] text-steel-light">
          Pipeline Radar
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[.12em] text-steel-light">
          5-stage cascade
        </span>
      </div>

      <div className="flex items-center justify-center">
        <svg
          width={size}
          height={size + 14}
          viewBox={`0 0 ${size} ${size + 14}`}
        >
          {/* gridlines */}
          {rings.map((pts, i) => (
            <polygon
              key={i}
              points={pts}
              fill="none"
              stroke="rgba(168, 196, 181, 0.12)"
              strokeWidth={1}
            />
          ))}
          {/* axes */}
          {axes.map((_, i) => {
            const [x, y] = point(i, radius);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke="rgba(168, 196, 181, 0.12)"
                strokeWidth={1}
              />
            );
          })}
          {/* outer polygon hint */}
          <polygon
            points={polyOuter}
            fill="rgba(107, 189, 149, 0.04)"
            stroke="rgba(107, 189, 149, 0.25)"
            strokeWidth={1}
          />
          {/* dynamic fill */}
          <polygon
            points={polyFill}
            fill="rgba(250, 204, 21, 0.18)"
            stroke="#facc15"
            strokeWidth={1.5}
          />
          {/* per-axis dots, glow on the active axis */}
          {axes.map((a, i) => {
            const [x, y] = point(i, radius * Math.max(0.05, fills[i]));
            const isActive = a.id === activeAgent;
            return (
              <g key={a.id}>
                {isActive && (
                  <circle cx={x} cy={y} r={7} fill={`${a.color}33`} />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={isActive ? 4 : 3}
                  fill={a.color}
                  stroke="#0F1A14"
                  strokeWidth={1}
                />
              </g>
            );
          })}
          {/* axis labels */}
          {axes.map((a, i) => {
            const [x, y] = point(i, radius + 14);
            const ang = angle(i);
            // anchor by quadrant for readable spacing
            let textAnchor: "start" | "middle" | "end" = "middle";
            if (Math.cos(ang) > 0.3) textAnchor = "start";
            else if (Math.cos(ang) < -0.3) textAnchor = "end";
            return (
              <text
                key={a.id}
                x={x}
                y={y}
                textAnchor={textAnchor}
                dominantBaseline="middle"
                fill={a.id === activeAgent ? a.color : "#A9C2B5"}
                style={{
                  fontFamily:
                    "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontWeight: a.id === activeAgent ? 600 : 400,
                }}
              >
                {a.short}
              </text>
            );
          })}
        </svg>
      </div>

      <div
        className="text-center font-mono text-[10px] tracking-[.18em]"
        style={{ color: centerColor }}
      >
        {centerLabel}
      </div>
    </div>
  );
}

// ── Agent card ────────────────────────────────────────────────

function AgentCard({
  state,
  now,
  onClick,
}: {
  state: AgentState;
  now: number;
  onClick: () => void;
}) {
  const { def, status } = state;
  const Icon = def.Icon;
  const color = status === "error" ? "#fb7185" : def.color;
  const isWorking = status === "working";
  const isComplete = status === "complete";
  const isQueued = status === "queued";
  const isError = status === "error";

  const tileGlow = isWorking
    ? `0 0 0 1px ${color}, 0 0 18px -2px ${color}`
    : isComplete
      ? `inset 0 0 0 1px ${color}40`
      : "none";

  const pillCls = isWorking
    ? "border bg-onyx text-[color:var(--c)] border-[color:var(--c)]/60"
    : isComplete
      ? "border border-[color:var(--c)]/30 bg-[color:var(--c)]/10 text-[color:var(--c)]"
      : isError
        ? "border border-danger/40 bg-danger/15 text-danger"
        : "border border-admin-rule bg-white/[0.02] text-steel-light";

  return (
    <button
      onClick={onClick}
      className={
        "group relative flex flex-col gap-2 border bg-onyx-2/60 px-3 py-3 text-left transition " +
        "hover:bg-onyx-2 " +
        (isWorking
          ? "border-[color:var(--c)]"
          : isComplete
            ? "border-admin-rule/80"
            : isError
              ? "border-danger/40"
              : "border-admin-rule/60")
      }
      style={
        {
          ["--c" as string]: color,
          boxShadow: tileGlow,
          opacity: isQueued ? 0.55 : 1,
        } as React.CSSProperties
      }
    >
      {/* Icon tile */}
      <div className="flex items-start justify-between">
        <div
          className={
            "flex h-9 w-9 items-center justify-center border bg-onyx " +
            (isWorking
              ? "border-[color:var(--c)] shadow-[0_0_12px_-2px_var(--c)]"
              : isComplete
                ? "border-[color:var(--c)]/40"
                : isError
                  ? "border-danger/50"
                  : "border-admin-rule")
          }
          style={{ color }}
        >
          <Icon className="h-4 w-4" />
        </div>
        {isWorking && (
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{
              background: color,
              boxShadow: `0 0 8px ${color}`,
            }}
          />
        )}
      </div>

      {/* Name + role */}
      <div>
        <div
          className="font-serif text-[15px] font-semibold leading-tight"
          style={{ color: isQueued ? "#7E9989" : "#E5EFE9" }}
        >
          {def.name}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-steel-light">
          {isWorking || isComplete || isError
            ? state.lastSummary || def.role
            : def.role}
        </div>
      </div>

      {/* Status pill + meta */}
      <div className="mt-auto flex items-center justify-between">
        <span
          className={
            "inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[9px] tracking-[.14em] " +
            pillCls
          }
        >
          {isWorking && (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: "currentColor" }}
            />
          )}
          {isComplete && <CheckCircle2 className="h-2.5 w-2.5" />}
          {isError && <AlertTriangle className="h-2.5 w-2.5" />}
          {statusLabel(status)}
        </span>

        {!isQueued && (
          <span className="font-mono text-[9px] text-steel-light">
            {formatRelative(now, state.lastEventAt)}
          </span>
        )}
      </div>

      {/* counts strip — only when there's data */}
      {(state.toolCallCount > 0 || state.reasoningCount > 0) && (
        <div className="flex items-center gap-2 border-t border-admin-rule/40 pt-1.5 font-mono text-[9px] text-steel-light">
          {state.reasoningCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Brain className="h-2.5 w-2.5" />
              {state.reasoningCount}
            </span>
          )}
          {state.toolCallCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Wrench className="h-2.5 w-2.5" />
              {state.toolCallCount}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ── Side drawer — recent reasoning / tool detail ───────────────

function AgentDetailDrawer({
  state,
  onClose,
}: {
  state: AgentState;
  onClose: () => void;
}) {
  const { def, events } = state;
  const Icon = def.Icon;
  const color = state.status === "error" ? "#fb7185" : def.color;

  return (
    <div className="absolute inset-0 z-50 flex">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-black/50 backdrop-blur-[2px] cursor-default"
      />
      {/* Drawer */}
      <aside className="dark-scope flex h-full w-[min(420px,100%)] flex-col overflow-hidden border-l border-admin-rule bg-onyx shadow-2xl">
        {/* Drawer header */}
        <div
          className="flex items-center gap-3 border-b border-admin-rule bg-onyx-2 px-4 py-3"
          style={{ borderTopColor: color }}
        >
          <div
            className="flex h-9 w-9 items-center justify-center border bg-onyx"
            style={{ borderColor: color, color }}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="font-mono text-[9px] uppercase tracking-[.16em]"
              style={{ color }}
            >
              {statusLabel(state.status)}
            </div>
            <div className="font-serif text-[15px] font-semibold text-admin-text">
              {def.name} Agent
            </div>
            <div className="text-[11px] text-steel-light">{def.role}</div>
          </div>
          <button
            onClick={onClose}
            className="text-steel-light hover:text-admin-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stats strip */}
        <div className="flex items-center justify-between border-b border-admin-rule/60 bg-onyx-2/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-steel-light">
          <span className="inline-flex items-center gap-1">
            <Brain className="h-3 w-3" /> {state.reasoningCount} thoughts
          </span>
          <span className="inline-flex items-center gap-1">
            <Wrench className="h-3 w-3" /> {state.toolCallCount} tools
          </span>
          {state.errorCount > 0 && (
            <span className="inline-flex items-center gap-1 text-danger">
              <AlertTriangle className="h-3 w-3" /> {state.errorCount} errors
            </span>
          )}
        </div>

        {/* Events */}
        <div className="scroll-thin flex-1 overflow-y-auto p-3">
          {events.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
              <Clock className="mb-2 h-5 w-5 text-steel-light/50" />
              <div className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
                No activity yet
              </div>
              <div className="mt-1 max-w-[240px] text-[11px] text-steel-light/70">
                {def.name} hasn&apos;t been engaged on a current incident.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((e) => (
                <DrawerCard key={e.id} event={e} color={color} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function DrawerCard({ event, color }: { event: AgentEvent; color: string }) {
  const [open, setOpen] = useState(false);
  const time = new Date(event.timestamp).toLocaleTimeString("en-IN", {
    hour12: false,
  });
  const expandable = isReasoning(event) || isToolCall(event) || isMission(event);

  let kind = "EVENT";
  if (isReasoning(event)) kind = "REASONING";
  else if (isToolCall(event)) kind = "TOOL CALL";
  else if (isMission(event)) kind = "MISSION";
  else if (isError(event)) kind = "ERROR";

  return (
    <div
      className="overflow-hidden border border-admin-rule/70 bg-onyx-2/50"
      style={{ borderLeft: `2px solid ${color}` }}
    >
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={
          "flex w-full items-start gap-2 px-3 py-2 text-left " +
          (expandable ? "cursor-pointer" : "cursor-default")
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-[9px] uppercase tracking-[.14em]"
              style={{ color: isError(event) ? "#fb7185" : color }}
            >
              {kind}
            </span>
            <span className="ml-auto font-mono text-[9px] text-steel-light">
              {time}
            </span>
          </div>
          <div
            className={
              "mt-1 break-words text-[12px] leading-snug " +
              (isError(event) ? "text-danger" : "text-admin-text")
            }
          >
            {summariseEvent(event)}
          </div>
        </div>
        {expandable && (
          <ChevronDown
            className={
              "mt-1 h-3 w-3 shrink-0 text-steel-light transition " +
              (open ? "rotate-180" : "")
            }
          />
        )}
      </button>

      {open && expandable && (
        <div className="border-t border-white/5 bg-onyx/60 px-3 py-2">
          {isReasoning(event) && (
            <div>
              <div
                className="mb-1.5 font-mono text-[9px] uppercase tracking-[.14em]"
                style={{ color }}
              >
                Full reasoning
              </div>
              <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-admin-text">
                {String(event.payload?.thought ?? "—")}
              </p>
            </div>
          )}
          {isToolCall(event) && (
            <div>
              <div
                className="mb-1.5 font-mono text-[9px] uppercase tracking-[.14em]"
                style={{ color }}
              >
                Tool arguments
              </div>
              <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap break-words bg-onyx-2/60 p-2 font-mono text-[10px] text-admin-muted">
                {JSON.stringify(event.payload?.args ?? {}, null, 2)}
              </pre>
              {event.payload?.result_summary ? (
                <div className="mt-2">
                  <div
                    className="mb-1.5 font-mono text-[9px] uppercase tracking-[.14em]"
                    style={{ color }}
                  >
                    Result
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-admin-muted">
                    {String(event.payload.result_summary)}
                  </p>
                </div>
              ) : null}
            </div>
          )}
          {isMission(event) && (
            <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap break-words bg-onyx-2/60 p-2 font-mono text-[10px] text-admin-muted">
              {JSON.stringify(event.payload ?? {}, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
