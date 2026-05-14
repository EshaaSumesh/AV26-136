"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  History,
  ImageIcon,
  MapPin,
  Megaphone,
  Send,
  Siren,
  Trash2,
  User,
  X,
} from "lucide-react";

import { api, CITY_CENTER } from "@/lib/api";
import type { CitizenHistory, HazardZone } from "@/lib/types";
import { DISASTER_TYPES } from "@/lib/types";
import { useCitizenWS } from "@/lib/useAuthorityWS";

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

export default function CitizenPage() {
  const [citizenId, setCitizenId] = useState<string>("");
  const [coords, setCoords] = useState<[number, number]>(DEFAULT_CENTER);
  const [disasterType, setDisasterType] = useState<string>("flood");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState(3);
  const [hazards, setHazards] = useState<HazardZone[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitTone, setSubmitTone] = useState<"ok" | "err">("ok");
  const [nearby, setNearby] = useState<{
    alerts: AlertItem[];
    hazards: NearbyHazard[];
  }>({
    alerts: [],
    hazards: [],
  });
  const [history, setHistory] = useState<CitizenHistory | null>(null);
  const [pendingImage, setPendingImage] = useState<{
    image_id: string;
    url: string;
    previewUrl: string;
    size_bytes: number;
  } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { connected, alerts: liveAlerts } = useCitizenWS(citizenId);

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
    if (!citizenId) return;
    api.subscribeCitizen(citizenId, coords[1], coords[0]).catch(() => {});
  }, [citizenId, coords]);

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

  function clearPendingImage() {
    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(file: File) {
    if (!citizenId) return;
    if (file.size > 6 * 1024 * 1024) {
      setSubmitTone("err");
      setSubmitMessage("Image too large (max 6 MB).");
      return;
    }
    setUploadingImage(true);
    setSubmitMessage(null);
    try {
      const res = await api.uploadImage(file, citizenId);
      const previewUrl = URL.createObjectURL(file);
      setPendingImage({ ...res, previewUrl });
    } catch (err) {
      setSubmitTone("err");
      setSubmitMessage(
        err instanceof Error ? err.message : "Image upload failed.",
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleReport() {
    if (!citizenId) return;
    if (!description.trim()) {
      setSubmitTone("err");
      setSubmitMessage("Please describe what you see.");
      return;
    }
    setSubmitting(true);
    setSubmitMessage(null);
    try {
      const res = await api.submitReport({
        citizen_id: citizenId,
        disaster_type: disasterType,
        description,
        coordinates: [coords[1], coords[0]],
        severity_hint: severity,
        image_id: pendingImage?.image_id,
      });
      if (res.accepted) {
        setSubmitTone("ok");
        setSubmitMessage("Report submitted. Agents are responding.");
        setDescription("");
        clearPendingImage();
        refreshHistory();
      }
    } catch {
      setSubmitTone("err");
      setSubmitMessage("Submission failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSOS() {
    if (!citizenId) return;
    setSubmitting(true);
    setSubmitMessage(null);
    try {
      const res = await api.triggerSOS(
        citizenId,
        [coords[1], coords[0]],
        description || "SOS — immediate assistance needed",
        pendingImage?.image_id,
      );
      if (res.accepted) {
        setSubmitTone("ok");
        setSubmitMessage("SOS dispatched. Help is on the way.");
        setDescription("");
        clearPendingImage();
        refreshHistory();
      }
    } catch {
      setSubmitTone("err");
      setSubmitMessage("SOS failed. Call emergency services directly.");
    } finally {
      setSubmitting(false);
    }
  }

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

  const shortId = citizenId ? citizenId.slice(-6).toUpperCase() : "—";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-warm-white text-body-text">
      {/* ── Top bar ── */}
      <header className="flex items-center gap-4 border-b-[3px] border-mid-green bg-forest px-5 py-2.5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[.1em] text-white/60 transition hover:text-warm-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Home
        </Link>
        <span className="h-3.5 w-px bg-white/15" />
        <span className="font-serif text-[15px] font-semibold text-warm-white">
          Res<em className="not-italic italic text-light-green">Q</em>Route
        </span>
        <span className="h-3.5 w-px bg-white/15" />
        <span className="font-mono text-[10px] uppercase tracking-[.12em] text-white/55">
          Citizen — Bengaluru
        </span>

        <div className="ml-auto flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 border border-white/15 bg-white/[0.05] px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] text-warm-white"
            title={citizenId}
          >
            <User className="h-3 w-3 text-light-green" />
            {shortId}
          </span>
          <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[.08em] text-white/55 sm:inline-flex">
            <MapPin className="h-3 w-3 text-light-green" />
            {coords[1].toFixed(4)}, {coords[0].toFixed(4)}
          </span>
          <span
            className={
              "inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] " +
              (connected
                ? "border-light-green/40 bg-light-green/15 text-light-green"
                : "border-white/15 bg-white/[0.05] text-white/55")
            }
          >
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (connected ? "bg-light-green live-pulse" : "bg-white/40")
              }
            />
            {connected ? "Subscribed" : "Connecting"}
          </span>
        </div>
      </header>

      {/* ── Body grid ── */}
      <div className="grid flex-1 overflow-hidden lg:grid-cols-[1fr_440px]">
        {/* MAP + Tip */}
        <div className="relative">
          <MapView
            hazards={hazards}
            missions={[]}
            reportLocation={coords}
            onClickMap={(lng, lat) => setCoords([lng, lat])}
          />
          <div className="pointer-events-none absolute left-3 top-3 max-w-[260px] border-l-[3px] border-mid-green bg-warm-white/95 p-3 shadow-[0_4px_24px_rgba(20,61,46,.12)] backdrop-blur">
            <div className="font-mono text-[9px] uppercase tracking-[.16em] text-mid-green">
              Tip
            </div>
            <div className="mt-1 text-[12px] leading-[1.55] text-body-text">
              Tap the map to set your incident location. We&apos;ve pre-filled
              with your GPS if available.
            </div>
          </div>
        </div>

        {/* RIGHT panel */}
        <div className="scroll-thin flex-1 space-y-4 overflow-y-auto border-l border-rule-color bg-mint-white/40 p-4">
          {/* Report card */}
          <Card kicker="Report" title="Submit an incident">
            <div className="grid gap-3">
              <Field label="Disaster type">
                <select
                  value={disasterType}
                  onChange={(e) => setDisasterType(e.target.value)}
                  className="w-full border border-rule-color bg-warm-white px-2.5 py-2 text-[13px] text-body-text focus:border-mid-green focus:outline-none"
                >
                  {DISASTER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What do you see? (location, what's happening, any people affected)"
                  className="w-full resize-none border border-rule-color bg-warm-white px-2.5 py-2 text-[13px] text-body-text placeholder:text-muted-text/60 focus:border-mid-green focus:outline-none"
                />
              </Field>

              <Field label={`Severity: ${severity} of 5`}>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={severity}
                  onChange={(e) => setSeverity(Number(e.target.value))}
                  className="w-full accent-mid-green"
                />
              </Field>

              <Field label="Photo evidence (optional)">
                {!pendingImage ? (
                  <div className="flex flex-col gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage}
                      className="inline-flex items-center justify-center gap-2 border border-dashed border-rule-color bg-warm-white px-3 py-3 text-[12px] text-muted-text transition hover:border-mid-green hover:bg-mint-white disabled:opacity-50"
                    >
                      {uploadingImage ? (
                        <>
                          <Clock className="h-3.5 w-3.5 animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          <Camera className="h-3.5 w-3.5 text-mid-green" />
                          Tap to take a photo or upload
                        </>
                      )}
                    </button>
                    <p className="text-[10px] leading-relaxed text-muted-text">
                      Gemini Vision will analyze the photo to verify and
                      classify the disaster.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 border-l-[3px] border-mid-green bg-safe-pale px-3 py-2.5">
                    <Image
                      src={pendingImage.previewUrl}
                      alt="incident preview"
                      width={56}
                      height={56}
                      className="h-14 w-14 object-cover"
                      unoptimized
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-safe-green">
                        <ImageIcon className="h-3 w-3" />
                        {pendingImage.image_id}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.08em] text-muted-text">
                        {(pendingImage.size_bytes / 1024).toFixed(1)} KB —
                        attached
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearPendingImage}
                      className="border border-rule-color bg-warm-white p-1.5 text-muted-text hover:border-emrg-red hover:bg-emrg-pale hover:text-emrg-red"
                      title="Remove image"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </Field>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleReport}
                  disabled={submitting}
                  className="flex flex-1 items-center justify-center gap-1.5 bg-forest px-3 py-2.5 text-[12px] font-semibold tracking-wide text-warm-white transition hover:bg-deep-green disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  Submit Report
                </button>
                <button
                  onClick={handleSOS}
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-1.5 bg-emrg-red px-4 py-2.5 text-[12px] font-bold tracking-[.06em] text-warm-white transition hover:opacity-90 disabled:opacity-50"
                >
                  <Siren className="h-3.5 w-3.5" />
                  SOS
                </button>
              </div>
              {submitMessage && (
                <div
                  className={
                    "flex items-center gap-2 border-l-[3px] px-3 py-2 text-[12px] " +
                    (submitTone === "ok"
                      ? "border-mid-green bg-safe-pale text-safe-green"
                      : "border-emrg-red bg-emrg-pale text-emrg-red")
                  }
                >
                  {submitTone === "ok" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {submitMessage}
                </div>
              )}
            </div>
          </Card>

          <CitizenHistorySection history={history} />

          {/* Live alerts */}
          <Card
            kicker="Alerts"
            title="Live in your area"
            badge={combinedAlerts.length}
            icon={<Megaphone className="h-3.5 w-3.5" />}
          >
            {combinedAlerts.length === 0 ? (
              <Empty>No alerts in your area.</Empty>
            ) : (
              <ul className="space-y-2">
                {combinedAlerts.slice(0, 6).map((a, i) => (
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
          </Card>

          {/* Nearby hazards */}
          <Card
            kicker="Hazards"
            title="Within 5 km"
            badge={nearby.hazards.length}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
          >
            {nearby.hazards.length === 0 ? (
              <Empty>No hazards within 5 km.</Empty>
            ) : (
              <ul className="space-y-2">
                {nearby.hazards.slice(0, 5).map((h, i) => (
                  <li
                    key={i}
                    className="border-l-[3px] border-emrg-red bg-emrg-pale/40 p-3"
                  >
                    <div className="text-[13px] font-semibold text-emrg-red">
                      {h.category ?? "Hazard"}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[.1em] text-muted-text">
                      Severity {h.severity ?? "?"} ·{" "}
                      {h.distance_km !== undefined
                        ? `${h.distance_km} km away`
                        : "distance unknown"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Card({
  kicker,
  title,
  icon,
  badge,
  children,
}: {
  kicker: string;
  title: string;
  icon?: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-rule-color bg-warm-white">
      <header className="flex items-center justify-between border-b border-rule-color bg-mint-white/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-mid-green">{icon}</span> : null}
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[.16em] text-mid-green">
              {kicker}
            </div>
            <div className="font-serif text-[14px] font-semibold leading-tight text-forest">
              {title}
            </div>
          </div>
        </div>
        {badge !== undefined && (
          <span className="font-mono text-[10px] uppercase tracking-[.08em] text-muted-text">
            {badge}
          </span>
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[.16em] text-muted-text">
        {label}
      </span>
      {children}
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-rule-color bg-mint-white/40 px-3 py-4 text-center font-mono text-[10px] uppercase tracking-[.12em] text-muted-text/80">
      {children}
    </div>
  );
}

function CitizenHistorySection({ history }: { history: CitizenHistory | null }) {
  const reports = history?.reports ?? [];
  return (
    <Card
      kicker="Activity"
      title="Your reports"
      icon={<History className="h-3.5 w-3.5" />}
      badge={history ? history.report_count + history.sos_count : undefined}
    >
      {reports.length === 0 ? (
        <Empty>You haven&apos;t submitted any reports yet.</Empty>
      ) : (
        <ul className="space-y-2">
          {reports.map((r, i) => {
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
    </Card>
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
