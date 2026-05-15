"use client";

import { useEffect, useState } from "react";
import { Activity, Database, Globe, Key, ShieldCheck } from "lucide-react";

import { api } from "@/lib/api";
import type { DataFeed, VertexRegionsPayload } from "@/lib/types";
import { ViewShell, EmptyState } from "./ViewShell";

const KIND_ICON: Record<string, typeof Database> = {
  routing: Globe,
  weather: Activity,
  disaster_alerts: Activity,
  seismic: Activity,
  news: Database,
  geocoding: Globe,
  llm: ShieldCheck,
};

export default function DataFeedsView() {
  const [feeds, setFeeds] = useState<DataFeed[] | null>(null);
  const [vertex, setVertex] = useState<VertexRegionsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [f, v] = await Promise.all([
          api.dataFeeds(),
          api.vertexRegions().catch(() => null),
        ]);
        if (cancelled) return;
        setFeeds(f.feeds);
        setVertex(v);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <ViewShell
      kicker="INTELLIGENCE"
      title="Data Feeds"
      actions={
        <span className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
          {feeds?.length ?? 0} sources
        </span>
      }
    >
      {loading ? (
        <EmptyState title="Loading feeds…" />
      ) : !feeds ? (
        <EmptyState title="Feeds unavailable" hint="Backend not reachable." />
      ) : (
        <div className="space-y-3 p-4">
          {vertex && (
            <div className="border border-admin-rule bg-onyx-2 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[.14em] text-safety-org">
                    LLM Region Pool
                  </div>
                  <div className="mt-1 font-serif text-[16px] text-admin-text">
                    {vertex.model}
                  </div>
                  <div className="mt-0.5 text-[11px] text-steel-light">
                    Project · {vertex.project}
                  </div>
                </div>
                <span className="font-serif text-[28px] text-safety-org">
                  {vertex.region_count}×
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {vertex.regions.map((r) => (
                  <span
                    key={r}
                    className="rounded-sharp border border-admin-rule bg-onyx px-1.5 py-0.5 font-mono text-[9px] tracking-[.06em] text-steel-light"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {feeds.map((f) => {
              const Icon = KIND_ICON[f.kind] ?? Database;
              return (
                <div
                  key={f.id}
                  className="border border-admin-rule bg-onyx-2 px-4 py-3 transition hover:border-safety-org/30"
                >
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-admin-rule bg-onyx text-safety-org">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-[14px] text-admin-text">
                          {f.name}
                        </span>
                        <span
                          className={
                            "inline-flex items-center gap-1 rounded-sharp px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[.12em] " +
                            (f.configured
                              ? "border border-cleared/40 bg-cleared/15 text-cleared"
                              : "border border-danger/40 bg-danger/15 text-danger")
                          }
                        >
                          <span
                            className={
                              "h-1.5 w-1.5 rounded-full " +
                              (f.configured
                                ? "bg-cleared live-pulse"
                                : "bg-danger")
                            }
                          />
                          {f.configured ? "online" : "missing"}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
                        {f.kind}
                        <span className="ml-2 inline-flex items-center gap-1">
                          <Key className="h-2.5 w-2.5" />
                          {f.auth}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-admin-muted">
                        {f.purpose}
                      </p>
                      {f.used_by.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {f.used_by.map((u) => (
                            <span
                              key={u}
                              className="rounded-sharp border border-admin-rule bg-onyx px-1 py-px font-mono text-[8px] tracking-[.08em] text-steel-light"
                            >
                              {u}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
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
