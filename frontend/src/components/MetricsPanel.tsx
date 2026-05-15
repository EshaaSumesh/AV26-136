"use client";

import { useEffect, useState } from "react";
import { Activity, AlertOctagon, BarChart3, Cpu, Zap } from "lucide-react";
import { api } from "@/lib/api";
import type { MetricsOverview } from "@/lib/metrics-types";
import { agentColor } from "@/lib/types";
import CollaborationGraph from "./CollaborationGraph";

export default function MetricsPanel() {
  const [data, setData] = useState<MetricsOverview | null>(null);

  async function refresh() {
    try {
      const d = await api.metricsOverview();
      setData(d as MetricsOverview);
    } catch (err) {
      console.error("Metrics refresh failed", err);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  const agents = data?.agents ?? {};
  const tools = data?.tools ?? {};
  const summary = data?.summary;

  const agentEntries = Object.entries(agents).sort(
    (a, b) => b[1].avg_ms - a[1].avg_ms,
  );
  const toolEntries = Object.entries(tools).sort(
    (a, b) => b[1].count - a[1].count,
  );

  return (
    <div className="dark-scope flex h-full flex-col overflow-hidden border border-admin-rule bg-onyx">
      <div className="flex items-center justify-between border-b border-admin-rule bg-onyx-2 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-safety-org" />
          <h3 className="font-mono text-[10px] uppercase tracking-[.14em] text-safety-org">
            Observability
          </h3>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
          Refresh 4s
        </span>
      </div>

      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-3">
        {/* Top stats — three values, serif numbers */}
        <div className="grid grid-cols-3 gap-2">
          <StatBox
            icon={<Cpu className="h-3 w-3" />}
            label="Agent calls"
            value={summary?.total_agent_invocations ?? 0}
            tone="orange"
          />
          <StatBox
            icon={<Zap className="h-3 w-3" />}
            label="Tool calls"
            value={summary?.total_tool_invocations ?? 0}
            tone="green"
          />
          <StatBox
            icon={<AlertOctagon className="h-3 w-3" />}
            label="Failures"
            value={summary?.total_failures ?? 0}
            tone={summary?.total_failures ? "red" : "muted"}
          />
        </div>

        {/* Collab graph */}
        <Section title="Agent Collaboration">
          <CollaborationGraph
            nodes={data?.collaboration?.nodes ?? []}
            edges={data?.collaboration?.edges ?? []}
          />
        </Section>

        {/* Agent latency bars */}
        <Section title="Agent Latency">
          {agentEntries.length === 0 ? (
            <Empty>No agent activity yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {agentEntries.map(([name, s]) => (
                <li key={name} className="space-y-1">
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[.08em]">
                    <span style={{ color: agentColor(name) }}>{name}</span>
                    <span className="text-admin-muted">
                      {s.avg_ms.toFixed(0)}ms · n={s.count}
                    </span>
                  </div>
                  <Bar
                    value={s.avg_ms}
                    max={Math.max(s.avg_ms, 1000)}
                    color={agentColor(name)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Tool usage horizontal bars */}
        <Section title="Tool Usage" icon={<Activity className="h-3 w-3" />}>
          {toolEntries.length === 0 ? (
            <Empty>No tool calls yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {toolEntries.slice(0, 8).map(([name, s]) => {
                const max = toolEntries[0][1].count;
                const pct = (s.count / max) * 100;
                return (
                  <li
                    key={name}
                    className="flex items-center gap-2 font-mono text-[10px]"
                  >
                    <span className="w-32 shrink-0 truncate text-admin-text">
                      {name}
                    </span>
                    <div className="relative h-1.5 flex-1 overflow-hidden bg-slate">
                      <div
                        className="absolute inset-y-0 left-0 bg-safety-org/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-admin-muted">
                      ×{s.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-admin-rule bg-onyx-2">
      <header className="flex items-center gap-1.5 border-b border-admin-rule/60 bg-onyx-2 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.14em] text-steel-light">
        {icon}
        {title}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-2 font-mono text-[10px] uppercase tracking-[.1em] text-steel-light">
      {children}
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "orange" | "green" | "red" | "muted";
}) {
  const colorMap = {
    orange: "text-safety-org",
    green: "text-cleared",
    red: "text-danger",
    muted: "text-admin-muted",
  };
  return (
    <div className="border border-admin-rule bg-onyx-2 px-3 py-2.5">
      <div
        className={
          "inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[.12em] " +
          colorMap[tone]
        }
      >
        {icon}
        {label}
      </div>
      <div className="mt-1 font-serif text-[22px] font-normal leading-none text-admin-text">
        {value}
      </div>
    </div>
  );
}

function Bar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-1 w-full overflow-hidden bg-slate">
      <div
        className="h-full"
        style={{ width: `${pct}%`, background: color, opacity: 0.85 }}
      />
    </div>
  );
}
