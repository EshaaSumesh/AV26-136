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

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  Clock,
  Crown,
  Eye,
  MapPin,
  Megaphone,
  Radar as RadarIcon,
  Search,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";

import type { AgentEvent } from "@/lib/types";
import type { SocialSignal } from "@/lib/useAuthorityWS";

// ── Agent registry ─────────────────────────────────────────────

type AgentId =
  | "supervisor"
  | "situation_awareness"
  | "social_media_intel"
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
    id: "social_media_intel",
    name: "Social Intel",
    short: "Social",
    role: "Scores public chatter",
    Icon: Sparkles,
    color: "#5eead4",
    matchAgent: (a) => a === "social_media_intel",
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
  byAgent.forEach((list) => {
    if (list.length > 0) {
      lastAnyTs = Math.max(lastAnyTs, new Date(list[0].timestamp).getTime());
    }
  });
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

export default function AgentCrewPanel({
  events,
  socialSignal,
}: {
  events: AgentEvent[];
  socialSignal?: SocialSignal | null;
}) {
  const states = useMemo(() => buildAgentStates(events), [events]);
  const [drawerAgent, setDrawerAgent] = useState<AgentId | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Hand-off detection ─────────────────────────────────────────
  // Each render we compare per-agent statuses with the previous render.
  // When a pipeline agent transitions working → complete AND the next
  // pipeline-stage agent is now `working`, we record a transient
  // "handoff in" flag on the receiving agent. The flag expires on its
  // own ~1500ms later. The visual is a small downward chevron rendered
  // in the row's left gutter so it reads as "the baton just landed
  // here", reinforcing collaboration without crowding the typography.
  const prevStatusRef = useRef<Map<AgentId, Status>>(new Map());
  const [handoffUntil, setHandoffUntil] = useState<Map<AgentId, number>>(
    () => new Map(),
  );

  useEffect(() => {
    const prev = prevStatusRef.current;
    const newHandoffs: Array<[AgentId, number]> = [];
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const prevStatus = prev.get(s.def.id);
      // Only consider pipeline-stage agents.
      if (!s.def.isPipelineStage) {
        prev.set(s.def.id, s.status);
        continue;
      }
      // Find the previous pipeline-stage agent (the one upstream of this).
      const upstream = (() => {
        for (let j = i - 1; j >= 0; j--) {
          if (states[j].def.isPipelineStage) return states[j];
        }
        return null;
      })();
      if (
        upstream &&
        s.status === "working" &&
        prevStatus !== "working" &&
        prev.get(upstream.def.id) === "working" &&
        upstream.status === "complete"
      ) {
        newHandoffs.push([s.def.id, Date.now() + 1500]);
      }
      prev.set(s.def.id, s.status);
    }
    if (newHandoffs.length > 0) {
      setHandoffUntil((m) => {
        const next = new Map(m);
        for (const [id, t] of newHandoffs) next.set(id, t);
        return next;
      });
    }
  }, [states]);

  // Sweep expired handoffs each second so the visual fades cleanly.
  useEffect(() => {
    setHandoffUntil((m) => {
      let dirty = false;
      const next = new Map(m);
      next.forEach((t, id) => {
        if (t < now) {
          next.delete(id);
          dirty = true;
        }
      });
      return dirty ? next : m;
    });
  }, [now]);

  const completed = states.filter(
    (s) => s.def.isPipelineStage && s.status === "complete",
  ).length;
  const totalEvents = events.length;

  const drawerState = drawerAgent
    ? states.find((s) => s.def.id === drawerAgent) ?? null
    : null;

  return (
    <div className="dark-scope flex h-full flex-col overflow-hidden bg-onyx">
      {/* Editorial body — no outer card, just hairlines between blocks */}
      <div className="scroll-thin flex-1 overflow-y-auto px-5 pt-3 pb-6">
        {/* Standalone counts — replaces the wordy masthead, no kicker */}
        <div className="flex items-baseline justify-between border-b border-admin-rule pb-2">
          <span
            className="font-serif text-[11px] tracking-[.16em] text-admin-text"
            style={{ fontVariantCaps: "small-caps" }}
          >
            the rescue crew
          </span>
          <span
            className="font-mono text-[10px] tracking-[.04em] text-admin-muted"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {String(totalEvents).padStart(3, "0")} events ·{" "}
            {String(completed).padStart(2, "0")}/{String(PIPELINE_AGENTS.length).padStart(2, "0")} stages
          </span>
        </div>

        {/* Social legitimacy — one-line summary by default */}
        <SocialLegitimacyRadar signal={socialSignal ?? null} />

        {/* Pipeline — one-line summary by default */}
        <PipelineStepper states={states} />

        {/* Roster — single-column editorial list */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between border-b border-admin-rule pb-1.5">
            <span
              className="font-serif text-[11px] tracking-[.16em] text-admin-text"
              style={{ fontVariantCaps: "small-caps" }}
            >
              the roster
            </span>
            <span
              className="font-mono text-[10px] tracking-[.04em] text-admin-muted"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              07 agents
            </span>
          </div>
          {totalEvents === 0 ? (
            <EmptyState />
          ) : (
            <ul>
              {states.map((s) => (
                <AgentRow
                  key={s.def.id}
                  state={s}
                  now={now}
                  handoffIn={handoffUntil.has(s.def.id)}
                  onClick={() => setDrawerAgent(s.def.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

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
      <div className="font-serif text-[10px] uppercase tracking-[.18em] text-admin-muted">
        Crew Standing By
      </div>
      <div className="mt-2 max-w-[240px] font-serif italic text-[12px] leading-relaxed text-admin-muted">
        Submit a citizen report or launch a demo scenario to see the
        agents coordinate in real time.
      </div>
    </div>
  );
}

// ── Horizontal pipeline stepper ────────────────────────────────
//
// Quiet ops-console stepper. Each stage is one row in a fixed-width
// monospace grid: a glyph (◌ ◐ ● !) + the agent's short name.
// No glow, no gradient, no animated flow. The "running" stage is
// marked by a half-filled glyph and a single accent color.

function PipelineStepper({ states }: { states: AgentState[] }) {
  // Collapsed: a single horizontal glyph row (◌ ◌ ● ● ◐ ◌) plus the count.
  // Expanded: each glyph gets its agent name underneath. Most of the time
  // the at-a-glance row is enough.
  const [expanded, setExpanded] = useState(false);
  const stages = states.filter((s) => s.def.isPipelineStage);
  const completed = stages.filter((s) => s.status === "complete").length;

  const glyphFor = (s: AgentState) => {
    const isWorking = s.status === "working";
    const isComplete = s.status === "complete";
    const isErr = s.status === "error";
    return {
      char: isComplete ? "●" : isErr ? "!" : isWorking ? "◐" : "◌",
      color: isErr
        ? "var(--danger)"
        : isComplete
          ? "var(--safety-org)"
          : isWorking
            ? "var(--safety-org)"
            : "var(--admin-muted)",
      pulsing: isWorking,
    };
  };

  return (
    <div className="border-b border-admin-rule">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-baseline gap-3 py-2.5 text-left"
      >
        <span
          className="font-serif text-[11px] tracking-[.16em] text-admin-text"
          style={{ fontVariantCaps: "small-caps" }}
        >
          pipeline
        </span>
        {/* glyph strip — fixed width, mono, tabular */}
        <span
          className="flex items-center gap-1 self-center font-mono text-[14px] leading-none"
          style={{ letterSpacing: "0.18em" }}
        >
          {stages.map((s) => {
            const g = glyphFor(s);
            return (
              <span
                key={s.def.id}
                className={g.pulsing ? "live-pulse" : ""}
                style={{ color: g.color }}
              >
                {g.char}
              </span>
            );
          })}
        </span>
        <span
          className="ml-auto font-mono text-[10px] tracking-[.04em] text-admin-muted"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {String(completed).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}
        </span>
        <span className="font-mono text-[10px] text-admin-muted" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="grid grid-cols-6 gap-x-2 gap-y-1 pb-3">
          {stages.map((s) => {
            const g = glyphFor(s);
            return (
              <div
                key={s.def.id}
                className="flex flex-col items-center text-center"
              >
                <span
                  className={
                    "font-mono text-[16px] leading-none " +
                    (g.pulsing ? "live-pulse" : "")
                  }
                  style={{ color: g.color }}
                >
                  {g.char}
                </span>
                <span
                  className="mt-1 font-serif text-[10px] italic text-admin-muted"
                  style={{ letterSpacing: 0 }}
                >
                  {s.def.short.toLowerCase()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Hexagon radar — Social-Media Legitimacy ────────────────────

const SOCIAL_AXES: { key: keyof NonNullable<SocialSignal["axis_scores"]>; label: string }[] = [
  { key: "source_credibility", label: "Source" },
  { key: "recency",            label: "Recency" },
  { key: "geo_relevance",      label: "Geo" },
  { key: "corroboration",      label: "Corrob." },
  { key: "media_evidence",     label: "Media" },
  { key: "sentiment_urgency",  label: "Urgency" },
];

/**
 * One-line plain-English verdict for the social-media intel signal.
 * Ties together the discrete signals (sources, recency, evidence,
 * corroboration) into the kind of sentence a duty officer would
 * actually say out loud — "VERIFIED · 3 sources, 2m ago, photo".
 *
 * Intentionally short. The hexagon is for "show your work"; this
 * line is what the audience remembers.
 */
function buildSocialVerdictLine(signal: SocialSignal | null): {
  headline: string;
  detail: string;
} | null {
  if (!signal) return null;

  const v = signal.verdict;
  const score = signal.legitimacy_score;
  if (v == null && typeof score !== "number") return null;

  const ev = signal.evidence_count ?? {};
  const totalSources =
    (ev.reddit ?? 0) +
    (ev.rss ?? 0) +
    (ev.gnews ?? 0) +
    (ev.synthetic_tweets ?? 0);
  const namedSources = [
    (ev.reddit ?? 0) > 0 && "Reddit",
    (ev.rss ?? 0) > 0 && "RSS",
    (ev.gnews ?? 0) > 0 && "news",
    (ev.synthetic_tweets ?? 0) > 0 && "X",
  ].filter(Boolean) as string[];

  // Headline word — replaces the more abstract `verdict` enum.
  let headline = "Inconclusive";
  if (v === "legitimate") headline = "Verified";
  else if (v === "suspicious") headline = "Suspicious";
  else if (v === "likely_false_alarm") headline = "Likely false";
  else if (v === "insufficient_data") headline = "Insufficient data";
  else if (typeof score === "number") {
    if (score >= 70) headline = "Verified";
    else if (score >= 40) headline = "Mixed signal";
    else headline = "Suspicious";
  }

  // Detail — sources + corroboration + media evidence + recency.
  const parts: string[] = [];
  if (totalSources > 0) {
    if (namedSources.length === 1) {
      parts.push(`${totalSources} source on ${namedSources[0]}`);
    } else if (namedSources.length > 1) {
      parts.push(
        `${totalSources} sources across ${namedSources.slice(0, 3).join(", ")}`,
      );
    } else {
      parts.push(`${totalSources} corroborating signals`);
    }
  } else {
    parts.push("no corroborating signals yet");
  }

  // Recency from the recency axis. ≥80 = "moments ago".
  const recency = signal.axis_scores?.recency;
  if (typeof recency === "number") {
    if (recency >= 80) parts.push("posted in the last few minutes");
    else if (recency >= 50) parts.push("posted recently");
    else if (recency > 0) parts.push("older posts");
  }

  // Media evidence axis ≥60 = "photo/video on hand".
  const media = signal.axis_scores?.media_evidence;
  if (typeof media === "number" && media >= 60) {
    parts.push("with photo/video");
  }

  // Geo-relevance — if it's pinned to the incident area, flag it.
  const geo = signal.axis_scores?.geo_relevance;
  if (typeof geo === "number" && geo >= 70) {
    parts.push("on-site");
  }

  return {
    headline,
    detail: parts.join(" · "),
  };
}

function SocialLegitimacyRadar({ signal }: { signal: SocialSignal | null }) {
  // Collapsible by default. The one-line summary covers 95% of the
  // information value; the full hexagon is for the curious. This was a
  // major source of vertical clutter in the previous layout.
  const [expanded, setExpanded] = useState(false);

  // Editorial palette: deep forest green (= --safety-org), warm muted greys
  const COLOR = "#1A5C41"; // editorial green
  const RULE = "#D9D2C3";  // hairline (= --admin-rule)
  const MUTED = "#4A453C"; // ink muted
  const size = 220;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const radius = 78;
  const N = SOCIAL_AXES.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;

  // 0..1 fill per axis
  const axisScore = (key: keyof NonNullable<SocialSignal["axis_scores"]>): number => {
    const v = signal?.axis_scores?.[key];
    if (typeof v !== "number") return 0;
    return Math.max(0, Math.min(100, v)) / 100;
  };
  const fills = SOCIAL_AXES.map(({ key }) => axisScore(key));
  const point = (i: number, r: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  };
  const polyOuter = SOCIAL_AXES.map((_, i) => point(i, radius))
    .map(([x, y]) => `${x},${y}`).join(" ");
  const polyFill = fills
    .map((f, i) => point(i, radius * Math.max(0.04, f)))
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
  const rings = [0.33, 0.66, 1.0].map((scale) =>
    SOCIAL_AXES.map((_, i) => point(i, radius * scale))
      .map(([x, y]) => `${x},${y}`)
      .join(" "),
  );

  const score = signal?.legitimacy_score;
  const verdict = signal?.verdict;
  const hasData = !!signal && (
    typeof score === "number" || (signal.axis_scores && Object.keys(signal.axis_scores).length > 0)
  );

  let centerLabel = "Awaiting social signals";
  let centerColor = MUTED;
  let scoreLabel = "—";
  if (hasData) {
    if (typeof score === "number") {
      scoreLabel = String(Math.round(score));
      centerColor =
        score >= 70 ? COLOR :
        score >= 40 ? "#A8741A" : "#A51C1C";
    }
    if (verdict === "legitimate") centerLabel = "Verdict — legitimate";
    else if (verdict === "suspicious") centerLabel = "Verdict — suspicious";
    else if (verdict === "likely_false_alarm") centerLabel = "Verdict — likely false";
    else if (verdict === "insufficient_data") centerLabel = "Insufficient data";
    else centerLabel = "Social legitimacy";
  }

  const ev = signal?.evidence_count;

  const STROKE = hasData ? COLOR : RULE;
  const FILL = hasData ? "rgba(26, 92, 65, 0.06)" : "transparent";

  // Collapsed: just one editorial line. No card border. Click anywhere
  // on the row to expand into the full hexagon.
  return (
    <div className="border-b border-admin-rule">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-baseline gap-2 py-2.5 text-left"
      >
        <span
          className="font-serif text-[11px] tracking-[.16em] text-admin-text"
          style={{ fontVariantCaps: "small-caps" }}
        >
          social legitimacy
        </span>
        <span className="font-serif italic text-[12px] text-admin-muted">
          —
        </span>
        <span
          className="font-mono text-[13px]"
          style={{
            color: centerColor,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.005em",
          }}
        >
          {scoreLabel}
        </span>
        <span
          className="font-serif italic text-[12px]"
          style={{ color: centerColor }}
        >
          {hasData
            ? centerLabel.replace(/^Verdict\s—\s/, "").toLowerCase()
            : "awaiting signals"}
        </span>
        <span className="ml-auto inline-flex items-baseline gap-2">
          <span
            className="font-mono text-[9px] tracking-[.18em]"
            style={{ color: hasData ? COLOR : MUTED }}
          >
            {hasData ? "live" : "idle"}
          </span>
          <span
            className="font-mono text-[10px] text-admin-muted"
            aria-hidden
          >
            {expanded ? "▾" : "▸"}
          </span>
        </span>
      </button>

      {/* Plain-English verdict line — always visible, even when the
          radar is collapsed. The hexagon shows your work; this line
          is what people remember. */}
      {(() => {
        const verdictLine = buildSocialVerdictLine(signal);
        if (!verdictLine) return null;
        return (
          <div className="-mt-1.5 pb-2">
            <div className="flex items-baseline gap-2 leading-tight">
              <span
                className="font-serif text-[12px] font-semibold tracking-[.02em]"
                style={{ color: centerColor }}
              >
                {verdictLine.headline.toUpperCase()}
              </span>
              <span className="font-serif italic text-[11px] text-admin-muted">
                {verdictLine.detail}
              </span>
            </div>
          </div>
        );
      })()}

      {expanded && (
        <div className="pb-3">

      <div className="flex items-center justify-center">
        <svg width={size} height={size + 14} viewBox={`0 0 ${size} ${size + 14}`}>
          {rings.map((pts, i) => (
            <polygon
              key={i}
              points={pts}
              fill="none"
              stroke={RULE}
              strokeOpacity={i === 2 ? 0.9 : 0.5}
              strokeWidth={1}
              strokeDasharray={i === 2 ? "0" : "2,3"}
            />
          ))}
          {SOCIAL_AXES.map((_, i) => {
            const [x, y] = point(i, radius);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke={RULE}
                strokeOpacity={0.5}
                strokeWidth={1}
              />
            );
          })}
          <polygon
            points={polyFill}
            fill={FILL}
            stroke={STROKE}
            strokeWidth={1.5}
          />
          {SOCIAL_AXES.map((a, i) => {
            const [x, y] = point(i, radius * Math.max(0.05, fills[i]));
            return (
              <rect
                key={a.key}
                x={x - 2}
                y={y - 2}
                width={4}
                height={4}
                fill={STROKE}
              />
            );
          })}
          {SOCIAL_AXES.map((a, i) => {
            const [x, y] = point(i, radius + 14);
            const ang = angle(i);
            let textAnchor: "start" | "middle" | "end" = "middle";
            if (Math.cos(ang) > 0.3) textAnchor = "start";
            else if (Math.cos(ang) < -0.3) textAnchor = "end";
            return (
              <text
                key={a.key}
                x={x}
                y={y}
                textAnchor={textAnchor}
                dominantBaseline="middle"
                fill={MUTED}
                style={{
                  fontFamily: "var(--font-serif), Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 10,
                  letterSpacing: "0.02em",
                }}
              >
                {a.label.toLowerCase()}
              </text>
            );
          })}
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={centerColor}
            style={{
              fontFamily: "var(--font-serif), Georgia, serif",
              fontSize: 28,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
            }}
          >
            {scoreLabel}
          </text>
          <text
            x={cx}
            y={cy + 18}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={MUTED}
            style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: 8,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            score · 0–100
          </text>
        </svg>
      </div>

      <div className="mt-1 border-t border-admin-rule pt-2">
        <div
          className="font-serif italic text-[12px]"
          style={{ color: centerColor }}
        >
          {centerLabel}
        </div>
      </div>

      {ev && (
        <div className="mt-2 grid grid-cols-4 gap-x-2 gap-y-0.5 border-t border-admin-rule pt-2">
          {([
            ["reddit", ev.reddit ?? 0, "Reddit"],
            ["rss", ev.rss ?? 0, "RSS"],
            ["gnews", ev.gnews ?? 0, "GNews"],
            ["synthetic_tweets", ev.synthetic_tweets ?? 0, "Synth-X"],
          ] as const).map(([k, n, lbl]) => (
            <div key={k} className="flex flex-col">
              <span className="font-serif text-[9px] uppercase tracking-[.16em] text-admin-muted">
                {lbl}
              </span>
              <span
                className="font-mono text-[14px]"
                style={{
                  color: n > 0 ? "var(--admin-text)" : "var(--admin-muted)",
                  fontVariantNumeric: "tabular-nums",
                  opacity: n > 0 ? 1 : 0.4,
                }}
              >
                {String(n).padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
      )}
        </div>
      )}
    </div>
  );
}


// ── Live thought ticker ────────────────────────────────────────
//
// A small rolling feed of an agent's last reasoning lines. The newest
// line uses a typewriter "is typing" reveal; older lines stay rendered
// (truncated) and fade as they age. Visually this changes the agent
// roster from a list of static rows into a wall of small live monitors.
//
// We only animate a line on its first appearance — subsequent re-renders
// (from `now` ticking, etc.) show the already-revealed text instantly.
// React's `key` prop on the event id keeps the inner typewriter state
// alive across parent re-renders so the animation doesn't restart.

interface ThoughtTickerProps {
  events: AgentEvent[]; // newest-first list of all this agent's events
  dimmed: boolean;       // true when the agent is "complete" — fade the lines a touch
  fallback: string;      // last-resort line if we have no reasoning events
}

function ThoughtTicker({ events, dimmed, fallback }: ThoughtTickerProps) {
  // Pull the most recent reasoning lines. We exclude tool-calls and
  // mission events — those are surfaced in counters/markers and would
  // crowd the ticker.
  const lines = useMemo(() => {
    const out: { id: string; text: string; ts: number }[] = [];
    for (const e of events) {
      if (e.type !== "agent.reasoning") continue;
      const text = summariseEvent(e).trim();
      if (!text) continue;
      out.push({
        id: e.id,
        text,
        ts: new Date(e.timestamp).getTime(),
      });
      if (out.length >= 3) break;
    }
    return out; // newest-first
  }, [events]);

  if (lines.length === 0) {
    return (
      <div className="mt-0.5 truncate font-serif italic text-[11px] text-admin-muted">
        {fallback}
      </div>
    );
  }

  return (
    <div className="mt-0.5 space-y-0.5 leading-tight">
      {lines.map((ln, idx) => (
        <TickerLine
          key={ln.id}
          text={ln.text}
          // Only the newest line types in. Older lines render instantly
          // — they were already typed in a previous render cycle.
          animate={idx === 0}
          // Older lines fade as they age. Index 0 = full ink, 1 = 70%,
          // 2 = 45%. Combined with `dimmed` (agent finished) we go
          // a notch quieter.
          opacity={(idx === 0 ? 1 : idx === 1 ? 0.7 : 0.45) * (dimmed ? 0.85 : 1)}
        />
      ))}
    </div>
  );
}

// One line in the ticker. Typewriter for "active" lines (newest), instant
// for the rest. We deliberately keep the speed moderate (~22ms/char) so
// the animation reads as "thinking" not "typing".
function TickerLine({
  text,
  animate,
  opacity,
}: {
  text: string;
  animate: boolean;
  opacity: number;
}) {
  const [revealed, setRevealed] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      setRevealed(text.length);
      return;
    }
    setRevealed(0);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= text.length) clearInterval(id);
    }, 22);
    return () => clearInterval(id);
  }, [text, animate]);

  const showCursor = animate && revealed < text.length;

  return (
    <div
      className="truncate font-serif italic text-[11px] text-admin-text"
      style={{ opacity }}
    >
      {text.slice(0, revealed)}
      {showCursor && (
        <span
          className="inline-block w-[1px] live-pulse"
          style={{
            background: "var(--safety-org)",
            height: "0.85em",
            marginLeft: 1,
            verticalAlign: "-0.05em",
          }}
        />
      )}
    </div>
  );
}

// ── Agent row (single-column editorial list) ──────────────────
//
// Each agent is one row: small icon + serif name + italic role / latest
// thought + small mono counters and timestamp on the right. Whole row
// is the click target for the detail drawer. We use a hairline between
// rows instead of a card border, which is much calmer at narrow widths.

function AgentRow({
  state,
  now,
  handoffIn,
  onClick,
}: {
  state: AgentState;
  now: number;
  handoffIn: boolean;
  onClick: () => void;
}) {
  const { def, status } = state;
  const Icon = def.Icon;
  const isWorking = status === "working";
  const isComplete = status === "complete";
  const isQueued = status === "queued";
  const isError = status === "error";

  const stateInk = isError
    ? "var(--danger)"
    : isWorking
      ? "var(--safety-org)"
      : isComplete
        ? "var(--admin-text)"
        : "var(--admin-muted)";

  return (
    <li className="relative">
      {/* Hand-off "baton landing" indicator. When the upstream pipeline
          stage completes and this agent starts working, we render a
          small descending chevron in the left gutter for ~1.5s. The
          chevron is animated downward (slide-in) so the eye sees the
          baton arrive at the receiving agent. We also briefly tint the
          row's left edge in the same warm orange.

          Pure visual: zero impact on layout, click target, or
          accessibility. No motion-prefers-reduced check yet because
          the slide is short and subtle. */}
      {handoffIn && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute left-[-14px] top-1/2 -translate-y-1/2"
            style={{
              animation: "handoff-arrive 600ms ease-out 1",
            }}
          >
            <svg width="10" height="14" viewBox="0 0 10 14">
              <polyline
                points="2,2 5,5 8,2"
                fill="none"
                stroke="var(--safety-org)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="2,7 5,10 8,7"
                fill="none"
                stroke="var(--safety-org)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.5"
              />
            </svg>
          </span>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
            style={{
              background: "var(--safety-org)",
              animation: "handoff-flash 1500ms ease-out 1 forwards",
            }}
          />
        </>
      )}
      <button
        onClick={onClick}
        className="group flex w-full items-baseline gap-3 border-b border-admin-rule py-2.5 text-left transition hover:bg-onyx-2"
        style={{ opacity: isQueued ? 0.65 : 1 }}
      >
        {/* Status dot */}
        <span
          className={
            "mt-1 h-1.5 w-1.5 shrink-0 self-center " + (isWorking ? "live-pulse" : "")
          }
          style={{
            background: isError
              ? "var(--danger)"
              : isWorking
                ? "var(--safety-org)"
                : isComplete
                  ? "var(--safety-org)"
                  : "var(--admin-rule)",
          }}
        />

        {/* Icon (small, ink) */}
        <Icon
          className="h-3 w-3 shrink-0 self-center"
          style={{ color: isQueued ? "var(--admin-muted)" : "var(--admin-text)" }}
        />

        {/* Name + role / latest summary */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="font-serif text-[14px] font-semibold leading-none"
              style={{
                color: isQueued ? "var(--admin-muted)" : "var(--admin-text)",
                letterSpacing: "-0.005em",
              }}
            >
              {def.name}
            </span>
            <span
              className="font-serif italic text-[10px] tracking-[.04em]"
              style={{ color: stateInk }}
            >
              {statusLabel(status).toLowerCase()}
            </span>
          </div>
          {/* Rolling thought ticker. While the agent is queued or has
              never spoken we just show its role tagline. The moment any
              reasoning lands we switch to the rolling 3-line ticker — the
              newest line types in (typewriter), older lines fade and
              shift up. The effect makes the agents feel like they're
              actively thinking instead of just polled.

              We don't show tool-calls in the ticker because they're
              dense ("called search_news with q='...'") and crowd the
              reasoning. Tool counts are surfaced on the right gutter. */}
          {isQueued || (!isWorking && !isComplete && !isError) ? (
            <div className="mt-0.5 truncate font-serif italic text-[11px] text-admin-muted">
              {def.role}
            </div>
          ) : (
            <ThoughtTicker
              events={state.events}
              dimmed={isComplete}
              fallback={state.lastSummary || def.role}
            />
          )}
        </div>

        {/* Right gutter — mono counters + relative time */}
        <div
          className="flex shrink-0 flex-col items-end gap-0.5 self-center font-mono text-[9px] text-admin-muted"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {(state.reasoningCount > 0 || state.toolCallCount > 0) && (
            <span>
              {state.reasoningCount > 0 && (
                <>R{String(state.reasoningCount).padStart(2, "0")} </>
              )}
              {state.toolCallCount > 0 && (
                <>T{String(state.toolCallCount).padStart(2, "0")}</>
              )}
            </span>
          )}
          {!isQueued && (
            <span style={{ opacity: 0.7 }}>
              {formatRelative(now, state.lastEventAt)}
            </span>
          )}
        </div>
      </button>
    </li>
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
  const accent =
    state.status === "error" ? "var(--danger)" : "var(--safety-org)";

  return (
    <div className="absolute inset-0 z-50 flex">
      <button
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-black/30 cursor-default"
      />
      {/* Editorial paper drawer */}
      <aside className="dark-scope flex h-full w-[min(440px,100%)] flex-col overflow-hidden border-l border-admin-rule bg-onyx-2 shadow-[-12px_0_32px_rgba(0,0,0,0.08)]">
        {/* Masthead */}
        <div className="border-b border-admin-text px-5 pb-2 pt-4">
          <div className="flex items-baseline justify-between">
            <div>
              <div
                className="font-serif text-[10px] uppercase tracking-[.18em]"
                style={{ color: accent, fontVariantCaps: "small-caps" }}
              >
                {statusLabel(state.status).toLowerCase()}
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <Icon className="h-4 w-4 text-admin-text" />
                <h2 className="font-serif text-[22px] font-semibold leading-none text-admin-text">
                  {def.name}
                </h2>
                <span className="font-serif italic text-[12px] text-admin-muted">
                  agent
                </span>
              </div>
              <div className="mt-1 font-serif italic text-[12px] text-admin-muted">
                {def.role}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-admin-muted hover:text-admin-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Ledger strip */}
        <div className="flex items-center justify-between border-b border-admin-rule px-5 py-2">
          <span className="inline-flex items-center gap-1.5 font-serif text-[11px] italic text-admin-muted">
            <Brain className="h-3 w-3" />
            <span
              className="font-mono not-italic"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {String(state.reasoningCount).padStart(2, "0")}
            </span>
            thoughts
          </span>
          <span className="inline-flex items-center gap-1.5 font-serif text-[11px] italic text-admin-muted">
            <Wrench className="h-3 w-3" />
            <span
              className="font-mono not-italic"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {String(state.toolCallCount).padStart(2, "0")}
            </span>
            tools
          </span>
          {state.errorCount > 0 && (
            <span className="inline-flex items-center gap-1.5 font-serif text-[11px] italic text-danger">
              <AlertTriangle className="h-3 w-3" />
              <span
                className="font-mono not-italic"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {String(state.errorCount).padStart(2, "0")}
              </span>
              errors
            </span>
          )}
        </div>

        {/* Events column */}
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-3">
          {events.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
              <Clock className="mb-2 h-5 w-5 text-admin-muted" />
              <div className="font-serif text-[11px] uppercase tracking-[.18em] text-admin-muted">
                No activity yet
              </div>
              <div className="mt-2 max-w-[240px] font-serif italic text-[12px] leading-relaxed text-admin-muted">
                {def.name} hasn&apos;t been engaged on a current incident.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((e) => (
                <DrawerCard key={e.id} event={e} accent={accent} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function DrawerCard({
  event,
  accent,
}: {
  event: AgentEvent;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const time = new Date(event.timestamp).toLocaleTimeString("en-IN", {
    hour12: false,
  });
  const expandable = isReasoning(event) || isToolCall(event) || isMission(event);

  let kind = "Event";
  if (isReasoning(event)) kind = "Reasoning";
  else if (isToolCall(event)) kind = "Tool call";
  else if (isMission(event)) kind = "Mission";
  else if (isError(event)) kind = "Error";

  const kindColor = isError(event) ? "var(--danger)" : accent;

  return (
    <article className="border-b border-admin-rule pb-3 last:border-b-0">
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={
          "flex w-full items-start gap-3 text-left " +
          (expandable ? "cursor-pointer" : "cursor-default")
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="font-serif text-[10px] uppercase tracking-[.18em]"
              style={{ color: kindColor, fontVariantCaps: "small-caps" }}
            >
              {kind}
            </span>
            <span className="h-px flex-1 bg-admin-rule" />
            <span
              className="font-mono text-[9px] tracking-[.04em] text-admin-muted"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {time}
            </span>
          </div>
          <p
            className={
              "mt-1.5 font-serif text-[13px] leading-snug break-words " +
              (isError(event) ? "text-danger italic" : "text-admin-text")
            }
            style={{ letterSpacing: "-0.005em" }}
          >
            {summariseEvent(event)}
          </p>
        </div>
        {expandable && (
          <ChevronDown
            className={
              "mt-1 h-3 w-3 shrink-0 text-admin-muted transition " +
              (open ? "rotate-180" : "")
            }
          />
        )}
      </button>

      {open && expandable && (
        <div className="mt-2 space-y-2">
          {isReasoning(event) && (
            <div>
              <div className="font-serif italic text-[10px] text-admin-muted">
                full reasoning
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words font-serif text-[12px] leading-relaxed text-admin-text">
                {String(event.payload?.thought ?? "—")}
              </p>
            </div>
          )}
          {isToolCall(event) && (
            <div>
              <div className="font-serif italic text-[10px] text-admin-muted">
                tool arguments
              </div>
              <pre className="scroll-thin mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words border-l-2 border-admin-rule bg-slate px-2 py-1.5 font-mono text-[10px] text-admin-text">
                {JSON.stringify(event.payload?.args ?? {}, null, 2)}
              </pre>
              {event.payload?.result_summary ? (
                <div className="mt-2">
                  <div className="font-serif italic text-[10px] text-admin-muted">
                    result
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words font-serif text-[12px] leading-relaxed text-admin-text">
                    {String(event.payload.result_summary)}
                  </p>
                </div>
              ) : null}
            </div>
          )}
          {isMission(event) && (
            <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap break-words border-l-2 border-admin-rule bg-slate px-2 py-1.5 font-mono text-[10px] text-admin-text">
              {JSON.stringify(event.payload ?? {}, null, 2)}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}
