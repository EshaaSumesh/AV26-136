"use client";

import { useEffect, useState } from "react";
import { Play, Zap } from "lucide-react";
import { api } from "@/lib/api";

interface Scenario {
  id: string;
  title: string;
  description: string;
  step_count: number;
}

export default function DemoLauncher() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api
      .listScenarios()
      .then((d) => setScenarios(d.scenarios))
      .catch(() => setScenarios([]));
  }, []);

  async function launch(id: string) {
    setRunning(id);
    setStatus(null);
    try {
      const res = await api.runScenario(id);
      if (res.accepted) {
        setStatus(`Running: ${res.title} — ${res.run_id.slice(-6)}`);
      }
    } catch {
      setStatus("Failed to launch scenario.");
    } finally {
      setTimeout(() => setRunning(null), 1500);
    }
  }

  return (
    <div className="dark-scope border border-admin-rule bg-onyx">
      <div className="flex items-center gap-2 border-b border-admin-rule bg-onyx-2 px-4 py-2.5">
        <Zap className="h-3.5 w-3.5 text-safety-org" />
        <h3 className="font-mono text-[10px] uppercase tracking-[.14em] text-safety-org">
          Demo Scenarios
        </h3>
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
          {scenarios.length} available
        </span>
      </div>
      <div className="divide-y divide-admin-rule/60">
        {scenarios.length === 0 && (
          <div className="px-4 py-3 font-mono text-[10px] uppercase tracking-[.1em] text-steel-light">
            Loading scenarios…
          </div>
        )}
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => launch(s.id)}
            disabled={running === s.id}
            className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-safety-org/[0.06] disabled:opacity-50"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-admin-rule bg-white/[0.02] text-safety-org transition group-hover:border-safety-org/50">
              <Play className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-admin-text">
                {s.title}
              </div>
              <div className="line-clamp-1 text-[10px] text-steel-light">
                {s.description}
              </div>
            </div>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
              {s.step_count} steps
            </span>
          </button>
        ))}
      </div>
      {status && (
        <div className="border-t border-admin-rule bg-safety-org/[0.06] px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-safety-org">
          {status}
        </div>
      )}
    </div>
  );
}
