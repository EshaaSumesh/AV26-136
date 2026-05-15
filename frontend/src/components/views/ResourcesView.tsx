"use client";

import { useEffect, useState } from "react";
import { Building2, Users } from "lucide-react";

import { api } from "@/lib/api";
import type { ResourcesPayload } from "@/lib/types";
import { ViewShell, EmptyState } from "./ViewShell";

const TYPE_COLOR: Record<string, string> = {
  ndrf: "#60a5fa",
  fire: "#f87171",
  police: "#a78bfa",
  sdrf: "#34d399",
  medical: "#f472b6",
};

export default function ResourcesView() {
  const [data, setData] = useState<ResourcesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .resources()
      .then((d) => !cancelled && setData(d))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ViewShell
      kicker="Admin · Roster"
      title="Rescue Resources"
      actions={
        data && (
          <span className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
            {data.base_count} bases · {data.total_teams_available} teams
          </span>
        )
      }
    >
      {loading ? (
        <EmptyState title="Loading resources…" />
      ) : !data ? (
        <EmptyState title="No resources configured" />
      ) : (
        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <SummaryCard
              label="Bases"
              value={data.base_count}
              accent="#6BBD95"
            />
            <SummaryCard
              label="Teams Available"
              value={data.total_teams_available}
              accent="#2E8B63"
            />
            {Object.entries(data.by_type)
              .slice(0, 2)
              .map(([t, n]) => (
                <SummaryCard
                  key={t}
                  label={t}
                  value={n}
                  accent={TYPE_COLOR[t] ?? "#94a3b8"}
                />
              ))}
          </div>

          <div className="space-y-2">
            {data.bases.map((b) => {
              const color = TYPE_COLOR[b.type] ?? "#94a3b8";
              return (
                <div
                  key={b.id}
                  className="flex items-start gap-3 border border-admin-rule bg-onyx-2 px-4 py-3 transition hover:border-safety-org/30"
                >
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center border border-admin-rule"
                    style={{
                      background: `${color}1f`,
                      border: `1px solid ${color}66`,
                      color,
                    }}
                  >
                    <Building2 className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-[15px] text-admin-text">
                        {b.name}
                      </span>
                      <span
                        className="rounded-sharp border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[.12em]"
                        style={{
                          color,
                          borderColor: `${color}66`,
                          background: `${color}1a`,
                        }}
                      >
                        {b.type}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[.08em] text-steel-light">
                      <span>{b.id}</span>
                      <span>
                        {b.coordinates[0].toFixed(4)},{" "}
                        {b.coordinates[1].toFixed(4)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-cleared">
                        <Users className="h-3 w-3" />
                        {b.teams_available} teams
                      </span>
                    </div>
                    {b.specialization.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {b.specialization.map((s) => (
                          <span
                            key={s}
                            className="rounded-sharp border border-admin-rule bg-onyx px-1 py-px font-mono text-[8px] tracking-[.08em] text-steel-light"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ViewShell>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="border border-admin-rule bg-onyx-2 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[.14em] text-steel-light">
        {label}
      </div>
      <div
        className="mt-1 font-serif text-[24px] leading-none"
        style={{ color: accent }}
      >
        {value}
      </div>
    </div>
  );
}
