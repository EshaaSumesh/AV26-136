export type Coordinates = [number, number];

export type EventType =
  | "citizen.report.submitted"
  | "citizen.sos.triggered"
  | "external.alert.received"
  | "situation.assessed"
  | "hazard.zone.proposed"
  | "hazard.zone.confirmed"
  | "hazard.zone.updated"
  | "hazard.zone.cleared"
  | "mission.proposed"
  | "mission.accepted"
  | "mission.declined"
  | "mission.counter_proposed"
  | "mission.completed"
  | "route.computed"
  | "route.invalidated"
  | "route.recomputed"
  | "public.alert.broadcast"
  | "agent.reasoning"
  | "agent.tool_call"
  | "agent.error";

export interface AgentEvent {
  id: string;
  type: EventType;
  payload: Record<string, any>;
  source_agent: string | null;
  timestamp: string;
}

export interface HazardZone {
  id: string;
  category: string;
  center: Coordinates;
  radius_km: number;
  severity: "low" | "medium" | "high" | "critical";
  blocked: boolean;
  penalty_multiplier?: number;
  reasoning?: string;
  created_at?: string;
}

export interface RescueBase {
  id: string;
  name: string;
  coordinates: Coordinates;
  teams_available: number;
  type: string;
  specialization: string[];
  distance_km?: number;
}

export type MissionStatus =
  | "proposed"
  | "negotiating"
  | "accepted"
  | "declined"
  | "en_route"
  | "on_site"
  | "completed"
  | "cancelled";

export interface NegotiationEntry {
  timestamp: string;
  agent: string;
  action: string;
  reasoning: string;
  details: Record<string, any>;
}

export interface Mission {
  mission_id: string;
  incident_id: string;
  disaster_type: string;
  severity: number;
  incident_coordinates: Coordinates;
  status: MissionStatus;
  assigned_base_id: string | null;
  assigned_base_name: string | null;
  assigned_commander: string | null;
  route_path: Coordinates[] | null;
  route_distance_km: number | null;
  route_eta_minutes: number | null;
  negotiation_history: NegotiationEntry[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CitizenReport {
  citizen_id: string;
  disaster_type: string;
  description: string;
  location_text?: string;
  coordinates: Coordinates;
  severity_hint: number;
  image_id?: string;
}

export interface CitizenHistoryEntry {
  submitted_at: string;
  kind: "report" | "sos";
  incident_id?: string;
  disaster_type?: string;
  description?: string | null;
  location_text?: string | null;
  coordinates?: number[] | null;
  severity_hint?: number;
  image_id?: string | null;
  image_url?: string | null;
  status?: string;
  stages?: string[];
  error?: string;
}

export interface CitizenHistory {
  citizen_id: string;
  exists: boolean;
  report_count: number;
  sos_count: number;
  created_at?: string;
  last_seen?: string;
  last_location?: { lat: number; lng: number } | null;
  reports: CitizenHistoryEntry[];
}

export interface ImageUploadResult {
  image_id: string;
  url: string;
  content_type: string;
  size_bytes: number;
}

export interface RescueBase {
  id: string;
  name: string;
  coordinates: Coordinates;
  teams_available: number;
  type: string;
  specialization: string[];
}

export interface ResourcesPayload {
  city: string;
  base_count: number;
  total_teams_available: number;
  by_type: Record<string, number>;
  bases: RescueBase[];
}

export interface CitizenSummary {
  citizen_id: string;
  created_at?: string;
  last_seen?: string;
  last_location: { lat: number; lng: number } | null;
  report_count: number;
  sos_count: number;
  recent_reports: CitizenHistoryEntry[];
}

export interface CitizenListPayload {
  citizen_count: number;
  total_reports: number;
  total_sos: number;
  citizens: CitizenSummary[];
}

export interface DataFeed {
  id: string;
  name: string;
  kind: string;
  configured: boolean;
  auth: "api-key" | "none" | "service-account" | string;
  purpose: string;
  used_by: string[];
}

export interface DataFeedsPayload {
  feed_count: number;
  feeds: DataFeed[];
}

export interface VertexRegionsPayload {
  model: string;
  project: string;
  regions: string[];
  region_count: number;
}

export interface PublicAlert {
  broadcast_id: string;
  message: string;
  category: string;
  severity: number;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  recipient_count?: number;
}

export interface DashboardData {
  recent_events: AgentEvent[];
  active_missions: Mission[];
  stats: {
    total_events: number;
    connections: { authority: number; citizen: number };
    missions: { total: number; by_status: Record<string, number> };
  };
}

export const DISASTER_TYPES = [
  "flood",
  "fire",
  "earthquake",
  "building_collapse",
  "road_block",
  "landslide",
  "cyclone",
  "medical",
  "other",
] as const;

export type DisasterType = (typeof DISASTER_TYPES)[number];

export const AGENT_COLORS: Record<string, string> = {
  situation_awareness: "#60a5fa",
  hazard_assessment: "#f59e0b",
  dispatch_strategist: "#a78bfa",
  route_optimizer: "#34d399",
  communications: "#f472b6",
  supervisor: "#94a3b8",
  reeval_loop: "#22d3ee",
};

export function agentColor(agent: string | null | undefined): string {
  if (!agent) return "#94a3b8";
  if (agent.startsWith("field_commander")) return "#fb7185";
  return AGENT_COLORS[agent] ?? "#94a3b8";
}
