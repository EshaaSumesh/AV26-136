import type {
  AgentEvent,
  CitizenHistory,
  CitizenReport,
  DashboardData,
  HazardZone,
  ImageUploadResult,
  Mission,
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

export const api = {
  health: () => http<{ status: string; city: string; agents: string[] }>("/health"),

  dashboard: () => http<DashboardData>("/authority/dashboard"),

  agentLog: (limit = 100) =>
    http<{ events: AgentEvent[] }>(`/authority/agent-log?limit=${limit}`),

  stats: () => http<any>("/authority/stats"),

  activeMissions: () => http<{ missions: Mission[] }>("/missions/active"),

  allMissions: () => http<{ missions: Mission[] }>("/missions/"),

  mission: (id: string) => http<Mission>(`/missions/${id}`),

  hazardZones: () =>
    http<{ zone_count: number; zones: HazardZone[] }>("/hazards/"),

  nearby: (lat: number, lng: number, radius_km = 3) =>
    http<{ alerts: any[]; hazards: any[] }>(
      `/citizen/nearby?lat=${lat}&lng=${lng}&radius_km=${radius_km}`,
    ),

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

  listScenarios: () =>
    http<{ scenarios: Array<{ id: string; title: string; description: string; step_count: number }> }>(
      "/demo/scenarios",
    ),

  runScenario: (scenario_id: string) =>
    http<{ accepted: boolean; run_id: string; title: string }>("/demo/run", {
      method: "POST",
      body: JSON.stringify({ scenario_id }),
    }),
};
