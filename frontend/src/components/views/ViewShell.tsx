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
      <div className="flex items-center justify-between border-b border-admin-rule bg-onyx-2/50 px-5 py-3">
        <div>
          {kicker && (
            <div className="font-mono text-[9px] uppercase tracking-[.18em] text-safety-org">
              {kicker}
            </div>
          )}
          <h2 className="font-serif text-[18px] font-normal leading-tight text-admin-text">
            {title}
          </h2>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>
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
      <div className="font-mono text-[10px] uppercase tracking-[.14em] text-steel-light">
        {title}
      </div>
      {hint && (
        <div className="mt-1.5 max-w-[300px] text-[11px] text-steel-light/70">
          {hint}
        </div>
      )}
    </div>
  );
}
