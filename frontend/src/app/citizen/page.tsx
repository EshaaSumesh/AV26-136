"use client";

/**
 * Citizen page — panic-mode-first redesign.
 *
 * Design pillars (in priority order):
 *   1. SOS is always one tap away (pinned bottom bar). It works without
 *      a description — location + "SOS" is enough.
 *   2. Filing a normal report is fast: tap an icon for the category, tap
 *      a bucket for severity, type/dictate a sentence, hit Submit. No
 *      sliders, no <select>s.
 *   3. The form occupies the whole right-rail while filling. After
 *      submit it folds and the IncidentTracker ("help is on the way")
 *      takes its place at the top — closes the emotional loop.
 *   4. Offline-resilient: if the network drops mid-submit, queue in
 *      localStorage and retry on reconnect. The user sees "Saved —
 *      will send when reconnected" rather than a silent failure.
 *   5. The map is informative, not just a picker: hazards render with
 *      the same per-category glyphs and pulsing radar rings as the
 *      authority command centre, on a light civic basemap.
 *   6. Mobile-first: on phones the map sits at the top of the screen
 *      and the form is in the thumb arc; the SOS bar is permanent.
 *
 * Things this page deliberately does NOT do:
 *   - Show the raw citizen-id (it's a database key, not user identity).
 *   - Expose demo scenarios (those belong on the authority surface).
 *   - Show the full agent reasoning panel (operators only).
 */

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  ImageIcon,
  Loader2,
  MapPin,
  Megaphone,
  Send,
  Siren,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";

import { api, CITY_CENTER } from "@/lib/api";
import type { CitizenHistory, HazardZone } from "@/lib/types";
import {
  CATEGORIES,
  CITIZEN_TAP_GRID,
  SEVERITY_BUCKETS,
  categoryMeta,
  type CategoryId,
  type SeverityBucket,
} from "@/lib/categories";
import {
  enqueue,
  flush,
  size as queueSize,
  type QueuedItem,
} from "@/lib/offlineQueue";
import { useCitizenWS } from "@/lib/useAuthorityWS";
import {
  IncidentTracker,
  buildIncidents,
} from "@/components/IncidentTracker";
import CitizenOnboarding from "@/components/CitizenOnboarding";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const DEFAULT_CENTER: [number, number] = [CITY_CENTER[0], CITY_CENTER[1]];
const CITIZEN_ID_KEY = "resqroute_citizen_id";

function ensureCitizenId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(CITIZEN_ID_KEY);
  if (existing) return existing;
  const fresh = `citizen_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(CITIZEN_ID_KEY, fresh);
  return fresh;
}

interface AlertItem {
  message: string;
  category?: string;
  severity?: number;
  broadcast_id?: string;
}

interface NearbyHazard {
  category?: string;
  severity?: number;
  distance_km?: number;
}

type SubmitStatus =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "queued"; message: string }
  | { kind: "err"; message: string };

export default function CitizenPage() {
  // ── Identity & location ─────────────────────────────────────────
  const [citizenId, setCitizenId] = useState<string>("");
  const [coords, setCoords] = useState<[number, number]>(DEFAULT_CENTER);

  // ── Form state ───────────────────────────────────────────────────
  const [category, setCategory] = useState<CategoryId>("flood");
  const [description, setDescription] = useState("");
  const [bucket, setBucket] = useState<SeverityBucket>(SEVERITY_BUCKETS[1]);
  const [pendingImage, setPendingImage] = useState<{
    image_id: string;
    url: string;
    previewUrl: string;
    size_bytes: number;
  } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Submit state & queue ─────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>({ kind: "idle" });
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  // ── Ambient data ─────────────────────────────────────────────────
  const [hazards, setHazards] = useState<HazardZone[]>([]);
  const [nearby, setNearby] = useState<{
    alerts: AlertItem[];
    hazards: NearbyHazard[];
  }>({ alerts: [], hazards: [] });
  const [history, setHistory] = useState<CitizenHistory | null>(null);

  // ── Live agent stream ────────────────────────────────────────────
  const [trackedIncidentIds, setTrackedIncidentIds] = useState<string[]>([]);
  const {
    connected,
    alerts: liveAlerts,
    stageUpdates,
    agentEvents,
  } = useCitizenWS(citizenId);

  // ── UI state ─────────────────────────────────────────────────────
  // While at least one report is being tracked we collapse the form
  // into a small "file another?" affordance so the tracker sits at the
  // top, where the user is looking for reassurance.
  const [formOpen, setFormOpen] = useState(true);
  // Info disclosure (alerts/hazards/history) is collapsed by default
  // when the form is open — the form takes priority on entry. After
  // submit it auto-expands.
  const [infoOpen, setInfoOpen] = useState(false);
  const [online, setOnline] = useState(true);

  const incidents = useMemo(
    () => buildIncidents(stageUpdates, trackedIncidentIds),
    [stageUpdates, trackedIncidentIds],
  );

  const eventsByIncident = useMemo(() => {
    const m = new Map<string, typeof agentEvents>();
    for (const e of agentEvents) {
      const id = (e.payload as { incident_id?: string } | undefined)
        ?.incident_id;
      if (!id) continue;
      const list = m.get(id) ?? [];
      list.push(e);
      m.set(id, list);
    }
    return m;
  }, [agentEvents]);

  // ── Boot: id, geolocation, online watcher ───────────────────────
  useEffect(() => {
    setCitizenId(ensureCitizenId());
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords([pos.coords.longitude, pos.coords.latitude]),
      () => {},
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!citizenId) return;
    api.subscribeCitizen(citizenId, coords[1], coords[0]).catch(() => {});
  }, [citizenId, coords]);

  // ── Ambient refresh ─────────────────────────────────────────────
  const refreshHistory = useCallback(async () => {
    if (!citizenId) return;
    try {
      const h = await api.citizenHistory(citizenId, 10);
      setHistory(h);
    } catch (err) {
      console.error("history fetch failed", err);
    }
  }, [citizenId]);

  const refreshAmbient = useCallback(async () => {
    try {
      const [hz, near] = await Promise.all([
        api.hazardZones(),
        api.nearby(coords[1], coords[0], 5),
      ]);
      setHazards(hz.zones ?? []);
      setNearby(near);
    } catch (err) {
      console.error(err);
    }
  }, [coords]);

  useEffect(() => {
    if (!citizenId) return;
    refreshAmbient();
    refreshHistory();
    const id = setInterval(() => {
      refreshAmbient();
      refreshHistory();
    }, 7000);
    return () => clearInterval(id);
  }, [citizenId, refreshAmbient, refreshHistory]);

  // ── Offline queue: drain on reconnect ───────────────────────────
  const drainQueue = useCallback(async () => {
    const sent = await flush(async (item: QueuedItem) => {
      if (item.kind === "report") {
        const res = await api.submitReport(item.payload);
        if (res.accepted && res.incident_id) {
          setTrackedIncidentIds((prev) =>
            prev.includes(res.incident_id!) ? prev : [...prev, res.incident_id!],
          );
        }
      } else {
        const res = await api.triggerSOS(
          item.payload.citizen_id,
          item.payload.coordinates,
          item.payload.note,
          item.payload.image_id,
        );
        if (res.accepted && res.incident_id) {
          setTrackedIncidentIds((prev) =>
            prev.includes(res.incident_id!) ? prev : [...prev, res.incident_id!],
          );
        }
      }
    });
    setPendingQueueCount(queueSize());
    if (sent > 0) {
      setStatus({
        kind: "ok",
        message: `Sent ${sent} queued report${sent === 1 ? "" : "s"}.`,
      });
      refreshHistory();
    }
  }, [refreshHistory]);

  useEffect(() => {
    setPendingQueueCount(queueSize());
  }, []);

  useEffect(() => {
    if (online) {
      drainQueue().catch(() => {});
    }
  }, [online, drainQueue]);

  // ── Image handling ───────────────────────────────────────────────
  function clearPendingImage() {
    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(file: File) {
    if (!citizenId) return;
    if (file.size > 6 * 1024 * 1024) {
      setStatus({ kind: "err", message: "Image too large (max 6 MB)." });
      return;
    }
    setUploadingImage(true);
    setStatus({ kind: "idle" });
    try {
      const res = await api.uploadImage(file, citizenId);
      const previewUrl = URL.createObjectURL(file);
      setPendingImage({ ...res, previewUrl });
    } catch (err) {
      setStatus({
        kind: "err",
        message:
          err instanceof Error ? err.message : "Image upload failed.",
      });
    } finally {
      setUploadingImage(false);
    }
  }

  // ── Submit / SOS ─────────────────────────────────────────────────
  async function handleReport() {
    if (!citizenId) return;
    if (!description.trim()) {
      setStatus({
        kind: "err",
        message: "Please describe what you see in a sentence.",
      });
      return;
    }
    setSubmitting(true);
    setStatus({ kind: "idle" });
    const payload = {
      citizen_id: citizenId,
      disaster_type: category,
      description: description.trim(),
      coordinates: [coords[1], coords[0]] as [number, number],
      severity_hint: bucket.numeric,
      image_id: pendingImage?.image_id,
    };
    try {
      const res = await api.submitReport(payload);
      if (res.accepted) {
        setStatus({
          kind: "ok",
          message: "Report received. Help is on the way.",
        });
        setDescription("");
        clearPendingImage();
        refreshHistory();
        if (res.incident_id) {
          setTrackedIncidentIds((prev) =>
            prev.includes(res.incident_id!)
              ? prev
              : [...prev, res.incident_id!],
          );
        }
        // Fold the form so the tracker takes over the top slot.
        setFormOpen(false);
        setInfoOpen(true);
      }
    } catch {
      enqueue({ kind: "report", payload });
      setPendingQueueCount(queueSize());
      setStatus({
        kind: "queued",
        message:
          "Saved on this device. We'll send it as soon as you're back online.",
      });
      setDescription("");
      clearPendingImage();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSOS() {
    if (!citizenId) return;
    setSubmitting(true);
    setStatus({ kind: "idle" });
    const payload = {
      citizen_id: citizenId,
      coordinates: [coords[1], coords[0]] as [number, number],
      note: description.trim() || "SOS — immediate assistance needed",
      image_id: pendingImage?.image_id,
    };
    try {
      const res = await api.triggerSOS(
        payload.citizen_id,
        payload.coordinates,
        payload.note,
        payload.image_id,
      );
      if (res.accepted) {
        setStatus({
          kind: "ok",
          message: "SOS dispatched. Stay where you are if it's safe.",
        });
        setDescription("");
        clearPendingImage();
        refreshHistory();
        if (res.incident_id) {
          setTrackedIncidentIds((prev) =>
            prev.includes(res.incident_id!)
              ? prev
              : [...prev, res.incident_id!],
          );
        }
        setFormOpen(false);
        setInfoOpen(true);
      }
    } catch {
      enqueue({ kind: "sos", payload });
      setPendingQueueCount(queueSize());
      setStatus({
        kind: "queued",
        message:
          "SOS saved on this device. Sending as soon as you're back online. If you can, call emergency services directly.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────
  const combinedAlerts = useMemo(() => {
    const merged = [...liveAlerts, ...nearby.alerts] as AlertItem[];
    const seen = new Set<string>();
    return merged.filter((a) => {
      const key = a.broadcast_id ?? a.message;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [liveAlerts, nearby.alerts]);

  const safetyState = useMemo(() => {
    // Pick the closest meaningful hazard for the top-bar safety pill.
    const sorted = [...nearby.hazards]
      .filter((h) => typeof h.distance_km === "number")
      .sort((a, b) => (a.distance_km ?? 99) - (b.distance_km ?? 99));
    const nearest = sorted[0];
    if (!nearest) {
      return {
        tone: "ok" as const,
        text: "No hazards nearby",
      };
    }
    if ((nearest.distance_km ?? 99) < 0.5) {
      return {
        tone: "danger" as const,
        text: `${nearest.category ?? "Hazard"} — ${nearest.distance_km}km`,
      };
    }
    return {
      tone: "warn" as const,
      text: `${nearest.category ?? "Hazard"} — ${nearest.distance_km}km`,
    };
  }, [nearby.hazards]);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-warm-white text-body-text">
      {/* ── Top bar ── */}
      <header className="flex flex-shrink-0 items-center gap-3 border-b-[3px] border-mid-green bg-forest px-4 py-2.5 sm:px-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[.1em] text-white/60 transition hover:text-warm-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Home</span>
        </Link>
        <span className="hidden h-3.5 w-px bg-white/15 sm:block" />
        <span className="font-serif text-[15px] font-semibold text-warm-white">
          Res<em className="not-italic italic text-light-green">Q</em>Route
        </span>
        <span className="hidden h-3.5 w-px bg-white/15 sm:block" />
        <span className="hidden font-mono text-[10px] uppercase tracking-[.12em] text-white/55 sm:inline">
          Citizen — Bengaluru
        </span>

        <div className="ml-auto flex items-center gap-2">
          <SafetyPill state={safetyState} />
          <ConnectionPill connected={connected} online={online} />
          {pendingQueueCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 border border-warn-amber/40 bg-warn-amber/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] text-warn-amber"
              title="Reports saved offline, waiting to send"
            >
              <Clock className="h-3 w-3" />
              {pendingQueueCount} queued
            </span>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[1fr_440px]">
        {/* MAP */}
        <div className="relative flex-shrink-0 lg:flex-shrink lg:h-auto h-[42vh] lg:h-auto">
          <MapView
            variant="light"
            hazards={hazards}
            missions={[]}
            reportLocation={coords}
            onClickMap={(lng, lat) => setCoords([lng, lat])}
          />
          <MapTip />
        </div>

        {/* RIGHT panel — scrollable. On mobile this sits below the map. */}
        <div className="scroll-thin flex-1 overflow-y-auto border-l border-rule-color bg-mint-white/40 pb-28 lg:pb-4">
          <div className="space-y-4 p-4">
            {/* Live trackers FIRST when we have any — closes the
                emotional loop after a submit. */}
            {incidents.length > 0 && (
              <div className="space-y-3">
                {incidents.slice(0, 3).map((inc) => (
                  <IncidentTracker
                    key={inc.incidentId}
                    incident={inc}
                    events={eventsByIncident.get(inc.incidentId) ?? []}
                  />
                ))}
              </div>
            )}

            {/* The form. Either expanded (entry mode) or folded
                (after submit). Folded shows a single one-line
                "File another?" call-to-action. */}
            {formOpen ? (
              <ReportForm
                category={category}
                onCategory={setCategory}
                description={description}
                onDescription={setDescription}
                bucket={bucket}
                onBucket={setBucket}
                pendingImage={pendingImage}
                onPickFile={handleFile}
                onClearImage={clearPendingImage}
                uploadingImage={uploadingImage}
                fileInputRef={fileInputRef}
                onSubmit={handleReport}
                submitting={submitting}
                status={status}
                online={online}
              />
            ) : (
              <button
                onClick={() => {
                  setFormOpen(true);
                  setStatus({ kind: "idle" });
                }}
                className="flex w-full items-center justify-between border border-rule-color bg-warm-white px-4 py-3 text-left transition hover:border-mid-green"
              >
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[.16em] text-mid-green">
                    Report
                  </div>
                  <div className="font-serif text-[14px] font-semibold text-forest">
                    File another incident
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 text-mid-green" />
              </button>
            )}

            {/* Info disclosure: alerts/hazards/history. Collapsed
                while filing, auto-expands after a submit. */}
            <InfoDisclosure
              open={infoOpen}
              onToggle={() => setInfoOpen((v) => !v)}
              alerts={combinedAlerts}
              hazards={nearby.hazards}
              history={history}
            />
          </div>
        </div>
      </div>

      {/* ── Pinned bottom SOS bar ── */}
      <SosBar
        onPress={handleSOS}
        disabled={submitting}
        status={status}
        online={online}
      />

      {/* First-visit onboarding — three slides, dismissable, never
          shown again on this device. */}
      <CitizenOnboarding />
    </main>
  );
}

// ════════════════════════════════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════════════════════════════════

// ── Top-bar pills ──────────────────────────────────────────────────

function SafetyPill({
  state,
}: {
  state: { tone: "ok" | "warn" | "danger"; text: string };
}) {
  const palette = {
    ok: "border-light-green/40 bg-light-green/15 text-light-green",
    warn: "border-warn-amber/40 bg-warn-amber/15 text-warn-amber",
    danger: "border-emrg-red/50 bg-emrg-red/20 text-emrg-red",
  }[state.tone];
  return (
    <span
      className={
        "hidden items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] sm:inline-flex " +
        palette
      }
      title={state.text}
    >
      <MapPin className="h-3 w-3" />
      {state.text}
    </span>
  );
}

function ConnectionPill({
  connected,
  online,
}: {
  connected: boolean;
  online: boolean;
}) {
  if (!online) {
    return (
      <span className="inline-flex items-center gap-1.5 border border-warn-amber/40 bg-warn-amber/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] text-warn-amber">
        <WifiOff className="h-3 w-3" />
        Offline
      </span>
    );
  }
  const live = connected;
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] " +
        (live
          ? "border-light-green/40 bg-light-green/15 text-light-green"
          : "border-white/15 bg-white/[0.05] text-white/55")
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (live ? "bg-light-green live-pulse" : "bg-white/40")
        }
      />
      {live ? "Live" : "Connecting"}
    </span>
  );
}

// ── Map tip overlay ────────────────────────────────────────────────

function MapTip() {
  return (
    <div className="pointer-events-none absolute left-3 top-3 border-l-[3px] border-mid-green bg-warm-white/95 px-2.5 py-1.5 shadow-[0_4px_24px_rgba(20,61,46,.12)] backdrop-blur">
      <div className="font-mono text-[9px] uppercase tracking-[.14em] text-mid-green">
        Tap map to set location
      </div>
    </div>
  );
}

// ── The big form ───────────────────────────────────────────────────

interface ReportFormProps {
  category: CategoryId;
  onCategory: (c: CategoryId) => void;
  description: string;
  onDescription: (s: string) => void;
  bucket: SeverityBucket;
  onBucket: (b: SeverityBucket) => void;
  pendingImage: {
    image_id: string;
    url: string;
    previewUrl: string;
    size_bytes: number;
  } | null;
  onPickFile: (f: File) => void;
  onClearImage: () => void;
  uploadingImage: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  submitting: boolean;
  status: SubmitStatus;
  online: boolean;
}

function ReportForm(props: ReportFormProps) {
  const {
    category,
    onCategory,
    description,
    onDescription,
    bucket,
    onBucket,
    pendingImage,
    onPickFile,
    onClearImage,
    uploadingImage,
    fileInputRef,
    onSubmit,
    submitting,
    status,
    online,
  } = props;

  const meta = categoryMeta(category);

  return (
    <section className="border border-rule-color bg-warm-white">
      <header className="flex items-center justify-between border-b border-rule-color bg-mint-white/60 px-4 py-2.5">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[.16em] text-mid-green">
            Report
          </div>
          <div className="font-serif text-[14px] font-semibold leading-tight text-forest">
            What&apos;s happening?
          </div>
        </div>
        {!online && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[.08em] text-warn-amber">
            <WifiOff className="h-3 w-3" />
            Offline mode
          </span>
        )}
      </header>

      <div className="space-y-4 p-4">
        {/* ── Category tap-grid ── */}
        <div>
          <SectionLabel>Type</SectionLabel>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {CITIZEN_TAP_GRID.map((id) => {
              const m = CATEGORIES[id];
              const active = id === category;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onCategory(id)}
                  className={
                    "group flex aspect-square flex-col items-center justify-center gap-1 border px-1 py-1.5 text-center transition " +
                    (active
                      ? "border-[2.5px] shadow-[0_2px_12px_rgba(20,61,46,.18)]"
                      : "border-rule-color hover:border-mid-green/60")
                  }
                  style={
                    active
                      ? {
                          borderColor: m.tint,
                          backgroundColor: m.bg,
                          color: m.tint,
                        }
                      : { color: m.tint, backgroundColor: "white" }
                  }
                  aria-pressed={active}
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center"
                    style={{ color: m.tint }}
                  >
                    {m.glyph}
                  </span>
                  <span
                    className={
                      "font-mono text-[10px] uppercase tracking-[.06em] " +
                      (active ? "font-semibold" : "text-muted-text")
                    }
                  >
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] italic leading-relaxed text-muted-text">
            {meta.blurb}
          </p>
        </div>

        {/* ── Description ── */}
        <div>
          <SectionLabel>Describe it</SectionLabel>
          <textarea
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            rows={3}
            placeholder="A sentence is enough — what you see, who's affected."
            className="mt-2 w-full resize-none border border-rule-color bg-warm-white px-3 py-2.5 text-[14px] leading-relaxed text-body-text placeholder:text-muted-text/60 focus:border-mid-green focus:outline-none"
          />
        </div>

        {/* ── Severity buckets ── */}
        <div>
          <SectionLabel>How bad is it?</SectionLabel>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {SEVERITY_BUCKETS.map((b) => {
              const active = b.id === bucket.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onBucket(b)}
                  className={
                    "flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left transition " +
                    (active
                      ? "border-[2.5px]"
                      : "border-rule-color hover:border-mid-green/60")
                  }
                  style={
                    active
                      ? {
                          borderColor: b.tint,
                          backgroundColor: b.bg,
                        }
                      : { backgroundColor: "white" }
                  }
                  aria-pressed={active}
                >
                  <span
                    className="font-serif text-[14px] font-semibold leading-tight"
                    style={{ color: active ? b.tint : "var(--forest)" }}
                  >
                    {b.label}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[.08em] text-muted-text">
                    {b.blurb}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Photo ── */}
        <div>
          <SectionLabel>Photo (optional)</SectionLabel>
          {!pendingImage ? (
            <div className="mt-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="flex w-full items-center justify-center gap-2 border border-dashed border-rule-color bg-warm-white px-4 py-4 text-[13px] text-muted-text transition hover:border-mid-green hover:bg-mint-white disabled:opacity-50"
              >
                {uploadingImage ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 text-mid-green" />
                    Take or upload a photo
                  </>
                )}
              </button>
              <p className="mt-1.5 text-[10px] italic leading-relaxed text-muted-text">
                Helps us classify and verify faster.
              </p>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3 border-l-[3px] border-mid-green bg-safe-pale px-3 py-2.5">
              <Image
                src={pendingImage.previewUrl}
                alt="incident preview"
                width={56}
                height={56}
                className="h-14 w-14 object-cover"
                unoptimized
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-safe-green">
                  <ImageIcon className="h-3 w-3" />
                  Photo attached
                </div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.08em] text-muted-text">
                  {(pendingImage.size_bytes / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                type="button"
                onClick={onClearImage}
                className="border border-rule-color bg-warm-white p-2 text-muted-text transition hover:border-emrg-red hover:bg-emrg-pale hover:text-emrg-red"
                title="Remove image"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ── Primary submit button ── */}
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 bg-forest px-4 py-3.5 text-[14px] font-semibold tracking-wide text-warm-white transition hover:bg-deep-green disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {submitting ? "Sending…" : "Submit report"}
        </button>

        {/* ── Status banner ── */}
        {status.kind !== "idle" && <StatusBanner status={status} />}
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block font-mono text-[9px] uppercase tracking-[.16em] text-muted-text">
      {children}
    </span>
  );
}

function StatusBanner({ status }: { status: SubmitStatus }) {
  if (status.kind === "idle") return null;
  const palette =
    status.kind === "ok"
      ? "border-mid-green bg-safe-pale text-safe-green"
      : status.kind === "queued"
        ? "border-warn-amber bg-warn-pale text-warn-amber"
        : "border-emrg-red bg-emrg-pale text-emrg-red";
  const Icon =
    status.kind === "ok"
      ? CheckCircle2
      : status.kind === "queued"
        ? Clock
        : X;
  return (
    <div
      className={"flex items-start gap-2 border-l-[3px] px-3 py-2 text-[12px] leading-relaxed " + palette}
    >
      <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0" />
      <span>{status.message}</span>
    </div>
  );
}

// ── Info disclosure ────────────────────────────────────────────────

interface InfoDisclosureProps {
  open: boolean;
  onToggle: () => void;
  alerts: AlertItem[];
  hazards: NearbyHazard[];
  history: CitizenHistory | null;
}

function InfoDisclosure({
  open,
  onToggle,
  alerts,
  hazards,
  history,
}: InfoDisclosureProps) {
  const totalCount =
    alerts.length +
    hazards.length +
    (history ? history.report_count + history.sos_count : 0);

  return (
    <section className="border border-rule-color bg-warm-white">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between border-b border-rule-color bg-mint-white/60 px-4 py-2.5 text-left transition hover:bg-mint-white"
      >
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[.16em] text-mid-green">
            Nearby
          </div>
          <div className="font-serif text-[14px] font-semibold leading-tight text-forest">
            Alerts, hazards, history
          </div>
        </div>
        <div className="flex items-center gap-2">
          {totalCount > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[.08em] text-muted-text">
              {totalCount}
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4 text-mid-green" />
          ) : (
            <ChevronDown className="h-4 w-4 text-mid-green" />
          )}
        </div>
      </button>
      {open && (
        <div className="space-y-4 p-4">
          <AlertsSection alerts={alerts} />
          <HazardsSection hazards={hazards} />
          <HistorySection history={history} />
        </div>
      )}
    </section>
  );
}

function AlertsSection({ alerts }: { alerts: AlertItem[] }) {
  return (
    <div>
      <SubSectionHead
        icon={<Megaphone className="h-3.5 w-3.5" />}
        title="Live alerts in your area"
        count={alerts.length}
      />
      {alerts.length === 0 ? (
        <Empty>No alerts in your area.</Empty>
      ) : (
        <ul className="mt-2 space-y-2">
          {alerts.slice(0, 6).map((a, i) => (
            <li
              key={i}
              className="border-l-[3px] border-warn-amber bg-warn-pale/50 p-3"
            >
              <div className="text-[13px] font-medium leading-relaxed text-body-text">
                {a.message}
              </div>
              {a.category && (
                <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[.14em] text-warn-amber">
                  {a.category} · severity {a.severity ?? "?"}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HazardsSection({ hazards }: { hazards: NearbyHazard[] }) {
  return (
    <div>
      <SubSectionHead
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        title="Hazards within 5 km"
        count={hazards.length}
      />
      {hazards.length === 0 ? (
        <Empty>No hazards within 5 km.</Empty>
      ) : (
        <ul className="mt-2 space-y-2">
          {hazards.slice(0, 5).map((h, i) => {
            const m = h.category ? categoryMeta(h.category) : null;
            return (
              <li
                key={i}
                className="flex items-center gap-3 border-l-[3px] p-3"
                style={{
                  borderColor: m?.tint ?? "var(--emrg-red)",
                  backgroundColor: m?.bg ? m.bg + "60" : "var(--emrg-pale)",
                }}
              >
                {m && (
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center"
                    style={{ color: m.tint }}
                  >
                    {m.glyph}
                  </span>
                )}
                <div className="min-w-0">
                  <div
                    className="text-[13px] font-semibold"
                    style={{ color: m?.tint ?? "var(--emrg-red)" }}
                  >
                    {m?.label ?? h.category ?? "Hazard"}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.1em] text-muted-text">
                    Severity {h.severity ?? "?"} ·{" "}
                    {h.distance_km !== undefined
                      ? `${h.distance_km} km away`
                      : "distance unknown"}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HistorySection({ history }: { history: CitizenHistory | null }) {
  const reports = history?.reports ?? [];
  return (
    <div>
      <SubSectionHead
        icon={<History className="h-3.5 w-3.5" />}
        title="Your reports"
        count={
          history ? history.report_count + history.sos_count : undefined
        }
      />
      {reports.length === 0 ? (
        <Empty>You haven&apos;t submitted any reports yet.</Empty>
      ) : (
        <ul className="mt-2 space-y-2">
          {reports.slice(0, 6).map((r, i) => {
            const isSOS = r.kind === "sos";
            const isProcessed = r.status === "processed";
            const isFailed = r.status === "failed";
            return (
              <li
                key={`${r.incident_id ?? i}-${r.submitted_at}`}
                className={
                  "border-l-[3px] p-3 " +
                  (isSOS
                    ? "border-emrg-red bg-emrg-pale/40"
                    : "border-mid-green bg-mint-white/60")
                }
              >
                <div className="flex items-center justify-between">
                  <span
                    className={
                      "inline-flex items-center gap-1.5 text-[13px] font-semibold " +
                      (isSOS ? "text-emrg-red" : "text-forest")
                    }
                  >
                    {isSOS ? (
                      <Siren className="h-3.5 w-3.5" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {r.disaster_type ?? r.kind}
                  </span>
                  <StatusPill processed={isProcessed} failed={isFailed} />
                </div>
                {r.description && (
                  <div className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-text">
                    {r.description}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.1em] text-muted-text">
                  <Clock className="h-3 w-3" />
                  <span>
                    {new Date(r.submitted_at).toLocaleTimeString("en-IN", {
                      hour12: false,
                    })}
                  </span>
                  {r.image_id && (
                    <span className="inline-flex items-center gap-1 text-mid-green">
                      <ImageIcon className="h-3 w-3" />
                      photo
                    </span>
                  )}
                  {r.stages && r.stages.length > 0 && (
                    <span className="ml-auto">{r.stages.length} stages</span>
                  )}
                </div>
                {isFailed && r.error && (
                  <div className="mt-2 border border-emrg-red/30 bg-emrg-pale/60 px-2 py-1 text-[11px] text-emrg-red">
                    {r.error}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SubSectionHead({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-mid-green">
        {icon}
        <span className="font-serif text-[12px] font-semibold text-forest">
          {title}
        </span>
      </div>
      {count !== undefined && (
        <span className="font-mono text-[10px] uppercase tracking-[.08em] text-muted-text">
          {count}
        </span>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 border border-dashed border-rule-color bg-mint-white/40 px-3 py-3 text-center font-mono text-[10px] uppercase tracking-[.12em] text-muted-text/80">
      {children}
    </div>
  );
}

function StatusPill({
  processed,
  failed,
}: {
  processed: boolean;
  failed: boolean;
}) {
  if (failed) {
    return (
      <span className="border border-emrg-red/40 bg-emrg-pale px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[.1em] text-emrg-red">
        Failed
      </span>
    );
  }
  if (processed) {
    return (
      <span className="border border-mid-green/40 bg-safe-pale px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[.1em] text-safe-green">
        Processed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 border border-warn-amber/40 bg-warn-pale px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[.1em] text-warn-amber">
      <Clock className="h-2.5 w-2.5 animate-pulse" />
      Processing
    </span>
  );
}

// ── Pinned bottom SOS bar ──────────────────────────────────────────

function SosBar({
  onPress,
  disabled,
  status,
  online,
}: {
  onPress: () => void;
  disabled: boolean;
  status: SubmitStatus;
  online: boolean;
}) {
  const justSent = status.kind === "ok";
  const queued = status.kind === "queued";
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t-[3px] border-emrg-red bg-warm-white/95 px-3 py-2.5 shadow-[0_-6px_24px_rgba(165,28,28,.12)] backdrop-blur lg:px-4">
      <button
        type="button"
        onClick={onPress}
        disabled={disabled}
        className={
          "flex w-full items-center justify-center gap-3 px-4 py-3.5 text-[15px] font-bold tracking-[.06em] text-warm-white transition disabled:opacity-50 " +
          (justSent || queued
            ? "bg-emrg-red/80 hover:bg-emrg-red"
            : "bg-emrg-red hover:opacity-90")
        }
      >
        <Siren className="h-5 w-5" />
        SOS — TAP FOR IMMEDIATE HELP
      </button>
      <p className="mt-1.5 text-center text-[10px] italic leading-relaxed text-muted-text">
        Sends your location instantly. Description optional.
        {!online && (
          <span className="ml-1 text-warn-amber">
            Offline — will send when reconnected.
          </span>
        )}
      </p>
    </div>
  );
}
