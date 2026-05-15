import type {
  AgentEvent,
  CitizenHistory,
  CitizenListPayload,
  CitizenReport,
  DashboardData,
  DataFeedsPayload,
  HazardZone,
  ImageUploadResult,
  Mission,
  ResourcesPayload,
  VertexRegionsPayload,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8001";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE || "ws://localhost:8001";
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
export const CITY_CENTER: [number, number] = [
  Number(process.env.NEXT_PUBLIC_CITY_LNG ?? 77.5946),
  Number(process.env.NEXT_PUBLIC_CITY_LAT ?? 12.9716),
];

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

// Normalize backend hazard payload (geometry-nested + `type`) into the
// flat shape (`center`, `radius_km`, `category`) the UI components use.
function normalizeHazardZone(raw: Record<string, unknown>): HazardZone {
  const geometry = (raw.geometry as Record<string, unknown> | undefined) ?? {};
  const center =
    (raw.center as [number, number] | undefined) ??
    (geometry.center as [number, number] | undefined) ??
    [0, 0];
  const radiusKm =
    (raw.radius_km as number | undefined) ??
    (geometry.radius_km as number | undefined) ??
    0;
  const category =
    (raw.category as string | undefined) ??
    (raw.type as string | undefined) ??
    (raw.disaster_type as string | undefined) ??
    "hazard";
  return {
    id: String(raw.id ?? "hz_unknown"),
    category,
    center,
    radius_km: Number(radiusKm) || 0,
    severity:
      (raw.severity as HazardZone["severity"] | undefined) ?? "medium",
    blocked: Boolean(raw.blocked),
    penalty_multiplier: raw.penalty_multiplier as number | undefined,
    reasoning:
      (raw.reasoning as string | undefined) ??
      (raw.label as string | undefined),
    created_at: raw.created_at as string | undefined,
  };
}

export const api = {
  health: () => http<{ status: string; city: string; agents: string[] }>("/health"),

  dashboard: async (): Promise<DashboardData> => {
    const raw = await http<DashboardData>("/authority/dashboard");
    // active_missions don't need normalization, but if the dashboard ever
    // grows hazard fields we keep this hook ready.
    return raw;
  },

  agentLog: (limit = 100) =>
    http<{ events: AgentEvent[] }>(`/authority/agent-log?limit=${limit}`),

  stats: () => http<any>("/authority/stats"),

  activeMissions: () => http<{ missions: Mission[] }>("/missions/active"),

  allMissions: () => http<{ missions: Mission[] }>("/missions/"),

  mission: (id: string) => http<Mission>(`/missions/${id}`),

  hazardZones: async (): Promise<{ zone_count: number; zones: HazardZone[] }> => {
    const raw = await http<{
      zone_count: number;
      zones: Array<Record<string, unknown>>;
    }>("/hazards/");
    return {
      zone_count: raw.zone_count,
      zones: (raw.zones ?? []).map(normalizeHazardZone),
    };
  },

  nearby: async (lat: number, lng: number, radius_km = 3) => {
    const raw = await http<{
      alerts: any[];
      hazards: Array<Record<string, unknown>>;
    }>(`/citizen/nearby?lat=${lat}&lng=${lng}&radius_km=${radius_km}`);
    return {
      alerts: raw.alerts ?? [],
      hazards: (raw.hazards ?? []).map((h) => ({
        ...normalizeHazardZone(h),
        // preserve distance_km if backend included it
        distance_km: (h as { distance_km?: number }).distance_km,
      })),
    };
  },

  submitReport: (report: CitizenReport) =>
    http<{ accepted: boolean; message: string; incident_id?: string }>(
      "/citizen/report",
      {
        method: "POST",
        body: JSON.stringify(report),
      },
    ),

  triggerSOS: (
    citizen_id: string,
    coordinates: [number, number],
    note?: string,
    image_id?: string,
  ) =>
    http<{ accepted: boolean; incident_id?: string }>("/citizen/sos", {
      method: "POST",
      body: JSON.stringify({ citizen_id, coordinates, note, image_id }),
    }),

  uploadImage: async (
    file: File,
    citizen_id: string,
  ): Promise<ImageUploadResult> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("citizen_id", citizen_id);
    const res = await fetch(`${API_BASE}/citizen/upload`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upload failed: ${res.status} ${text}`);
    }
    return res.json();
  },

  imageUrl: (image_url: string) =>
    image_url.startsWith("http") ? image_url : `${API_BASE}${image_url}`,

  citizenProfile: (citizen_id: string) =>
    http<{
      citizen_id: string;
      created_at: string;
      last_seen: string;
      last_location: { lat: number; lng: number } | null;
      report_count: number;
      sos_count: number;
    }>(`/citizen/${citizen_id}/profile`),

  citizenHistory: (citizen_id: string, limit = 20) =>
    http<CitizenHistory>(`/citizen/${citizen_id}/history?limit=${limit}`),

  subscribeCitizen: (citizen_id: string, lat: number, lng: number) =>
    http<{ subscribed: boolean }>("/citizen/subscribe", {
      method: "POST",
      body: JSON.stringify({ citizen_id, lat, lng }),
    }),

  metricsOverview: () => http<any>("/metrics/overview"),

  resources: () => http<ResourcesPayload>("/authority/resources"),

  citizenList: (limit_per_citizen = 5) =>
    http<CitizenListPayload>(
      `/authority/citizens?limit_per_citizen=${limit_per_citizen}`,
    ),

  dataFeeds: () => http<DataFeedsPayload>("/authority/data-feeds"),

  vertexRegions: () => http<VertexRegionsPayload>("/metrics/llm/regions"),

  listScenarios: () =>
    http<{
      scenarios: Array<{
        id: string;
        title: string;
        subtitle?: string | null;
        category?: string;
        description: string;
        step_count: number;
      }>;
    }>("/demo/scenarios"),

  runScenario: (scenario_id: string, opts?: { record?: boolean }) =>
    http<{ accepted: boolean; run_id: string; title: string; recording?: boolean }>(
      "/demo/run",
      {
        method: "POST",
        body: JSON.stringify({ scenario_id, record: opts?.record ?? false }),
      },
    ),

  listRecordings: () =>
    http<{
      recordings: Array<{
        scenario_id: string;
        recorded_at: string | null;
        event_count: number;
        duration_ms: number;
      }>;
    }>("/demo/recordings"),

  replayScenario: (scenario_id: string, speed = 1.0) =>
    http<{ accepted: boolean; run_id?: string; reason?: string; message?: string }>(
      "/demo/replay",
      {
        method: "POST",
        body: JSON.stringify({ scenario_id, speed }),
      },
    ),

  demoStatus: () =>
    http<{
      active: Array<{
        run_id: string;
        scenario_id: string;
        title: string;
        started_at: string;
        kind?: string;
      }>;
    }>("/demo/status"),
};
