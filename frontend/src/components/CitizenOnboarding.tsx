"use client";

/**
 * CitizenOnboarding — first-visit-only modal that explains, in 3
 * slides, how to file a report. Disappears after dismiss and never
 * comes back unless the user clears localStorage.
 *
 * Three slides, kept short — anyone hitting this page in a real
 * emergency wouldn't read more than a sentence per slide. The whole
 * flow is dismissable from any slide.
 */

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Camera,
  Send,
  Siren,
  WifiOff,
  X,
} from "lucide-react";

const SEEN_KEY = "resqroute_citizen_onboarding_v1";

interface Slide {
  kicker: string;
  title: string;
  body: string;
  // Big visual icon — single-purpose, accessible to non-readers.
  icon: React.ReactNode;
  iconColor: string;
}

const SLIDES: Slide[] = [
  {
    kicker: "01 · How to report",
    title: "Tap the type. Describe in a sentence. Submit.",
    body:
      "Pick what's happening from the icons (flood, fire, accident, …). One sentence is enough. We'll do the rest.",
    icon: <Send className="h-12 w-12" />,
    iconColor: "var(--forest, #143D2E)",
  },
  {
    kicker: "02 · For emergencies",
    title: "Hit the red SOS bar.",
    body:
      "It's pinned to the bottom of every screen. Your location is enough — a description is optional.",
    icon: <Siren className="h-12 w-12" />,
    iconColor: "var(--emrg-red, #A51C1C)",
  },
  {
    kicker: "03 · Works offline",
    title: "Don't worry about your signal.",
    body:
      "If you're offline, your report saves on this device and sends as soon as you're back online.",
    icon: <WifiOff className="h-12 w-12" />,
    iconColor: "var(--warn-amber, #B98C00)",
  },
];

export default function CitizenOnboarding() {
  // Three states: not-decided (loading flag), dismissed, showing.
  const [open, setOpen] = useState<boolean | null>(null);
  const [step, setStep] = useState(0);

  // Read the seen flag client-side only. Server-render gives `null` so
  // there's no flash of modal during SSR.
  useEffect(() => {
    if (typeof window === "undefined") {
      setOpen(false);
      return;
    }
    try {
      const seen = window.localStorage.getItem(SEEN_KEY) === "true";
      setOpen(!seen);
    } catch {
      setOpen(false);
    }
  }, []);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "true");
    } catch {
      /* ignore — modal will reappear on next visit, no harm done */
    }
  }

  function next() {
    if (step >= SLIDES.length - 1) dismiss();
    else setStep((s) => s + 1);
  }

  if (!open) return null;
  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center">
      <div className="relative w-full max-w-md border-t-[3px] border-mid-green bg-warm-white shadow-[0_-12px_40px_rgba(20,61,46,0.18)] sm:border sm:border-mid-green/20 sm:shadow-[0_12px_40px_rgba(20,61,46,0.22)]">
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center border border-rule-color text-muted-text transition hover:border-emrg-red hover:text-emrg-red"
          aria-label="Skip introduction"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="px-6 pb-5 pt-7">
          <div className="font-mono text-[10px] uppercase tracking-[.16em] text-mid-green">
            {slide.kicker}
          </div>
          <h2 className="mt-1 font-serif text-[20px] font-semibold leading-tight text-forest">
            {slide.title}
          </h2>

          {/* Big illustrative icon. Sits to the left of the body text on
              tablet+, stacks above on phone. */}
          <div className="mt-5 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center border-l-[3px] border-mid-green bg-mint-white/60"
              style={{ color: slide.iconColor }}
            >
              {slide.icon}
            </div>
            <p className="font-serif text-[14px] leading-relaxed text-body-text">
              {slide.body}
            </p>
          </div>

          {/* Bonus image hint on slide 1 — citizens who skipped the slide
              labels still see "Camera = optional photo upload".  */}
          {step === 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 font-serif italic text-[12px] text-muted-text">
              <Camera className="h-3.5 w-3.5 text-mid-green" />
              You can also attach a photo — it helps us classify faster.
            </p>
          )}
        </div>

        {/* Footer: dot indicator + skip + next/done */}
        <div className="flex items-center justify-between border-t border-rule-color bg-mint-white/40 px-6 py-3">
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-4 transition"
                style={{
                  background:
                    i === step
                      ? "var(--forest, #143D2E)"
                      : "var(--rule-color, #D9D2C3)",
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isLast && (
              <button
                onClick={dismiss}
                className="font-mono text-[10px] uppercase tracking-[.14em] text-muted-text transition hover:text-emrg-red"
              >
                Skip
              </button>
            )}
            <button
              onClick={next}
              className="inline-flex items-center gap-1.5 bg-forest px-4 py-2 text-[13px] font-semibold tracking-wide text-warm-white transition hover:bg-deep-green"
            >
              {isLast ? "Got it" : "Next"}
              {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
