'use client';

import { useEffect, useRef, useState } from 'react';
import { BarChart2, Star, Clock, ClipboardList, Users } from 'lucide-react';
import {
  getTimeBookingAnalytics,
  TimeBookingAnalytics,
} from '../../../api/taskApi';
import {
  EfficiencyBadge,
  ErrorState,
  LoadingState,
  analyticsErrorMessage,
  formatHours,
} from './shared';
import FindingsTab from './FindingsTab';
import PersonnelTab from './PersonnelTab';

// ─── Display helpers ────────────────────────────────────────────────────────

// Over-budget reason codes → human-readable labels
const REASON_LABELS: Record<string, string> = {
  COMPLEX_TASK: 'Complex task',
  WAIT_TIME: 'Wait time needed',
  ADDITIONAL_WORK: 'Additional work found',
  OTHER: 'Other',
};

function reasonLabel(reason: string | null): string {
  if (!reason) return '—';
  return REASON_LABELS[reason] ?? reason;
}

// ─── Time Booking tab ───────────────────────────────────────────────────────

function TimeBookingTab() {
  const [data, setData] = useState<TimeBookingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTimeBookingAnalytics()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(analyticsErrorMessage(err, 'analytics'));
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

  // ── Sorting (templates: efficiency desc, nulls last · staff: rating desc, nulls last) ──
  const templates = [...data.templates].sort((a, b) => {
    if (a.efficiencyRatio === null && b.efficiencyRatio === null) return 0;
    if (a.efficiencyRatio === null) return 1;
    if (b.efficiencyRatio === null) return -1;
    return b.efficiencyRatio - a.efficiencyRatio;
  });

  const staff = [...data.staff].sort((a, b) => {
    if (a.avgRating === null && b.avgRating === null) return 0;
    if (a.avgRating === null) return 1;
    if (b.avgRating === null) return -1;
    return b.avgRating - a.avgRating;
  });

  return (
    <div className="space-y-6">
      {/* Incomplete bookings notice */}
      {data.incompleteBookings > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-caution-surface border border-amber-caution/30 rounded-xl text-sm text-amber-caution">
          <AlertTriangleInline />
          {data.incompleteBookings} closed task{data.incompleteBookings === 1 ? '' : 's'}{' '}
          {data.incompleteBookings === 1 ? 'is' : 'are'} missing a time booking and excluded from efficiency data.
        </div>
      )}

      {/* Template Efficiency */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-ink-primary">Template Efficiency</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Average actual versus estimated hours and efficiency ratio per template.
            </caption>
            <thead>
              <tr className="text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider bg-slate-50">
                <th scope="col" className="px-5 py-3">Template ID</th>
                <th scope="col" className="px-5 py-3">Title</th>
                <th scope="col" className="px-5 py-3 text-right">Tasks</th>
                <th scope="col" className="px-5 py-3 text-right">Avg Actual</th>
                <th scope="col" className="px-5 py-3 text-right">Avg Estimated</th>
                <th scope="col" className="px-5 py-3 text-center">Efficiency</th>
                <th scope="col" className="px-5 py-3 text-right">Over-Budget</th>
                <th scope="col" className="px-5 py-3">Top Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-ink-secondary">
                    No completed tasks with time data yet.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.templateId} className="hover:bg-slate-50 transition-colors">
                    <th scope="row" className="px-5 py-3 font-mono font-semibold text-ink-secondary text-left">{t.templateCode}</th>
                    <td className="px-5 py-3 text-ink-primary">{t.title}</td>
                    <td className="px-5 py-3 text-right text-ink-primary">{t.taskCount}</td>
                    <td className="px-5 py-3 text-right text-ink-primary">{formatHours(t.avgActualHours)}</td>
                    <td className="px-5 py-3 text-right text-ink-primary">{formatHours(t.estimatedHours)}</td>
                    <td className="px-5 py-3 text-center">
                      <EfficiencyBadge ratio={t.efficiencyRatio} />
                    </td>
                    <td className="px-5 py-3 text-right text-ink-primary">{t.overBudgetCount}</td>
                    <td className="px-5 py-3 text-ink-secondary">{reasonLabel(t.topOverBudgetReason)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Staff Performance */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-ink-primary">Staff Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Average rating and efficiency per staff member.</caption>
            <thead>
              <tr className="text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider bg-slate-50">
                <th scope="col" className="px-5 py-3">Name</th>
                <th scope="col" className="px-5 py-3 text-center">Avg Rating</th>
                <th scope="col" className="px-5 py-3 text-right">Tasks Rated</th>
                <th scope="col" className="px-5 py-3 text-center">Avg Efficiency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-ink-secondary">
                    No rated tasks yet.
                  </td>
                </tr>
              ) : (
                staff.map((s) => (
                  <tr key={s.userId} className="hover:bg-slate-50 transition-colors">
                    <th scope="row" className="px-5 py-3 text-ink-primary font-medium text-left">{s.name}</th>
                    <td className="px-5 py-3 text-center">
                      {s.avgRating === null ? (
                        <span className="text-ink-muted" aria-label="No rating">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            s.avgRating >= 4 ? 'text-amber-caution' : 'text-ink-secondary'
                          }`}
                          aria-label={`Average rating ${s.avgRating.toFixed(1)} out of 5`}
                        >
                          <Star className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                          {s.avgRating.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-ink-primary">{s.ratedTaskCount}</td>
                    <td className="px-5 py-3 text-center">
                      <EfficiencyBadge ratio={s.avgEfficiencyRatio} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Small inline caution glyph for the incomplete-bookings notice (inherits
// currentColor so it tracks the amber-caution text).
function AlertTriangleInline() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

// ─── Page (tab shell) ───────────────────────────────────────────────────────

type TabKey = 'time' | 'findings' | 'personnel';

const TABS: { key: TabKey; label: string; icon: typeof Clock }[] = [
  { key: 'time', label: 'Time Efficiency', icon: Clock },
  { key: 'findings', label: 'Findings', icon: ClipboardList },
  { key: 'personnel', label: 'Personnel', icon: Users },
];

export default function AnalyticsPage() {
  const [tab, setTab] = useState<TabKey>('time');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving arrow-key navigation across the tablist (WAI-ARIA Tabs pattern).
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (index + dir + TABS.length) % TABS.length;
    setTab(TABS[next].key);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white p-8 rounded-2xl border border-slate-200 flex items-center gap-4">
        <div className="p-3 bg-slate-100 rounded-xl">
          <BarChart2 className="w-7 h-7 text-ink-secondary" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink-primary text-balance">Analytics</h1>
          <p className="text-ink-secondary">Time efficiency, staff performance, and findings trends.</p>
        </div>
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="Analytics views" className="flex gap-1 border-b border-slate-200">
        {TABS.map(({ key, label, icon: Icon }, i) => {
          const active = tab === key;
          return (
            <button
              key={key}
              ref={(el) => { tabRefs.current[i] = el; }}
              type="button"
              role="tab"
              id={`tab-${key}`}
              aria-selected={active}
              aria-controls={`panel-${key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue focus-visible:ring-offset-1 ${
                active
                  ? 'border-signal-blue text-signal-blue'
                  : 'border-transparent text-ink-secondary hover:text-ink-primary'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Active tab */}
      {TABS.map(({ key }) => (
        <div
          key={key}
          role="tabpanel"
          id={`panel-${key}`}
          aria-labelledby={`tab-${key}`}
          hidden={tab !== key}
        >
          {tab === key && key === 'time' && <TimeBookingTab />}
          {tab === key && key === 'findings' && <FindingsTab />}
          {tab === key && key === 'personnel' && <PersonnelTab />}
        </div>
      ))}
    </div>
  );
}
