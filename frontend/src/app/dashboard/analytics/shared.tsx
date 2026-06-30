'use client';

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

// Centered loading state with an accessible status announcement. The spinner is
// suppressed under prefers-reduced-motion; the status text always announces.
export function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64" role="status">
      <span
        className="animate-spin motion-reduce:animate-none rounded-full h-8 w-8 border-t-2 border-b-2 border-signal-blue"
        aria-hidden="true"
      />
      <span className="sr-only">Loading analytics…</span>
    </div>
  );
}

// Error panel. Renders as an alert with an h2 (never a second h1 inside the
// page) so heading hierarchy stays intact.
export function ErrorState({ message }: { message: string }) {
  return (
    <div className="max-w-xl mx-auto mt-16 text-center space-y-4" role="alert">
      <div className="w-16 h-16 bg-red-finding-surface rounded-full flex items-center justify-center mx-auto">
        <AlertTriangle className="w-8 h-8 text-red-finding" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-bold text-ink-primary">{message}</h2>
    </div>
  );
}

// Maps an axios-style error to a friendly message (403 vs generic).
export function analyticsErrorMessage(err: unknown, subject: string): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 403
    ? 'You do not have permission to view this data.'
    : `Failed to load ${subject}. Please try again.`;
}
