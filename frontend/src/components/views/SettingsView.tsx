"use client";

import { useEffect, useState } from "react";

import { api, API_BASE, WS_BASE } from "@/lib/api";
import { ViewShell } from "./ViewShell";

interface SettingsState {
  refreshSec: number;
  autoExpandActive: boolean;
  showRawDefault: boolean;
}

const DEFAULTS: SettingsState = {
  refreshSec: 5,
  autoExpandActive: true,
  showRawDefault: false,
};

const STORAGE_KEY = "resqroute.authority.settings";

function loadSettings(): SettingsState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SettingsState>) };
  } catch {
    return DEFAULTS;
  }
}

export default function SettingsView() {
  const [s, setS] = useState<SettingsState>(DEFAULTS);
  const [health, setHealth] = useState<
    { status: string; city: string; agents: string[] } | null
  >(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);

  useEffect(() => {
    setS(loadSettings());
    api
      .health()
      .then(setHealth)
      .catch((e) => setHealthErr(String(e)));
  }, []);

  function update<K extends keyof SettingsState>(k: K, v: SettingsState[K]) {
    setS((prev) => {
      const next = { ...prev, [k]: v };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <ViewShell kicker="ADMIN" title="Settings">
      <div className="space-y-6 p-5">
        <Section title="Display preferences">
          <Row
            label="Dashboard refresh interval"
            sub="How often to re-poll missions, hazards, and stats."
          >
            <select
              value={s.refreshSec}
              onChange={(e) => update("refreshSec", Number(e.target.value))}
              className="border border-admin-rule bg-onyx px-2 py-1 font-mono text-[11px] text-admin-text"
            >
              {[3, 5, 10, 15, 30].map((n) => (
                <option key={n} value={n}>
                  {n}s
                </option>
              ))}
            </select>
          </Row>
          <Row
            label="Auto-expand active stage"
            sub="Open the agent reasoning card whose stage is currently active."
          >
            <Toggle
              on={s.autoExpandActive}
              onClick={() => update("autoExpandActive", !s.autoExpandActive)}
            />
          </Row>
          <Row
            label="Default to Raw timeline"
            sub="Open Agent Reasoning in chronological log mode instead of the staged view."
          >
            <Toggle
              on={s.showRawDefault}
              onClick={() => update("showRawDefault", !s.showRawDefault)}
            />
          </Row>
          <p className="font-mono text-[9px] uppercase tracking-[.12em] text-steel-light/70">
            Saved locally in this browser. They take effect on next reload.
          </p>
        </Section>

        <Section title="System status">
          {healthErr ? (
            <div className="border border-danger/40 bg-danger/10 p-3 font-mono text-[11px] text-danger">
              Backend unreachable · {healthErr}
            </div>
          ) : !health ? (
            <div className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
              Querying…
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <KV label="Status" value={health.status} accent="#34d399" />
              <KV label="City" value={health.city} />
              <KV
                label="Agents registered"
                value={String(health.agents.length)}
              />
              <KV label="API" value={API_BASE} mono />
              <KV label="WebSocket" value={WS_BASE} mono />
            </div>
          )}
        </Section>

        <Section title="About">
          <p className="max-w-[640px] text-[12px] leading-relaxed text-admin-muted">
            ResQRoute is a multi-agent rescue routing platform. Six LLM-powered
            agents collaborate over LangGraph using live data from TomTom,
            Open-Meteo, GDACS, USGS, and GNews to dispatch teams along
            hazard-aware routes.
          </p>
        </Section>
      </div>
    </ViewShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[9px] uppercase tracking-[.18em] text-safety-org">
        {title}
      </div>
      <div className="border border-admin-rule bg-onyx-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-admin-rule/60 px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-admin-text">{label}</div>
        {sub && (
          <div className="mt-0.5 text-[11px] text-steel-light">{sub}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "h-5 w-9 rounded-full border transition " +
        (on
          ? "border-safety-org/60 bg-safety-org/30"
          : "border-admin-rule bg-onyx")
      }
    >
      <span
        className={
          "block h-4 w-4 rounded-full transition " +
          (on
            ? "translate-x-4 bg-safety-org"
            : "translate-x-0.5 bg-steel-light")
        }
      />
    </button>
  );
}

function KV({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent?: string;
  mono?: boolean;
}) {
  return (
    <div className="border border-admin-rule/60 bg-onyx px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[.14em] text-steel-light">
        {label}
      </div>
      <div
        className={
          "mt-0.5 truncate " +
          (mono ? "font-mono text-[11px]" : "text-[13px]") +
          " text-admin-text"
        }
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
