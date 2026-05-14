"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  Handshake,
  MapPin,
  Megaphone,
  Radar,
  Search,
  Truck,
  Wrench,
} from "lucide-react";

import type { AgentEvent } from "@/lib/types";

// ── Stage taxonomy ─────────────────────────────────────────────

type StageId =
  | "situation_awareness"
  | "hazard_assessment"
  | "dispatch_strategist"
  | "negotiation"
  | "route_optimizer"
  | "communications";

interface StageDef {
  id: StageId;
  label: string;
  short: string;
  icon: typeof Brain;
  color: string;
  matchAgent: (agent: string | null) => boolean;
}

const STAGES: StageDef[] = [
  {
    id: "situation_awareness",
    label: "Situation Awareness",
    short: "Situation",
    icon: Eye,
    color: "#6BBD95",
    matchAgent: (a) => a === "situation_awareness",
  },
  {
    id: "hazard_assessment",
    label: "Hazard Assessment",
    short: "Hazard",
    icon: Radar,
    color: "#E86A10",
    matchAgent: (a) => a === "hazard_assessment",
  },
  {
    id: "dispatch_strategist",
    label: "Dispatch Strategist",
    short: "Dispatch",
    icon: Search,
    color: "#a78bfa",
    matchAgent: (a) => a === "dispatch_strategist",
  },
  {
    id: "negotiation",
    label: "Field Commander Negotiation",
    short: "Negotiate",
    icon: Handshake,
    color: "#fb7185",
    matchAgent: (a) => !!a && a.startsWith("field_commander"),
  },
  {
    id: "route_optimizer",
    label: "Route Optimizer",
    short: "Route",
    icon: MapPin,
    color: "#34d399",
    matchAgent: (a) => a === "route_optimizer",
  },
  {
    id: "communications",
    label: "Communications",
    short: "Comms",
    icon: Megaphone,
    color: "#f472b6",
    matchAgent: (a) => a === "communications",
  },
];

function stageForAgent(agent: string | null): StageId | null {
  for (const s of STAGES) if (s.matchAgent(agent)) return s.id;
  return null;
}

// ── Event helpers ──────────────────────────────────────────────

function isToolCall(e: AgentEvent) {
  return e.type === "agent.tool_call";
}
function isReasoning(e: AgentEvent) {
  return e.type === "agent.reasoning";
}
function isMission(e: AgentEvent) {
  return e.type.startsWith("mission.");
}
function isError(e: AgentEvent) {
  return e.type === "agent.error";
}

function formatArgsPreview(
  args: Record<string, unknown> | undefined | null,
): string {
  if (!args || typeof args !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    let val: string;
    if (typeof v === "object" && v !== null) val = JSON.stringify(v);
    else val = String(v);
    if (val.length > 40) val = val.slice(0, 37) + "…";
    parts.push(`${k}=${val}`);
    if (parts.join(", ").length > 80) break;
  }
  return parts.join(", ");
}

interface PipelineStage {
  id: StageId;
  events: AgentEvent[];
  firstAt: string | null;
  lastAt: string | null;
  reasoningCount: number;
  toolCalls: AgentEvent[];
  errorCount: number;
  status: "pending" | "active" | "done" | "error";
}

function buildStages(events: AgentEvent[]): {
  stages: PipelineStage[];
  unstaged: AgentEvent[];
  errors: AgentEvent[];
} {
  const map = new Map<StageId, PipelineStage>();
  for (const s of STAGES) {
    map.set(s.id, {
      id: s.id,
      events: [],
      firstAt: null,
      lastAt: null,
      reasoningCount: 0,
      toolCalls: [],
      errorCount: 0,
      status: "pending",
    });
  }

  const unstaged: AgentEvent[] = [];
  const errors: AgentEvent[] = [];

  const ordered = [...events].reverse();
  for (const e of ordered) {
    if (isError(e)) errors.push(e);
    const sid = stageForAgent(e.source_agent);
    if (!sid) {
      unstaged.push(e);
      continue;
    }
    const st = map.get(sid)!;
    st.events.push(e);
    if (!st.firstAt) st.firstAt = e.timestamp;
    st.lastAt = e.timestamp;
    if (isReasoning(e)) st.reasoningCount += 1;
    if (isToolCall(e)) st.toolCalls.push(e);
    if (isError(e)) st.errorCount += 1;
  }

  const stages = STAGES.map((s) => map.get(s.id)!);

  let lastActiveIdx = -1;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].events.length > 0) lastActiveIdx = i;
  }
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].errorCount > 0) stages[i].status = "error";
    else if (i < lastActiveIdx) stages[i].status = "done";
    else if (i === lastActiveIdx) stages[i].status = "active";
    else stages[i].status = "pending";
  }

  return { stages, unstaged, errors };
}

function durationMs(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  return Math.max(0, new Date(b).getTime() - new Date(a).getTime());
}

function formatDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Main component ─────────────────────────────────────────────

export default function AgentReasoningPanel({
  events,
}: {
  events: AgentEvent[];
}) {
  const { stages, unstaged, errors } = useMemo(
    () => buildStages(events),
    [events],
  );
  const [expanded, setExpanded] = useState<Record<StageId, boolean>>({
    situation_awareness: true,
    hazard_assessment: false,
    dispatch_strategist: false,
    negotiation: false,
    route_optimizer: false,
    communications: false,
  });
  const [showRaw, setShowRaw] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = stages.find((s) => s.status === "active");
    if (active) {
      setExpanded((prev) => ({ ...prev, [active.id]: true }));
    }
  }, [stages]);

  useEffect(() => {
    if (showRaw) {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [events.length, showRaw]);

  const activeStage = stages.find((s) => s.status === "active");
  const completedCount = stages.filter((s) => s.status === "done").length;

  return (
    <div className="dark-scope flex h-full flex-col overflow-hidden border border-admin-rule bg-onyx">
      {/* Header */}
      <div className="border-b border-admin-rule bg-onyx-2 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-safety-org" />
            <h3 className="font-mono text-[10px] uppercase tracking-[.14em] text-safety-org">
              Agent Reasoning — Live
            </h3>
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
            <span>{events.length} events</span>
            <span className="text-steel-light/50">·</span>
            <span>
              {completedCount}/{STAGES.length} stages
            </span>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className={
                "ml-1 px-1.5 py-0.5 transition " +
                (showRaw
                  ? "bg-safety-org/15 text-safety-org"
                  : "text-steel-light hover:text-admin-text")
              }
            >
              Raw
            </button>
          </div>
        </div>

        <StageTracker stages={stages} />

        {activeStage && (
          <div className="mt-2.5 flex items-center gap-2 border border-safety-org/30 bg-safety-org/[0.06] px-2.5 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-safety-org opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-safety-org" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[.12em] text-safety-org">
              {STAGES.find((s) => s.id === activeStage.id)?.label}
            </span>
            <span className="font-mono text-[10px] tracking-[.08em] text-safety-org/70">
              · reasoning
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto p-3">
        {events.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
            <Brain className="mb-2 h-5 w-5 text-steel-light/50" />
            <div className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
              Awaiting Agent Activity
            </div>
            <div className="mt-1 max-w-[220px] text-[11px] text-steel-light/70">
              Submit a citizen report or run a demo scenario to see agents
              reason in real time.
            </div>
          </div>
        ) : showRaw ? (
          <RawTimeline events={events} />
        ) : (
          <div className="space-y-2">
            {stages.map((stage) => (
              <StageCard
                key={stage.id}
                stage={stage}
                def={STAGES.find((s) => s.id === stage.id)!}
                isOpen={!!expanded[stage.id]}
                onToggle={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [stage.id]: !prev[stage.id],
                  }))
                }
              />
            ))}
            {errors.length > 0 && <ErrorSection errors={errors} />}
            {unstaged.length > 0 && <UnstagedSection events={unstaged} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stage tracker (top chip row) ──────────────────────────────

function StageTracker({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="mt-3 flex items-stretch gap-px overflow-hidden border border-admin-rule bg-admin-rule">
      {stages.map((s, i) => {
        const def = STAGES.find((d) => d.id === s.id)!;
        const Icon = def.icon;
        const bg =
          s.status === "active"
            ? "bg-safety-org/15"
            : s.status === "done"
              ? "bg-cleared/10"
              : s.status === "error"
                ? "bg-danger/15"
                : "bg-onyx-2";
        const colorStyle =
          s.status === "pending"
            ? "#475569"
            : s.status === "error"
              ? "#fb7185"
              : def.color;
        const labelClass =
          s.status === "pending" ? "text-steel-light/70" : "text-admin-text";
        return (
          <div
            key={s.id}
            className={`relative flex flex-1 flex-col items-center gap-1 px-1 py-2 ${bg}`}
            title={def.label}
          >
            <div className="flex items-center gap-1">
              <Icon className="h-3 w-3" style={{ color: colorStyle }} />
              <span className="font-mono text-[8px] text-steel-light">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <span
              className={`font-mono text-[9px] font-medium uppercase tracking-[.1em] ${labelClass}`}
            >
              {def.short}
            </span>
            {s.status === "active" && (
              <span className="absolute inset-x-1 bottom-0 h-[2px] bg-safety-org" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Stage card (collapsible) ──────────────────────────────────

function StageCard({
  stage,
  def,
  isOpen,
  onToggle,
}: {
  stage: PipelineStage;
  def: StageDef;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const Icon = def.icon;
  const duration = durationMs(stage.firstAt, stage.lastAt);
  const isInactive = stage.events.length === 0;

  if (isInactive) {
    return (
      <div className="border border-admin-rule/60 bg-white/[0.015] px-3 py-2 opacity-60">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-steel-light/60" />
          <span className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
            {def.label}
          </span>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-[.1em] text-steel-light/60">
            pending
          </span>
        </div>
      </div>
    );
  }

  const accentBorder =
    stage.status === "error"
      ? "border-danger/40 bg-danger/[0.06]"
      : stage.status === "active"
        ? "border-safety-org/30 bg-safety-org/[0.04]"
        : "border-admin-rule bg-white/[0.02]";

  return (
    <div
      className={`overflow-hidden border-l-[3px] ${accentBorder}`}
      style={{
        borderLeftColor:
          stage.status === "active"
            ? def.color
            : stage.status === "error"
              ? "#fb7185"
              : def.color,
      }}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/[0.02]"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 text-steel-light" />
        ) : (
          <ChevronRight className="h-3 w-3 text-steel-light" />
        )}
        <Icon className="h-3.5 w-3.5" style={{ color: def.color }} />
        <span
          className="font-mono text-[10px] uppercase tracking-[.12em]"
          style={{ color: def.color }}
        >
          {def.label}
        </span>
        <div className="ml-auto flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-steel-light">
          {stage.toolCalls.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Wrench className="h-2.5 w-2.5" />
              {stage.toolCalls.length}
            </span>
          )}
          {stage.reasoningCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Brain className="h-2.5 w-2.5" />
              {stage.reasoningCount}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(duration)}
          </span>
          <StageStatusPill status={stage.status} />
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-admin-rule/60 bg-onyx-2/40 px-3 py-2">
          <ul className="space-y-1.5">
            {stage.events.map((e) => (
              <EventLine key={e.id} event={e} accent={def.color} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StageStatusPill({ status }: { status: PipelineStage["status"] }) {
  const config: Record<
    PipelineStage["status"],
    { label: string; cls: string; icon: typeof CheckCircle2 }
  > = {
    done: {
      label: "done",
      cls: "border-cleared/40 bg-cleared/15 text-cleared",
      icon: CheckCircle2,
    },
    active: {
      label: "active",
      cls: "border-safety-org/40 bg-safety-org/15 text-safety-org",
      icon: Clock,
    },
    error: {
      label: "error",
      cls: "border-danger/40 bg-danger/15 text-danger",
      icon: AlertTriangle,
    },
    pending: {
      label: "pending",
      cls: "border-admin-rule bg-white/[0.02] text-steel-light",
      icon: Clock,
    },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-sharp border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[.1em] " +
        c.cls
      }
    >
      <Icon
        className={"h-2.5 w-2.5 " + (status === "active" ? "animate-pulse" : "")}
      />
      {c.label}
    </span>
  );
}

// ── Per-event display ──────────────────────────────────────────

function EventLine({ event, accent }: { event: AgentEvent; accent: string }) {
  const [open, setOpen] = useState(false);
  const time = new Date(event.timestamp).toLocaleTimeString("en-IN", {
    hour12: false,
  });

  if (isToolCall(event)) {
    const tool = (event.payload?.tool as string) ?? "tool";
    const argsPreview = formatArgsPreview(
      event.payload?.args as Record<string, unknown> | undefined,
    );
    const hasArgs = argsPreview.length > 0;
    return (
      <li className="border border-admin-rule/60 bg-white/[0.02]">
        <button
          onClick={() => hasArgs && setOpen((v) => !v)}
          className={
            "flex w-full items-start gap-2 px-2 py-1.5 text-left " +
            (hasArgs ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default")
          }
        >
          <Wrench
            className="mt-0.5 h-3 w-3 shrink-0"
            style={{ color: accent }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[11px] font-semibold text-admin-text">
                {tool}
              </span>
              {hasArgs && (
                <span className="truncate font-mono text-[10px] text-admin-muted">
                  ({argsPreview})
                </span>
              )}
            </div>
          </div>
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
            {time}
          </span>
        </button>
        {open && hasArgs && (
          <pre className="scroll-thin max-h-40 overflow-auto border-t border-admin-rule/60 bg-onyx-2 p-2 font-mono text-[10px] text-admin-muted">
            {JSON.stringify(event.payload?.args, null, 2)}
          </pre>
        )}
      </li>
    );
  }

  if (isReasoning(event)) {
    const thought = String(event.payload?.thought ?? "");
    return (
      <li className="flex items-start gap-2 border border-admin-rule/60 bg-white/[0.02] px-2 py-1.5">
        <Brain
          className="mt-0.5 h-3 w-3 shrink-0"
          style={{ color: accent }}
        />
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-admin-text">
          {thought}
        </div>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
          {time}
        </span>
      </li>
    );
  }

  if (isMission(event)) {
    const verb = event.type.split(".").pop()?.toUpperCase() ?? "MISSION";
    const base = (event.payload?.base_name as string) ?? "";
    const commander = (event.payload?.commander as string) ?? "";
    return (
      <li className="flex items-start gap-2 border border-admin-rule/60 bg-white/[0.02] px-2 py-1.5">
        <Truck
          className="mt-0.5 h-3 w-3 shrink-0"
          style={{ color: accent }}
        />
        <div className="min-w-0 flex-1 text-[11px]">
          <span className="font-mono font-semibold uppercase tracking-[.08em] text-admin-text">
            {verb}
          </span>
          {base && <span className="ml-1 text-admin-text">{base}</span>}
          {commander && (
            <span className="ml-1 text-steel-light">· {commander}</span>
          )}
        </div>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
          {time}
        </span>
      </li>
    );
  }

  if (isError(event)) {
    return (
      <li className="flex items-start gap-2 border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        <div className="min-w-0 flex-1 break-words">
          {String(event.payload?.error ?? "error")}
        </div>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[.1em] text-danger/70">
          {time}
        </span>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 border border-admin-rule/60 bg-white/[0.02] px-2 py-1.5 text-[11px] text-admin-muted">
      <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-steel-light" />
      <div className="min-w-0 flex-1 truncate">
        {event.type} · {JSON.stringify(event.payload).slice(0, 80)}
      </div>
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
        {time}
      </span>
    </li>
  );
}

// ── Errors + supervisor events ─────────────────────────────────

function ErrorSection({ errors }: { errors: AgentEvent[] }) {
  return (
    <div className="border-l-[3px] border-danger bg-danger/[0.06] px-3 py-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-danger">
        <AlertTriangle className="h-3 w-3" />
        Pipeline Errors
        <span className="ml-auto font-normal tracking-[.08em] text-danger/70">
          {errors.length}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {errors.slice(0, 4).map((e) => (
          <li
            key={e.id}
            className="bg-danger/10 px-2 py-1 text-[11px] text-danger"
          >
            {String(e.payload?.error ?? "unknown error")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnstagedSection({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) return null;
  return (
    <details className="border border-admin-rule/60 bg-white/[0.02] px-3 py-1.5">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[.12em] text-steel-light hover:text-admin-text">
        Supervisor &amp; system events ({events.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {events.slice(0, 8).map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-2 bg-white/[0.02] px-2 py-1 text-[10px] text-admin-muted"
          >
            <span className="font-mono font-medium text-admin-text">
              {e.source_agent ?? "system"}
            </span>
            <span className="truncate text-steel-light">
              {String(e.payload?.thought ?? e.type)}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[.08em] text-steel-light/70">
              {new Date(e.timestamp).toLocaleTimeString("en-IN", {
                hour12: false,
              })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── Raw mode (chronological flat list) ────────────────────────

function RawTimeline({ events }: { events: AgentEvent[] }) {
  return (
    <ul className="space-y-1.5">
      {events.map((e) => {
        const stage = stageForAgent(e.source_agent);
        const def = stage ? STAGES.find((s) => s.id === stage) : null;
        const color = def?.color ?? "#A0AEC0";
        return (
          <li
            key={e.id}
            className="border border-admin-rule/60 bg-white/[0.025] p-2"
          >
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[.12em] text-steel-light">
              <span className="font-medium" style={{ color }}>
                {e.source_agent ?? "system"}
              </span>
              <span>
                {new Date(e.timestamp).toLocaleTimeString("en-IN", {
                  hour12: false,
                })}
              </span>
            </div>
            <div className="mt-1 break-words text-[11px] text-admin-text">
              {isReasoning(e)
                ? String(e.payload?.thought ?? "")
                : isToolCall(e)
                  ? `${e.payload?.tool}(${formatArgsPreview(e.payload?.args as Record<string, unknown> | undefined)})`
                  : isError(e)
                    ? String(e.payload?.error ?? "")
                    : `${e.type} · ${JSON.stringify(e.payload).slice(0, 100)}`}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
