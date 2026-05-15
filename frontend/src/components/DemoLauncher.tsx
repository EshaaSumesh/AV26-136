"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, Zap, Flame } from "lucide-react";
import { api } from "@/lib/api";

interface Scenario {
  id: string;
  title: string;
  subtitle?: string | null;
  category?: string;
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

  // Flagship demos rendered on top, then the quick demos.
  const { flagship, quick } = useMemo(() => {
    const f: Scenario[] = [];
    const q: Scenario[] = [];
    for (const s of scenarios) {
      if (s.category === "flagship") f.push(s);
      else q.push(s);
    }
    return { flagship: f, quick: q };
  }, [scenarios]);

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

      {scenarios.length === 0 && (
        <div className="px-4 py-3 font-mono text-[10px] uppercase tracking-[.1em] text-steel-light">
          Loading scenarios…
        </div>
      )}

      {flagship.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 border-b border-admin-rule/60 bg-onyx-2/50 px-4 py-1.5 font-mono text-[9px] uppercase tracking-[.14em] text-safety-org">
            <Flame className="h-3 w-3" />
            Flagship · large-scale
          </div>
          {flagship.map((s) => (
            <FlagshipRow
              key={s.id}
              s={s}
              running={running === s.id}
              onLaunch={() => launch(s.id)}
            />
          ))}
        </div>
      )}

      {quick.length > 0 && (
        <div>
          {flagship.length > 0 && (
            <div className="border-b border-admin-rule/60 bg-onyx-2/50 px-4 py-1.5 font-mono text-[9px] uppercase tracking-[.14em] text-steel-light">
              Quick demos
            </div>
          )}
          <div className="divide-y divide-admin-rule/60">
            {quick.map((s) => (
              <QuickRow
                key={s.id}
                s={s}
                running={running === s.id}
                onLaunch={() => launch(s.id)}
              />
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className="border-t border-admin-rule bg-safety-org/[0.06] px-4 py-2 font-mono text-[10px] uppercase tracking-[.1em] text-safety-org">
          {status}
        </div>
      )}
    </div>
  );
}

function FlagshipRow({
  s,
  running,
  onLaunch,
}: {
  s: Scenario;
  running: boolean;
  onLaunch: () => void;
}) {
  return (
    <button
      onClick={onLaunch}
      disabled={running}
      className="group flex w-full items-start gap-3 border-b border-admin-rule/60 px-4 py-3 text-left transition hover:bg-safety-org/[0.06] disabled:opacity-50"
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-safety-org/40 bg-safety-org/[0.08] text-safety-org transition group-hover:border-safety-org">
        <Flame className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-admin-text">
            {s.title}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
            {s.step_count} steps
          </span>
        </div>
        {s.subtitle && (
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.1em] text-safety-org/80">
            {s.subtitle}
          </div>
        )}
        <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-admin-muted">
          {s.description}
        </div>
      </div>
      <Play className="mt-1 h-3.5 w-3.5 shrink-0 text-steel-light transition group-hover:text-safety-org" />
    </button>
  );
}

function QuickRow({
  s,
  running,
  onLaunch,
}: {
  s: Scenario;
  running: boolean;
  onLaunch: () => void;
}) {
  return (
    <button
      onClick={onLaunch}
      disabled={running}
      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-safety-org/[0.06] disabled:opacity-50"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-admin-rule bg-white/[0.02] text-safety-org transition group-hover:border-safety-org/50">
        <Play className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-admin-text">{s.title}</div>
        <div className="line-clamp-1 text-[10px] text-steel-light">
          {s.description}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[.1em] text-steel-light">
        {s.step_count} steps
      </span>
    </button>
  );
}
