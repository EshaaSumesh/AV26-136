"use client";

import { useEffect, useState } from "react";
import { Camera, MapPin, Siren, User2 } from "lucide-react";

import { api } from "@/lib/api";
import type { CitizenListPayload, CitizenSummary } from "@/lib/types";
import { ViewShell, EmptyState } from "./ViewShell";

export default function ReportsView() {
  const [data, setData] = useState<CitizenListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  async function load() {
    try {
      const d = await api.citizenList(8);
      setData(d);
      if (!active && d.citizens.length > 0) {
        setActive(d.citizens[0].citizen_id);
      }
    } catch (e) {
      console.error("citizens load failed", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = data?.citizens.find((c) => c.citizen_id === active);

  return (
    <ViewShell
      kicker="ADMIN"
      title="Citizen Reports"
      actions={
        data && (
          <span className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
            {data.citizen_count} citizens · {data.total_reports} reports ·{" "}
            <span className="text-danger">{data.total_sos} SOS</span>
          </span>
        )
      }
    >
      {loading ? (
        <EmptyState title="Loading reports…" />
      ) : !data || data.citizen_count === 0 ? (
        <EmptyState
          title="No citizen reports yet"
          hint="Submit a report from the citizen app or run a demo scenario to populate this audit log."
        />
      ) : (
        <div className="grid h-full grid-cols-[260px_1fr] divide-x divide-admin-rule">
          {/* Citizen list */}
          <ul className="scroll-thin overflow-y-auto">
            {data.citizens.map((c) => (
              <li
                key={c.citizen_id}
                onClick={() => setActive(c.citizen_id)}
                className={
                  "cursor-pointer border-b border-admin-rule/60 px-4 py-2.5 transition " +
                  (active === c.citizen_id
                    ? "bg-safety-org/10"
                    : "hover:bg-white/[0.025]")
                }
              >
                <div className="flex items-center gap-2">
                  <User2 className="h-3 w-3 text-steel-light" />
                  <span className="truncate text-[12px] text-admin-text">
                    {c.citizen_id}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-steel-light">
                  <span>{c.report_count} reports</span>
                  {c.sos_count > 0 && (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <Siren className="h-2.5 w-2.5" />
                      {c.sos_count}
                    </span>
                  )}
                </div>
                {c.last_seen && (
                  <div className="mt-0.5 font-mono text-[9px] tracking-[.04em] text-steel-light/70">
                    {new Date(c.last_seen).toLocaleString("en-IN", {
                      hour12: false,
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Detail */}
          <div className="scroll-thin overflow-y-auto p-5">
            {selected ? (
              <CitizenDetail citizen={selected} />
            ) : (
              <EmptyState title="Select a citizen" />
            )}
          </div>
        </div>
      )}
    </ViewShell>
  );
}

function CitizenDetail({ citizen }: { citizen: CitizenSummary }) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-admin-rule bg-onyx-2 text-safety-org">
          <User2 className="h-4 w-4" />
        </span>
        <div>
          <div className="font-serif text-[16px] text-admin-text">
            {citizen.citizen_id}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[.1em] text-steel-light">
            {citizen.report_count} reports · {citizen.sos_count} SOS
            {citizen.last_location && (
              <span className="ml-2 inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {citizen.last_location.lat.toFixed(4)},{" "}
                {citizen.last_location.lng.toFixed(4)}
              </span>
            )}
          </div>
        </div>
      </div>

      {citizen.recent_reports.length === 0 ? (
        <EmptyState title="No recent activity" />
      ) : (
        <ul className="space-y-2">
          {citizen.recent_reports.map((r, i) => {
            const isSOS = r.kind === "sos";
            return (
              <li
                key={i}
                className={
                  "border-l-[3px] bg-onyx-2 px-4 py-3 " +
                  (isSOS ? "border-danger" : "border-mid-green")
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      "font-mono text-[9px] uppercase tracking-[.14em] " +
                      (isSOS ? "text-danger" : "text-light-green")
                    }
                  >
                    {isSOS ? "SOS" : "REPORT"}
                  </span>
                  <span className="font-serif text-[13px] text-admin-text">
                    {r.disaster_type ?? "incident"}
                  </span>
                  {r.status && (
                    <span
                      className={
                        "rounded-sharp border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[.12em] " +
                        (r.status === "ok" || r.status === "completed"
                          ? "border-cleared/40 bg-cleared/15 text-cleared"
                          : r.status === "error"
                            ? "border-danger/40 bg-danger/15 text-danger"
                            : "border-safety-org/40 bg-safety-org/15 text-safety-org")
                      }
                    >
                      {r.status}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[9px] tracking-[.04em] text-steel-light">
                    {new Date(r.submitted_at).toLocaleString("en-IN", {
                      hour12: false,
                    })}
                  </span>
                </div>
                {r.description && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-admin-muted">
                    {r.description}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-[9px] uppercase tracking-[.08em] text-steel-light">
                  {r.incident_id && <span>incident · {r.incident_id}</span>}
                  {r.coordinates && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {Number(r.coordinates[0]).toFixed(3)},{" "}
                      {Number(r.coordinates[1]).toFixed(3)}
                    </span>
                  )}
                  {r.image_url && (
                    <span className="inline-flex items-center gap-1 text-mid-green">
                      <Camera className="h-3 w-3" />
                      photo attached
                    </span>
                  )}
                  {r.stages && r.stages.length > 0 && (
                    <span>{r.stages.length} stages</span>
                  )}
                </div>
                {r.error && (
                  <div className="mt-1.5 font-mono text-[10px] text-danger">
                    error · {r.error}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
