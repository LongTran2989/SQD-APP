'use client';

import { useEffect, useRef, useState } from 'react';
import { BarChart2, ChevronDown, ChevronUp, Star, Clock, ClipboardList, Users } from 'lucide-react';
import {
  getTimeBookingAnalytics,
  TimeBookingAnalytics,
} from '../../../api/taskApi';
import {
  EfficiencyBadge,
  ErrorState,
  InfoTooltip,
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

// ─── Sortable header for Time Booking tables ────────────────────────────────

type TemplSortKey = 'code' | 'title' | 'tasks' | 'actual' | 'estimated' | 'efficiency' | 'overBudget' | 'reason';
type StaffSortKey = 'name' | 'rating' | 'ratedCount' | 'efficiency';

function SortTh<K extends string>({
  children,
  col,
  active,
  dir,
  align = 'right',
  onSort,
  tooltip,
}: {
  children: React.ReactNode;
  col: K;
  active: K;
  dir: 'asc' | 'desc';
  align?: 'left' | 'right' | 'center';
  onSort: (key: K) => void;
  tooltip?: string;
}) {
  const isActive = active === col;
  return (
    <th
      scope="col"
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-5 py-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 rounded p-0.5 hover:text-ink-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${isActive ? 'text-ink-primary' : ''}`}
      >
        {children}
        {isActive && (
          dir === 'asc'
            ? <ChevronUp className="w-3 h-3" aria-hidden="true" />
            : <ChevronDown className="w-3 h-3" aria-hidden="true" />
        )}
      </button>
      {tooltip && <InfoTooltip definition={tooltip} />}
    </th>
  );
}

// ─── Time Booking tab ───────────────────────────────────────────────────────

function TimeBookingTab({ from, to, dateRangeError }: { from: string; to: string; dateRangeError: string | null }) {
  const [data, setData] = useState<TimeBookingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [templSort, setTemplSort] = useState<{ key: TemplSortKey; dir: 'asc' | 'desc' }>({ key: 'efficiency', dir: 'desc' });
  const [staffSort, setStaffSort] = useState<{ key: StaffSortKey; dir: 'asc' | 'desc' }>({ key: 'rating', dir: 'desc' });
  const [staffOpen, setStaffOpen] = useState(true);
  const [templateOpen, setTemplateOpen] = useState(true);

  useEffect(() => {
    if (dateRangeError) return; // invalid range — wait for correction
    let cancelled = false;
    setError(null);
    setLoading(true);
    getTimeBookingAnalytics({ from: from || undefined, to: to || undefined })
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
  }, [from, to, dateRangeError, retryKey]);

  const handleTemplSort = (key: TemplSortKey) =>
    setTemplSort((s) => ({
      key,
      dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : (key === 'code' || key === 'title' || key === 'reason' ? 'asc' : 'desc'),
    }));

  const handleStaffSort = (key: StaffSortKey) =>
    setStaffSort((s) => ({
      key,
      dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : (key === 'name' ? 'asc' : 'desc'),
    }));

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'Something went wrong'} onRetry={() => setRetryKey((k) => k + 1)} />;

  const templates = [...data.templates].sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    switch (templSort.key) {
      case 'code':       av = a.templateCode;             bv = b.templateCode;             break;
      case 'title':      av = a.title;                    bv = b.title;                    break;
      case 'tasks':      av = a.taskCount;                bv = b.taskCount;                break;
      case 'actual':     av = a.avgActualHours ?? -Infinity; bv = b.avgActualHours ?? -Infinity; break;
      case 'estimated':  av = a.estimatedHours ?? -Infinity; bv = b.estimatedHours ?? -Infinity; break;
      case 'efficiency': av = a.efficiencyRatio ?? -Infinity; bv = b.efficiencyRatio ?? -Infinity; break;
      case 'overBudget': av = a.overBudgetCount;          bv = b.overBudgetCount;          break;
      case 'reason':     av = reasonLabel(a.topOverBudgetReason); bv = reasonLabel(b.topOverBudgetReason); break;
      default:           av = 0;                          bv = 0;
    }
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return templSort.dir === 'asc' ? cmp : -cmp;
  });

  const staff = [...data.staff].sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    switch (staffSort.key) {
      case 'name':       av = a.name.toLowerCase();        bv = b.name.toLowerCase();        break;
      case 'rating':     av = a.avgRating ?? -Infinity;    bv = b.avgRating ?? -Infinity;    break;
      case 'ratedCount': av = a.ratedTaskCount;            bv = b.ratedTaskCount;            break;
      case 'efficiency': av = a.avgEfficiencyRatio ?? -Infinity; bv = b.avgEfficiencyRatio ?? -Infinity; break;
      default:           av = 0;                           bv = 0;
    }
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return staffSort.dir === 'asc' ? cmp : -cmp;
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

      {/* Staff Performance — shown first per product priority */}
      <div className="bg-surface-card rounded-xl border border-border-default overflow-hidden">
        <div className="p-5 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-primary">Staff Performance</h2>
          <button
            type="button"
            onClick={() => setStaffOpen((o) => !o)}
            aria-expanded={staffOpen}
            aria-controls="section-staff"
            className="p-1 rounded text-ink-muted hover:text-ink-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue"
          >
            {staffOpen ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            <span className="sr-only">{staffOpen ? 'Collapse' : 'Expand'} staff performance</span>
          </button>
        </div>
        {staffOpen && (
          <div id="section-staff" className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Average rating and efficiency per staff member.</caption>
              <thead>
                <tr className="text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider bg-surface-base">
                  <SortTh col="name" active={staffSort.key} dir={staffSort.dir} align="left" onSort={handleStaffSort}>Name</SortTh>
                  <SortTh col="rating" active={staffSort.key} dir={staffSort.dir} align="center" onSort={handleStaffSort}>Avg Rating</SortTh>
                  <SortTh col="ratedCount" active={staffSort.key} dir={staffSort.dir} onSort={handleStaffSort}>Tasks Rated</SortTh>
                  <SortTh col="efficiency" active={staffSort.key} dir={staffSort.dir} align="center" onSort={handleStaffSort} tooltip="Estimated hours ÷ Actual hours. ≥ 1.0 = on or under budget (green). < 1.0 = over budget (red).">Avg Efficiency</SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {staff.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-ink-secondary">
                      No rated tasks yet.
                    </td>
                  </tr>
                ) : (
                  staff.map((s) => (
                    <tr key={s.userId} className="hover:bg-surface-base transition-colors">
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
        )}
      </div>

      {/* Template Efficiency */}
      <div className="bg-surface-card rounded-xl border border-border-default overflow-hidden">
        <div className="p-5 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-primary">Template Efficiency</h2>
          <button
            type="button"
            onClick={() => setTemplateOpen((o) => !o)}
            aria-expanded={templateOpen}
            aria-controls="section-template"
            className="p-1 rounded text-ink-muted hover:text-ink-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue"
          >
            {templateOpen ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            <span className="sr-only">{templateOpen ? 'Collapse' : 'Expand'} template efficiency</span>
          </button>
        </div>
        {templateOpen && (
          <div id="section-template" className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Average actual versus estimated hours and efficiency ratio per template.
              </caption>
              <thead>
                <tr className="text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider bg-surface-base">
                  <SortTh col="code" active={templSort.key} dir={templSort.dir} align="left" onSort={handleTemplSort}>Template ID</SortTh>
                  <SortTh col="title" active={templSort.key} dir={templSort.dir} align="left" onSort={handleTemplSort}>Title</SortTh>
                  <SortTh col="tasks" active={templSort.key} dir={templSort.dir} onSort={handleTemplSort}>Tasks</SortTh>
                  <SortTh col="actual" active={templSort.key} dir={templSort.dir} onSort={handleTemplSort}>Avg Actual</SortTh>
                  <SortTh col="estimated" active={templSort.key} dir={templSort.dir} onSort={handleTemplSort}>Avg Estimated</SortTh>
                  <SortTh col="efficiency" active={templSort.key} dir={templSort.dir} align="center" onSort={handleTemplSort} tooltip="Estimated hours ÷ Actual hours. ≥ 1.0 = on or under budget (green). < 1.0 = over budget (red).">Efficiency</SortTh>
                  <SortTh col="overBudget" active={templSort.key} dir={templSort.dir} onSort={handleTemplSort}>Over-Budget</SortTh>
                  <SortTh col="reason" active={templSort.key} dir={templSort.dir} align="left" onSort={handleTemplSort}>Top Reason</SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {templates.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-ink-secondary">
                      No completed tasks with time data yet.
                    </td>
                  </tr>
                ) : (
                  templates.map((t) => (
                    <tr key={t.templateId} className="hover:bg-surface-base transition-colors">
                      <th scope="row" className="px-5 py-3 font-mono font-semibold text-ink-secondary text-left">{t.templateCode}</th>
                      <td className="px-5 py-3 text-ink-primary">{t.title}</td>
                      <td className="px-5 py-3 text-right text-ink-primary">{t.taskCount}</td>
                      <td className="px-5 py-3 text-right text-ink-primary">{formatHours(t.avgActualHours)}</td>
                      <td className="px-5 py-3 text-right text-ink-primary">{formatHours(t.estimatedHours)}</td>
                      <td className="px-5 py-3 text-center">
                        <EfficiencyBadge ratio={t.efficiencyRatio} />
                      </td>
                      <td className="px-5 py-3 text-right text-ink-primary">{t.overBudgetCount}</td>
                      <td className="px-5 py-3 text-ink-secondary">
                        {t.overBudgetCount === 0
                          ? <span className="text-ink-muted">None</span>
                          : reasonLabel(t.topOverBudgetReason)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
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

const PRESETS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

export default function AnalyticsPage() {
  const [tab, setTab] = useState<TabKey>('time');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // ── Global date range (shared across all three tabs) ──
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');

  const applyPreset = (days: number) => {
    const now  = new Date();
    const past = new Date();
    past.setDate(past.getDate() - days);
    setFrom(past.toISOString().slice(0, 10));
    setTo(now.toISOString().slice(0, 10));
  };

  const dateRangeError = from && to && from > to ? 'Start date must be before end date.' : null;

  const today = new Date().toISOString().slice(0, 10);
  const activePreset = (() => {
    if (!from || !to || to !== today) return null;
    for (const p of PRESETS) {
      const expected = new Date();
      expected.setDate(expected.getDate() - p.days);
      if (from === expected.toISOString().slice(0, 10)) return p.label;
    }
    return null;
  })();
  const isAllTime = !from && !to;

  // Roving arrow-key navigation across the tablist (WAI-ARIA Tabs pattern).
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (index + dir + TABS.length) % TABS.length;
    setTab(TABS[next].key);
    tabRefs.current[next]?.focus();
  };

  // Shared chip style helpers
  const chipBase = 'px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue';
  const chipActive   = 'bg-signal-blue text-white border-signal-blue';
  const chipInactive = 'border-border-default text-ink-secondary hover:text-ink-primary hover:bg-surface-base';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart2 className="w-6 h-6 text-ink-secondary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-ink-primary text-balance">Analytics</h1>
          <p className="text-sm text-ink-secondary">Time efficiency, staff performance, and findings trends.</p>
        </div>
      </div>

      {/* Period bar — filters all three tabs simultaneously */}
      <div className="bg-surface-card rounded-xl border border-border-default px-5 py-4 flex flex-wrap items-end gap-4">
        <div>
          <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-1.5">Date range</p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Range start date"
              className={`border rounded-lg px-3 py-2 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-signal-blue focus:border-transparent ${dateRangeError ? 'border-red-finding' : 'border-border-default'}`}
            />
            <span className="text-ink-muted text-sm" aria-hidden="true">–</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Range end date"
              className={`border rounded-lg px-3 py-2 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-signal-blue focus:border-transparent ${dateRangeError ? 'border-red-finding' : 'border-border-default'}`}
            />
          </div>
          {dateRangeError && (
            <p className="text-xs text-red-finding mt-1" role="alert">{dateRangeError}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setFrom(''); setTo(''); }}
            className={`${chipBase} ${isAllTime ? chipActive : chipInactive}`}
          >
            All time
          </button>
          {PRESETS.map(({ label, days }) => (
            <button
              key={label}
              type="button"
              onClick={() => applyPreset(days)}
              className={`${chipBase} ${activePreset === label ? chipActive : chipInactive}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="Analytics views" className="flex gap-1 border-b border-border-default">
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
          {tab === key && key === 'time'      && <TimeBookingTab from={from} to={to} dateRangeError={dateRangeError} />}
          {tab === key && key === 'findings'  && <FindingsTab    from={from} to={to} dateRangeError={dateRangeError} />}
          {tab === key && key === 'personnel' && <PersonnelTab   from={from} to={to} dateRangeError={dateRangeError} />}
        </div>
      ))}
    </div>
  );
}
