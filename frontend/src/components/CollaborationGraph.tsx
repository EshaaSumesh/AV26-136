"use client";

import { useMemo } from "react";
import type {
  CollaborationEdge,
  CollaborationNode,
} from "@/lib/metrics-types";
import { agentColor } from "@/lib/types";

interface Props {
  nodes: CollaborationNode[];
  edges: CollaborationEdge[];
}

const WIDTH = 320;
const HEIGHT = 320;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const RADIUS = 110;

function nodeLabel(id: string): string {
  if (id.startsWith("field_commander_")) return id.replace("field_commander_", "FC:");
  return id.replace(/_/g, " ");
}

export default function CollaborationGraph({ nodes, edges }: Props) {
  const positions = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    // Put supervisor at center if present, others on a ring
    const others = nodes.filter((n) => n.id !== "supervisor");
    if (nodes.find((n) => n.id === "supervisor")) {
      out["supervisor"] = { x: CENTER_X, y: CENTER_Y };
    }
    others.forEach((n, i) => {
      const angle = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
      out[n.id] = {
        x: CENTER_X + RADIUS * Math.cos(angle),
        y: CENTER_Y + RADIUS * Math.sin(angle),
      };
    });
    return out;
  }, [nodes]);

  const maxEdge = Math.max(1, ...edges.map((e) => e.count));

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
        <span>{nodes.length} agents</span>
        <span>{edges.length} edges</span>
      </div>
      <div className="flex items-center justify-center">
        {nodes.length === 0 ? (
          <div className="py-4 font-mono text-[10px] uppercase tracking-[.1em] text-steel-light">
            No agent activity yet.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-full w-full max-h-[300px]"
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 -5 10 10"
                refX={10}
                refY={0}
                markerWidth={6}
                markerHeight={6}
                orient="auto"
              >
                <path d="M0,-4 L10,0 L0,4" fill="#A0AEC0" />
              </marker>
            </defs>

            {edges.map((e, i) => {
              const a = positions[e.source];
              const b = positions[e.target];
              if (!a || !b) return null;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len === 0) return null;
              // shorten line endpoint so arrow doesn't overlap node circle
              const ux = dx / len;
              const uy = dy / len;
              const endX = b.x - ux * 14;
              const endY = b.y - uy * 14;
              const opacity = 0.25 + 0.65 * (e.count / maxEdge);
              const width = 1 + 3 * (e.count / maxEdge);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={endX}
                  y2={endY}
                  stroke="#94a3b8"
                  strokeOpacity={opacity}
                  strokeWidth={width}
                  markerEnd="url(#arrow)"
                />
              );
            })}

            {nodes.map((n) => {
              const p = positions[n.id];
              if (!p) return null;
              const color = agentColor(n.id);
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                  <circle
                    r={11}
                    fill={color}
                    fillOpacity={0.85}
                    stroke="#1C2128"
                    strokeWidth={2}
                  />
                  <text
                    x={0}
                    y={26}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#E2E8F0"
                    fontFamily="var(--font-mono)"
                    style={{ pointerEvents: "none" }}
                  >
                    {nodeLabel(n.id)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
