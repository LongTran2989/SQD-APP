'use client';

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';

// ─── Shared analytics primitives ─────────────────────────────────────────────
// Single source of truth for the efficiency badge, hour formatting, and the
// loading / error states that every analytics tab reuses. Keeping these here
// means a contrast or a11y fix lands once, not three times.

export function formatHours(h: number | null): string {
  if (h === null) return '—';
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

export function formatPct(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${Math.round(ratio * 100)}%`;
}

// Efficiency ratio badge. Formula: est ÷ actual, so ≥1.0 = on/under budget (good = green),
// <1.0 = over budget (bad = red). Colour reinforces the state but is never the sole signal:
// a directional icon and an aria-label carry the same meaning for colour-blind and
// screen-reader users (WCAG 1.4.1). Uses the design-system status tiers (emerald-clear /
// red-finding) at full strength so the label clears 4.5:1 on its surface.
export function EfficiencyBadge({ ratio }: { ratio: number | null }) {
  if (ratio === null) {
    return (
      <span className="text-ink-muted" aria-label="No efficiency data">
        —
      </span>
    );
  }
  // ≥1.0 means on or under budget (efficient). <1.0 means over budget.
  const efficient = ratio >= 1.0;
  const Icon = efficient ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${
        efficient
          ? 'bg-emerald-clear-surface text-emerald-clear border-emerald-clear/20'
          : 'bg-red-finding-surface text-red-finding border-red-finding/20'
      }`}
      aria-label={`${ratio.toFixed(2)}× efficiency (est ÷ actual), ${efficient ? 'on or under budget' : 'over budget'}`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {ratio.toFixed(2)}×
    </span>
  );
}

// Skeleton loading state — preferred over spinners for content areas (product register).
// Aria role="status" announces to screen readers; the visible skeleton gives layout context.
export function LoadingState() {
  return (
    <div role="status" aria-label="Loading analytics…">
      <span className="sr-only">Loading analytics…</span>
      {/* Header skeleton */}
      <div className="bg-surface-card rounded-xl border border-border-default overflow-hidden mb-4 animate-pulse motion-reduce:animate-none">
        <div className="p-5 border-b border-border-subtle">
          <div className="h-5 w-40 bg-border-subtle rounded" />
        </div>
        <div className="divide-y divide-border-subtle">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
              <div className="h-4 w-24 bg-border-subtle rounded shrink-0" />
              <div className="h-4 flex-1 bg-border-subtle rounded" />
              <div className="h-4 w-16 bg-border-subtle rounded shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Error panel. Renders as an alert with an h2 (never a second h1 inside the
// page) so heading hierarchy stays intact. Pass onRetry to show a "Try again"
// button — callers should reset state and re-trigger the fetch.
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="max-w-xl mx-auto mt-16 text-center space-y-4" role="alert">
      <div className="w-16 h-16 bg-red-finding-surface rounded-full flex items-center justify-center mx-auto">
        <AlertTriangle className="w-8 h-8 text-red-finding" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-bold text-ink-primary">{message}</h2>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-signal-blue border border-signal-blue/30 rounded-xl bg-signal-blue-surface hover:bg-signal-blue/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue"
        >
          Try again
        </button>
      )}
    </div>
  );
}

// Small '?' badge that surfaces a metric definition on hover/focus.
// Uses a portal so the tooltip renders on document.body — safe inside
// overflow:auto table wrappers that would otherwise clip position:absolute.
export function InfoTooltip({ definition }: { definition: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const hide = useCallback(() => setPos(null), []);

  const show = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top - 8, left: r.left + r.width / 2 });
    window.addEventListener('scroll', hide, { passive: true, capture: true, once: true });
  }, [hide]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={definition}
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={hide}
        onBlur={hide}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-border-subtle text-ink-muted text-[9px] font-bold cursor-help ml-1 hover:bg-border-default hover:text-ink-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue align-middle"
      >
        ?
      </button>
      {pos !== null &&
        createPortal(
          <div
            role="tooltip"
            className="fixed w-72 text-left text-xs text-ink-primary bg-surface-card border border-border-default rounded-lg px-3 py-2 shadow-lg pointer-events-none break-words"
            style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)', zIndex: 9999 }}
          >
            {definition}
          </div>,
          document.body,
        )}
    </>
  );
}

// Maps an axios-style error to a friendly message (403 vs generic).
export function analyticsErrorMessage(err: unknown, subject: string): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 403
    ? 'You do not have permission to view this data.'
    : `Failed to load ${subject}. Please try again.`;
}
