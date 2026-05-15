/**
 * Single source of truth for disaster-category metadata used by both
 * the citizen-facing UI (tap grid, hazard chips) and the map glyphs.
 *
 * Keeping these aligned matters because the citizen picks a category
 * here, the agents reason about it, and the resulting incident is
 * eventually rendered with the same icon + tint on the operator map.
 * If the icon and label drift between surfaces the user loses the
 * mental link.
 */

import type { ReactNode } from "react";

export type CategoryId =
  | "flood"
  | "fire"
  | "medical"
  | "building_collapse"
  | "road_accident"
  | "gas_leak"
  | "earthquake"
  | "landslide"
  | "electrocution"
  | "tree_fall"
  | "vehicle_accident"
  | "cyclone"
  | "road_block"
  | "other";

export interface CategoryMeta {
  id: CategoryId;
  /** Short display label for chips and badges. */
  label: string;
  /** One-line plain-language description shown under the icon in the
   *  citizen tap-grid. Should be readable to a panicking layperson. */
  blurb: string;
  /** Tint colour for chips, hazard fills, the citizen tap-grid card. */
  tint: string;
  /** Tap-grid card background — a paler version of `tint` for warmth
   *  on the light-civic citizen surface. */
  bg: string;
  /** Inline 24×24 SVG glyph. Pictogram colour comes from `currentColor`
   *  so the same glyph renders correctly against light or dark
   *  backgrounds. */
  glyph: ReactNode;
}

// Shared inline-SVG glyphs at 24×24, drawn with currentColor so callers
// can simply set the `color` on a wrapping element. These are bigger,
// thicker variants of the 10×10 pictograms used inside MapView for
// pin overlays — same visual language, scaled for tap targets.
const G = {
  flood: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <path d="M12 3 C12 3 6 9 6 14 C6 17.3 8.7 20 12 20 C15.3 20 18 17.3 18 14 C18 9 12 3 12 3 Z" />
    </svg>
  ),
  fire: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <path d="M12 2 C12 6 8 8 8 13 C8 17 10 21 12 21 C14 21 17 17.5 17 14 C17 11.5 14.5 10.5 14.5 8 C14.5 5.5 12 2 12 2 Z" />
    </svg>
  ),
  medical: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <rect x="10" y="3" width="4" height="18" rx="0.5" />
      <rect x="3" y="10" width="18" height="4" rx="0.5" />
    </svg>
  ),
  building_collapse: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <rect x="3" y="14" width="7" height="6" transform="rotate(-15 6.5 17)" />
      <rect x="11" y="11" width="7" height="6" transform="rotate(8 14.5 14)" />
      <rect x="6" y="6" width="7" height="6" transform="rotate(-5 9.5 9)" />
    </svg>
  ),
  road_accident: (
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
      <line x1="12" y1="2" x2="12" y2="8" />
      <line x1="12" y1="16" x2="12" y2="22" />
      <line x1="2" y1="12" x2="8" y2="12" />
      <line x1="16" y1="12" x2="22" y2="12" />
      <line x1="5" y1="5" x2="9" y2="9" />
      <line x1="15" y1="15" x2="19" y2="19" />
      <line x1="19" y1="5" x2="15" y2="9" />
      <line x1="9" y1="15" x2="5" y2="19" />
    </svg>
  ),
  gas_leak: (
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
      <path d="M7 21 C8 18 6 16 8 13 C9.2 11 8 8 8 5" />
      <path d="M12 21 C13 18 11 16 13 13 C14.2 11 13 8 13 5" />
      <path d="M17 21 C18 18 16 16 18 13 C19.2 11 18 8 18 5" />
    </svg>
  ),
  earthquake: (
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round">
      <polyline points="2,12 5,7 8,17 11,4 14,20 17,7 20,12 22,10" />
    </svg>
  ),
  landslide: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <polygon points="2,20 7,12 11,20" />
      <polygon points="9,18 14,9 19,18" />
      <polygon points="15,20 19,14 22,20" />
    </svg>
  ),
  electrocution: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <polygon points="13,2 5,14 11,14 9,22 18,10 12,10 14,2" />
    </svg>
  ),
  tree_fall: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
      <circle cx="9" cy="8" r="5" />
      <rect x="11" y="10" width="2" height="11" transform="rotate(-25 12 15.5)" />
    </svg>
  ),
  vehicle_accident: (
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none">
      <line x1="12" y1="3" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="21" />
      <line x1="3" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="21" y2="12" />
    </svg>
  ),
  cyclone: (
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round">
      <path d="M5 7 C9 4 16 5 19 8" />
      <path d="M5 12 C9 9 16 10 19 13" />
      <path d="M5 17 C9 14 16 15 19 18" />
    </svg>
  ),
  road_block: (
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round">
      <rect x="3" y="9" width="18" height="6" />
      <line x1="6" y1="9" x2="9" y2="15" />
      <line x1="11" y1="9" x2="14" y2="15" />
      <line x1="16" y1="9" x2="19" y2="15" />
    </svg>
  ),
  other: (
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5 A2.5 2.5 0 1 1 12 12.5 V14" />
      <line x1="12" y1="17" x2="12" y2="17.5" />
    </svg>
  ),
};

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  flood: {
    id: "flood",
    label: "Flood",
    blurb: "Water rising, lanes flooded",
    tint: "#3A7CA5",
    bg: "#E1ECF3",
    glyph: G.flood,
  },
  fire: {
    id: "fire",
    label: "Fire",
    blurb: "Smoke, flames, burning",
    tint: "#E26B1A",
    bg: "#FBE7D7",
    glyph: G.fire,
  },
  medical: {
    id: "medical",
    label: "Medical",
    blurb: "Someone is hurt or unwell",
    tint: "#C53030",
    bg: "#F8DDDD",
    glyph: G.medical,
  },
  building_collapse: {
    id: "building_collapse",
    label: "Collapse",
    blurb: "Wall, building, debris fallen",
    tint: "#7C5A36",
    bg: "#EDE2D2",
    glyph: G.building_collapse,
  },
  road_accident: {
    id: "road_accident",
    label: "Accident",
    blurb: "Cars, bus, vehicle crash",
    tint: "#9B59B6",
    bg: "#ECDFF1",
    glyph: G.road_accident,
  },
  gas_leak: {
    id: "gas_leak",
    label: "Gas leak",
    blurb: "Strong smell, hissing pipe",
    tint: "#B98C00",
    bg: "#F4E9C4",
    glyph: G.gas_leak,
  },
  earthquake: {
    id: "earthquake",
    label: "Earthquake",
    blurb: "Tremor, cracks, shaking",
    tint: "#A0522D",
    bg: "#EFDBCC",
    glyph: G.earthquake,
  },
  landslide: {
    id: "landslide",
    label: "Landslide",
    blurb: "Mud, rocks slid down",
    tint: "#8B6F47",
    bg: "#EAE0CF",
    glyph: G.landslide,
  },
  electrocution: {
    id: "electrocution",
    label: "Live wire",
    blurb: "Fallen power line, shock",
    tint: "#B89200",
    bg: "#F5EDC4",
    glyph: G.electrocution,
  },
  tree_fall: {
    id: "tree_fall",
    label: "Tree down",
    blurb: "Tree fell, blocking road",
    tint: "#3F7042",
    bg: "#DCE9DC",
    glyph: G.tree_fall,
  },
  vehicle_accident: {
    id: "vehicle_accident",
    label: "Vehicle",
    blurb: "Single-vehicle incident",
    tint: "#9B59B6",
    bg: "#ECDFF1",
    glyph: G.vehicle_accident,
  },
  cyclone: {
    id: "cyclone",
    label: "Cyclone",
    blurb: "Severe wind, storm cell",
    tint: "#4A7C8C",
    bg: "#DBE7EB",
    glyph: G.cyclone,
  },
  road_block: {
    id: "road_block",
    label: "Road block",
    blurb: "Road impassable, debris",
    tint: "#7A6E5D",
    bg: "#E5E0D6",
    glyph: G.road_block,
  },
  other: {
    id: "other",
    label: "Other",
    blurb: "Something else worrying",
    tint: "#5B6A6F",
    bg: "#DCE2E3",
    glyph: G.other,
  },
};

/**
 * Curated set shown in the citizen tap grid. Order is tuned for the
 * Bengaluru-civic load — most-frequent first — so the form is fast
 * for the cases citizens actually face.
 */
export const CITIZEN_TAP_GRID: CategoryId[] = [
  "flood",
  "fire",
  "medical",
  "road_accident",
  "building_collapse",
  "gas_leak",
  "tree_fall",
  "other",
];

/** Severity buckets shown to citizens, mapped to the agent-side numeric
 *  severity. We deliberately collapse the 1-5 scale to 3 conceptual
 *  buckets because asking a panicking layperson to pick "3 vs 4" is
 *  bad UX — and the agents will refine severity from photo + text
 *  anyway. */
export interface SeverityBucket {
  id: "minor" | "serious" | "life_threat";
  label: string;
  blurb: string;
  /** What we send to the agent pipeline. */
  numeric: number;
  tint: string;
  bg: string;
}

export const SEVERITY_BUCKETS: SeverityBucket[] = [
  {
    id: "minor",
    label: "Minor",
    blurb: "Inconvenience, no danger",
    numeric: 2,
    tint: "#3F7042",
    bg: "#DCE9DC",
  },
  {
    id: "serious",
    label: "Serious",
    blurb: "Property damage or risk",
    numeric: 3,
    tint: "#B98C00",
    bg: "#F4E9C4",
  },
  {
    id: "life_threat",
    label: "Life-threatening",
    blurb: "People hurt or trapped",
    numeric: 5,
    tint: "#C53030",
    bg: "#F8DDDD",
  },
];

export function categoryMeta(id: string): CategoryMeta {
  return CATEGORIES[id as CategoryId] ?? CATEGORIES.other;
}
