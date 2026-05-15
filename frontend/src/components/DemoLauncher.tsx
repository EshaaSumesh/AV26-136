"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, Flame, Circle, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";

interface Scenario {
  id: string;
  title: string;
  subtitle?: string | null;
  category?: string;
  description: string;
  step_count: number;
}

interface Recording {
  scenario_id: string;
  recorded_at: string | null;
  event_count: number;
  duration_ms: number;
}

export default function DemoLauncher() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // When this is true the next live run records itself to disk so it
  // can be replayed later — the demo-day insurance policy. We default
  // OFF so casual experimentation doesn't churn recording files.
  const [recordNext, setRecordNext] = useState(false);
  const [recordings, setRecordings] = useState<Map<string, Recording>>(
    () => new Map(),
  );

  useEffect(() => {
    api
      .listScenarios()
      .then((d) => setScenarios(d.scenarios))
      .catch(() => setScenarios([]));
  }, []);

  const refreshRecordings = useCallback(async () => {
    try {
      const r = await api.listRecordings();
      const m = new Map<string, Recording>();
      for (const rec of r.recordings) m.set(rec.scenario_id, rec);
      setRecordings(m);
    } catch {
      // Endpoint may not exist on older backends; silently ignore.
    }
  }, []);

  useEffect(() => {
    refreshRecordings();
    const id = setInterval(refreshRecordings, 8000);
    return () => clearInterval(id);
  }, [refreshRecordings]);

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
      const res = await api.runScenario(id, { record: recordNext });
      if (res.accepted) {
        const tag = res.recording ? " · REC" : "";
        setStatus(`Running${tag}: ${res.title} — ${res.run_id.slice(-6)}`);
        // After a recording run we'll have a fresh recording — refresh
        // the list shortly after the cooldown ends.
        if (res.recording) {
          setTimeout(refreshRecordings, 60_000);
        }
      }
    } catch {
      setStatus("Failed to launch scenario.");
    } finally {
      setTimeout(() => setRunning(null), 1500);
    }
  }

  async function replay(id: string) {
    setRunning(id);
    setStatus(null);
    try {
      const res = await api.replayScenario(id, 1.0);
      if (res.accepted) {
        setStatus(`Replaying: ${id} — ${res.run_id?.slice(-6)}`);
      } else {
        setStatus(res.message ?? "Replay rejected.");
      }
    } catch {
      setStatus("Failed to replay.");
    } finally {
      setTimeout(() => setRunning(null), 1500);
    }
  }

  return (
    <div className="dark-scope">
      <div className="flex items-baseline justify-between border-b border-admin-rule pb-1.5">
        <span
          className="font-serif text-[11px] tracking-[.16em] text-admin-text"
          style={{ fontVariantCaps: "small-caps" }}
        >
          drill scenarios
        </span>
        <span
          className="font-mono text-[10px] tracking-[.04em] text-admin-muted"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {String(scenarios.length).padStart(2, "0")} available
        </span>
      </div>
      <p className="mt-1.5 font-serif italic text-[12px] leading-relaxed text-admin-muted">
        Run a scripted incident to watch the crew coordinate end-to-end —
        useful for demos and after-action reviews.
      </p>

      {/* Recording toggle. When ON, the next live run is captured and
          can be replayed later WITHOUT calling Gemini. Demo-day
          insurance against quota exhaustion mid-presentation. */}
      <label className="mt-2 flex cursor-pointer items-center gap-2 border-b border-admin-rule pb-2 select-none">
        <input
          type="checkbox"
          checked={recordNext}
          onChange={(e) => setRecordNext(e.target.checked)}
          className="h-3 w-3 accent-safety-org"
        />
        <Circle
          className={
            "h-3 w-3 " +
            (recordNext ? "fill-safety-org text-safety-org" : "text-admin-muted")
          }
        />
        <span
          className="font-mono text-[10px] tracking-[.18em] text-admin-text"
          style={{ fontVariantCaps: "small-caps" }}
        >
          record next run
        </span>
        <span className="ml-auto font-serif italic text-[10px] text-admin-muted">
          {recordings.size > 0
            ? `${recordings.size} recording${recordings.size === 1 ? "" : "s"} on disk`
            : "no recordings yet"}
        </span>
      </label>

      {scenarios.length === 0 && (
        <div className="px-4 py-3 font-serif italic text-[11px] text-admin-muted">
          Loading scenarios…
        </div>
      )}

      {flagship.length > 0 && (
        <div>
          <div
            className="flex items-center gap-1.5 border-b border-admin-rule px-4 py-1 font-serif text-[10px] tracking-[.18em] text-admin-text"
            style={{ fontVariantCaps: "small-caps" }}
          >
            <Flame className="h-3 w-3 text-safety-org" />
            flagship · large-scale
          </div>
          {flagship.map((s) => (
            <FlagshipRow
              key={s.id}
              s={s}
              running={running === s.id}
              hasRecording={recordings.has(s.id)}
              onLaunch={() => launch(s.id)}
              onReplay={() => replay(s.id)}
            />
          ))}
        </div>
      )}

      {quick.length > 0 && (
        <div>
          {flagship.length > 0 && (
            <div
              className="border-b border-admin-rule px-4 py-1 font-serif text-[10px] tracking-[.18em] text-admin-muted"
              style={{ fontVariantCaps: "small-caps" }}
            >
              quick demos
            </div>
          )}
          <div>
            {quick.map((s) => (
              <QuickRow
                key={s.id}
                s={s}
                running={running === s.id}
                hasRecording={recordings.has(s.id)}
                onLaunch={() => launch(s.id)}
                onReplay={() => replay(s.id)}
              />
            ))}
          </div>
        </div>
      )}

      {status && (
        <div className="border-t border-admin-rule px-4 py-2 font-serif italic text-[11px] text-safety-org">
          {status}
        </div>
      )}
    </div>
  );
}

function FlagshipRow({
  s,
  running,
  hasRecording,
  onLaunch,
  onReplay,
}: {
  s: Scenario;
  running: boolean;
  hasRecording: boolean;
  onLaunch: () => void;
  onReplay: () => void;
}) {
  return (
    <div className="group flex w-full items-start gap-3 border-b border-admin-rule px-4 py-3 transition hover:bg-slate">
      <Flame className="mt-1 h-3.5 w-3.5 shrink-0 text-safety-org" />
      <button
        onClick={onLaunch}
        disabled={running}
        className="min-w-0 flex-1 text-left disabled:opacity-50"
      >
        <div className="flex items-baseline gap-2">
          <span
            className="font-serif text-[14px] font-semibold leading-tight text-admin-text"
            style={{ letterSpacing: "-0.005em" }}
          >
            {s.title}
          </span>
          <span
            className="font-mono text-[9px] tracking-[.04em] text-admin-muted"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            · {String(s.step_count).padStart(2, "0")} steps
          </span>
        </div>
        {s.subtitle && (
          <div className="mt-0.5 font-serif italic text-[11px] text-safety-org">
            {s.subtitle}
          </div>
        )}
        <div
          className="mt-1 font-serif text-[12px] leading-snug text-admin-muted"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {s.description}
        </div>
      </button>
      <RowActions
        hasRecording={hasRecording}
        running={running}
        onLaunch={onLaunch}
        onReplay={onReplay}
      />
    </div>
  );
}

function QuickRow({
  s,
  running,
  hasRecording,
  onLaunch,
  onReplay,
}: {
  s: Scenario;
  running: boolean;
  hasRecording: boolean;
  onLaunch: () => void;
  onReplay: () => void;
}) {
  return (
    <div className="group flex w-full items-center gap-3 border-b border-admin-rule px-4 py-2.5 transition hover:bg-slate last:border-b-0">
      <Play className="h-3 w-3 shrink-0 text-admin-muted" />
      <button
        onClick={onLaunch}
        disabled={running}
        className="min-w-0 flex-1 text-left disabled:opacity-50"
      >
        <div className="font-serif text-[12px] font-semibold text-admin-text">
          {s.title}
        </div>
        <div className="truncate font-serif italic text-[11px] text-admin-muted">
          {s.description}
        </div>
      </button>
      <RowActions
        hasRecording={hasRecording}
        running={running}
        onLaunch={onLaunch}
        onReplay={onReplay}
      />
      <span
        className="shrink-0 font-mono text-[9px] tracking-[.04em] text-admin-muted"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {String(s.step_count).padStart(2, "0")} steps
      </span>
    </div>
  );
}

// Tiny action cluster on each row: live launch icon (always) + replay
// icon (only when a recording exists for this scenario). Replay is the
// quota-safe button — clicking it re-broadcasts a previous capture.
function RowActions({
  hasRecording,
  running,
  onLaunch,
  onReplay,
}: {
  hasRecording: boolean;
  running: boolean;
  onLaunch: () => void;
  onReplay: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {hasRecording && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReplay();
          }}
          disabled={running}
          title="Replay recorded run (no Gemini calls)"
          className="inline-flex h-6 items-center gap-1 border border-admin-rule px-1.5 font-mono text-[9px] tracking-[.12em] text-admin-text transition hover:border-safety-org hover:text-safety-org disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" />
          REPLAY
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onLaunch();
        }}
        disabled={running}
        title="Run live (uses Gemini quota)"
        className="inline-flex h-6 w-6 items-center justify-center text-admin-muted transition hover:text-safety-org disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
