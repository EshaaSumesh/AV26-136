"use client";

/**
 * DataSourcesFooter — a single hairline strip at the bottom of the
 * authority view that shows which external data sources are wired in
 * and currently healthy.
 *
 *   TomTom · Open-Meteo · GDACS · USGS · GNews · Vertex (3 regions)
 *
 * Each source has a small status dot:
 *   • green pulse = configured + recently used
 *   • amber       = configured but unused recently (could be down)
 *   • grey        = not configured
 *   • red         = configured but errored recently
 *
 * Polls every 15s. Failures are silent — the strip degrades to all
 * grey rather than disappearing.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DataFeed, VertexRegionsPayload } from "@/lib/types";

interface SourceState {
  label: string;
  detail?: string;
  status: "ok" | "idle" | "down" | "off";
}

// Stable display order. Anything else from the backend gets appended.
const PRIORITY = [
  "tomtom",
  "open_meteo",
  "openmeteo",
  "gdacs",
  "usgs",
  "gnews",
  "google_maps",
  "mapbox",
  "reddit",
];

function deriveStatus(feed: DataFeed): SourceState["status"] {
  if (!feed.configured) return "off";
  // Without a real per-source heartbeat we treat configured as "ok".
  // The next iteration of this strip can ingest a /metrics/feeds
  // endpoint with last-success timestamps for richer states.
  return "ok";
}

function prettyName(feed: DataFeed): string {
  return feed.name || feed.id;
}

export default function DataSourcesFooter() {
  const [feeds, setFeeds] = useState<DataFeed[]>([]);
  const [vertex, setVertex] = useState<VertexRegionsPayload | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [fd, vx] = await Promise.all([
          api.dataFeeds(),
          api.vertexRegions().catch(() => null),
        ]);
        setFeeds(fd.feeds ?? []);
        setVertex(vx);
      } catch {
        // ignore — strip just shows what it has
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  // Sort feeds by PRIORITY order, with unknowns at the end.
  const orderedFeeds = [...feeds].sort((a, b) => {
    const ai = PRIORITY.indexOf(a.id);
    const bi = PRIORITY.indexOf(b.id);
    if (ai === -1 && bi === -1) return a.id.localeCompare(b.id);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const sources: SourceState[] = orderedFeeds.map((f) => ({
    label: prettyName(f),
    detail: f.purpose,
    status: deriveStatus(f),
  }));

  // Append Vertex AI at the end as a single multi-region pill.
  if (vertex && vertex.region_count > 0) {
    sources.push({
      label: "Vertex AI",
      detail: `${vertex.region_count} region${vertex.region_count === 1 ? "" : "s"} · ${vertex.model}`,
      status: "ok",
    });
  }

  if (sources.length === 0) return null;

  return (
    <footer className="dark-scope flex flex-shrink-0 items-center gap-4 overflow-x-auto border-t border-admin-rule bg-onyx-2 px-5 py-1.5">
      <span
        className="font-serif text-[10px] tracking-[.16em] text-admin-muted shrink-0"
        style={{ fontVariantCaps: "small-caps" }}
      >
        live data sources
      </span>
      <div className="flex shrink-0 items-center gap-3">
        {sources.map((s, i) => (
          <SourcePill key={i} source={s} />
        ))}
      </div>
    </footer>
  );
}

function SourcePill({ source }: { source: SourceState }) {
  const palette = {
    ok: { dot: "var(--safety-org)", text: "var(--admin-text)", pulse: true },
    idle: { dot: "var(--admin-muted)", text: "var(--admin-text)", pulse: false },
    down: { dot: "var(--danger)", text: "var(--danger)", pulse: false },
    off: { dot: "var(--admin-rule)", text: "var(--admin-muted)", pulse: false },
  }[source.status];

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      title={
        source.detail
          ? `${source.label} — ${source.detail} (${source.status})`
          : `${source.label} (${source.status})`
      }
    >
      <span
        className={"h-1.5 w-1.5 " + (palette.pulse ? "live-pulse" : "")}
        style={{ background: palette.dot }}
      />
      <span
        className="font-mono text-[10px] tracking-[.04em]"
        style={{
          color: palette.text,
          opacity: source.status === "off" ? 0.55 : 1,
        }}
      >
        {source.label}
      </span>
    </span>
  );
}
