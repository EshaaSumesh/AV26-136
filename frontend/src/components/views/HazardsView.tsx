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
      kicker="INTELLIGENCE"
      title="Hazard Zones"
      actions={
        <span className="font-mono text-[10px] uppercase tracking-[.12em] text-steel-light">
          {hazards.length} active
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2 border-b border-admin-rule p-4 md:grid-cols-4">
        {(["critical", "high", "medium", "low"] as const).map((sev) => (
          <div
            key={sev}
            className="border border-admin-rule bg-onyx-2 px-3 py-2"
          >
            <div className="font-mono text-[9px] uppercase tracking-[.14em] text-steel-light">
              {sev}
            </div>
            <div
              className="mt-1 font-serif text-[22px] leading-none"
              style={{ color: SEV_COLOR[sev] }}
            >
              {counts[sev] ?? 0}
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
                className="border-b border-admin-rule/60 px-5 py-3 transition hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full"
                    style={{
                      background: `${sevColor}22`,
                      border: `1px solid ${sevColor}66`,
                      color: sevColor,
                    }}
                  >
                    {h.category === "fire" ? (
                      <Flame className="h-3.5 w-3.5" />
                    ) : h.blocked ? (
                      <Shield className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-admin-text">
                        {titleCase(h.category, "Hazard")}
                      </span>
                      <span className="font-mono text-[9px] text-steel-light">
                        · {shortId(h.id)}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.08em] text-steel-light">
                      {Number.isFinite(lat) && Number.isFinite(lng)
                        ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                        : "coords unavailable"}
                      {Number.isFinite(radius)
                        ? ` · ${radius.toFixed(2)} km radius`
                        : ""}
                    </div>
                  </div>
                  <span
                    className="rounded-sharp border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[.12em]"
                    style={{
                      color: sevColor,
                      borderColor: `${sevColor}66`,
                      background: `${sevColor}1a`,
                    }}
                  >
                    {h.severity ?? "unknown"}
                  </span>
                  {h.blocked && (
                    <span className="rounded-sharp border border-danger/40 bg-danger/15 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[.12em] text-danger">
                      Blocked
                    </span>
                  )}
                </div>
                {h.reasoning && (
                  <p className="mt-2 max-w-[640px] text-[11px] leading-relaxed text-admin-muted">
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
