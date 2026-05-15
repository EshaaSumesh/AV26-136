"use client";

import { AlertTriangle, Flame, Shield } from "lucide-react";
import type { HazardZone } from "@/lib/types";
import { ViewShell, EmptyState } from "./ViewShell";

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f87171",
  medium: "#fb923c",
  low: "#facc15",
  unknown: "#94a3b8",
};

function titleCase(s: string | null | undefined, fallback = "Unknown"): string {
  if (!s || typeof s !== "string" || s.length === 0) return fallback;
  return s[0].toUpperCase() + s.slice(1);
}

function shortId(id: string | null | undefined, fallback = "—"): string {
  if (!id || typeof id !== "string") return fallback;
  return id.length > 8 ? id.slice(-8) : id;
}

export default function HazardsView({ hazards }: { hazards: HazardZone[] }) {
  const sorted = [...hazards].sort((a, b) => {
    const order = ["critical", "high", "medium", "low"];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });

  const counts = sorted.reduce<Record<string, number>>((acc, h) => {
    acc[h.severity] = (acc[h.severity] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <ViewShell
      kicker="Intelligence · Hazards"
      title="Hazard Zones"
      actions={
        <span
          className="font-mono text-[10px] tracking-[.06em] text-admin-muted"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {String(hazards.length).padStart(2, "0")} active
        </span>
      }
    >
      <div className="grid grid-cols-2 border-b border-admin-rule bg-onyx-2 md:grid-cols-4">
        {(["critical", "high", "medium", "low"] as const).map((sev) => (
          <div
            key={sev}
            className="border-r border-admin-rule px-5 py-3 last:border-r-0"
          >
            <div className="font-serif text-[10px] uppercase tracking-[.18em] text-admin-muted">
              {sev}
            </div>
            <div
              className="mt-1.5 font-mono text-[28px] leading-none"
              style={{
                color: SEV_COLOR[sev],
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.01em",
              }}
            >
              {String(counts[sev] ?? 0).padStart(2, "0")}
            </div>
            <div className="mt-1 font-serif italic text-[11px] text-admin-muted">
              {counts[sev] ?? 0 > 0 ? "active zones" : "no zones"}
            </div>
          </div>
        ))}
      </div>
      {hazards.length === 0 ? (
        <EmptyState
          title="No active hazard zones"
          hint="Once an incident is corroborated, the Hazard Assessment agent declares zones here."
        />
      ) : (
        <ul>
          {sorted.map((h, idx) => {
            const sevKey = (h.severity ?? "unknown") as keyof typeof SEV_COLOR;
            const sevColor = SEV_COLOR[sevKey] ?? SEV_COLOR.unknown;
            const lat = Array.isArray(h.center) ? Number(h.center[0]) : NaN;
            const lng = Array.isArray(h.center) ? Number(h.center[1]) : NaN;
            const radius = Number(h.radius_km);
            return (
              <li
                key={h.id ?? `hazard_${idx}`}
                className="border-b border-admin-rule px-6 py-4 transition hover:bg-onyx-2"
              >
                <div className="flex items-baseline gap-3">
                  <span
                    className="font-mono text-[10px] tracking-[.04em] text-admin-muted"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span
                    className="self-center"
                    style={{ color: sevColor }}
                  >
                    {h.category === "fire" ? (
                      <Flame className="h-3.5 w-3.5" />
                    ) : h.blocked ? (
                      <Shield className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <h3
                    className="flex-1 font-serif text-[15px] font-semibold leading-tight text-admin-text"
                    style={{ letterSpacing: "-0.005em" }}
                  >
                    {titleCase(h.category, "Hazard")}
                    <span className="font-serif italic font-normal text-admin-muted">
                      {" "}
                      — zone #{shortId(h.id)}
                    </span>
                  </h3>
                  <span
                    className="font-serif italic text-[11px]"
                    style={{
                      color: sevColor,
                      fontVariantCaps: "small-caps",
                    }}
                  >
                    {h.severity ?? "unknown"}
                  </span>
                  {h.blocked && (
                    <span className="font-serif italic text-[11px] text-danger">
                      blocked
                    </span>
                  )}
                </div>
                <div className="mt-1 pl-12 font-serif italic text-[11px] text-admin-muted">
                  <span
                    className="font-mono not-italic"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {Number.isFinite(lat) && Number.isFinite(lng)
                      ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                      : "coords unavailable"}
                  </span>
                  {Number.isFinite(radius) && (
                    <>
                      {" · "}
                      <span
                        className="font-mono not-italic"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {radius.toFixed(2)}
                      </span>{" "}
                      km radius
                    </>
                  )}
                </div>
                {h.reasoning && (
                  <p className="mt-2 max-w-[680px] pl-12 font-serif text-[13px] leading-relaxed text-admin-text">
                    {h.reasoning}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ViewShell>
  );
}
