'use client';

import { useEffect, useState } from 'react';
import { getFindingsAnalytics, FindingsAnalytics } from '../../../api/taskApi';
import { ErrorState, LoadingState, analyticsErrorMessage } from './shared';

// ─── Display helpers ────────────────────────────────────────────────────────

// Per-bucket bar colours, drawn ONLY from the closed design-system palette
// (signal-blue / amber-caution / red-finding / emerald-clear / slate neutral).
// Where there are more buckets than tiers, the always-present category label
// and numeric count disambiguate — colour reinforces, it is never the sole
// signal (WCAG 1.4.1). Dynamic taxonomies (eventType / department / ATA) have
// no fixed meaning and fall back to signal-blue.
const SEVERITY_COLORS: Record<string, string> = {
  Observation: 'bg-signal-blue',
  'Level 1': 'bg-amber-caution',
  'Level 2': 'bg-red-finding',
  Unreviewed: 'bg-slate-400',
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-signal-blue',
  'In Progress': 'bg-amber-caution',
  'Pending Verification': 'bg-amber-caution/60',
  Closed: 'bg-emerald-clear',
  Dismissed: 'bg-slate-400',
};

interface BarItem {
  label: string;
  count: number;
  color?: string;
}

// Horizontal proportional bar list — no charting library, SSR-safe. Rendered as
// a description list so each row reads as "label: count" to a screen reader.
function BarList({ items }: { items: BarItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-secondary px-1 py-2">No data.</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <dl className="space-y-2.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-3 text-sm">
          <dt className="w-36 shrink-0 truncate text-ink-secondary" title={i.label}>
            {i.label}
          </dt>
          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden" aria-hidden="true">
            <div
              className={`h-full rounded-full ${i.color ?? 'bg-signal-blue'}`}
              style={{ width: `${(i.count / max) * 100}%`, minWidth: i.count > 0 ? '0.5rem' : 0 }}
            />
          </div>
          <dd className="w-8 text-right tabular-nums font-semibold text-ink-primary">{i.count}</dd>
        </div>
      ))}
    </dl>
  );
}

// Vertical mini bar chart for the monthly recurrence trend. The bar geometry is
// decorative; the accessible name carries the full month/count series.
function MonthTrend({ items }: { items: { month: string; count: number }[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-secondary px-1 py-2">No findings yet.</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div
      className="flex items-end gap-2 h-44 pt-2"
      role="img"
      aria-label={`Findings raised per month: ${items.map((i) => `${i.month} ${i.count}`).join(', ')}`}
    >
      {items.map((i) => (
        <div key={i.month} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
          <span className="text-xs text-ink-secondary tabular-nums">{i.count}</span>
          <div
            className="w-full max-w-[2.5rem] bg-signal-blue rounded-t"
            style={{ height: `${(i.count / max) * 100}%`, minHeight: i.count > 0 ? '4px' : 0 }}
          />
          <span className="text-[10px] text-ink-secondary truncate w-full text-center" title={i.month}>
            {i.month.slice(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-ink-primary mt-1">{value}</p>
      {hint && <p className="text-xs text-ink-secondary mt-1">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-5 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-ink-primary">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Tab ────────────────────────────────────────────────────────────────────

export default function FindingsTab() {
  const [data, setData] = useState<FindingsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFindingsAnalytics()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(analyticsErrorMessage(err, 'findings analytics'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'Something went wrong'} />;

  if (data.totalCount === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <p className="text-ink-primary font-medium">No findings to report yet.</p>
        <p className="text-sm text-ink-secondary mt-1">
          Severity, status, and recurrence trends appear here once findings are raised against tasks.
        </p>
      </div>
    );
  }

  const resolved = data.closedCount + data.dismissedCount;
  const resolvedPct = data.totalCount > 0 ? Math.round((resolved / data.totalCount) * 100) : 0;

  const severityItems: BarItem[] = data.bySeverity.map((b) => ({
    label: b.key,
    count: b.count,
    color: SEVERITY_COLORS[b.key],
  }));
  const statusItems: BarItem[] = data.byStatus.map((b) => ({
    label: b.key,
    count: b.count,
    color: STATUS_COLORS[b.key],
  }));
  const eventTypeItems: BarItem[] = data.byEventType.map((b) => ({ label: b.key, count: b.count }));
  const departmentItems: BarItem[] = data.byDepartment.map((b) => ({ label: b.name, count: b.count }));
  const ataItems: BarItem[] = data.byAtaChapter.map((b) => ({
    label: `${b.code} · ${b.title}`,
    count: b.count,
  }));

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Findings" value={String(data.totalCount)} />
        <StatCard label="Unresolved" value={String(data.openCount)} hint="not yet resolved" />
        <StatCard
          label="Resolved"
          value={`${resolved}`}
          hint={`${resolvedPct}% · ${data.closedCount} closed, ${data.dismissedCount} dismissed`}
        />
        <StatCard
          label="Avg Time to Close"
          value={data.avgDaysToClose === null ? '—' : `${data.avgDaysToClose} d`}
          hint="closed findings only"
        />
      </div>

      {/* Severity + Status */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="By Severity">
          <BarList items={severityItems} />
        </Section>
        <Section title="By Status">
          <BarList items={statusItems} />
        </Section>
      </div>

      {/* Event type */}
      <Section title="By Event Type">
        <BarList items={eventTypeItems} />
      </Section>

      {/* Department + ATA */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="By Department">
          <BarList items={departmentItems} />
        </Section>
        <Section title="By ATA Chapter">
          <BarList items={ataItems} />
        </Section>
      </div>

      {/* Recurrence trend */}
      <Section title="Recurrence Trend (by month raised)">
        <MonthTrend items={data.byMonth} />
      </Section>
    </div>
  );
}
