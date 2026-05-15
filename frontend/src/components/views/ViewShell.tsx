"use client";

import type { ReactNode } from "react";

export function ViewShell({
  title,
  kicker,
  actions,
  children,
}: {
  title: string;
  kicker?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Editorial section masthead — double rule + serif headline */}
      <div className="flex items-end justify-between border-b border-admin-text bg-onyx-2 px-6 pb-2 pt-4">
        <div>
          {kicker && (
            <div className="font-mono text-[9px] uppercase tracking-[.2em] text-admin-muted">
              {kicker}
            </div>
          )}
          <h2
            className="mt-0.5 font-serif text-[26px] font-semibold leading-none tracking-tight text-admin-text"
            style={{ letterSpacing: "-0.01em" }}
          >
            {title}
          </h2>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto bg-onyx">
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <div className="font-serif text-[10px] uppercase tracking-[.18em] text-admin-muted">
        {title}
      </div>
      {hint && (
        <div className="mt-2 max-w-[320px] font-serif italic text-[12px] leading-relaxed text-admin-muted">
          {hint}
        </div>
      )}
    </div>
  );
}
