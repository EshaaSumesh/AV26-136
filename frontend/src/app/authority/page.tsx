"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
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
import AgentReasoningPanel from "@/components/AgentReasoningPanel";
import AgentCrewPanel from "@/components/AgentCrewPanel";
import MissionsPanel from "@/components/MissionsPanel";
import MetricsPanel from "@/components/MetricsPanel";
import DemoLauncher from "@/components/DemoLauncher";
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
  const { connected, events: liveEvents } = useAuthorityWS();
  const [seedEvents, setSeedEvents] = useState<AgentEvent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [hazards, setHazards] = useState<HazardZone[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [view, setView] = useState<ViewId>("live_map");
  const [rightTab, setRightTab] = useState<"reasoning" | "metrics">(
    "reasoning",
  );
  const [clock, setClock] = useState<string>("");

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

  return (
    <main className="dark-scope flex h-screen flex-col overflow-hidden bg-onyx text-admin-text">
      {/* TOPBAR */}
      <header className="flex items-center gap-4 border-b border-admin-rule bg-onyx-2 px-5 py-2.5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-1 py-1 font-mono text-[11px] uppercase tracking-[.1em] text-steel-light transition hover:text-admin-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Home
        </Link>
        <span className="h-3.5 w-px bg-admin-rule" />
        <span className="font-serif text-[15px] font-semibold tracking-tight text-safety-org">
          ResQRoute
        </span>
        <span className="h-3.5 w-px bg-admin-rule" />
        <span className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
          Command Centre · Bengaluru District
        </span>

        <div className="ml-auto flex items-center gap-4">
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1 rounded-sharp px-2 py-1 font-mono text-[10px] uppercase tracking-[.12em] text-steel-light transition hover:bg-white/5 hover:text-admin-text"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
          <span
            className={
              "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.12em] " +
              (connected ? "text-safety-org" : "text-danger")
            }
          >
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (connected ? "bg-safety-org live-pulse-orange" : "bg-danger")
              }
            />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <span className="font-mono text-[11px] tracking-[.04em] text-steel-light">
            {clock}
          </span>
        </div>
      </header>

      {/* BODY */}
      <div className="grid flex-1 overflow-hidden md:grid-cols-[200px_1fr]">
        {/* SIDEBAR */}
        <aside className="hidden border-r border-admin-rule bg-[#141a21] py-4 md:flex md:flex-col">
          {sections.map((sec) => (
            <div key={sec}>
              <SidebarSection label={sec} />
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
          <div className="mt-auto border-t border-admin-rule px-4 pt-3">
            <div className="font-mono text-[9px] uppercase tracking-[.14em] text-steel-light">
              Operator
            </div>
            <div className="mt-1 truncate text-[11px] text-admin-text">
              ndrf.bengaluru
            </div>
          </div>
        </aside>

        {/* CONTENT */}
        <div className="flex flex-col overflow-hidden">
          {/* Stat row — always visible */}
          <div className="grid grid-cols-2 gap-2 border-b border-admin-rule bg-onyx p-3 md:grid-cols-4">
            <StatCard
              label="Active Missions"
              value={activeMissions.length}
              accent="orange"
              sub={
                missions.length > activeMissions.length
                  ? `${missions.length} total queued`
                  : "All running"
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
                  : "No active hazards"
              }
            />
            <StatCard
              label="Agents"
              value="6/6"
              accent="green"
              sub="All operational"
            />
            <StatCard
              label="Avg ETA"
              value={avgEta}
              accent="white"
              sub={
                stats?.total_events
                  ? `${stats.total_events} events streamed`
                  : "Awaiting data"
              }
            />
          </div>

          <div className="flex-1 overflow-hidden">
            {view === "live_map" && (
              <LiveMapView
                hazards={hazards}
                missions={missions}
                selected={selected}
                onSelect={setSelected}
                allEvents={allEvents}
                rightTab={rightTab}
                onRightTabChange={setRightTab}
              />
            )}
            {view === "missions" && (
              <MissionsFullView
                missions={missions}
                selected={selected}
                onSelect={setSelected}
                hazards={hazards}
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
    </main>
  );
}

// ── Live map composite (the original triple-pane) ─────────────

function LiveMapView({
  hazards,
  missions,
  selected,
  onSelect,
  allEvents,
  rightTab,
  onRightTabChange,
}: {
  hazards: HazardZone[];
  missions: Mission[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  allEvents: AgentEvent[];
  rightTab: "reasoning" | "metrics";
  onRightTabChange: (t: "reasoning" | "metrics") => void;
}) {
  return (
    <div className="grid h-full overflow-hidden md:grid-cols-[1fr_360px_360px]">
      <div className="relative">
        <MapView
          hazards={hazards}
          missions={missions}
          selectedMission={selected}
        />
        <div className="pointer-events-none absolute left-3 top-3 space-y-2">
          <Legend />
        </div>
        <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 border border-admin-rule bg-onyx/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[.1em] text-steel-light backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-safety-org live-pulse-orange" />
          Mapbox · Live Operations
        </div>
      </div>

      <div className="flex flex-col gap-3 overflow-hidden border-l border-admin-rule p-3">
        <DemoLauncher />
        <div className="min-h-0 flex-1">
          <MissionsPanel
            missions={missions}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
      </div>

      <div className="flex flex-col overflow-hidden border-l border-admin-rule p-3">
        <div className="mb-2 flex border border-admin-rule bg-slate">
          <TabButton
            active={rightTab === "reasoning"}
            onClick={() => onRightTabChange("reasoning")}
            icon={<Brain className="h-3 w-3" />}
            label="Crew"
          />
          <TabButton
            active={rightTab === "metrics"}
            onClick={() => onRightTabChange("metrics")}
            icon={<BarChart3 className="h-3 w-3" />}
            label="Metrics"
          />
        </div>
        <div className="relative min-h-0 flex-1">
          {rightTab === "reasoning" ? (
            <AgentCrewPanel events={allEvents} />
          ) : (
            <MetricsPanel />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Missions full view (wide list + map) ─────────────────────

function MissionsFullView({
  missions,
  selected,
  onSelect,
  hazards,
}: {
  missions: Mission[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  hazards: HazardZone[];
}) {
  return (
    <div className="grid h-full overflow-hidden md:grid-cols-[1fr_460px]">
      <div className="relative">
        <MapView
          hazards={hazards}
          missions={missions}
          selectedMission={selected}
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

function SidebarSection({ label }: { label: string }) {
  return (
    <div className="mb-1 px-4 pt-3 font-mono text-[9px] uppercase tracking-[.14em] text-steel-light">
      {label}
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
        "flex w-full items-center gap-2.5 border-l-2 px-4 py-2 text-left text-[12px] tracking-wide transition " +
        (active
          ? "border-safety-org bg-safety-org/15 font-medium text-safety-org"
          : "border-transparent text-steel-light hover:bg-white/[0.03] hover:text-admin-text")
      }
    >
      <Icon className="h-3 w-3" />
      <span className="flex-1">{item.label}</span>
      {badge ? (
        <span className="rounded-full bg-danger px-1.5 py-px font-mono text-[9px] text-white">
          {badge}
        </span>
      ) : alertBadge ? (
        <span className="rounded-full bg-safety-org px-1.5 py-px font-mono text-[9px] text-onyx">
          {alertBadge}
        </span>
      ) : null}
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
  accent: "orange" | "red" | "green" | "white" | "custom";
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
            ? "text-cleared"
            : "text-admin-text";
  return (
    <div className="border border-admin-rule bg-onyx-2 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[.14em] text-steel-light">
        {label}
      </div>
      <div
        className={`mt-1.5 font-serif text-[26px] font-normal leading-none ${cls}`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 truncate text-[10px] text-steel-light">{sub}</div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 font-mono text-[10px] uppercase tracking-[.12em] transition " +
        (active
          ? "bg-safety-org/15 text-safety-org"
          : "text-steel-light hover:bg-white/5 hover:text-admin-text")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function Legend() {
  return (
    <div className="dark-scope border border-admin-rule bg-onyx-2/85 px-2.5 py-2 backdrop-blur">
      <div className="mb-1.5 font-mono text-[9px] font-medium uppercase tracking-[.14em] text-steel-light">
        Map Legend
      </div>
      <div className="space-y-1 text-[10px] text-admin-muted">
        <Row color="#ef4444" label="Critical hazard" />
        <Row color="#f87171" label="High hazard" />
        <Row color="#fb923c" label="Medium hazard" />
        <Row color="#facc15" label="Low hazard" />
        <Row color="#34d399" label="Selected route" />
        <Row color="#60a5fa" label="Active route" />
      </div>
    </div>
  );
}

function Row({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </div>
  );
}
