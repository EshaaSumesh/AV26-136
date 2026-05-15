"use client";

/**
 * MapView — operations-console map.
 *
 * Renders:
 *   • Hazard rings (circle layer)
 *   • One primary route per active mission, drawn as a single solid line
 *     in the agent's accent color, with a dark outline beneath for legibility.
 *     The destination end gets an arrowhead marker so direction is obvious.
 *     A monospace `ETA · KM` badge sits at the route midpoint.
 *   • Base origin markers (square) and incident destination markers (circle).
 *
 * Deliberately spartan: no animated dashes, no glow, no symbol-text layer
 * (Mapbox glyph fonts cause silent render failures), no alternate routes.
 * The route data comes from either:
 *   (a) `liveRoutes` streamed over WS the moment ROUTE_COMPUTED fires, or
 *   (b) the persisted `mission.route_path` from /authority/dashboard
 *       which the page polls every 5s.
 */

import Map, {
  Marker,
  Source,
  Layer,
  NavigationControl,
  Popup,
  useMap,
} from "react-map-gl";
import type { LayerProps } from "react-map-gl";
import { useEffect, useMemo, useState } from "react";
import { MAPBOX_TOKEN, CITY_CENTER } from "@/lib/api";
import type { AgentEvent, HazardZone, Mission } from "@/lib/types";
import {
  AgentBurstLayer,
  AlertRingLayer,
  CameraDirector,
  CinemaPinShell,
  IncidentShockwave,
  VehicleAnimator,
} from "@/components/cinema/CinemaInMap";

interface LiveRoute {
  mission_id?: string | null;
  incident_id?: string | null;
  path: Array<[number, number]>;
  distance_km?: number | null;
  eta_minutes?: number | null;
  candidates?: Array<{
    label: string;
    path: Array<[number, number]>;
    distance_km?: number | null;
    eta_minutes?: number | null;
  }>;
  receivedAt?: number;
}

interface Props {
  hazards: HazardZone[];
  missions: Mission[];
  reportLocation?: [number, number] | null;
  onClickMap?: (lng: number, lat: number) => void;
  selectedMission?: string | null;
  liveRoutes?: LiveRoute[];
  /**
   * `dark` (default) — editorial-dark Monocle palette, used in the
   * authority command centre.
   * `light` — pale civic palette suitable for the citizen-facing
   * page; skips the dark basemap repaint and uses a brighter
   * default Mapbox style.
   *
   * Same component, two surfaces. Saves us a parallel implementation.
   */
  variant?: "dark" | "light";
  /**
   * Optional callback invoked when an incident pin is clicked. If
   * supplied, suppresses the inline popup and lets the parent page
   * render a richer mission-detail drawer instead.
   */
  onMissionClick?: (missionId: string) => void;
  /**
   * Cinema-mode props: when `cinema` is true, the map switches into a
   * theatrical presentation mode with an auto camera tour, incident
   * shockwaves, agent-burst sparks, alert-broadcast rings, and moving
   * vehicle icons. Driven by the live `cinemaEvents` stream so visuals
   * stay in lock-step with the agent ticker.
   */
  cinema?: boolean;
  cinemaEvents?: AgentEvent[];
}

// ── Constants ──────────────────────────────────────────────────

const ROUTE_COLOR = "#6BBD95";       // mint — primary route
const ROUTE_COLOR_SELECT = "#8DDCB1"; // brighter when selected
const HAZARD_COLOR: Record<string, string> = {
  low: "#facc15",
  medium: "#fb923c",
  high: "#f87171",
  critical: "#ef4444",
};

// ── Editorial-dark basemap palette ─────────────────────────────
//
// We start from `mapbox/dark-v11` (which gives us all the layer
// definitions for free) and repaint a curated subset to a Monocle-ish
// dark scheme: ivory-on-deep-navy with warm-grey roads. We deliberately
// don't replace the entire style; we only nudge:
//
//   • land / background → deep, slightly-warm dark
//   • water → deep teal-navy (gives contrast against land)
//   • parks → muted forest
//   • roads (minor) → warm grey, low-contrast
//   • motorways → brighter ivory, this is what you actually navigate by
//   • labels → ivory with a subtle dark halo for legibility
//
// Done by walking the style's layers post-load and using
// `setPaintProperty`. This is robust to Mapbox style updates because we
// match by layer-id substring, not by exact id.
const BASEMAP_PAINT: Array<{
  match: (id: string, type: string) => boolean;
  apply: (id: string) => Array<[string, string | number]>;
}> = [
  {
    // Background land — a deep warm-charcoal, slightly green-tinted to
    // sit nicely with the editorial green accent.
    match: (id, type) => type === "background" || id === "land",
    apply: () => [
      ["background-color", "#0E1612"],
    ],
  },
  {
    // Water — deep teal-navy. Brighter than land so coast lines pop.
    match: (id) => id.startsWith("water") || id === "waterway",
    apply: () => [
      ["fill-color", "#0B2A3A"],
      ["fill-opacity", 1],
    ],
  },
  {
    // Parks / green space — quiet forest tone.
    match: (id) =>
      id.includes("park") ||
      id.includes("vegetation") ||
      id.includes("landuse-park"),
    apply: () => [
      ["fill-color", "#10261C"],
      ["fill-opacity", 0.85],
    ],
  },
  {
    // Buildings — barely-there silhouette.
    match: (id) => id.startsWith("building"),
    apply: () => [
      ["fill-color", "#15201A"],
      ["fill-opacity", 0.7],
    ],
  },
  {
    // Motorways / trunk roads — the navigation arteries. Brighter ivory.
    match: (id) =>
      id.includes("motorway") || id.includes("trunk"),
    apply: () => [
      ["line-color", "#D9D2C3"],
      ["line-opacity", 0.85],
    ],
  },
  {
    // Primary / secondary roads — warm grey.
    match: (id) =>
      id.includes("primary") ||
      id.includes("secondary") ||
      id.includes("tertiary"),
    apply: () => [
      ["line-color", "#6F6A5F"],
      ["line-opacity", 0.7],
    ],
  },
  {
    // Minor / residential roads — barely visible.
    match: (id) =>
      id.includes("street") ||
      id.includes("road-minor") ||
      id.includes("residential"),
    apply: () => [
      ["line-color", "#3A352D"],
      ["line-opacity", 0.6],
    ],
  },
  {
    // All text labels — ivory with a quiet dark halo so they read on
    // any background. We match `symbol`-type layers conservatively so
    // we don't accidentally restyle anything else.
    match: (id, type) =>
      type === "symbol" &&
      (id.includes("label") || id.includes("place") || id.includes("road-name")),
    apply: () => [
      ["text-color", "#E8E2D2"],
      ["text-halo-color", "#0E1612"],
      ["text-halo-width", 1.2],
    ],
  },
];

/**
 * RouteFlowAnimator — drives the per-frame dash-offset animation that
 * makes the white "flow" line appear to travel from origin to
 * destination along the route. Mapbox doesn't expose a `line-dashoffset`
 * directly, but the same effect is achievable by rotating the
 * `line-dasharray` pattern through a list of offset variants.
 *
 * The pattern is a short solid + a long gap; we cycle a step counter and
 * pick one of N pre-rolled dash arrays. Cheaper and smoother than
 * recomputing arrays on the fly.
 *
 * The hook is intentionally tied to the `route-flow` layer's lifecycle:
 * if the layer doesn't exist yet (style still loading, or no routes),
 * it just no-ops until it does.
 */
function RouteFlowAnimator() {
  const { current: mapRef } = useMap();
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    // Pre-rolled dash patterns. Each step = 0.2 of a unit shifted along
    // the [solid, gap] pattern; over `STEPS` steps we complete a full
    // cycle (so the animation seamlessly loops).
    const STEPS = 10;
    const patterns: number[][] = [];
    for (let i = 0; i < STEPS; i++) {
      const shift = i * 0.26;
      // The dash array sums to 2.6 so a 0.26 shift advances by 1/10th.
      patterns.push([0.4, 0.5 + shift, 0.4, 1.7 - shift]);
    }

    let raf = 0;
    let step = 0;
    let lastTick = 0;

    const tick = (t: number) => {
      // ~6 fps is plenty for this — smooth-looking flow without burning CPU.
      if (t - lastTick > 160) {
        lastTick = t;
        safeSetPaint(
          map,
          "route-flow",
          "line-dasharray",
          patterns[step % STEPS],
        );
        step++;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapRef]);

  return null;
}

/**
 * Shared epoch — captured at module load. Every pulse animator measures
 * phase as `(now - PULSE_EPOCH) % period`, so any two animators whose
 * `period` values are integer multiples will reach phase 0
 * simultaneously. This is what makes critical (1500ms) and high
 * (4500ms = 3× critical) lock-step instead of drifting independently.
 */
const PULSE_EPOCH =
  typeof performance !== "undefined" ? performance.now() : 0;

/**
 * safeSetPaint — Mapbox's `setPaintProperty` throws a confusing
 * `getOwnLayer` TypeError if you call it while the style is mid-load
 * or being rebuilt. The throw happens inside Mapbox's own code before
 * any of the public guards (`isStyleLoaded`, `getLayer(...)`) help,
 * which is why a defensive try/catch is required at every call site.
 *
 * This wrapper centralises the safety dance:
 *   1. Bail if the map is unset.
 *   2. Bail if the style isn't fully loaded.
 *   3. Bail if the layer doesn't exist yet.
 *   4. Catch any residual throw silently — they're transient.
 *
 * Returns `true` if the property was actually applied, `false`
 * otherwise (useful for telemetry / debugging if this ever needs it).
 */
// `any` here is intentional: the underlying Mapbox map handle has a
// rich type, but we only touch a small surface and adding the
// @types/mapbox-gl dependency for one helper isn't worth the ceremony.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapHandle = any;

function safeSetPaint(
  map: MapHandle,
  layerId: string,
  property: string,
  value: unknown,
): boolean {
  if (!map) return false;
  try {
    if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) {
      return false;
    }
    if (!map.getLayer || !map.getLayer(layerId)) return false;
    map.setPaintProperty(layerId, property, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * HazardPulseAnimator — drives an expand-and-fade pulse on a single
 * Mapbox circle layer. Used for both the slow `high` pulse and the
 * fast `critical` pulse with different parameters, so a critical
 * hazard reads as visually more urgent than a high hazard.
 *
 * `periodMs`        — full pulse cycle. Smaller = faster.
 *                      Choose values that are integer multiples of each
 *                      other so multiple animators stay in sync (see
 *                      `PULSE_EPOCH` above).
 * `radiusMax`       — peak radius of the expanding ring.
 * `fillOpacityMax`  — peak fill opacity (start of cycle).
 * `strokeOpacityMax`— peak stroke opacity (start of cycle).
 *
 * Uses requestAnimationFrame at ~12 fps — smooth enough to read as a
 * radar sweep, light enough that it's invisible in the profiler.
 */
function HazardPulseAnimator({
  layerId,
  periodMs,
  radiusMax,
  fillOpacityMax,
  strokeOpacityMax,
}: {
  layerId: string;
  periodMs: number;
  radiusMax: number;
  fillOpacityMax: number;
  strokeOpacityMax: number;
}) {
  const { current: mapRef } = useMap();
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const RADIUS_MIN = 8;

    let raf = 0;
    let lastTick = 0;

    const tick = (t: number) => {
      if (t - lastTick > 80) {
        lastTick = t;
        // Phase is measured against the shared module-load epoch so any
        // two animators whose periods are integer multiples reach phase
        // 0 at the same instant. A naive `t % periodMs` works the same
        // arithmetically (epoch cancels), but expressing it this way
        // makes the synchronisation contract explicit.
        const phase = ((t - PULSE_EPOCH) % periodMs) / periodMs; // 0..1
        // Ease-out for a "ping" feel.
        const eased = 1 - Math.pow(1 - phase, 2);
        const radius = RADIUS_MIN + (radiusMax - RADIUS_MIN) * eased;
        const fillOpacity = (1 - phase) * fillOpacityMax;
        const strokeOpacity = (1 - phase) * strokeOpacityMax;
        safeSetPaint(map, layerId, "circle-radius", radius);
        safeSetPaint(map, layerId, "circle-opacity", fillOpacity);
        safeSetPaint(map, layerId, "circle-stroke-opacity", strokeOpacity);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapRef, layerId, periodMs, radiusMax, fillOpacityMax, strokeOpacityMax]);

  return null;
}

/**
 * RouteDrawAnimator — when the set of routes changes, animate the
 * `line-trim-offset` on the route stack from `[1, 1]` (nothing) to
 * `[0, 1]` (fully drawn) over ~700ms, then leave it alone. Result: the
 * route visibly "draws in" along its length whenever a new computation
 * lands. Mapbox v3+ supports `line-trim-offset` natively.
 *
 * `routeKey` is a string the parent computes from the current routes
 * (mission ids + path lengths). When it changes, we restart the
 * animation. We trim the glow + outline + primary in lockstep so the
 * whole stack draws in together; the flow layer is left untrimmed
 * because it's visually a moving overlay.
 */
function RouteDrawAnimator({ routeKey }: { routeKey: string }) {
  const { current: mapRef } = useMap();
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const TRIMMED_LAYERS = ["route-glow", "route-outline", "route-primary"];
    const DURATION_MS = 750;

    const setTrim = (start: number) => {
      for (const id of TRIMMED_LAYERS) {
        safeSetPaint(map, id, "line-trim-offset", [start, 1]);
      }
    };

    let raf = 0;
    let cancelled = false;
    const start = performance.now();

    // Make sure the layers exist before we try to animate. If the style
    // hasn't loaded yet we wait for it.
    const begin = () => {
      const tick = (t: number) => {
        if (cancelled) return;
        const elapsed = t - start;
        const phase = Math.min(1, elapsed / DURATION_MS);
        // Ease-out cubic for a satisfying "land" at the end.
        const eased = 1 - Math.pow(1 - phase, 3);
        // trim-start animates from 1 (everything hidden) to 0 (revealed).
        setTrim(1 - eased);
        if (phase < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          // Final state: fully visible. Setting [0, 1] is equivalent to
          // omitting trim, but explicit is clearer.
          setTrim(0);
        }
      };
      raf = requestAnimationFrame(tick);
    };

    if (map.isStyleLoaded()) begin();
    else map.once("style.load", begin);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      // Defensively reset trim on cleanup so a stuck partial draw
      // doesn't persist between key changes.
      setTrim(0);
    };
  }, [mapRef, routeKey]);

  return null;
}

/**
 * EditorialBasemap — listens for the map's `style.load` event and walks
 * the style layers, repainting matching ones to our editorial palette.
 *
 * Why a sub-component? `useMap()` only works inside <Map>. We mount this
 * as a child so it has the map handle. It renders nothing visible.
 */
function EditorialBasemap() {
  const { current: mapRef } = useMap();
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const apply = () => {
      const style = map.getStyle();
      if (!style?.layers) return;
      for (const layer of style.layers) {
        const id = layer.id;
        const type = layer.type;
        for (const rule of BASEMAP_PAINT) {
          if (!rule.match(id, type)) continue;
          for (const [prop, val] of rule.apply(id)) {
            safeSetPaint(map, id, prop, val);
          }
        }
      }
    };

    if (map.isStyleLoaded()) apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [mapRef]);

  return null;
}

// ── Hazard GeoJSON ─────────────────────────────────────────────
//
// We split hazards into two collections:
//   • all hazards   → render the filled zone + bordered circle + centre dot
//   • critical/high → render the animated radar pulse (gets attention)
//
// The pulse layer's `circle-radius` is driven per-frame by
// `useHazardPulse` so it expands and fades from the centre. We only
// pulse the urgent ones; doing it on every hazard would create visual
// noise and defeat the point of "this is what to look at NOW".

function hazardCircleGeoJSON(hazards: HazardZone[]) {
  return {
    type: "FeatureCollection" as const,
    features: hazards
      .filter((h) => h.center && h.radius_km)
      .map((h) => ({
        type: "Feature" as const,
        properties: {
          id: h.id,
          severity: h.severity,
          color: HAZARD_COLOR[h.severity] ?? "#94a3b8",
          radius_m: h.radius_km * 1000,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [h.center[1], h.center[0]],
        },
      })),
  };
}

function hazardPulseGeoJSON(
  hazards: HazardZone[],
  severity: "critical" | "high",
) {
  return {
    type: "FeatureCollection" as const,
    features: hazards
      .filter((h) => h.center && h.severity === severity)
      .map((h) => ({
        type: "Feature" as const,
        properties: {
          id: h.id,
          severity: h.severity,
          color: HAZARD_COLOR[h.severity] ?? "#ef4444",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [h.center[1], h.center[0]],
        },
      })),
  };
}

// Filled zone footprint (the meteorologically "this much area is
// affected" ring). Stronger fill + bolder border than before.
const hazardCircleLayer: LayerProps = {
  id: "hazard-circles",
  type: "circle",
  paint: {
    "circle-radius": [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      8, ["/", ["get", "radius_m"], 200],
      14, ["/", ["get", "radius_m"], 8],
      18, ["/", ["get", "radius_m"], 2],
    ],
    "circle-color": ["get", "color"],
    "circle-opacity": 0.20,
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-opacity": 0.95,
    "circle-stroke-width": 1.5,
  },
};

// Centre dot — anchors the eye to the hazard's exact location even
// when zoomed out.
const hazardCenterLayer: LayerProps = {
  id: "hazard-centers",
  type: "circle",
  paint: {
    "circle-radius": 4,
    "circle-color": ["get", "color"],
    "circle-stroke-color": "#0E1612",
    "circle-stroke-width": 1.5,
  },
};

// Two pulse layers: one slow (high severity), one fast (critical).
// Each is animated by its own animator. Layer ids are distinct so the
// rAF loops can target them independently.
const hazardPulseHighLayer: LayerProps = {
  id: "hazard-pulse-high",
  type: "circle",
  paint: {
    "circle-radius": 8,
    "circle-color": ["get", "color"],
    "circle-opacity": 0,
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-opacity": 0.4,
    "circle-stroke-width": 1.5,
  },
};

const hazardPulseCriticalLayer: LayerProps = {
  id: "hazard-pulse-critical",
  type: "circle",
  paint: {
    "circle-radius": 8,
    "circle-color": ["get", "color"],
    "circle-opacity": 0,
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-opacity": 0.5,
    "circle-stroke-width": 2,
  },
};

// ── Route resolution ───────────────────────────────────────────

interface ResolvedRoute {
  mission: Mission;
  path: Array<[number, number]>;        // [lat, lng] tuples
  distance_km: number | null;
  eta_minutes: number | null;
  baseCoord: [number, number] | null;   // [lat, lng] origin
}

function resolveRoutes(
  missions: Mission[],
  liveRoutes: LiveRoute[] | undefined,
): ResolvedRoute[] {
  // Index live routes by mission_id (latest wins).
  type LiveByMission = globalThis.Map<string, LiveRoute>;
  const liveByMission: LiveByMission = new globalThis.Map();
  (liveRoutes ?? []).forEach((r) => {
    if (!r.mission_id) return;
    const existing = liveByMission.get(r.mission_id);
    if (!existing || (r.receivedAt ?? 0) >= (existing.receivedAt ?? 0)) {
      liveByMission.set(r.mission_id, r);
    }
  });

  const out: ResolvedRoute[] = [];
  for (const m of missions) {
    if (
      m.status === "completed" ||
      m.status === "cancelled" ||
      m.status === "declined"
    ) {
      continue;
    }
    const live = liveByMission.get(m.mission_id);
    let path: Array<[number, number]> | null = null;
    let distance_km: number | null = null;
    let eta_minutes: number | null = null;

    if (live?.path && live.path.length > 1) {
      path = live.path;
      distance_km = live.distance_km ?? null;
      eta_minutes = live.eta_minutes ?? null;
    } else if (m.route_path && m.route_path.length > 1) {
      path = m.route_path as Array<[number, number]>;
      distance_km = m.route_distance_km ?? null;
      eta_minutes = m.route_eta_minutes ?? null;
    }

    if (!path) continue;

    out.push({
      mission: m,
      path,
      distance_km,
      eta_minutes,
      baseCoord: path.length > 0 ? path[0] : null,
    });
  }
  return out;
}

function routeGeoJSON(
  resolved: ResolvedRoute[],
  selectedMission: string | null | undefined,
) {
  return {
    type: "FeatureCollection" as const,
    features: resolved.map((r) => ({
      type: "Feature" as const,
      properties: {
        mission_id: r.mission.mission_id,
        status: r.mission.status,
        selected: selectedMission === r.mission.mission_id ? 1 : 0,
      },
      geometry: {
        type: "LineString" as const,
        // GeoJSON requires [lng, lat] order.
        coordinates: r.path.map(([lat, lng]) => [lng, lat]),
      },
    })),
  };
}

// Route is rendered as a 4-layer stack for visual richness:
//
//   1. routeGlowLayer   — wide soft mint blur, low opacity
//                         ("this artery is live")
//   2. routeOutlineLayer — dark casing for legibility on any basemap
//   3. routePrimaryLayer — solid forest-green core
//   4. routeFlowLayer    — thin white dashed line, dash offset animated
//                         in JS so it appears to flow toward the
//                         destination
//
// Mapbox can't natively animate dash offset, so we set up a rAF loop in
// `useFlowAnimation` below that increments `line-dasharray`'s offset
// every frame.

const routeGlowLayer: LayerProps = {
  id: "route-glow",
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": ROUTE_COLOR,
    "line-width": [
      "case",
      ["==", ["get", "selected"], 1], 11,
      8,
    ],
    "line-opacity": [
      "case",
      ["==", ["get", "selected"], 1], 0.24,
      0.16,
    ],
    "line-blur": 5,
  },
};

const routeOutlineLayer: LayerProps = {
  id: "route-outline",
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#0A1410",
    "line-width": [
      "case",
      ["==", ["get", "selected"], 1], 6,
      5,
    ],
    "line-opacity": 0.9,
  },
};

const routePrimaryLayer: LayerProps = {
  id: "route-primary",
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": [
      "case",
      ["==", ["get", "selected"], 1], ROUTE_COLOR_SELECT,
      ROUTE_COLOR,
    ],
    "line-width": [
      "case",
      ["==", ["get", "selected"], 1], 4,
      3.5,
    ],
    "line-opacity": 1,
  },
};

// The flow layer's dash array is set per-frame by `useFlowAnimation`.
// We give it a sensible default so SSR doesn't render an empty paint.
const routeFlowLayer: LayerProps = {
  id: "route-flow",
  type: "line",
  layout: { "line-cap": "butt", "line-join": "round" },
  paint: {
    "line-color": "#FFFFFF",
    "line-width": [
      "case",
      ["==", ["get", "selected"], 1], 2.4,
      2,
    ],
    "line-opacity": 0.85,
    "line-dasharray": [0.4, 2.2],
  },
};

// ── ETA badge marker (HTML, no Mapbox glyph dependency) ───────

function midpoint(path: Array<[number, number]>): [number, number] | null {
  if (!path || path.length < 2) return null;
  // Walk to ~50% cumulative distance for a more honest midpoint than
  // simply path[Math.floor(N/2)] (which biases toward dense node clusters).
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversine(path[i - 1], path[i]);
  }
  if (total === 0) return path[Math.floor(path.length / 2)];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = haversine(path[i - 1], path[i]);
    if (walked + seg >= total / 2) {
      const t = (total / 2 - walked) / seg;
      const [a, b] = [path[i - 1], path[i]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += seg;
  }
  return path[Math.floor(path.length / 2)];
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function bearing(a: [number, number], b: [number, number]): number {
  // a, b in [lat, lng]
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// ── Component ──────────────────────────────────────────────────

export default function MapView({
  hazards,
  missions,
  reportLocation,
  onClickMap,
  selectedMission,
  liveRoutes,
  variant = "dark",
  onMissionClick,
  cinema = false,
  cinemaEvents = [],
}: Props) {
  const isLight = variant === "light";
  const [popup, setPopup] = useState<{
    lng: number;
    lat: number;
    title: string;
    body: string;
  } | null>(null);

  const hazardData = useMemo(() => hazardCircleGeoJSON(hazards), [hazards]);
  const hazardPulseHighData = useMemo(
    () => hazardPulseGeoJSON(hazards, "high"),
    [hazards],
  );
  const hazardPulseCriticalData = useMemo(
    () => hazardPulseGeoJSON(hazards, "critical"),
    [hazards],
  );
  const resolvedRoutes = useMemo(
    () => resolveRoutes(missions, liveRoutes),
    [missions, liveRoutes],
  );

  // Map of incident_id → [lat, lng] so cinema-mode agent bursts can
  // fire at the right spot even when the triggering reasoning event
  // doesn't carry coordinates of its own (most don't).
  const incidentCoords = useMemo(() => {
    const map = new globalThis.Map<string, [number, number]>();
    for (const m of missions) {
      if (m.incident_id && m.incident_coordinates?.length === 2) {
        map.set(m.incident_id, [
          m.incident_coordinates[0],
          m.incident_coordinates[1],
        ]);
      }
    }
    // Also harvest from raw cinema events themselves — citizen reports
    // know their own coords and run before the mission is created.
    for (const ev of cinemaEvents) {
      const inc = ev.payload?.incident_id as string | undefined;
      const c = ev.payload?.coordinates as [number, number] | undefined;
      if (inc && c && c.length === 2 && !map.has(inc)) {
        map.set(inc, [c[0], c[1]]);
      }
    }
    return map;
  }, [missions, cinemaEvents]);

  const cinemaRoutes = useMemo(
    () =>
      resolvedRoutes
        .filter((r) => r.path && r.path.length >= 2)
        .map((r) => ({
          mission_id: r.mission.mission_id,
          path: r.path,
          eta_minutes: r.eta_minutes ?? null,
          disaster_type: r.mission.disaster_type,
          status: r.mission.status,
        })),
    [resolvedRoutes],
  );
  const routeData = useMemo(
    () => routeGeoJSON(resolvedRoutes, selectedMission),
    [resolvedRoutes, selectedMission],
  );

  // Route key — a fingerprint of the current routes. When this changes,
  // the draw-in animation re-runs. We deliberately exclude
  // `selectedMission` (clicking a mission shouldn't retrigger a draw)
  // but we DO include a small fingerprint of the path geometry so a
  // re-routed mission with the same waypoint count still triggers a
  // redraw. We sample 3 waypoints (start / middle / end) and round to
  // 4 decimal places (~10m) — enough resolution to detect real changes
  // and stable enough that floating-point jitter doesn't cause a
  // spurious replay.
  const routeKey = useMemo(
    () =>
      resolvedRoutes
        .map((r) => {
          const p = r.path;
          if (p.length === 0) return `${r.mission.mission_id}:0`;
          const fp = (idx: number) => {
            const pt = p[Math.min(idx, p.length - 1)];
            return `${pt[0].toFixed(4)},${pt[1].toFixed(4)}`;
          };
          const sample = `${fp(0)};${fp(Math.floor(p.length / 2))};${fp(p.length - 1)}`;
          return `${r.mission.mission_id}:${p.length}:${sample}`;
        })
        .join("|"),
    [resolvedRoutes],
  );

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full items-center justify-center bg-onyx text-[11px] font-mono uppercase tracking-[.18em] text-steel-light">
        Missing Mapbox token — set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={
          isLight
            ? "mapbox://styles/mapbox/light-v11"
            : "mapbox://styles/mapbox/dark-v11"
        }
        initialViewState={{
          longitude: CITY_CENTER[0],
          latitude: CITY_CENTER[1],
          zoom: 11.5,
        }}
        style={{ width: "100%", height: "100%" }}
        onClick={(e) => onClickMap?.(e.lngLat.lng, e.lngLat.lat)}
      >
        {!isLight && <EditorialBasemap />}
        <RouteFlowAnimator />
        <RouteDrawAnimator routeKey={routeKey} />
        {/* Slow, calm pulse for `high` zones — radar sweep feel.
            Period is exactly 3× the critical period so the two stay in
            lock-step: every third critical pulse coincides with one
            high pulse, making the rhythm read as related rather than
            chaotic. */}
        <HazardPulseAnimator
          layerId="hazard-pulse-high"
          periodMs={4500}
          radiusMax={34}
          fillOpacityMax={0.32}
          strokeOpacityMax={0.5}
        />
        {/* Fast, urgent pulse for `critical` zones — bigger and sharper.
            See note above on the high pulse: 1500ms × 3 = 4500ms. */}
        <HazardPulseAnimator
          layerId="hazard-pulse-critical"
          periodMs={1500}
          radiusMax={42}
          fillOpacityMax={0.5}
          strokeOpacityMax={0.7}
        />
        <NavigationControl position="top-right" showCompass={false} />

      {/* Hazards: pulses (under, severity-split) → filled zone → centre dot.
          The critical layer is drawn after the high one so its pulse renders
          on top in the rare case both share a centre. */}
      <Source id="hazards-pulse-high" type="geojson" data={hazardPulseHighData}>
        <Layer {...hazardPulseHighLayer} />
      </Source>
      <Source
        id="hazards-pulse-critical"
        type="geojson"
        data={hazardPulseCriticalData}
      >
        <Layer {...hazardPulseCriticalLayer} />
      </Source>
      <Source id="hazards" type="geojson" data={hazardData}>
        <Layer {...hazardCircleLayer} />
        <Layer {...hazardCenterLayer} />
      </Source>

      {/* Route stack: glow (under) → outline → primary → animated flow (over).
          Order matters; Mapbox renders later layers on top. */}
      <Source id="routes" type="geojson" data={routeData}>
        <Layer {...routeGlowLayer} />
        <Layer {...routeOutlineLayer} />
        <Layer {...routePrimaryLayer} />
        <Layer {...routeFlowLayer} />
      </Source>

      {/* Per-route HTML markers: origin pin, ETA midpoint, dest arrowhead. */}
      {resolvedRoutes.map((r) => {
        const isSelected = r.mission.mission_id === selectedMission;
        const color = isSelected ? ROUTE_COLOR_SELECT : ROUTE_COLOR;

        const origin = r.baseCoord;
        const dest = r.path[r.path.length - 1];
        const mid = midpoint(r.path);
        const arrowAnchor = r.path[Math.max(0, r.path.length - 2)];
        const arrowHeading = bearing(arrowAnchor, dest);

        const etaText =
          (typeof r.eta_minutes === "number"
            ? `${Math.round(r.eta_minutes)} min`
            : "—") +
          (typeof r.distance_km === "number"
            ? `  ·  ${r.distance_km.toFixed(1)} km`
            : "");

        return (
          <RouteMarkers
            key={r.mission.mission_id}
            origin={origin}
            mid={mid}
            dest={dest}
            arrowHeading={arrowHeading}
            color={color}
            etaText={etaText}
            label={r.mission.assigned_base_name ?? "Base"}
          />
        );
      })}

      {/* Incident markers — status-coded glyphs per mission.
          Completed/cancelled/declined missions are excluded so the map
          doesn't accumulate dead pins; the missions panel still lists
          them in the resolved tally. */}
      {missions
        .filter(
          (m) =>
            m.status !== "completed" &&
            m.status !== "cancelled" &&
            m.status !== "declined",
        )
        .map((m) => (
          <Marker
            key={`incident-${m.mission_id}`}
            longitude={m.incident_coordinates[1]}
            latitude={m.incident_coordinates[0]}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              if (onMissionClick) {
                onMissionClick(m.mission_id);
                return;
              }
              setPopup({
                lng: m.incident_coordinates[1],
                lat: m.incident_coordinates[0],
                title: `${m.disaster_type.toUpperCase()} · sev ${m.severity}`,
                body: `${m.assigned_base_name ?? "Unassigned"} · ${m.status.replace("_", " ")}`,
              });
            }}
          >
            {cinema ? (
              <CinemaPinShell
                status={m.status}
                severity={m.severity}
                disasterType={m.disaster_type}
                etaMinutes={m.route_eta_minutes ?? null}
              >
                <IncidentGlyph
                  status={m.status}
                  severity={m.severity}
                  label={m.disaster_type}
                  eta={m.route_eta_minutes ?? null}
                  disasterType={m.disaster_type}
                />
              </CinemaPinShell>
            ) : (
              <IncidentGlyph
                status={m.status}
                severity={m.severity}
                label={m.disaster_type}
                eta={m.route_eta_minutes ?? null}
                disasterType={m.disaster_type}
              />
            )}
          </Marker>
        ))}

      {reportLocation && (
        <Marker
          longitude={reportLocation[0]}
          latitude={reportLocation[1]}
          anchor="center"
        >
          <div
            className="h-3 w-3 border border-onyx"
            style={{ background: "#5eead4" }}
          />
        </Marker>
      )}

      {popup && (
        <Popup
          longitude={popup.lng}
          latitude={popup.lat}
          onClose={() => setPopup(null)}
          anchor="bottom"
          closeButton={false}
        >
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-admin-text">
              {popup.title}
            </div>
            <div className="text-[11px] text-steel-light">{popup.body}</div>
          </div>
        </Popup>
      )}

      {/* Cinema-mode FX. All sub-components are no-ops while !cinema. */}
      {cinema && (
        <>
          <CameraDirector
            events={cinemaEvents}
            active={cinema}
            cityCenter={CITY_CENTER}
          />
          <IncidentShockwave events={cinemaEvents} />
          <AgentBurstLayer
            events={cinemaEvents}
            incidentCoords={incidentCoords}
          />
          <AlertRingLayer events={cinemaEvents} />
          <VehicleAnimator routes={cinemaRoutes} />
        </>
      )}
      </Map>

      {/* Subtle vignette over the map edges — gives depth and makes the
          chrome on the page feel like it's framing the map rather than
          sitting flat next to it. We use a much softer vignette on the
          light variant so it doesn't bruise the pale civic palette. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          boxShadow: isLight
            ? "inset 0 0 60px 0 rgba(20,61,46,0.10)"
            : "inset 0 0 80px 0 rgba(0,0,0,0.55)",
        }}
      />

      {/* Compass + city cartouche are editorial chrome and look out of
          place on the light civic basemap, so we only render them on
          the dark variant. The citizen page has its own simpler tip
          card overlay anyway. */}
      {!isLight && <CompassRosette />}
      {!isLight && <CityCartouche />}
    </div>
  );
}

// ── Compass rosette ────────────────────────────────────────────

function CompassRosette() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 select-none">
      <div className="border border-[#3A352D] bg-[#0E1612]/80 px-2 py-1.5 backdrop-blur-[1px]">
        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
          {/* Hairline outer circle */}
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="#6F6A5F"
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          {/* North arrow — taller and lighter; this is the only thing
              that's visually loud on the rosette. */}
          <polygon
            points="18,3 21,17 18,15 15,17"
            fill="#E8E2D2"
            stroke="#0E1612"
            strokeWidth="0.5"
          />
          {/* South lobe — quiet counterweight */}
          <polygon
            points="18,33 20,21 18,23 16,21"
            fill="#3A352D"
          />
          {/* Cardinal letters */}
          <text
            x="18"
            y="2.5"
            textAnchor="middle"
            dominantBaseline="hanging"
            fill="#E8E2D2"
            style={{
              fontFamily: "var(--font-serif), Georgia, serif",
              fontSize: 7,
              fontWeight: 600,
              letterSpacing: "0.08em",
            }}
          >
            N
          </text>
        </svg>
      </div>
      <div className="mt-1 text-center font-serif italic text-[10px] text-[#A9C2B5]">
        true north
      </div>
    </div>
  );
}

// ── City cartouche ─────────────────────────────────────────────

function CityCartouche() {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 select-none border border-[#3A352D] bg-[#0E1612]/80 px-3 py-1.5 backdrop-blur-[1px]">
      <div
        className="font-serif text-[12px] tracking-[.04em]"
        style={{ color: "#E8E2D2" }}
      >
        <span style={{ fontStyle: "italic" }}>Bengaluru</span>
        <span style={{ color: "#6F6A5F" }}> · Karnataka</span>
      </div>
      <div
        className="font-mono text-[9px]"
        style={{
          color: "#A9C2B5",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.04em",
        }}
      >
        {CITY_CENTER[1].toFixed(2)}°N · {CITY_CENTER[0].toFixed(2)}°E
      </div>
    </div>
  );
}

// ── Per-route marker bundle ────────────────────────────────────

function RouteMarkers({
  origin,
  mid,
  color,
  etaText,
  label,
}: {
  origin: [number, number] | null;
  mid: [number, number] | null;
  /** dest + arrowHeading retained on the props type for backwards compat
   *  but no longer rendered — the incident glyph anchors the destination
   *  end of the route now. */
  dest: [number, number] | null;
  arrowHeading: number;
  color: string;
  etaText: string;
  label: string;
}) {
  return (
    <>
      {/* Origin (rescue base): small ivory diamond rotated 45° with a
          colour-tinted core, plus a serif italic label tail to the right
          showing the base name. Reads as "this is where help departs". */}
      {origin && (
        <Marker longitude={origin[1]} latitude={origin[0]} anchor="center">
          <div className="flex items-center gap-1.5">
            <div
              title={label}
              className="h-3 w-3"
              style={{
                background: color,
                border: "1.5px solid #0E1612",
                boxShadow: `0 0 0 1px ${color}`,
                transform: "rotate(45deg)",
              }}
            />
            <span
              className="select-none whitespace-nowrap font-serif italic"
              style={{
                color: "#E8E2D2",
                fontSize: 11,
                textShadow: "0 1px 2px rgba(0,0,0,0.7)",
                pointerEvents: "none",
              }}
            >
              {label}
            </span>
          </div>
        </Marker>
      )}

      {/* ETA midpoint badge — editorial pull-quote: paper card, hairline
          border, tabular mono numbers. Doesn't intercept clicks. */}
      {mid && etaText && (
        <Marker
          longitude={mid[1]}
          latitude={mid[0]}
          anchor="center"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="select-none whitespace-nowrap border bg-[#0E1612]/95 px-2 py-[3px] font-mono text-[10px] tracking-[.04em]"
            style={{
              borderColor: color,
              color: "#E8E2D2",
              fontVariantNumeric: "tabular-nums",
              boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
            }}
          >
            {etaText}
          </div>
        </Marker>
      )}
    </>
  );
}

// ── Incident glyph (mission destination, status-coded) ─────────
//
// The glyph is the click-target for the incident popup. Each status
// reads as a different operational state:
//
//   negotiating → hollow ring, amber. "Asking who can take this."
//   accepted    → filled square. "A base has agreed."
//   en_route    → solid disc with a slow pulse. "On the move."
//   on_site     → reticle / target. "Crew is there."
//   default     → filled square in red/amber by severity.
//
// All glyphs are drawn with inline SVG so they layer cleanly without
// pulling in lucide React icons (which don't accept arbitrary fill
// expressions and add tree-shaking weight).

const STATUS_COLOR: Record<string, string> = {
  negotiating: "#D4A017",  // editorial amber
  accepted:    "#2E8B63",  // mid green
  en_route:    "#1A5C41",  // forest green (= safety-org)
  on_site:     "#0F4D2C",  // deep green
};

/**
 * Per-category visual identity. Each disaster type gets:
 *   - a tint colour for the chassis (lets the eye triage by type),
 *   - a tiny pictogram drawn in the center of the chassis (clarifies
 *     the type at a glance, useful when many pins are on screen).
 *
 * The chassis SHAPE still encodes status (ring / square / disc /
 * reticle) so the user can read both axes — what kind of incident,
 * and what stage in the dispatch lifecycle — without a popup.
 *
 * Pictograms are inline SVG paths because we want them to inherit
 * stroke width and colour from the parent and tint nicely against
 * any chassis colour.
 */
type CategoryStyle = {
  /** Chassis tint. Used as the chassis stroke + fill base. */
  tint: string;
  /** Tiny pictogram drawn at the centre of the chassis. */
  pictogram: (color: string) => React.ReactNode;
};

const CATEGORY_STYLE: Record<string, CategoryStyle> = {
  flood: {
    tint: "#3A7CA5",
    pictogram: (c) => (
      // Water droplet
      <path
        d="M5 1.5 C5 1.5 2 4.5 2 6.5 C2 8.2 3.4 9.5 5 9.5 C6.6 9.5 8 8.2 8 6.5 C8 4.5 5 1.5 5 1.5 Z"
        fill={c}
        stroke="none"
      />
    ),
  },
  fire: {
    tint: "#E26B1A",
    pictogram: (c) => (
      // Flame
      <path
        d="M5 1 C5 3 3 4 3 6 C3 8 4 9.5 5 9.5 C6 9.5 7 8 7 6.5 C7 5.5 6 5 6 4 C6 3 5 1 5 1 Z"
        fill={c}
        stroke="none"
      />
    ),
  },
  building_collapse: {
    tint: "#7C5A36",
    pictogram: (c) => (
      // Tilted brick stack
      <g fill={c} stroke="none">
        <rect x="2" y="6" width="3" height="2.5" transform="rotate(-12 3.5 7.25)" />
        <rect x="5" y="5" width="3" height="2.5" transform="rotate(8 6.5 6.25)" />
        <rect x="3" y="3" width="3" height="2.5" transform="rotate(-5 4.5 4.25)" />
      </g>
    ),
  },
  medical: {
    tint: "#C53030",
    pictogram: (c) => (
      // Plus / red cross
      <g fill={c} stroke="none">
        <rect x="4.2" y="1.5" width="1.6" height="7" />
        <rect x="1.5" y="4.2" width="7" height="1.6" />
      </g>
    ),
  },
  road_accident: {
    tint: "#9B59B6",
    pictogram: (c) => (
      // Crash-impact starburst
      <g stroke={c} strokeWidth="1" strokeLinecap="round" fill="none">
        <line x1="5" y1="1" x2="5" y2="3.5" />
        <line x1="5" y1="6.5" x2="5" y2="9" />
        <line x1="1" y1="5" x2="3.5" y2="5" />
        <line x1="6.5" y1="5" x2="9" y2="5" />
        <line x1="2" y1="2" x2="3.5" y2="3.5" />
        <line x1="6.5" y1="6.5" x2="8" y2="8" />
        <line x1="8" y1="2" x2="6.5" y2="3.5" />
        <line x1="3.5" y1="6.5" x2="2" y2="8" />
      </g>
    ),
  },
  vehicle_accident: {
    tint: "#9B59B6",
    pictogram: (c) => (
      <g stroke={c} strokeWidth="1" strokeLinecap="round" fill="none">
        <line x1="5" y1="1" x2="5" y2="3.5" />
        <line x1="5" y1="6.5" x2="5" y2="9" />
        <line x1="1" y1="5" x2="3.5" y2="5" />
        <line x1="6.5" y1="5" x2="9" y2="5" />
      </g>
    ),
  },
  gas_leak: {
    tint: "#E2C44A",
    pictogram: (c) => (
      // Three rising wisps
      <g stroke={c} strokeWidth="1" strokeLinecap="round" fill="none">
        <path d="M3 8 C3.5 6.5 2.5 5.5 3.2 4 C3.7 3 3 2 3 1" />
        <path d="M5 8 C5.5 6.5 4.5 5.5 5.2 4 C5.7 3 5 2 5 1" />
        <path d="M7 8 C7.5 6.5 6.5 5.5 7.2 4 C7.7 3 7 2 7 1" />
      </g>
    ),
  },
  earthquake: {
    tint: "#A0522D",
    pictogram: (c) => (
      // Seismic zigzag
      <polyline
        points="1,5 2.2,3 3.4,7 4.6,2 5.8,8 7,3 8.2,5 9,4"
        fill="none"
        stroke={c}
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    ),
  },
  landslide: {
    tint: "#8B6F47",
    pictogram: (c) => (
      // Tumbling rocks
      <g fill={c} stroke="none">
        <polygon points="1,8 3,5 4.5,8" />
        <polygon points="4,7 6,4 7.8,7" />
        <polygon points="6.5,8 8.2,6 9,8" />
      </g>
    ),
  },
  electrocution: {
    tint: "#F5C518",
    pictogram: (c) => (
      // Lightning bolt
      <polygon
        points="5.5,1 2.5,5.5 4.8,5.5 4,9 7.5,4.5 5.2,4.5 6,1"
        fill={c}
        stroke="none"
      />
    ),
  },
  tree_fall: {
    tint: "#3F7042",
    pictogram: (c) => (
      // Leaning tree
      <g fill={c} stroke="none">
        <rect
          x="4.4"
          y="4"
          width="1.2"
          height="5"
          transform="rotate(-22 5 6.5)"
        />
        <circle cx="3.5" cy="3.5" r="2" />
      </g>
    ),
  },
};

const CATEGORY_FALLBACK: CategoryStyle = {
  tint: "#7C8FA1",
  pictogram: (c) => (
    <circle cx="5" cy="5" r="1.6" fill={c} />
  ),
};

function categoryStyleFor(disasterType: string | undefined | null): CategoryStyle {
  if (!disasterType) return CATEGORY_FALLBACK;
  return CATEGORY_STYLE[disasterType] ?? CATEGORY_FALLBACK;
}

function IncidentGlyph({
  status,
  severity,
  label,
  eta,
  disasterType,
}: {
  status: string;
  severity: number;
  label: string;
  eta: number | null;
  disasterType?: string | null;
}) {
  // Status drives the chassis colour by default, but if we have a
  // category style we let it tint the chassis when the status is
  // 'negotiating' or 'accepted' (low-energy states). For en_route
  // and on_site we want the high-contrast status colour to dominate
  // because those states are the urgent ones.
  const cat = categoryStyleFor(disasterType);
  const statusColor = STATUS_COLOR[status] ?? (severity >= 4 ? "#A51C1C" : "#D4A017");
  const chassisColor =
    status === "en_route" || status === "on_site" ? statusColor : cat.tint;
  const color = chassisColor;
  const ink = "#0E1612";

  let svg: React.ReactNode;
  switch (status) {
    case "negotiating":
      // Hollow ring — "we're asking around".
      svg = (
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle
            cx="9"
            cy="9"
            r="6"
            fill="none"
            stroke={color}
            strokeWidth="2"
          />
          <circle cx="9" cy="9" r="1.6" fill={color} />
        </svg>
      );
      break;
    case "accepted":
      // Filled square (slight rotation feels less stamp-like).
      svg = (
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect
            x="3"
            y="3"
            width="10"
            height="10"
            fill={color}
            stroke={ink}
            strokeWidth="1.5"
          />
        </svg>
      );
      break;
    case "en_route":
      // Solid disc with a thin halo.
      svg = (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke={color}
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          <circle
            cx="10"
            cy="10"
            r="5"
            fill={color}
            stroke={ink}
            strokeWidth="1.5"
          />
        </svg>
      );
      break;
    case "on_site":
      // Reticle / target — boots are on the ground.
      svg = (
        <svg width="22" height="22" viewBox="0 0 22 22">
          <circle
            cx="11"
            cy="11"
            r="8"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
          />
          <line x1="11" y1="1" x2="11" y2="5" stroke={color} strokeWidth="1.5" />
          <line x1="11" y1="17" x2="11" y2="21" stroke={color} strokeWidth="1.5" />
          <line x1="1" y1="11" x2="5" y2="11" stroke={color} strokeWidth="1.5" />
          <line x1="17" y1="11" x2="21" y2="11" stroke={color} strokeWidth="1.5" />
          <circle cx="11" cy="11" r="2" fill={color} />
        </svg>
      );
      break;
    default:
      svg = (
        <svg width="14" height="14" viewBox="0 0 14 14">
          <rect
            x="2"
            y="2"
            width="10"
            height="10"
            fill={color}
            stroke={ink}
            strokeWidth="1"
          />
        </svg>
      );
  }

  // The category pictogram is overlaid on top of the chassis in a
  // fixed 10×10 viewport so its proportions are stable regardless of
  // chassis size. We invert the pictogram colour against filled
  // chassis (accepted/en_route/on_site) and use the tint against
  // hollow ones (negotiating, default).
  const filledChassis =
    status === "accepted" ||
    status === "en_route" ||
    status === "on_site";
  const pictogramColor = filledChassis ? "#F4EFE2" : cat.tint;
  const chassisOverlay = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10">
        {cat.pictogram(pictogramColor)}
      </svg>
    </div>
  );

  // Wrap in a row that also carries a small italic incident-type label
  // and (when known) the ETA in mono. en_route gets a subtle blink so
  // active incidents read as "this is happening right now".
  return (
    <div
      className={
        "flex cursor-pointer items-center gap-1.5 " +
        (status === "en_route" ? "live-pulse" : "")
      }
      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }}
    >
      <div style={{ position: "relative", display: "inline-block" }}>
        {svg}
        {chassisOverlay}
      </div>
      <span
        className="select-none whitespace-nowrap"
        style={{
          color: "#E8E2D2",
          fontSize: 11,
          fontFamily: "var(--font-serif), Georgia, serif",
          textShadow: "0 1px 2px rgba(0,0,0,0.7)",
          pointerEvents: "none",
        }}
      >
        <span style={{ fontStyle: "italic" }}>
          {label && label.length > 0
            ? label[0].toUpperCase() + label.slice(1)
            : "Incident"}
        </span>
        {typeof eta === "number" && (
          <span
            style={{
              marginLeft: 6,
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              color: "#A9C2B5",
              fontSize: 10,
            }}
          >
            {Math.round(eta)}m
          </span>
        )}
      </span>
    </div>
  );
}
