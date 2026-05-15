"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Brain,
  Building2,
  Database,
  FileText,
  History,
  Map as MapIcon,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
  Truck,
} from "lucide-react";

import { api } from "@/lib/api";
import type { AgentEvent, HazardZone, Mission } from "@/lib/types";
import { useAuthorityWS } from "@/lib/useAuthorityWS";
import { useReplayState } from "@/lib/useReplayState";
import AgentReasoningPanel from "@/components/AgentReasoningPanel";
import MissionDetailDrawer from "@/components/MissionDetailDrawer";
import DataSourcesFooter from "@/components/DataSourcesFooter";
import AgentCrewPanel from "@/components/AgentCrewPanel";
import MissionsPanel from "@/components/MissionsPanel";
import MetricsPanel from "@/components/MetricsPanel";
import DemoLauncher from "@/components/DemoLauncher";
import CinemaOverlay from "@/components/cinema/CinemaOverlay";
import HazardsView from "@/components/views/HazardsView";
import DataFeedsView from "@/components/views/DataFeedsView";
import RouteHistoryView from "@/components/views/RouteHistoryView";
import ResourcesView from "@/components/views/ResourcesView";
import ReportsView from "@/components/views/ReportsView";
import SettingsView from "@/components/views/SettingsView";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

interface DashboardStats {
  total_events: number;
  missions?: { total?: number; active?: number; en_route?: number };
}

type ViewId =
  | "live_map"
  | "missions"
  | "reasoning"
  | "hazards"
  | "feeds"
  | "history"
  | "resources"
  | "reports"
  | "settings";

interface NavItem {
  id: ViewId;
  label: string;
  icon: typeof MapIcon;
  section: "Operations" | "Intelligence" | "Admin";
}

const NAV: NavItem[] = [
  { id: "live_map", label: "Live Map", icon: MapIcon, section: "Operations" },
  { id: "missions", label: "Missions", icon: Truck, section: "Operations" },
  {
    id: "reasoning",
    label: "Agent Reasoning",
    icon: Brain,
    section: "Operations",
  },
  {
    id: "hazards",
    label: "Hazard Zones",
    icon: ShieldAlert,
    section: "Intelligence",
  },
  { id: "feeds", label: "Data Feeds", icon: Database, section: "Intelligence" },
  {
    id: "history",
    label: "Route History",
    icon: History,
    section: "Intelligence",
  },
  {
    id: "resources",
    label: "Resources",
    icon: Building2,
    section: "Admin",
  },
  { id: "reports", label: "Reports", icon: FileText, section: "Admin" },
  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    section: "Admin",
  },
];

export default function AuthorityPage() {
  const { connected, events: liveEvents, routes: liveRoutes, latestSocial } = useAuthorityWS();
  const replay = useReplayState();
  const [seedEvents, setSeedEvents] = useState<AgentEvent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [hazards, setHazards] = useState<HazardZone[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [view, setView] = useState<ViewId>("live_map");
  const [clock, setClock] = useState<string>("");
  // Mission detail drawer — operator-facing "click any pin, see why".
  const [openMissionId, setOpenMissionId] = useState<string | null>(null);
  const openMission = useMemo(
    () => missions.find((m) => m.mission_id === openMissionId) ?? null,
    [missions, openMissionId],
  );

  async function refresh() {
    try {
      const [dash, hz] = await Promise.all([
        api.dashboard(),
        api.hazardZones(),
      ]);
      setSeedEvents(dash.recent_events ?? []);
      setMissions(dash.active_missions ?? []);
      setStats(dash.stats);
      setHazards(hz.zones ?? []);
    } catch (err) {
      console.error("Refresh failed", err);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-IN", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const allEvents = useMemo(() => {
    const merged = [...liveEvents, ...seedEvents];
    const seen = new Set<string>();
    return merged.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }, [liveEvents, seedEvents]);

  const activeMissions = missions.filter((m) =>
    ["negotiating", "accepted", "en_route", "on_site"].includes(m.status),
  );
  const SEV_RANK: Record<string, number> = {
    low: 1,
    medium: 3,
    high: 4,
    critical: 5,
  };
  const maxSeverity = hazards.reduce(
    (m, h) => Math.max(m, SEV_RANK[h.severity] ?? 0),
    0,
  );
  const severityLabel =
    maxSeverity >= 5
      ? "CRITICAL"
      : maxSeverity >= 4
        ? "HIGH"
        : maxSeverity >= 3
          ? "ELEVATED"
          : maxSeverity >= 1
            ? "LOW"
            : "NORMAL";
  const severityClass =
    maxSeverity >= 4
      ? "text-danger"
      : maxSeverity >= 3
        ? "text-safety-org"
        : maxSeverity >= 1
          ? "text-cleared"
          : "text-admin-text";
  const avgEta = (() => {
    const withEta = activeMissions.filter((m) => m.route_eta_minutes);
    if (!withEta.length) return "—";
    const avg =
      withEta.reduce((a, m) => a + (m.route_eta_minutes ?? 0), 0) /
      withEta.length;
    return `${avg.toFixed(0)}m`;
  })();

  const sections: Array<NavItem["section"]> = [
    "Operations",
    "Intelligence",
    "Admin",
  ];

  const dateLine = useMemo(() => {
    const d = new Date();
    return d
      .toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
      .toUpperCase();
  }, [clock]);

  return (
    <main className="dark-scope flex h-screen flex-col overflow-hidden bg-onyx text-admin-text">
      {/* MASTHEAD — editorial / Monocle */}
      <header className="bg-onyx-2">
        {/* Top sliver: date · live · clock */}
        <div className="flex items-center gap-3 border-b border-admin-rule px-6 py-1">
          <span className="font-mono text-[9px] uppercase tracking-[.18em] text-admin-muted">
            {dateLine}
          </span>
          <span className="ml-auto inline-flex items-center gap-3">
            <span
              className={
                "inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.18em] " +
                (connected ? "text-safety-org" : "text-danger")
              }
            >
              <span
                className={
                  "h-1.5 w-1.5 live-pulse " +
                  (connected ? "bg-safety-org" : "bg-danger")
                }
              />
              {connected ? "LIVE" : "OFFLINE"}
            </span>
            <span
              className="font-mono text-[10px] tracking-[.06em] text-admin-muted"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {clock}
            </span>
          </span>
        </div>

        {/* Masthead row: wordmark + section line + edition */}
        <div className="flex items-end justify-between border-b border-admin-text px-6 pb-2 pt-3">
          <div className="flex items-end gap-4">
            <Link
              href="/"
              className="font-serif text-[28px] font-semibold leading-none tracking-tight text-admin-text hover:text-safety-org"
              style={{ fontFeatureSettings: '"liga","dlig"' }}
            >
              ResQRoute
            </Link>
            <span className="mb-[3px] font-serif italic text-[13px] leading-none text-admin-muted">
              the command centre
            </span>
          </div>
          <div className="flex items-end gap-3">
            <span className="mb-[2px] font-mono text-[9px] uppercase tracking-[.2em] text-admin-muted">
              Vol. I · Bengaluru Edition · No. 01
            </span>
            <button
              onClick={refresh}
              className="inline-flex items-center gap-1 border border-admin-rule px-2 py-1 font-mono text-[9px] uppercase tracking-[.16em] text-admin-muted transition hover:border-admin-text hover:text-admin-text"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
            <Link
              href="/"
              className="inline-flex items-center gap-1 font-serif italic text-[11px] text-admin-muted hover:text-admin-text"
            >
              <ArrowLeft className="h-3 w-3" />
              return home
            </Link>
          </div>
        </div>

        {/* Section line — thin rule with inline tagline */}
        <div className="flex items-center gap-3 px-6 py-1.5">
          <span className="font-serif text-[10px] italic text-admin-muted">
            Real-time multi-agent intelligence for urban rescue operations.
          </span>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-[.16em] text-admin-muted">
            Issued continuously · Sources: TomTom · Open-Meteo · GDACS · GNews · USGS
          </span>
        </div>
      </header>

      {/* BODY */}
      <div className="grid flex-1 overflow-hidden md:grid-cols-[220px_1fr]">
        {/* SIDEBAR — editorial table of contents */}
        <aside className="hidden border-r border-admin-rule bg-onyx py-4 md:flex md:flex-col">
          <div className="px-5 pb-2">
            <div className="font-mono text-[9px] uppercase tracking-[.2em] text-admin-muted">
              Contents
            </div>
            <div className="mt-1 h-px bg-admin-text" />
          </div>
          {sections.map((sec, idx) => (
            <div key={sec} className={idx === 0 ? "" : "mt-3"}>
              <SidebarSection label={sec} index={idx + 1} />
              {NAV.filter((n) => n.section === sec).map((item) => (
                <SidebarItem
                  key={item.id}
                  item={item}
                  active={view === item.id}
                  badge={
                    item.id === "missions" ? activeMissions.length : undefined
                  }
                  alertBadge={
                    item.id === "hazards" && hazards.length > 0
                      ? hazards.length
                      : undefined
                  }
                  onClick={() => setView(item.id)}
                />
              ))}
            </div>
          ))}
          <div className="mt-auto px-5 pt-3">
            <div className="h-px bg-admin-rule" />
            <div className="mt-2 font-serif text-[10px] uppercase tracking-[.18em] text-admin-muted">
              Filed by
            </div>
            <div className="mt-0.5 font-serif italic text-[12px] text-admin-text">
              ndrf.bengaluru
            </div>
          </div>
        </aside>

        {/* CONTENT */}
        <div className="flex flex-col overflow-hidden">
          {/* On the Live Map view we collapse the four stat cards into a
              single editorial standfirst line — the data is already
              echoed in the missions panel and the crew, so this is just
              an at-a-glance summary. Other views keep the full ledger. */}
          {view === "live_map" ? (
            <Standfirst
              activeCount={activeMissions.length}
              totalCount={missions.length}
              severityLabel={severityLabel}
              severityClass={severityClass}
              hazardCount={hazards.length}
              avgEta={avgEta}
              eventCount={stats?.total_events ?? 0}
            />
          ) : (
            <div className="grid grid-cols-2 border-b border-admin-rule bg-onyx-2 md:grid-cols-4">
              <StatCard
                label="Active Missions"
                value={activeMissions.length}
                accent="ink"
                sub={
                  missions.length > activeMissions.length
                    ? `${missions.length} total queued`
                    : "all running"
                }
              />
              <StatCard
                label="Severity"
                value={severityLabel}
                accent="custom"
                valueClass={severityClass}
                sub={
                  hazards.length
                    ? `${hazards.length} active hazard${hazards.length === 1 ? "" : "s"}`
                    : "no active hazards"
                }
              />
              <StatCard
                label="Agents"
                value="6/6"
                accent="green"
                sub="all operational"
              />
              <StatCard
                label="Avg ETA"
                value={avgEta}
                accent="ink"
                sub={
                  stats?.total_events
                    ? `${stats.total_events} events streamed`
                    : "awaiting data"
                }
              />
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {view === "live_map" && (
              <LiveMapView
                hazards={hazards}
                missions={missions}
                selected={selected}
                onSelect={setSelected}
                allEvents={allEvents}
                liveRoutes={liveRoutes}
                socialSignal={latestSocial}
                onMissionClick={setOpenMissionId}
                cinema={!!replay}
                cinemaEvents={liveEvents}
              />
            )}
            {view === "missions" && (
              <MissionsFullView
                missions={missions}
                selected={selected}
                onSelect={setSelected}
                hazards={hazards}
                liveRoutes={liveRoutes}
                onMissionClick={setOpenMissionId}
                cinema={!!replay}
                cinemaEvents={liveEvents}
              />
            )}
            {view === "reasoning" && (
              <ReasoningFullView events={allEvents} />
            )}
            {view === "hazards" && <HazardsView hazards={hazards} />}
            {view === "feeds" && <DataFeedsView />}
            {view === "history" && <RouteHistoryView />}
            {view === "resources" && <ResourcesView />}
            {view === "reports" && <ReportsView />}
            {view === "settings" && <SettingsView />}
          </div>
        </div>
      </div>
      <DataSourcesFooter />
      {openMission && (
        <MissionDetailDrawer
          mission={openMission}
          onClose={() => setOpenMissionId(null)}
        />
      )}
      <CinemaOverlay replay={replay} events={liveEvents} />
    </main>
  );
}

// ── Live map composite (stacked rail — Map + single switching panel) ──
//
// Layout: [Map ~65%] [Rail ~35%]. The rail is a tab strip whose default
// pick auto-shifts based on pipeline state:
//
//   - no events yet                → "drills"   (run a demo)
//   - any agent currently working  → "crew"     (watch them reason)
//   - everything settled           → "missions" (review outcomes)
//
// The user can override at any time; once they click a tab manually we
// stop auto-switching for the rest of the session. This avoids the
// "panel jumped under my mouse" surprise.

type RailTab = "missions" | "crew" | "metrics" | "drills";

function LiveMapView({
  hazards,
  missions,
  selected,
  onSelect,
  allEvents,
  liveRoutes,
  socialSignal,
  onMissionClick,
  cinema,
  cinemaEvents,
}: {
  hazards: HazardZone[];
  missions: Mission[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  allEvents: AgentEvent[];
  liveRoutes: ReturnType<typeof useAuthorityWS>["routes"];
  socialSignal: ReturnType<typeof useAuthorityWS>["latestSocial"];
  onMissionClick?: (missionId: string) => void;
  cinema?: boolean;
  cinemaEvents?: AgentEvent[];
}) {
  const [rail, setRail] = useState<RailTab>("drills");
  const [userOverride, setUserOverride] = useState(false);

  // Auto-pick the most useful panel based on pipeline activity. Only fires
  // until the user clicks a tab themselves.
  const autoTab: RailTab = useMemo(() => {
    if (allEvents.length === 0) return "drills";
    const recent = allEvents.slice(0, 30);
    const RECENT_MS = 45_000;
    const now = Date.now();
    const isWorking = recent.some(
      (e) => now - new Date(e.timestamp).getTime() < RECENT_MS,
    );
    if (isWorking) return "crew";
    if (missions.length > 0) return "missions";
    return "crew";
  }, [allEvents, missions]);

  useEffect(() => {
    if (!userOverride) setRail(autoTab);
  }, [autoTab, userOverride]);

  const onTab = (t: RailTab) => {
    setUserOverride(true);
    setRail(t);
  };

  return (
    <div className="grid h-full overflow-hidden md:grid-cols-[1fr_400px]">
      <div className="relative">
        <MapView
          hazards={hazards}
          missions={missions}
          selectedMission={selected}
          liveRoutes={liveRoutes}
          onMissionClick={onMissionClick}
          cinema={cinema}
          cinemaEvents={cinemaEvents}
        />
        <div className="pointer-events-none absolute left-3 top-3 space-y-2">
          <Legend />
        </div>
        <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-2 border border-admin-rule bg-onyx-2 px-3 py-1 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
          <span className="h-1.5 w-1.5 bg-safety-org live-pulse" />
          <span className="font-serif text-[10px] italic text-admin-muted">
            live operations · Mapbox
          </span>
        </div>
      </div>

      <aside className="flex flex-col overflow-hidden border-l border-admin-rule bg-onyx">
        {/* Rail tab strip — no boxes, just a hairline below */}
        <div className="flex items-stretch border-b border-admin-rule bg-onyx-2">
          <RailTabButton
            active={rail === "missions"}
            onClick={() => onTab("missions")}
            label="Missions"
            count={missions.length}
          />
          <RailTabButton
            active={rail === "crew"}
            onClick={() => onTab("crew")}
            label="Crew"
            count={
              allEvents.length > 99 ? 99 : allEvents.length
            }
          />
          <RailTabButton
            active={rail === "metrics"}
            onClick={() => onTab("metrics")}
            label="Metrics"
          />
          <RailTabButton
            active={rail === "drills"}
            onClick={() => onTab("drills")}
            label="Drills"
          />
        </div>

        {/* Rail body */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {rail === "missions" && (
            <MissionsPanel
              missions={missions}
              selected={selected}
              onSelect={onSelect}
            />
          )}
          {rail === "crew" && (
            <AgentCrewPanel events={allEvents} socialSignal={socialSignal} />
          )}
          {rail === "metrics" && <MetricsPanel />}
          {rail === "drills" && (
            <div className="h-full overflow-y-auto p-4">
              <DemoLauncher />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function RailTabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "group flex flex-1 items-baseline justify-center gap-1.5 border-r border-admin-rule px-2 py-2.5 transition last:border-r-0 " +
        (active
          ? "bg-onyx text-admin-text"
          : "bg-onyx-2 text-admin-muted hover:bg-onyx hover:text-admin-text")
      }
    >
      <span
        className={
          "font-serif text-[13px] " +
          (active ? "italic" : "")
        }
      >
        {label}
      </span>
      {typeof count === "number" && (
        <span
          className="font-mono text-[10px] tracking-[.04em] text-admin-muted"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {String(count).padStart(2, "0")}
        </span>
      )}
    </button>
  );
}

// ── Missions full view (wide list + map) ─────────────────────

function MissionsFullView({
  missions,
  selected,
  onSelect,
  hazards,
  liveRoutes,
  onMissionClick,
  cinema,
  cinemaEvents,
}: {
  missions: Mission[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  hazards: HazardZone[];
  liveRoutes: ReturnType<typeof useAuthorityWS>["routes"];
  onMissionClick?: (missionId: string) => void;
  cinema?: boolean;
  cinemaEvents?: AgentEvent[];
}) {
  return (
    <div className="grid h-full overflow-hidden md:grid-cols-[1fr_460px]">
      <div className="relative">
        <MapView
          hazards={hazards}
          missions={missions}
          selectedMission={selected}
          liveRoutes={liveRoutes}
          onMissionClick={onMissionClick}
          cinema={cinema}
          cinemaEvents={cinemaEvents}
        />
      </div>
      <div className="flex flex-col overflow-hidden border-l border-admin-rule p-3">
        <MissionsPanel
          missions={missions}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

// ── Agent reasoning full view ────────────────────────────────

function ReasoningFullView({ events }: { events: AgentEvent[] }) {
  return (
    <div className="grid h-full overflow-hidden md:grid-cols-[1fr_360px]">
      <div className="overflow-hidden p-3">
        <AgentReasoningPanel events={events} />
      </div>
      <div className="overflow-hidden border-l border-admin-rule p-3">
        <MetricsPanel />
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────

function SidebarSection({ label, index }: { label: string; index: number }) {
  return (
    <div className="mb-1 flex items-baseline gap-2 px-5 pt-2">
      <span
        className="font-mono text-[9px] tracking-[.16em] text-admin-muted"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {String(index).padStart(2, "0")}
      </span>
      <span
        className="font-serif text-[11px] tracking-[.16em] text-admin-text"
        style={{ fontVariantCaps: "small-caps" }}
      >
        {label}
      </span>
      <span className="ml-1 h-px flex-1 bg-admin-rule" />
    </div>
  );
}

function SidebarItem({
  item,
  active,
  badge,
  alertBadge,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  alertBadge?: number;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={
        "group flex w-full items-baseline gap-2 px-5 py-1 text-left text-[13px] transition-colors " +
        (active
          ? "text-admin-text"
          : "text-admin-muted hover:text-admin-text")
      }
    >
      <Icon
        className={
          "h-3 w-3 self-center " +
          (active ? "text-safety-org" : "opacity-60")
        }
      />
      <span
        className={
          "flex-1 font-serif " +
          (active ? "italic" : "")
        }
      >
        {item.label}
      </span>
      {badge ? (
        <span
          className="font-mono text-[10px] text-danger"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {String(badge).padStart(2, "0")}
        </span>
      ) : alertBadge ? (
        <span
          className="font-mono text-[10px] text-safety-org"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {String(alertBadge).padStart(2, "0")}
        </span>
      ) : (
        <span
          className="font-mono text-[10px] text-admin-muted/40"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {active ? "■" : "·"}
        </span>
      )}
    </button>
  );
}

function StatCard({
  label,
  value,
  accent,
  valueClass,
  sub,
}: {
  label: string;
  value: string | number;
  accent: "orange" | "red" | "green" | "white" | "ink" | "custom";
  valueClass?: string;
  sub?: string;
}) {
  const cls =
    accent === "custom"
      ? valueClass ?? "text-admin-text"
      : accent === "orange"
        ? "text-safety-org"
        : accent === "red"
          ? "text-danger"
          : accent === "green"
            ? "text-safety-org"
            : "text-admin-text";
  return (
    <div className="relative border-r border-admin-rule px-6 py-4 last:border-r-0">
      <div className="font-serif text-[10px] uppercase tracking-[.18em] text-admin-muted">
        {label}
      </div>
      <div
        className={`mt-1.5 font-mono text-[32px] leading-none ${cls}`}
        style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 font-serif text-[11px] italic text-admin-muted">
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * Standfirst — replaces the four-card stat row on the Live Map view.
 *
 * Editorial publications use a "standfirst" or "deck" line under the
 * masthead to summarise the situation in one breath. We mirror that:
 * one row, hairline-bordered, mono numerals separated by middle-dots.
 * If something needs urgent attention (severity HIGH+ or hazards present)
 * the relevant token gets the danger / accent colour, rest stays muted.
 */
function Standfirst({
  activeCount,
  totalCount,
  severityLabel,
  severityClass,
  hazardCount,
  avgEta,
  eventCount,
}: {
  activeCount: number;
  totalCount: number;
  severityLabel: string;
  severityClass: string;
  hazardCount: number;
  avgEta: string;
  eventCount: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-admin-rule bg-onyx-2 px-6 py-2.5">
      <span className="font-serif italic text-[11px] text-admin-muted">
        At a glance —
      </span>
      <Metric label="active" value={String(activeCount).padStart(2, "0")} />
      {totalCount > activeCount && (
        <Metric
          label="queued"
          value={String(totalCount - activeCount).padStart(2, "0")}
          muted
        />
      )}
      <Metric
        label="severity"
        valueClass={severityClass}
        valueRaw
        value={severityLabel}
      />
      <Metric
        label="hazards"
        value={String(hazardCount).padStart(2, "0")}
        muted={hazardCount === 0}
      />
      <Metric label="agents" value="6/6" muted />
      <Metric label="ETA" value={avgEta} />
      <span className="ml-auto font-serif italic text-[11px] text-admin-muted">
        <span
          className="font-mono not-italic"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {String(eventCount).padStart(3, "0")}
        </span>{" "}
        events streamed
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass,
  valueRaw,
  muted,
}: {
  label: string;
  value: string;
  valueClass?: string;
  /** If true, render the value in serif (for non-numeric labels like severity). */
  valueRaw?: boolean;
  muted?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-serif text-[10px] uppercase tracking-[.18em] text-admin-muted">
        {label}
      </span>
      <span
        className={
          (valueRaw ? "font-serif text-[13px] italic " : "font-mono text-[13px] ") +
          (valueClass ?? (muted ? "text-admin-muted" : "text-admin-text"))
        }
        style={
          valueRaw
            ? undefined
            : {
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.005em",
              }
        }
      >
        {value}
      </span>
    </span>
  );
}

function Legend() {
  return (
    <div className="border border-admin-rule bg-onyx-2 px-3 py-2 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
      <div className="mb-1.5 font-serif text-[10px] uppercase tracking-[.18em] text-admin-muted">
        Map · Legend
      </div>
      <div className="space-y-0.5 font-serif text-[11px] text-admin-text">
        <Row color="#ef4444" label="Critical hazard" />
        <Row color="#f87171" label="High hazard" />
        <Row color="#fb923c" label="Medium hazard" />
        <Row color="#facc15" label="Low hazard" />
        <Row color="#1A5C41" label="Active route" />
        <Row color="#2E8B63" label="Selected route" />
      </div>
    </div>
  );
}

function Row({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2"
        style={{ background: color }}
      />
      {label}
    </div>
  );
}
