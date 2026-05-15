"use client";

import type { Mission } from "@/lib/types";
import { Clock, MapPin, Users } from "lucide-react";

interface Props {
  missions: Mission[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

interface StatusStyle {
  /** colour of the status word (italic) and the leading dot. */
  ink: string;
  /** the editorial label, lower-case (we render via small-caps). */
  label: string;
}

function statusStyle(status: string): StatusStyle {
  switch (status) {
    case "negotiating":
      return { ink: "#A8741A", label: "negotiating" };
    case "accepted":
      return { ink: "var(--safety-org)", label: "accepted" };
    case "en_route":
      return { ink: "var(--safety-org)", label: "en route" };
    case "on_site":
      return { ink: "#0F4D2C", label: "on site" };
    case "completed":
      return { ink: "var(--admin-muted)", label: "resolved" };
    case "cancelled":
    case "declined":
      return { ink: "var(--danger)", label: "declined" };
    default:
      return { ink: "var(--admin-muted)", label: status.replace("_", " ") };
  }
}

export default function MissionsPanel({ missions, selected, onSelect }: Props) {
  const active = missions.filter((m) =>
    ["negotiating", "accepted", "en_route", "on_site"].includes(m.status),
  );
  const resolved = missions.length - active.length;

  return (
    <div className="dark-scope flex h-full flex-col overflow-hidden bg-onyx">
      <div className="flex items-baseline justify-between border-b border-admin-rule px-5 py-2.5">
        <span
          className="font-serif text-[11px] tracking-[.16em] text-admin-text"
          style={{ fontVariantCaps: "small-caps" }}
        >
          missions ledger
        </span>
        <span
          className="font-mono text-[10px] tracking-[.04em] text-admin-muted"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {String(active.length).padStart(2, "0")} active ·{" "}
          {String(resolved).padStart(2, "0")} resolved
        </span>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {missions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
            <div className="font-serif text-[10px] uppercase tracking-[.18em] text-admin-muted">
              No missions in progress
            </div>
            <div className="mt-2 max-w-[240px] font-serif italic text-[12px] leading-relaxed text-admin-muted">
              Run a demo scenario or wait for an incoming citizen report.
            </div>
          </div>
        ) : (
          <ul className="px-5">
            {missions.map((m, idx) => {
              const s = statusStyle(m.status);
              const isSel = selected === m.mission_id;
              const headline =
                m.disaster_type && m.disaster_type.length > 0
                  ? `${m.disaster_type[0].toUpperCase()}${m.disaster_type.slice(1)}`
                  : "Incident";
              return (
                <li
                  key={m.mission_id}
                  onClick={() =>
                    onSelect(m.mission_id === selected ? null : m.mission_id)
                  }
                  className={
                    "cursor-pointer border-b border-admin-rule py-3 transition " +
                    (isSel ? "bg-slate" : "hover:bg-slate/60") +
                    (idx === 0 ? " pt-3" : "")
                  }
                >
                  {/* Headline row */}
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-mono text-[10px] tracking-[.04em] text-admin-muted"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <h4
                      className="flex-1 font-serif text-[14px] font-semibold leading-tight text-admin-text"
                      style={{ letterSpacing: "-0.005em" }}
                    >
                      {headline}
                      <span className="font-serif italic font-normal text-admin-muted">
                        {" "}
                        — {m.assigned_base_name ?? "awaiting dispatch"}
                      </span>
                    </h4>
                    <span
                      className="font-serif italic text-[11px]"
                      style={{
                        color: s.ink,
                        fontVariantCaps: "small-caps",
                      }}
                    >
                      {s.label}
                    </span>
                  </div>

                  {/* Byline / metadata */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 font-serif italic text-[11px] text-admin-muted">
                    <span
                      className="font-mono not-italic"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      #{m.mission_id.slice(-8)}
                    </span>
                    <span>severity {m.severity}</span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      <span
                        className="font-mono not-italic"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {m.incident_coordinates[0].toFixed(3)},{" "}
                        {m.incident_coordinates[1].toFixed(3)}
                      </span>
                    </span>
                    {m.route_eta_minutes ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        ETA{" "}
                        <span
                          className="font-mono not-italic"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {m.route_eta_minutes.toFixed(0)}m
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {/* Expanded negotiation timeline (editorial pull-out) */}
                  {isSel && m.negotiation_history.length > 0 && (
                    <div className="mt-3 ml-6 border-l border-admin-rule pl-3">
                      <div
                        className="font-serif text-[10px] uppercase tracking-[.18em] text-admin-text"
                        style={{ fontVariantCaps: "small-caps" }}
                      >
                        the negotiation
                      </div>
                      <ul className="mt-1.5 space-y-2">
                        {m.negotiation_history.map((n, i) => (
                          <li key={i}>
                            <div className="flex items-baseline gap-2">
                              <span className="font-serif text-[12px] font-semibold text-admin-text">
                                {n.agent}
                              </span>
                              <span
                                className="font-serif italic text-[11px]"
                                style={{
                                  color:
                                    n.action === "accepted"
                                      ? "var(--safety-org)"
                                      : n.action === "declined"
                                        ? "var(--danger)"
                                        : "var(--admin-muted)",
                                  fontVariantCaps: "small-caps",
                                }}
                              >
                                — {n.action}
                              </span>
                            </div>
                            <p className="mt-0.5 font-serif text-[12px] leading-snug text-admin-muted">
                              {n.reasoning}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {isSel && (
                    <div className="mt-2 flex items-center gap-4 pl-6 font-serif italic text-[11px] text-admin-muted">
                      {m.assigned_base_name && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {m.assigned_base_name}
                        </span>
                      )}
                      {m.route_eta_minutes && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span
                            className="font-mono not-italic"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {m.route_eta_minutes.toFixed(1)}
                          </span>{" "}
                          min
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
