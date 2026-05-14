"use client";

import Map, {
  Marker,
  Source,
  Layer,
  NavigationControl,
  Popup,
} from "react-map-gl";
import type { LayerProps } from "react-map-gl";
import { useMemo, useState } from "react";
import { MAPBOX_TOKEN, CITY_CENTER } from "@/lib/api";
import type { HazardZone, Mission } from "@/lib/types";

interface Props {
  hazards: HazardZone[];
  missions: Mission[];
  reportLocation?: [number, number] | null;
  onClickMap?: (lng: number, lat: number) => void;
  selectedMission?: string | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  low: "#facc15",
  medium: "#fb923c",
  high: "#f87171",
  critical: "#ef4444",
};

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
          category: h.category,
          color: SEVERITY_COLOR[h.severity] ?? "#94a3b8",
          radius_m: h.radius_km * 1000,
          blocked: !!h.blocked,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [h.center[1], h.center[0]],
        },
      })),
  };
}

function routeGeoJSON(missions: Mission[], selectedMission: string | null | undefined) {
  return {
    type: "FeatureCollection" as const,
    features: missions
      .filter((m) => m.route_path && m.route_path.length > 1)
      .map((m) => ({
        type: "Feature" as const,
        properties: {
          mission_id: m.mission_id,
          severity: m.severity,
          status: m.status,
          selected:
            selectedMission && selectedMission === m.mission_id ? 1 : 0,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: (m.route_path ?? []).map((p) => [p[1], p[0]]),
        },
      })),
  };
}

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
    "circle-opacity": 0.18,
    "circle-stroke-color": ["get", "color"],
    "circle-stroke-opacity": 0.9,
    "circle-stroke-width": 2,
  },
};

const hazardCenterLayer: LayerProps = {
  id: "hazard-centers",
  type: "circle",
  paint: {
    "circle-radius": 5,
    "circle-color": ["get", "color"],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 1.5,
  },
};

const routeLineLayer: LayerProps = {
  id: "route-lines",
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": [
      "case",
      ["==", ["get", "selected"], 1], "#34d399",
      "#60a5fa",
    ],
    "line-width": [
      "case",
      ["==", ["get", "selected"], 1], 6,
      4,
    ],
    "line-opacity": 0.9,
  },
};

const routeOutlineLayer: LayerProps = {
  id: "route-outline",
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#0f172a",
    "line-width": 8,
    "line-opacity": 0.8,
  },
};

export default function MapView({
  hazards,
  missions,
  reportLocation,
  onClickMap,
  selectedMission,
}: Props) {
  const [popup, setPopup] = useState<{
    lng: number;
    lat: number;
    title: string;
    body: string;
  } | null>(null);

  const hazardData = useMemo(() => hazardCircleGeoJSON(hazards), [hazards]);
  const routeData = useMemo(
    () => routeGeoJSON(missions, selectedMission),
    [missions, selectedMission],
  );

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900 text-sm text-slate-400">
        Missing Mapbox token. Set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local.
      </div>
    );
  }

  return (
    <Map
      mapboxAccessToken={MAPBOX_TOKEN}
      mapStyle="mapbox://styles/mapbox/dark-v11"
      initialViewState={{
        longitude: CITY_CENTER[0],
        latitude: CITY_CENTER[1],
        zoom: 11.5,
      }}
      style={{ width: "100%", height: "100%" }}
      onClick={(e) => onClickMap?.(e.lngLat.lng, e.lngLat.lat)}
    >
      <NavigationControl position="top-right" />

      <Source id="hazards" type="geojson" data={hazardData}>
        <Layer {...hazardCircleLayer} />
        <Layer {...hazardCenterLayer} />
      </Source>

      <Source id="routes" type="geojson" data={routeData}>
        <Layer {...routeOutlineLayer} />
        <Layer {...routeLineLayer} />
      </Source>

      {missions.map((m) => (
        <Marker
          key={m.mission_id}
          longitude={m.incident_coordinates[1]}
          latitude={m.incident_coordinates[0]}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            setPopup({
              lng: m.incident_coordinates[1],
              lat: m.incident_coordinates[0],
              title: `${m.disaster_type.toUpperCase()} · sev ${m.severity}`,
              body: `${m.assigned_base_name ?? "Unassigned"} · ${m.status}`,
            });
          }}
        >
          <div className="relative flex h-3 w-3 items-center justify-center">
            <span
              className="pulse-ring absolute h-3 w-3 rounded-full"
              style={{ background: m.severity >= 4 ? "#ef4444" : "#fb923c" }}
            />
            <span
              className="relative h-2 w-2 rounded-full"
              style={{ background: m.severity >= 4 ? "#fca5a5" : "#fdba74" }}
            />
          </div>
        </Marker>
      ))}

      {reportLocation && (
        <Marker
          longitude={reportLocation[0]}
          latitude={reportLocation[1]}
          anchor="center"
        >
          <div className="h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-emerald-300/40" />
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
            <div className="text-xs font-semibold uppercase tracking-wider">
              {popup.title}
            </div>
            <div className="text-xs text-slate-300">{popup.body}</div>
          </div>
        </Popup>
      )}
    </Map>
  );
}
