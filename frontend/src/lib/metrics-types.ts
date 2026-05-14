export interface AgentStat {
  count: number;
  success_count: number;
  failure_count: number;
  success_rate: number | null;
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  total_ms: number;
}

export interface MetricsSummary {
  started_at: string;
  total_agent_invocations: number;
  total_tool_invocations: number;
  total_failures: number;
  unique_agents: number;
  unique_tools: number;
  collaboration_edges: number;
}

export interface CollaborationEdge {
  source: string;
  target: string;
  count: number;
}

export interface CollaborationNode {
  id: string;
}

export interface MetricsOverview {
  summary: MetricsSummary;
  agents: Record<string, AgentStat>;
  tools: Record<string, AgentStat>;
  collaboration: {
    nodes: CollaborationNode[];
    edges: CollaborationEdge[];
  };
  agent_tool_usage: Record<string, Record<string, number>>;
}

export interface DemoScenario {
  id: string;
  title: string;
  description: string;
  step_count: number;
}
