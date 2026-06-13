'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getFindingsAnalytics, FindingsAnalytics } from '../../../api/taskApi';

// ─── Display helpers ────────────────────────────────────────────────────────

// Per-bucket bar colours (Tailwind classes). Falls back to blue for dynamic
// taxonomies (eventType / department / ATA) where there is no fixed palette.
const SEVERITY_COLORS: Record<string, string> = {
  Observation: 'bg-sky-500',
  'Level 1': 'bg-amber-500',
  'Level 2': 'bg-red-500',
  Unreviewed: 'bg-slate-400',
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-blue-500',
  'In Progress': 'bg-indigo-500',
  'Pending Verification': 'bg-amber-500',
  Closed: 'bg-green-500',
  Dismissed: 'bg-slate-400',
};

interface BarItem {
  label: string;
  count: number;
  color?: string;
}

// Horizontal proportional bar list — no charting library, SSR-safe.
function BarList({ items }: { items: BarItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400 px-1 py-2">No data.</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-3 text-sm">
          <div className="w-36 shrink-0 truncate text-slate-600" title={i.label}>
            {i.label}
          </div>
          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
            <div
              className={`h-full rounded-full ${i.color ?? 'bg-blue-500'}`}
              style={{ width: `${(i.count / max) * 100}%`, minWidth: i.count > 0 ? '0.5rem' : 0 }}
            />
          </div>
          <div className="w-8 text-right tabular-nums font-semibold text-slate-700">{i.count}</div>
        </div>
      ))}
    </div>
  );
}

// Vertical mini bar chart for the monthly recurrence trend.
function MonthTrend({ items }: { items: { month: string; count: number }[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400 px-1 py-2">No findings yet.</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="flex items-end gap-2 h-44 pt-2">
      {items.map((i) => (
        <div key={i.month} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
          <span className="text-xs text-slate-500 tabular-nums">{i.count}</span>
          <div
            className="w-full max-w-[2.5rem] bg-blue-500 rounded-t"
            style={{ height: `${(i.count / max) * 100}%`, minHeight: i.count > 0 ? '4px' : 0 }}
            title={`${i.month}: ${i.count}`}
          />
          <span className="text-[10px] text-slate-400 truncate w-full text-center" title={i.month}>
            {i.month.slice(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-5 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-700">{title}</h2>
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
        if (!cancelled) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          setError(
            status === 403
              ? 'You do not have permission to view analytics.'
              : 'Failed to load findings analytics. Please try again.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-800">{error ?? 'Something went wrong'}</h1>
      </div>
    );
  }

  if (data.totalCount === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-400">
        No findings to report yet.
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
        <StatCard label="Open" value={String(data.openCount)} hint="not yet resolved" />
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
