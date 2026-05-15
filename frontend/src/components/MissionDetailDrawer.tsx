"use client";

/**
 * MissionDetailDrawer — full-bleed editorial drawer that slides in
 * when the operator clicks an incident pin on the map.
 *
 * Renders the agentic story for a single mission:
 *   • Headline status row  (category, severity, base, ETA)
 *   • Why this base?       (the dispatch agent's free-text rationale)
 *   • Considered alternatives (rejected bases + reasons — proves the
 *                              agent reasoned, didn't just pick nearest)
 *   • Negotiation history  (round-by-round commander accept/reject)
 *   • Route details        (distance, ETA, hazards crossed/avoided)
 *
 * Closes on backdrop click or Esc. Read-only — no actions inside the
 * drawer; ops happens in the rail and on the map.
 */

import { useEffect } from "react";
import { X, MapPin, Clock, Building2, Network, Route } from "lucide-react";
import type { Mission } from "@/lib/types";
import { categoryMeta } from "@/lib/categories";

interface Props {
  mission: Mission;
  onClose: () => void;
}

export default function MissionDetailDrawer({ mission, onClose }: Props) {
  // Close on Escape — quicker than aiming for the close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cat = categoryMeta(mission.disaster_type);
  const statusLabel = mission.status.replace(/_/g, " ");

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        aria-label="Close mission details"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/30"
      />
      <aside className="dark-scope flex h-full w-[min(520px,100%)] flex-col overflow-hidden border-l border-admin-rule bg-onyx-2 shadow-[-12px_0_32px_rgba(0,0,0,0.18)]">
        {/* Masthead — kicker + serif headline + close button */}
        <header className="flex items-start justify-between border-b border-admin-text px-5 pb-3 pt-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-admin-muted">
              <span style={{ color: cat.tint }}>
                <span className="inline-flex h-3 w-3 items-center justify-center align-text-bottom">
                  {cat.glyph}
                </span>
              </span>
              <span>Mission · {mission.mission_id}</span>
              <span className="rounded-sm px-1.5 py-0.5 text-[9px]"
                style={{
                  background: "var(--onyx)",
                  color: "var(--admin-text)",
                  border: "1px solid var(--admin-rule)",
                }}
              >
                SEV {mission.severity}
              </span>
            </div>
            <h2
              className="mt-1 font-serif text-[20px] font-semibold leading-tight text-admin-text"
              style={{ letterSpacing: "-0.01em" }}
            >
              {cat.label}
              <span className="ml-2 font-serif italic text-[14px] text-admin-muted">
                {statusLabel}
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="ml-3 inline-flex h-7 w-7 items-center justify-center border border-admin-rule text-admin-muted transition hover:border-admin-text hover:text-admin-text"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Scrollable body */}
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
          {/* Quick facts row */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-admin-rule pb-3">
            <Fact
              icon={<Building2 className="h-3 w-3" />}
              label="Base"
              value={mission.assigned_base_name ?? "Unassigned"}
            />
            <Fact
              icon={<Clock className="h-3 w-3" />}
              label="ETA"
              value={
                mission.route_eta_minutes != null
                  ? `${Math.round(mission.route_eta_minutes)} min`
                  : "—"
              }
              mono
            />
            <Fact
              icon={<Route className="h-3 w-3" />}
              label="Distance"
              value={
                mission.route_distance_km != null
                  ? `${mission.route_distance_km.toFixed(1)} km`
                  : "—"
              }
              mono
            />
            <Fact
              icon={<MapPin className="h-3 w-3" />}
              label="Incident"
              value={`${mission.incident_coordinates[0].toFixed(3)}, ${mission.incident_coordinates[1].toFixed(3)}`}
              mono
            />
          </dl>

          {/* WHY THIS BASE? — the dispatch agent's rationale, in its
              own words. This is the "show your work" moment. */}
          {mission.dispatch_reasoning && (
            <Section title="Why this base?">
              <blockquote
                className="border-l-2 px-3 py-1.5 font-serif italic text-[13px] leading-relaxed text-admin-text"
                style={{ borderColor: cat.tint }}
              >
                {mission.dispatch_reasoning}
              </blockquote>
            </Section>
          )}

          {/* CONSIDERED ALTERNATIVES — bases that were thought about and
              rejected. Proves there was real reasoning, not just a
              nearest-neighbour pick. */}
          {mission.dispatch_alternatives &&
            mission.dispatch_alternatives.length > 0 && (
              <Section
                title="Considered alternatives"
                icon={<Network className="h-3.5 w-3.5" />}
                count={mission.dispatch_alternatives.length}
              >
                <ul className="space-y-2">
                  {mission.dispatch_alternatives.map((alt, i) => (
                    <li
                      key={i}
                      className="border-l border-admin-rule px-3 py-1.5"
                    >
                      <div className="font-serif text-[13px] font-semibold text-admin-text">
                        {alt.name}
                      </div>
                      {alt.reason && (
                        <div className="mt-0.5 font-serif italic text-[12px] leading-relaxed text-admin-muted">
                          {alt.reason}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

          {/* NEGOTIATION HISTORY — round-by-round between supervisor /
              dispatch / field commander. Useful for explaining why a
              mission took N rounds. */}
          {mission.negotiation_history.length > 0 && (
            <Section
              title="Negotiation history"
              count={mission.negotiation_history.length}
            >
              <ol className="space-y-2">
                {mission.negotiation_history.map((entry, i) => (
                  <li key={i} className="border-l border-admin-rule px-3 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[.12em] text-admin-muted">
                        {entry.agent}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[.08em] text-admin-muted">
                        {entry.action}
                      </span>
                    </div>
                    {entry.reasoning && (
                      <div className="mt-0.5 font-serif italic text-[12px] leading-relaxed text-admin-text">
                        {entry.reasoning}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* If we have NEITHER reasoning nor alternatives, show a
              gentle empty state so the panel doesn't feel broken. */}
          {!mission.dispatch_reasoning &&
            (!mission.dispatch_alternatives ||
              mission.dispatch_alternatives.length === 0) &&
            mission.negotiation_history.length === 0 && (
              <div className="mt-6 border border-dashed border-admin-rule px-4 py-6 text-center font-mono text-[10px] uppercase tracking-[.14em] text-admin-muted">
                Dispatch reasoning not yet captured
              </div>
            )}
        </div>
      </aside>
    </div>
  );
}

// ── Section wrapper with editorial kicker ─────────────────────────

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-baseline justify-between border-b border-admin-rule pb-1">
        <span
          className="flex items-center gap-1.5 font-serif text-[11px] tracking-[.16em] text-admin-text"
          style={{ fontVariantCaps: "small-caps" }}
        >
          {icon && <span className="text-admin-muted">{icon}</span>}
          {title}
        </span>
        {count !== undefined && (
          <span
            className="font-mono text-[10px] tracking-[.04em] text-admin-muted"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {String(count).padStart(2, "0")}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// ── Compact label/value row for the quick-facts grid ─────────────

function Fact({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[.14em] text-admin-muted">
        <span className="text-admin-muted">{icon}</span>
        {label}
      </dt>
      <dd
        className={
          "mt-0.5 truncate text-[13px] text-admin-text " +
          (mono ? "font-mono" : "font-serif")
        }
        style={mono ? { fontVariantNumeric: "tabular-nums" } : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
