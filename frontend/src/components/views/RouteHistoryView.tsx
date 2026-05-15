"use client";

import { useEffect, useState } from "react";
import { Clock, MapPin, Truck } from "lucide-react";

import { api } from "@/lib/api";
import type { Mission } from "@/lib/types";
import { ViewShell, EmptyState } from "./ViewShell";

const STATUS_COLOR: Record<string, string> = {
  completed: "#34d399",
  cancelled: "#fb7185",
  declined: "#fb7185",
  on_site: "#facc15",
  en_route: "#6BBD95",
  accepted: "#6BBD95",
  negotiating: "#facc15",
};

export default function RouteHistoryView() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await api.allMissions();
      setMissions(r.missions ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const sorted = [...missions].sort(
    (a, b) =>
      new Date(b.updated_at ?? b.created_at).getTime() -
      new Date(a.updated_at ?? a.created_at).getTime(),
  );

  const finished = sorted.filter((m) =>
    ["completed", "cancelled", "declined"].includes(m.status),
  );

  return (
    <ViewShell
      kicker="INTELLIGENCE"
      title="Route History"
      actions={
        <span className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
          {sorted.length} total · {finished.length} closed
        </span>
      }
    >
      {loading ? (
        <EmptyState title="Loading missions…" />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No mission history yet"
          hint="Missions appear here as soon as the dispatch agent commits to a base."
        />
      ) : (
        <ul>
          {sorted.map((m) => {
            const color = STATUS_COLOR[m.status] ?? "#94a3b8";
            return (
              <li
                key={m.mission_id}
                className="border-b border-admin-rule/60 px-5 py-3 transition hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full"
                    style={{
                      background: `${color}1f`,
                      border: `1px solid ${color}66`,
                      color,
                    }}
                  >
                    <Truck className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-admin-text">
                        {m.disaster_type && m.disaster_type.length > 0
                          ? m.disaster_type[0].toUpperCase() +
                            m.disaster_type.slice(1)
                          : "Incident"}
                      </span>
                      <span className="text-admin-muted">·</span>
                      <span className="text-[12px] text-admin-muted">
                        {m.assigned_base_name ?? "Unassigned"}
                      </span>
                      <span
                        className="ml-auto rounded-sharp border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[.12em]"
                        style={{
                          color,
                          borderColor: `${color}66`,
                          background: `${color}1a`,
                        }}
                      >
                        {m.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[.08em] text-steel-light">
                      <span>{m.mission_id.slice(-10)}</span>
                      <span className={`severity-${m.severity}`}>
                        SEV {m.severity}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {m.incident_coordinates[0].toFixed(3)},{" "}
                        {m.incident_coordinates[1].toFixed(3)}
                      </span>
                      {m.route_distance_km != null && (
                        <span>{m.route_distance_km.toFixed(1)} km</span>
                      )}
                      {m.route_eta_minutes != null && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          ETA {m.route_eta_minutes.toFixed(0)}m
                        </span>
                      )}
                      <span>
                        {new Date(
                          m.updated_at ?? m.created_at,
                        ).toLocaleString("en-IN", { hour12: false })}
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ViewShell>
  );
}
