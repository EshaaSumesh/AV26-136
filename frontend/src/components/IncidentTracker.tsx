"use client";

import { useMemo, useState } from "react";
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
  Sparkles,
  Truck,
  Wrench,
  XCircle,
} from "lucide-react";

import type { IncidentStageUpdate } from "@/lib/useAuthorityWS";
import type { AgentEvent } from "@/lib/types";

type StageId =
  | "situation_awareness"
  | "hazard_assessment"
  | "communications"
  | "dispatch_strategist"
  | "negotiation"
  | "route_optimizer";

interface StageDef {
  id: StageId;
  short: string;
  long: string;
  icon: typeof Eye;
  color: string;
  matchesAgent: (agent: string | null) => boolean;
}

const STAGES: StageDef[] = [
  {
    id: "situation_awareness",
    short: "Situation",
    long: "Reading & verifying your report",
    icon: Eye,
    color: "#1A5C41",
    matchesAgent: (a) => a === "situation_awareness",
  },
  {
    id: "hazard_assessment",
    short: "Hazard",
    long: "Evaluating hazard zones",
    icon: Radar,
    color: "#92400E",
    matchesAgent: (a) => a === "hazard_assessment",
  },
  {
    id: "communications",
    short: "Alert",
    long: "Notifying nearby citizens",
    icon: Megaphone,
    color: "#7A3FB2",
    matchesAgent: (a) => a === "communications",
  },
  {
    id: "dispatch_strategist",
    short: "Dispatch",
    long: "Picking the closest base",
    icon: Search,
    color: "#374D8A",
    matchesAgent: (a) => a === "dispatch_strategist",
  },
  {
    id: "negotiation",
    short: "Negotiate",
    long: "Field commander accepting",
    icon: Handshake,
    color: "#B0356B",
    matchesAgent: (a) =>
      !!a &&
      (a.startsWith("field_commander") ||
        a === "supervisor" /* propose / decline / accept events */),
  },
  {
    id: "route_optimizer",
    short: "Route",
    long: "Computing the safest route",
    icon: MapPin,
    color: "#1F6A4D",
    matchesAgent: (a) => a === "route_optimizer",
  },
];

function stageForAgent(agent: string | null): StageId | null {
  for (const s of STAGES) if (s.matchesAgent(agent)) return s.id;
  return null;
}

interface StageState {
  status: "pending" | "running" | "done" | "skipped" | "error";
  caption?: string;
  startedAt?: number;
  endedAt?: number;
}

type OutcomeKind =
  | "dispatched"
  | "advisory"
  | "non_disaster"
  | "escalated"
  | "error";

const OUTCOME_KINDS: ReadonlySet<string> = new Set([
  "dispatched",
  "advisory",
  "non_disaster",
  "escalated",
  "error",
]);

function asOutcomeKind(raw: unknown, fallback: OutcomeKind): OutcomeKind {
  return OUTCOME_KINDS.has(String(raw)) ? (raw as OutcomeKind) : fallback;
}

export interface TrackedIncident {
  incidentId: string;
  startedAt: number;
  stages: Record<StageId, StageState>;
  outcome?: {
    kind: OutcomeKind;
    caption: string;
    base_name?: string;
    eta_minutes?: number;
    mission_id?: string;
  };
}

export function buildIncidents(
  updates: IncidentStageUpdate[],
  knownIds: string[],
): TrackedIncident[] {
  const map = new Map<string, TrackedIncident>();

  function ensure(id: string): TrackedIncident {
    let inc = map.get(id);
    if (!inc) {
      inc = {
        incidentId: id,
        startedAt: Date.now(),
        stages: Object.fromEntries(
          STAGES.map((s) => [s.id, { status: "pending" } as StageState]),
        ) as Record<StageId, StageState>,
      };
      map.set(id, inc);
    }
    return inc;
  }

  for (const id of knownIds) ensure(id);

  for (const u of updates) {
    const inc = ensure(u.incident_id);
    if (u.receivedAt < inc.startedAt) inc.startedAt = u.receivedAt;

    if (u.stage === "supervisor") {
      if (u.status === "done" || u.status === "error") {
        inc.outcome = {
          kind: asOutcomeKind(
            u.outcome,
            u.status === "error" ? "error" : "dispatched",
          ),
          caption: u.caption,
          base_name: u.base_name,
          eta_minutes: u.eta_minutes,
          mission_id: u.mission_id,
        };
      }
      continue;
    }

    const stage = inc.stages[u.stage as StageId];
    if (!stage) continue;
    if (u.status === "running") {
      stage.status = "running";
      stage.startedAt = u.receivedAt;
      stage.caption = u.caption;
    } else if (u.status === "done") {
      stage.status = "done";
      stage.endedAt = u.receivedAt;
      stage.caption = u.caption;
    } else if (u.status === "skipped") {
      stage.status = "skipped";
      stage.caption = u.caption;
    } else if (u.status === "error") {
      stage.status = "error";
      stage.caption = u.caption;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function IncidentTracker({
  incident,
  events = [],
}: {
  incident: TrackedIncident;
  events?: AgentEvent[];
}) {
  const completed = useMemo(
    () =>
      Object.values(incident.stages).filter(
        (s) => s.status === "done" || s.status === "skipped",
      ).length,
    [incident],
  );
  const isError = incident.outcome?.kind === "error" || incident.outcome?.kind === "escalated";
  const isResolved = !!incident.outcome && !isError;
  const startTime = new Date(incident.startedAt).toLocaleTimeString("en-IN", {
    hour12: false,
  });

  // Group events by stage for the per-stage expanders.
  const eventsByStage = useMemo(() => {
    const m = new Map<StageId, AgentEvent[]>();
    for (const s of STAGES) m.set(s.id, []);
    // chronological (oldest first)
    const chrono = [...events].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    for (const e of chrono) {
      const sid = stageForAgent(e.source_agent);
      if (sid && m.has(sid)) m.get(sid)!.push(e);
    }
    return m;
  }, [events]);

  return (
    <section className="border border-rule-color bg-warm-white">
      <header className="flex items-start justify-between border-b border-rule-color bg-mint-white/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={
              "relative flex h-7 w-7 items-center justify-center rounded-full " +
              (isError
                ? "bg-emrg-pale"
                : isResolved
                  ? "bg-safe-pale"
                  : "bg-mint")
            }
          >
            {isError ? (
              <XCircle className="h-3.5 w-3.5 text-emrg-red" />
            ) : isResolved ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-safe-green" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-mid-green" />
            )}
            {!incident.outcome && (
              <span className="absolute inset-0 rounded-full border border-mid-green/40 live-pulse" />
            )}
          </span>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[.16em] text-mid-green">
              Tracking your report
            </div>
            <div className="font-serif text-[14px] font-semibold leading-tight text-forest">
              Incident · {incident.incidentId.slice(-8)}
            </div>
          </div>
        </div>
        <div className="text-right font-mono text-[9px] uppercase tracking-[.1em] text-muted-text">
          <div>{startTime}</div>
          <div className="mt-0.5">
            {completed}/{STAGES.length} stages
          </div>
        </div>
      </header>

      {/* Stage tracker */}
      <ol className="divide-y divide-rule-color/70">
        {STAGES.map((def, i) => {
          const state = incident.stages[def.id];
          const stageEvents = eventsByStage.get(def.id) ?? [];
          return (
            <StageRow
              key={def.id}
              def={def}
              state={state}
              index={i}
              isLast={i === STAGES.length - 1}
              events={stageEvents}
            />
          );
        })}
      </ol>

      {/* Outcome banner */}
      {incident.outcome && <OutcomeBanner outcome={incident.outcome} />}
    </section>
  );
}

function StageRow({
  def,
  state,
  index,
  events,
}: {
  def: StageDef;
  state: StageState;
  index: number;
  isLast: boolean;
  events: AgentEvent[];
}) {
  const Icon = def.icon;
  const [expanded, setExpanded] = useState(false);
  const reasoningCount = events.filter((e) => e.type === "agent.reasoning").length;
  const toolCount = events.filter((e) => e.type === "agent.tool_call").length;
  const missionCount = events.filter((e) => e.type.startsWith("mission.")).length;
  const hasDetail = events.length > 0;
  const palette = (() => {
    switch (state.status) {
      case "running":
        return {
          ring: "border-mid-green text-mid-green bg-mint-white",
          text: "text-forest",
          iconCls: "animate-pulse",
        };
      case "done":
        return {
          ring: "border-safe-green text-safe-green bg-safe-pale",
          text: "text-forest",
          iconCls: "",
        };
      case "skipped":
        return {
          ring: "border-rule-color text-muted-text bg-mint-white/40",
          text: "text-muted-text",
          iconCls: "",
        };
      case "error":
        return {
          ring: "border-emrg-red text-emrg-red bg-emrg-pale",
          text: "text-emrg-red",
          iconCls: "",
        };
      default:
        return {
          ring: "border-rule-color/70 text-muted-text/60 bg-warm-white",
          text: "text-muted-text/70",
          iconCls: "",
        };
    }
  })();

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center">
          <span
            className={
              "inline-flex h-7 w-7 items-center justify-center rounded-full border " +
              palette.ring
            }
          >
            {state.status === "done" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : state.status === "error" ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : state.status === "running" ? (
              <Clock className={"h-3.5 w-3.5 " + palette.iconCls} />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="mt-0.5 font-mono text-[8px] tracking-[.12em] text-muted-text">
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                "font-mono text-[10px] uppercase tracking-[.12em] " +
                palette.text
              }
            >
              {def.short}
            </span>
            <StatusBadge status={state.status} />
            {hasDetail && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-auto inline-flex items-center gap-1 border border-rule-color bg-warm-white px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[.1em] text-muted-text transition hover:border-mid-green hover:text-mid-green"
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {expanded ? "Hide" : "Show"} reasoning
                <span className="ml-1 inline-flex items-center gap-1.5 text-muted-text/80">
                  {reasoningCount > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Brain className="h-2.5 w-2.5" />
                      {reasoningCount}
                    </span>
                  )}
                  {toolCount > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Wrench className="h-2.5 w-2.5" />
                      {toolCount}
                    </span>
                  )}
                  {missionCount > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Truck className="h-2.5 w-2.5" />
                      {missionCount}
                    </span>
                  )}
                </span>
              </button>
            )}
          </div>
          <div
            className={
              "mt-0.5 text-[12px] leading-snug " +
              (state.status === "pending"
                ? "text-muted-text/70"
                : state.status === "error"
                  ? "text-emrg-red"
                  : "text-body-text")
            }
          >
            {state.caption ?? def.long}
          </div>
        </div>
      </div>

      {expanded && hasDetail && (
        <div className="mt-3 ml-10 space-y-2">
          {events.map((e) => (
            <CitizenFlashcard key={e.id} event={e} color={def.color} />
          ))}
        </div>
      )}
    </li>
  );
}

// ── Glass flashcard tuned to the citizen palette (light) ──────

function CitizenFlashcard({
  event,
  color,
}: {
  event: AgentEvent;
  color: string;
}) {
  const [open, setOpen] = useState(false);
  const time = new Date(event.timestamp).toLocaleTimeString("en-IN", {
    hour12: false,
  });

  let kindLabel = "Event";
  let headline = event.type;
  let detailNode: React.ReactNode = null;
  let Icon: typeof Brain = Brain;

  if (event.type === "agent.reasoning") {
    kindLabel = "Thought";
    Icon = Brain;
    const thought = String(event.payload?.thought ?? "");
    headline = thought.length > 110 ? thought.slice(0, 107) + "…" : thought;
    detailNode = (
      <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-body-text">
        {thought || "—"}
      </p>
    );
  } else if (event.type === "agent.tool_call") {
    kindLabel = "Tool call";
    Icon = Wrench;
    const tool = String(event.payload?.tool ?? "tool");
    const args = event.payload?.args as Record<string, unknown> | undefined;
    const argsStr = args
      ? Object.entries(args)
          .map(([k, v]) => {
            const sv =
              typeof v === "object" && v !== null
                ? JSON.stringify(v).slice(0, 40)
                : String(v).slice(0, 40);
            return `${k}=${sv}`;
          })
          .join(", ")
      : "";
    headline = `Called ${tool}`;
    detailNode = (
      <div>
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[.14em] text-muted-text">
          Tool · {tool}
        </div>
        {argsStr && (
          <pre className="scroll-thin max-h-44 overflow-auto whitespace-pre-wrap break-words border border-rule-color bg-mint-white/60 p-2 font-mono text-[10px] text-body-text">
            {JSON.stringify(args, null, 2)}
          </pre>
        )}
      </div>
    );
  } else if (event.type.startsWith("mission.")) {
    kindLabel = "Mission";
    Icon = Truck;
    const verb = (event.type.split(".").pop() ?? "mission").replace("_", " ");
    const base = (event.payload?.base_name as string) ?? "";
    const commander = (event.payload?.commander as string) ?? "";
    headline =
      `Mission ${verb}` +
      (base ? ` — ${base}` : "") +
      (commander ? ` · ${commander}` : "");
    detailNode = (
      <pre className="scroll-thin max-h-44 overflow-auto whitespace-pre-wrap break-words border border-rule-color bg-mint-white/60 p-2 font-mono text-[10px] text-body-text">
        {JSON.stringify(event.payload ?? {}, null, 2)}
      </pre>
    );
  } else if (event.type === "agent.error") {
    kindLabel = "Error";
    Icon = AlertTriangle;
    headline = String(event.payload?.error ?? "Error");
  }

  const expandable = !!detailNode;

  return (
    <div
      className="relative overflow-hidden border border-rule-color bg-warm-white shadow-[0_1px_0_rgba(20,61,46,.04)] transition hover:border-mid-green/40"
      style={
        {
          ["--agent-color" as string]: color,
        } as React.CSSProperties
      }
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -left-4 -top-4 h-12 w-12 rounded-full opacity-25 blur-xl"
        style={{ background: color }}
      />
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={
          "flex w-full items-start gap-3 px-3 py-2.5 text-left " +
          (expandable ? "cursor-pointer" : "cursor-default")
        }
      >
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-mint-white"
          style={{ borderColor: color, color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-[9px] uppercase tracking-[.14em]"
              style={{ color }}
            >
              {kindLabel}
            </span>
            <span className="font-mono text-[9px] text-muted-text/80">
              · {event.source_agent ?? "system"}
            </span>
            <span className="ml-auto font-mono text-[9px] text-muted-text">
              {time}
            </span>
          </div>
          <div
            className={
              "mt-0.5 break-words text-[12px] leading-snug " +
              (event.type === "agent.error" ? "text-emrg-red" : "text-body-text")
            }
          >
            {headline || "—"}
          </div>
        </div>
        {expandable && (
          <ChevronDown
            className={
              "mt-1.5 h-3 w-3 shrink-0 text-muted-text transition " +
              (open ? "rotate-180" : "")
            }
          />
        )}
      </button>
      {open && detailNode && (
        <div className="border-t border-rule-color/70 bg-mint-white/30 px-3 py-2">
          {detailNode}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StageState["status"] }) {
  const cfg: Record<StageState["status"], { label: string; cls: string }> = {
    pending: {
      label: "waiting",
      cls: "border-rule-color/70 text-muted-text/70 bg-warm-white",
    },
    running: {
      label: "live",
      cls: "border-mid-green/40 text-mid-green bg-mint-white",
    },
    done: {
      label: "done",
      cls: "border-safe-green/40 text-safe-green bg-safe-pale",
    },
    skipped: {
      label: "skipped",
      cls: "border-rule-color text-muted-text bg-mint-white/60",
    },
    error: {
      label: "error",
      cls: "border-emrg-red/40 text-emrg-red bg-emrg-pale",
    },
  };
  const c = cfg[status];
  return (
    <span
      className={
        "rounded-sharp border px-1.5 py-px font-mono text-[8px] uppercase tracking-[.12em] " +
        c.cls
      }
    >
      {c.label}
    </span>
  );
}

function OutcomeBanner({
  outcome,
}: {
  outcome: NonNullable<TrackedIncident["outcome"]>;
}) {
  const isErr = outcome.kind === "error" || outcome.kind === "escalated";
  return (
    <div
      className={
        "border-t border-rule-color px-4 py-3 " +
        (isErr ? "bg-emrg-pale/60" : "bg-safe-pale/60")
      }
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em]">
        {isErr ? (
          <AlertTriangle className="h-3.5 w-3.5 text-emrg-red" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-safe-green" />
        )}
        <span className={isErr ? "text-emrg-red" : "text-safe-green"}>
          {outcome.kind.replace("_", " ")}
        </span>
      </div>
      <div className="mt-1 text-[13px] font-medium leading-relaxed text-forest">
        {outcome.caption}
      </div>
      {(outcome.base_name || outcome.eta_minutes) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[.1em] text-muted-text">
          {outcome.base_name && <span>From · {outcome.base_name}</span>}
          {outcome.eta_minutes != null && (
            <span className="inline-flex items-center gap-1 text-mid-green">
              <Clock className="h-3 w-3" />
              ETA {outcome.eta_minutes.toFixed(0)} min
            </span>
          )}
        </div>
      )}
    </div>
  );
}
