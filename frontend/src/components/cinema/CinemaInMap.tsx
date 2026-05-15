"use client";

/**
 * Cinema-mode map FX, rendered INSIDE <Map> so they have access to
 * `useMap()`. They're activated only while a replay is mid-flight —
 * the plain authority dashboard does not see any of this.
 *
 * Sub-components exported:
 *   • <CameraDirector>    — pans/zooms to each incident as it fires,
 *                           dollies out at end.
 *   • <IncidentShockwave> — radial shockwave when a citizen.report or
 *                           citizen.sos.triggered event lands.
 *   • <AgentBurstLayer>   — small colored sparks at incident locations
 *                           every time an agent emits reasoning / tool_call.
 *   • <AlertRingLayer>    — expanding 1.5km translucent ring on
 *                           public.alert.broadcast events.
 *   • <VehicleAnimator>   — vehicle icon sliding from base to incident,
 *                           scaled to ETA. One per active mission.
 *
 * All components are pure-DOM / SVG over Marker, so they don't add to
 * the Mapbox layer count. They share one event stream prop and key off
 * `event.id` so the same event never triggers twice (idempotent across
 * re-renders).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Marker, useMap } from "react-map-gl";
import type { AgentEvent } from "@/lib/types";
import { agentColor } from "@/lib/types";

/* ────────────────────────────────────────────────────────────────
 * <CameraDirector>
 * ──────────────────────────────────────────────────────────────── */

interface DirectorProps {
  events: AgentEvent[];
  /** When replay state transitions to null, fly back to city centre. */
  active: boolean;
  cityCenter: [number, number];
}

const INCIDENT_TRIGGER_TYPES = new Set([
  "citizen.report.submitted",
  "citizen.sos.triggered",
  "external.alert.received",
]);

export function CameraDirector({ events, active, cityCenter }: DirectorProps) {
  const { current: mapRef } = useMap();
  const seen = useRef<Set<string>>(new Set());
  const lastIncidentAt = useRef<number>(0);
  const dolliedOut = useRef<boolean>(false);

  useEffect(() => {
    if (!active) {
      seen.current.clear();
      dolliedOut.current = false;
      return;
    }
    if (!mapRef) return;
    const map = mapRef.getMap();

    // Walk events newest-first (the WS pushes them at the head of the
    // array). Pick the most recent unseen incident-trigger and fly to
    // it. We fly only once per event id so re-renders don't churn the
    // camera.
    for (const ev of events) {
      if (seen.current.has(ev.id)) continue;
      seen.current.add(ev.id);
      if (!INCIDENT_TRIGGER_TYPES.has(ev.type)) continue;

      const coords = (ev.payload?.coordinates ?? null) as
        | [number, number]
        | null;
      if (!coords || coords.length !== 2) continue;
      const [lat, lng] = coords;

      // Throttle: ignore rapid-fire bursts within 2s of each other so
      // we don't dizzy the audience. The most recent one wins.
      const now = Date.now();
      if (now - lastIncidentAt.current < 1500) continue;
      lastIncidentAt.current = now;

      const isSos = ev.type === "citizen.sos.triggered";
      try {
        map.flyTo({
          center: [lng, lat],
          zoom: isSos ? 14.4 : 13.8,
          pitch: isSos ? 45 : 30,
          bearing: 0,
          duration: 2200,
          essential: true,
        });
      } catch {
        // Map may not be loaded yet on first tick; ignore.
      }
      // Schedule a slow zoom-out a few seconds later so the next
      // incident has somewhere to fly back from.
      window.setTimeout(() => {
        try {
          map.easeTo({
            zoom: 12.6,
            pitch: 18,
            duration: 2400,
          });
        } catch {
          /* noop */
        }
      }, 5500);
      break; // Only act on the freshest unseen incident.
    }
  }, [events, mapRef, active]);

  // When replay ends, dolly back to the city centre.
  useEffect(() => {
    if (active || !mapRef) return;
    if (dolliedOut.current) return;
    dolliedOut.current = true;
    try {
      mapRef.getMap().flyTo({
        center: cityCenter,
        zoom: 11.5,
        pitch: 0,
        bearing: 0,
        duration: 2000,
      });
    } catch {
      /* noop */
    }
  }, [active, mapRef, cityCenter]);

  return null;
}

/* ────────────────────────────────────────────────────────────────
 * <IncidentShockwave>
 * Big radial pulse when a citizen report or SOS lands.
 * ──────────────────────────────────────────────────────────────── */

interface Shock {
  id: string;
  lat: number;
  lng: number;
  kind: "report" | "sos" | "external";
  category: string;
  startedAt: number;
}

const SHOCK_DURATION_MS = 1800;

export function IncidentShockwave({ events }: { events: AgentEvent[] }) {
  const [shocks, setShocks] = useState<Shock[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const now = Date.now();
    const next: Shock[] = [];
    for (const ev of events.slice(0, 50)) {
      if (!INCIDENT_TRIGGER_TYPES.has(ev.type)) continue;
      if (seen.current.has(ev.id)) continue;
      seen.current.add(ev.id);
      const coords = ev.payload?.coordinates as [number, number] | undefined;
      if (!coords || coords.length !== 2) continue;
      const kind: Shock["kind"] =
        ev.type === "citizen.sos.triggered"
          ? "sos"
          : ev.type === "external.alert.received"
            ? "external"
            : "report";
      next.push({
        id: ev.id,
        lat: coords[0],
        lng: coords[1],
        kind,
        category:
          (ev.payload?.disaster_type as string) ||
          (ev.payload?.category as string) ||
          "incident",
        startedAt: now,
      });
    }
    if (next.length) {
      setShocks((prev) => [
        ...prev.filter((s) => now - s.startedAt < SHOCK_DURATION_MS),
        ...next,
      ]);
    }
  }, [events]);

  // Frame loop to expire shocks.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      setShocks((prev) =>
        prev.filter((s) => now - s.startedAt < SHOCK_DURATION_MS),
      );
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      {shocks.map((s) => (
        <ShockMarker key={s.id} shock={s} />
      ))}
    </>
  );
}

function ShockMarker({ shock }: { shock: Shock }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = shock.startedAt;
    const tick = () => {
      const elapsed = Date.now() - start;
      setT(Math.min(1, elapsed / SHOCK_DURATION_MS));
      if (elapsed < SHOCK_DURATION_MS)
        raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [shock.startedAt]);

  const ringSize = 24 + t * 220; // px
  const opacity = 1 - t;
  const tint =
    shock.kind === "sos"
      ? "#ef4444"
      : shock.kind === "external"
        ? "#facc15"
        : "#34d399";

  // Slam-in badge: scale from 0.4 → 1.05 → 1 in the first 350ms.
  const badgeScale =
    t < 0.18 ? 0.4 + (t / 0.18) * 0.7 : t < 0.28 ? 1.05 : 1;
  const badgeOpacity = t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) * 3);

  const badgeText =
    shock.kind === "sos"
      ? "SOS"
      : shock.kind === "external"
        ? "ALERT"
        : shock.category.replace("_", " ").toUpperCase();

  return (
    <Marker longitude={shock.lng} latitude={shock.lat} anchor="center">
      <div
        style={{
          position: "relative",
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      >
        {/* Expanding ring */}
        <div
          style={{
            position: "absolute",
            left: -ringSize / 2,
            top: -ringSize / 2,
            width: ringSize,
            height: ringSize,
            borderRadius: "50%",
            border: `2px solid ${tint}`,
            boxShadow: `0 0 24px ${tint}`,
            opacity: opacity * 0.8,
          }}
        />
        {/* Soft inner pulse */}
        <div
          style={{
            position: "absolute",
            left: -ringSize / 4,
            top: -ringSize / 4,
            width: ringSize / 2,
            height: ringSize / 2,
            borderRadius: "50%",
            background: tint,
            opacity: opacity * 0.18,
            filter: "blur(8px)",
          }}
        />
        {/* Slam-in badge above the pin */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: -54,
            transform: `translateX(-50%) scale(${badgeScale})`,
            opacity: badgeOpacity,
            background: tint,
            color: "#0a0a0a",
            fontFamily: "var(--font-mono), monospace",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".14em",
            padding: "4px 10px",
            border: "1px solid #0a0a0a",
            boxShadow: `0 6px 16px rgba(0,0,0,0.5), 0 0 0 2px ${tint}33`,
            whiteSpace: "nowrap",
          }}
        >
          {badgeText}
        </div>
      </div>
    </Marker>
  );
}

/* ────────────────────────────────────────────────────────────────
 * <AgentBurstLayer>
 * Small colored sparks at the incident location each time an agent
 * emits reasoning or a tool_call. Visually proves "8 agents working".
 * ──────────────────────────────────────────────────────────────── */

interface Burst {
  id: string;
  lat: number;
  lng: number;
  color: string;
  startedAt: number;
}
const BURST_DURATION_MS = 900;

export function AgentBurstLayer({
  events,
  incidentCoords,
}: {
  events: AgentEvent[];
  /** map of incident_id → [lat, lng] so we can place bursts even if the
   *  triggering event itself doesn't carry coordinates. */
  incidentCoords: Map<string, [number, number]>;
}) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const now = Date.now();
    const next: Burst[] = [];
    for (const ev of events.slice(0, 30)) {
      if (seen.current.has(ev.id)) continue;
      seen.current.add(ev.id);
      if (ev.type !== "agent.reasoning" && ev.type !== "agent.tool_call")
        continue;

      const incId = ev.payload?.incident_id as string | undefined;
      if (!incId) continue;
      const coords = incidentCoords.get(incId);
      if (!coords) continue;
      next.push({
        id: ev.id,
        lat: coords[0],
        lng: coords[1],
        color: agentColor(ev.payload?.agent || ev.source_agent),
        startedAt: now,
      });
    }
    if (next.length) {
      setBursts((prev) => [
        ...prev.filter((b) => now - b.startedAt < BURST_DURATION_MS),
        ...next,
      ]);
    }
  }, [events, incidentCoords]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      setBursts((prev) =>
        prev.filter((b) => now - b.startedAt < BURST_DURATION_MS),
      );
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      {bursts.map((b) => (
        <BurstMarker key={b.id} burst={b} />
      ))}
    </>
  );
}

function BurstMarker({ burst }: { burst: Burst }) {
  const [t, setT] = useState(0);
  // Random launch angle per burst so they radiate outward like sparks.
  const angle = useMemo(() => Math.random() * Math.PI * 2, []);
  const distance = useMemo(() => 22 + Math.random() * 22, []);

  useEffect(() => {
    let raf = 0;
    const start = burst.startedAt;
    const tick = () => {
      const elapsed = Date.now() - start;
      setT(Math.min(1, elapsed / BURST_DURATION_MS));
      if (elapsed < BURST_DURATION_MS)
        raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [burst.startedAt]);

  const x = Math.cos(angle) * distance * t;
  const y = Math.sin(angle) * distance * t;
  const opacity = 1 - t;
  const size = 8 - t * 4;

  return (
    <Marker longitude={burst.lng} latitude={burst.lat} anchor="center">
      <div
        style={{
          position: "relative",
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: x - size / 2,
            top: y - size / 2,
            width: size,
            height: size,
            borderRadius: "50%",
            background: burst.color,
            boxShadow: `0 0 10px ${burst.color}`,
            opacity,
          }}
        />
      </div>
    </Marker>
  );
}

/* ────────────────────────────────────────────────────────────────
 * <AlertRingLayer>
 * Expanding 1.5km translucent ring on public.alert.broadcast,
 * settling into a thin geofence outline.
 * ──────────────────────────────────────────────────────────────── */

interface AlertRing {
  id: string;
  lat: number;
  lng: number;
  radiusKm: number;
  startedAt: number;
}
const ALERT_RING_DURATION_MS = 4500;

export function AlertRingLayer({ events }: { events: AgentEvent[] }) {
  const [rings, setRings] = useState<AlertRing[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const now = Date.now();
    const next: AlertRing[] = [];
    for (const ev of events.slice(0, 50)) {
      if (seen.current.has(ev.id)) continue;
      seen.current.add(ev.id);
      if (ev.type !== "public.alert.broadcast") continue;
      const coords = ev.payload?.coordinates as [number, number] | undefined;
      if (!coords || coords.length !== 2) continue;
      const radiusKm = Number(ev.payload?.radius_km) || 1.5;
      next.push({
        id: ev.id,
        lat: coords[0],
        lng: coords[1],
        radiusKm,
        startedAt: now,
      });
    }
    if (next.length) {
      setRings((prev) => [
        ...prev.filter((r) => now - r.startedAt < ALERT_RING_DURATION_MS),
        ...next,
      ]);
    }
  }, [events]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      setRings((prev) =>
        prev.filter((r) => now - r.startedAt < ALERT_RING_DURATION_MS),
      );
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      {rings.map((r) => (
        <AlertRingMarker key={r.id} ring={r} />
      ))}
    </>
  );
}

function AlertRingMarker({ ring }: { ring: AlertRing }) {
  const { current: mapRef } = useMap();
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = ring.startedAt;
    const tick = () => {
      const elapsed = Date.now() - start;
      setT(Math.min(1, elapsed / ALERT_RING_DURATION_MS));
      if (elapsed < ALERT_RING_DURATION_MS)
        raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [ring.startedAt]);

  // Convert km → screen pixels using map zoom & latitude.
  const radiusPx = useMemo(() => {
    if (!mapRef) return 80;
    try {
      const map = mapRef.getMap();
      const z = map.getZoom();
      const metersPerPx =
        (40075016.686 * Math.cos((ring.lat * Math.PI) / 180)) /
        Math.pow(2, z + 8);
      return (ring.radiusKm * 1000) / metersPerPx;
    } catch {
      return 100;
    }
  }, [mapRef, ring.lat, ring.radiusKm, t]);

  // Three phases: 0–0.55 → expand from 0 to full radius (loud);
  //               0.55–0.85 → settle, fade ring fill, keep stroke;
  //               0.85–1   → outline-only ghost, fade out.
  const expandPhase = Math.min(1, t / 0.55);
  const currentRadius = expandPhase * radiusPx;
  const fillOpacity =
    t < 0.55 ? 0.18 * (1 - t / 0.55) : t < 0.85 ? 0.04 : 0;
  const strokeOpacity = t < 0.85 ? 0.85 : 1 - (t - 0.85) / 0.15;

  return (
    <Marker longitude={ring.lng} latitude={ring.lat} anchor="center">
      <div
        style={{
          position: "absolute",
          left: -currentRadius,
          top: -currentRadius,
          width: currentRadius * 2,
          height: currentRadius * 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(244,114,182,${fillOpacity}), transparent 70%)`,
          border: `1px dashed rgba(244,114,182,${strokeOpacity})`,
          pointerEvents: "none",
        }}
      />
    </Marker>
  );
}

/* ────────────────────────────────────────────────────────────────
 * <VehicleAnimator>
 * Vehicle icon sliding along the route from base to incident, scaled
 * to ETA. We use wall-clock interpolation against a per-mission start
 * stamp captured the moment the route is first seen.
 * ──────────────────────────────────────────────────────────────── */

interface RouteForVehicle {
  mission_id: string;
  path: Array<[number, number]>;
  eta_minutes: number | null;
  disaster_type?: string;
  status?: string;
}

export function VehicleAnimator({
  routes,
  /** Compress the simulated transit so the audience sees vehicles
   *  arrive within the demo window, not 14 real minutes later. */
  speedMultiplier = 60,
}: {
  routes: RouteForVehicle[];
  speedMultiplier?: number;
}) {
  // Per-mission start-of-transit timestamp.
  const startedAt = useRef<Map<string, number>>(new Map());
  const [, force] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      force((n) => (n + 1) % 1024);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      {routes.map((r) => {
        if (!r.path || r.path.length < 2) return null;
        let started = startedAt.current.get(r.mission_id);
        if (!started) {
          started = Date.now();
          startedAt.current.set(r.mission_id, started);
        }
        const etaMin = r.eta_minutes ?? 8;
        const totalMs = (etaMin * 60_000) / Math.max(1, speedMultiplier);
        const t = Math.min(1, (Date.now() - started) / totalMs);
        const pt = sampleAlongPath(r.path, t);
        const ahead = sampleAlongPath(r.path, Math.min(1, t + 0.02));
        const heading = bearing(pt, ahead);
        return (
          <Marker
            key={`vehicle-${r.mission_id}`}
            longitude={pt[1]}
            latitude={pt[0]}
            anchor="center"
          >
            <VehicleIcon
              heading={heading}
              category={r.disaster_type ?? "rescue"}
              arrived={t >= 1}
            />
          </Marker>
        );
      })}
    </>
  );
}

function sampleAlongPath(
  path: Array<[number, number]>,
  t: number,
): [number, number] {
  if (path.length === 1) return path[0];
  const seg = (path.length - 1) * t;
  const i = Math.floor(seg);
  const frac = seg - i;
  if (i >= path.length - 1) return path[path.length - 1];
  const a = path[i];
  const b = path[i + 1];
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
}

function bearing(a: [number, number], b: [number, number]): number {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/* ────────────────────────────────────────────────────────────────
 * <CinemaPinShell>
 * Wraps the existing IncidentGlyph with a cinema-only shimmer halo
 * and a live ETA countdown badge. Shimmer is a slowly rotating conic
 * gradient ring; ETA badge ticks down every second while en-route,
 * pinning at "ON SITE" when arrived (status flips to on_site) or at
 * the original ETA otherwise.
 */

interface CinemaPinShellProps {
  status: string;
  severity: number;
  /** retained for future tinting hook; currently unused */
  disasterType?: string;
  etaMinutes: number | null;
  children: React.ReactNode;
}

export function CinemaPinShell({
  status,
  severity,
  etaMinutes,
  children,
}: CinemaPinShellProps) {
  const enRoute = status === "en_route";
  const onSite = status === "on_site";
  const tint =
    severity >= 5
      ? "#ef4444"
      : severity >= 4
        ? "#fb923c"
        : severity >= 3
          ? "#facc15"
          : "#6BBD95";

  // Live ETA countdown. We compress the ETA to a 60s demo window per
  // minute so a 14-minute ETA reads down in 14s — proportional and
  // dramatic. If the recording's eta_minutes is missing we just show "—".
  const startedAt = useRef<number>(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enRoute) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [enRoute]);

  let etaBadge: string;
  if (onSite) {
    etaBadge = "ON SITE";
  } else if (typeof etaMinutes !== "number") {
    etaBadge = "—";
  } else {
    const totalMs = (etaMinutes / 60) * 60_000; // 1 ETA-minute → 1 demo-second
    const remain = Math.max(0, totalMs - (now - startedAt.current));
    const remainMin = remain / 60_000 / (1 / 60); // back-translate to ETA-minutes
    etaBadge =
      remainMin >= 1
        ? `${Math.ceil(remainMin)} min`
        : remain > 0
          ? `${Math.ceil(remain / 1000)}s`
          : "ARRIVING";
  }

  return (
    <div
      style={{
        position: "relative",
        width: 0,
        height: 0,
      }}
    >
      {/* Shimmer halo — only while en_route */}
      {enRoute && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: -22,
            top: -22,
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: `conic-gradient(from 0deg, ${tint}00, ${tint}aa, ${tint}00)`,
            animation: "cinemaSpin 2.4s linear infinite",
            opacity: 0.7,
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "relative" }}>{children}</div>
      {/* ETA badge */}
      {(enRoute || onSite) && (
        <div
          style={{
            position: "absolute",
            left: 14,
            top: -4,
            background: onSite ? "#6BBD95" : "rgba(14,22,18,0.95)",
            color: onSite ? "#0a0a0a" : "#E8E2D2",
            border: `1px solid ${tint}`,
            fontFamily: "var(--font-mono), monospace",
            fontSize: 10,
            letterSpacing: ".12em",
            padding: "2px 6px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {etaBadge}
        </div>
      )}
    </div>
  );
}

function VehicleIcon({
  heading,
  category,
  arrived,
}: {
  heading: number;
  category: string;
  arrived: boolean;
}) {
  const tint =
    category === "medical"
      ? "#f472b6"
      : category === "fire" || category === "vehicle_accident"
        ? "#fb923c"
        : category === "tree_fall" || category === "road_block"
          ? "#facc15"
          : "#6BBD95";
  return (
    <div
      style={{
        position: "relative",
        width: 0,
        height: 0,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -14,
          top: -14,
          width: 28,
          height: 28,
          background: tint,
          borderRadius: "50%",
          border: "2px solid #0E1612",
          transform: `rotate(${heading}deg)`,
          boxShadow: arrived
            ? `0 0 18px ${tint}`
            : `0 0 10px rgba(0,0,0,0.6)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "box-shadow 240ms ease",
        }}
      >
        {/* Chevron pointing direction of travel */}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <polygon
            points="7,1 12,11 7,8 2,11"
            fill="#0E1612"
            stroke="#0E1612"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {arrived && (
        <div
          style={{
            position: "absolute",
            left: 18,
            top: -10,
            background: "#6BBD95",
            color: "#0a0a0a",
            fontFamily: "var(--font-mono), monospace",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: ".14em",
            padding: "2px 6px",
            border: "1px solid #0a0a0a",
          }}
        >
          ON SITE
        </div>
      )}
    </div>
  );
}
