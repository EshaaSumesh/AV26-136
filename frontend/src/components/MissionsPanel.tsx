"use client";

import type { Mission } from "@/lib/types";
import { Clock, MapPin, Truck, Users } from "lucide-react";

interface Props {
  missions: Mission[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

interface StatusStyle {
  dot: string;
  glow: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  label: string;
}

function statusStyle(status: string): StatusStyle {
  switch (status) {
    case "negotiating":
      return {
        dot: "#E86A10",
        glow: "0 0 6px #E86A10",
        pillBg: "rgba(232,106,16,0.15)",
        pillBorder: "rgba(232,106,16,0.35)",
        pillText: "#E86A10",
        label: "NEGOTIATING",
      };
    case "accepted":
      return {
        dot: "#60a5fa",
        glow: "0 0 6px #60a5fa",
        pillBg: "rgba(96,165,250,0.15)",
        pillBorder: "rgba(96,165,250,0.35)",
        pillText: "#60a5fa",
        label: "ACCEPTED",
      };
    case "en_route":
      return {
        dot: "#E86A10",
        glow: "0 0 8px #E86A10",
        pillBg: "rgba(232,106,16,0.15)",
        pillBorder: "rgba(232,106,16,0.35)",
        pillText: "#E86A10",
        label: "EN ROUTE",
      };
    case "on_site":
      return {
        dot: "#2E7D32",
        glow: "0 0 8px #2E7D32",
        pillBg: "rgba(46,125,50,0.15)",
        pillBorder: "rgba(46,125,50,0.35)",
        pillText: "#65d188",
        label: "ON SITE",
      };
    case "completed":
      return {
        dot: "#718096",
        glow: "none",
        pillBg: "rgba(113,128,150,0.15)",
        pillBorder: "rgba(113,128,150,0.35)",
        pillText: "#A0AEC0",
        label: "RESOLVED",
      };
    case "cancelled":
    case "declined":
      return {
        dot: "#D32F2F",
        glow: "0 0 6px #D32F2F",
        pillBg: "rgba(211,47,47,0.15)",
        pillBorder: "rgba(211,47,47,0.35)",
        pillText: "#fb7185",
        label: "DECLINED",
      };
    default:
      return {
        dot: "#718096",
        glow: "none",
        pillBg: "rgba(113,128,150,0.12)",
        pillBorder: "rgba(113,128,150,0.3)",
        pillText: "#A0AEC0",
        label: status.toUpperCase().replace("_", " "),
      };
  }
}

export default function MissionsPanel({ missions, selected, onSelect }: Props) {
  const active = missions.filter((m) =>
    ["negotiating", "accepted", "en_route", "on_site"].includes(m.status),
  );
  const resolved = missions.length - active.length;

  return (
    <div className="dark-scope flex h-full flex-col overflow-hidden border border-admin-rule bg-onyx">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-admin-rule bg-onyx-2 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Truck className="h-3.5 w-3.5 text-safety-org" />
          <h3 className="font-mono text-[10px] uppercase tracking-[.14em] text-safety-org">
            Active Missions
          </h3>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
          {active.length} Active · {resolved} Resolved
        </span>
      </div>

      {/* List */}
      <div className="scroll-thin flex-1 overflow-y-auto">
        {missions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
            <Truck className="mb-2 h-5 w-5 text-steel-light/50" />
            <div className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
              No missions in progress
            </div>
            <div className="mt-1 max-w-[200px] text-[11px] text-steel-light/70">
              Run a demo scenario or wait for an incoming citizen report.
            </div>
          </div>
        ) : (
          <ul>
            {missions.map((m) => {
              const s = statusStyle(m.status);
              const isSel = selected === m.mission_id;
              return (
                <li
                  key={m.mission_id}
                  onClick={() =>
                    onSelect(m.mission_id === selected ? null : m.mission_id)
                  }
                  className={
                    "cursor-pointer border-b border-admin-rule/60 px-4 py-3 transition " +
                    (isSel
                      ? "bg-safety-org/10"
                      : "hover:bg-white/[0.025]")
                  }
                >
                  {/* Top row: dot + name + ETA + pill */}
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: s.dot,
                        boxShadow: s.glow,
                      }}
                    />
                    <span className="flex-1 truncate text-[12px] text-admin-text">
                      {m.disaster_type
                        ? `${m.disaster_type[0].toUpperCase()}${m.disaster_type.slice(1)}`
                        : "Incident"}{" "}
                      —{" "}
                      <span className="text-admin-muted">
                        {m.assigned_base_name ?? "Awaiting dispatch"}
                      </span>
                    </span>
                    {m.route_eta_minutes ? (
                      <span className="font-mono text-[9px] text-steel-light">
                        ETA {m.route_eta_minutes.toFixed(0)}m
                      </span>
                    ) : null}
                    <span
                      className="rounded-sharp border px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em]"
                      style={{
                        background: s.pillBg,
                        borderColor: s.pillBorder,
                        color: s.pillText,
                      }}
                    >
                      {s.label}
                    </span>
                  </div>

                  {/* Sub row: id, severity, coords */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 font-mono text-[9px] uppercase tracking-[.08em] text-steel-light">
                    <span>{m.mission_id.slice(-8)}</span>
                    <span className={`severity-${m.severity}`}>
                      SEV {m.severity}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {m.incident_coordinates[0].toFixed(3)},{" "}
                      {m.incident_coordinates[1].toFixed(3)}
                    </span>
                  </div>

                  {/* Expanded — negotiation timeline */}
                  {isSel && m.negotiation_history.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-admin-rule/60 pt-3 pl-4">
                      <div className="font-mono text-[9px] uppercase tracking-[.14em] text-safety-org">
                        Negotiation Timeline
                      </div>
                      <ul className="space-y-1.5">
                        {m.negotiation_history.map((n, i) => (
                          <li
                            key={i}
                            className="border border-admin-rule/60 bg-white/[0.02] px-2 py-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] font-medium text-admin-text">
                                {n.agent}
                              </span>
                              <span
                                className={
                                  "font-mono text-[8px] uppercase tracking-[.1em] " +
                                  (n.action === "accepted"
                                    ? "text-cleared"
                                    : n.action === "declined"
                                      ? "text-danger"
                                      : "text-safety-org")
                                }
                              >
                                {n.action}
                              </span>
                            </div>
                            <div className="mt-0.5 line-clamp-3 text-[10px] leading-relaxed text-admin-muted">
                              {n.reasoning}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {isSel && (
                    <div className="mt-2 flex items-center gap-3 pl-4 font-mono text-[9px] uppercase tracking-[.08em] text-steel-light">
                      {m.assigned_base_name && (
                        <span className="inline-flex items-center gap-1 text-light-green">
                          <Users className="h-3 w-3" />
                          {m.assigned_base_name}
                        </span>
                      )}
                      {m.route_eta_minutes && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {m.route_eta_minutes.toFixed(1)} min
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
