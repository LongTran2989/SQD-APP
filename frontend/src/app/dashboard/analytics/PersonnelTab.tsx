'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Users } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from 'recharts';
import {
  getPersonnelWorkload,
  getPersonnelDetail,
  PersonnelRow,
  PersonnelDetail,
} from '../../../api/workloadApi';
import { getDivisions } from '../../../api/taskApi';
import { useAuthStore } from '../../../store/authStore';
import { EfficiencyBadge, ErrorState, LoadingState, analyticsErrorMessage, formatHours, formatPct } from './shared';

// Open CAPAs / Active RCAs columns and detail panels are hidden for now but
// kept fully wired so they can be re-enabled by flipping this flag.
const SHOW_CAPA_RCA = false;

// Chart colours sourced from the design-system tokens (red-finding / emerald-
// clear / signal-blue) so recharts stays on-palette with the rest of the app.
const CHART = { red: '#dc2626', green: '#059669', blue: '#2563eb' } as const;

// ─── Detail panel (expanded row) ───────────────────────────────────────────

function PersonnelDetailPanel({ userId, from, to }: { userId: number; from: string; to: string }) {
  const [detail, setDetail] = useState<PersonnelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getPersonnelDetail(userId, { from: from || undefined, to: to || undefined });
      setDetail(d);
    } catch {
      setError('Failed to load detail.');
    } finally {
      setLoading(false);
    }
  }, [userId, from, to]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 bg-slate-50" role="status">
        <span
          className="animate-spin motion-reduce:animate-none rounded-full h-6 w-6 border-t-2 border-b-2 border-signal-blue"
          aria-hidden="true"
        />
        <span className="sr-only">Loading personnel detail…</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <p className="text-sm text-red-finding py-4 px-5 bg-slate-50" role="alert">
        {error ?? 'No data.'}
      </p>
    );
  }

  const gaugeValue = detail.taskEfficiency !== null ? Math.min(detail.taskEfficiency, 2) * 50 : 0;
  // With inverted formula: ≥1.0 = good (green), <1.0 = over budget (red)
  const gaugeEfficient = detail.taskEfficiency !== null && detail.taskEfficiency >= 1.0;

  return (
    <div className="grid lg:grid-cols-3 gap-6 p-5 bg-slate-50">
      {/* Efficiency gauge */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-ink-secondary mb-2">Task Efficiency</h3>
        {detail.taskEfficiency === null ? (
          <p className="text-sm text-ink-secondary py-8 text-center">No rated tasks yet.</p>
        ) : (
          <div
            className="relative h-36"
            role="img"
            aria-label={`Task efficiency ${detail.taskEfficiency.toFixed(2)}× (est ÷ actual), ${gaugeEfficient ? 'on or under budget' : 'over budget'}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                innerRadius="70%"
                outerRadius="100%"
                data={[{ value: gaugeValue, fill: gaugeEfficient ? CHART.green : CHART.red }]}
                startAngle={180}
                endAngle={0}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background dataKey="value" cornerRadius={8} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className={`text-2xl font-bold ${gaugeEfficient ? 'text-emerald-clear' : 'text-red-finding'}`}>
                {detail.taskEfficiency.toFixed(2)}×
              </span>
              <span className="text-xs text-ink-secondary">est ÷ actual</span>
            </div>
          </div>
        )}
      </div>

      {/* Hours logged trend */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold text-ink-secondary mb-2">
          Hours Logged {from || to ? '(selected range)' : '(last 12 months)'}
        </h3>
        {detail.hoursLoggedByMonth.length === 0 ? (
          <p className="text-sm text-ink-secondary py-8 text-center">No time entries yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={detail.hoursLoggedByMonth}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(m: string) => m.slice(2)} />
              <YAxis tick={{ fontSize: 11 }} width={30} />
              <Tooltip formatter={(v) => [`${v}h`, 'Hours']} />
              <Bar dataKey="hours" fill={CHART.blue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Upcoming deadlines */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-ink-secondary mb-2">
          Upcoming Deadlines ({detail.deadlineWindowDays}d)
        </h3>
        {detail.upcomingDeadlines.length === 0 ? (
          <p className="text-sm text-ink-secondary">None.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.upcomingDeadlines.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="text-ink-primary truncate">{t.title}</span>
                <span className="text-ink-secondary whitespace-nowrap">
                  {new Date(t.deadline).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Active tasks */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-ink-secondary mb-2">Active Tasks ({detail.activeTasks.length})</h3>
        {detail.activeTasks.length === 0 ? (
          <p className="text-sm text-ink-secondary">None.</p>
        ) : (
          <ul className="space-y-2 text-sm max-h-40 overflow-y-auto">
            {detail.activeTasks.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="text-ink-primary truncate">{t.title}</span>
                <span className="text-ink-secondary whitespace-nowrap">
                  {t.deadline ? new Date(t.deadline).toLocaleDateString() : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Work packages assigned */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-ink-secondary mb-2">Work Packages Assigned ({detail.activeWps.length})</h3>
        {detail.activeWps.length === 0 ? (
          <p className="text-sm text-ink-secondary">None.</p>
        ) : (
          <ul className="space-y-2 text-sm max-h-40 overflow-y-auto">
            {detail.activeWps.map((w) => (
              <li key={w.id} className="flex justify-between gap-2">
                <span className="text-ink-primary truncate">{w.name}</span>
                <span className="text-ink-secondary whitespace-nowrap">{w.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Open CAPAs */}
      {SHOW_CAPA_RCA && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-ink-secondary mb-2">Open CAPAs</h3>
          {detail.openCapas.length === 0 ? (
            <p className="text-sm text-ink-secondary">None.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.openCapas.map((c) => (
                <li key={c.id} className="text-ink-primary truncate" title={c.description}>
                  {c.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Active RCAs */}
      {SHOW_CAPA_RCA && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-ink-secondary mb-2">Active RCAs</h3>
          {detail.activeRcas.length === 0 ? (
            <p className="text-sm text-ink-secondary">None.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.activeRcas.map((r) => (
                <li key={r.id} className="text-ink-primary truncate" title={r.findingDescription}>
                  {r.findingDescription}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sorting ────────────────────────────────────────────────────────────────

type SortKey =
  | 'name'
  | 'activeTasks'
  | 'estimatedHours'
  | 'wpsManaged'
  | 'openCapas'
  | 'activeRcas'
  | 'upcomingDeadlines'
  | 'hoursLogged'
  | 'tasksCompleted'
  | 'taskEfficiency'
  | 'onTimeRate'
  | 'overdueRejectedCount'
  | 'findingsReported';

function sortValue(p: PersonnelRow, key: SortKey): number | string {
  switch (key) {
    case 'name':
      return p.name.toLowerCase();
    case 'activeTasks':
      return p.workload.activeTasks;
    case 'estimatedHours':
      return p.workload.estimatedHours;
    case 'wpsManaged':
      return p.workload.wpsManaged;
    case 'openCapas':
      return p.workload.openCapas;
    case 'activeRcas':
      return p.workload.activeRcas;
    case 'upcomingDeadlines':
      return p.workload.upcomingDeadlines;
    case 'hoursLogged':
      return p.performance.hoursLogged;
    case 'tasksCompleted':
      return p.performance.tasksCompleted;
    case 'taskEfficiency':
      return p.performance.taskEfficiency ?? -Infinity;
    case 'onTimeRate':
      return p.performance.onTimeRate ?? -Infinity;
    case 'overdueRejectedCount':
      return p.performance.overdueRejectedCount;
    case 'findingsReported':
      return p.performance.findingsReported;
  }
}

function SortableTh({
  label,
  sortKeyName,
  align = 'right',
  activeSortKey,
  sortDir,
  onSort,
}: {
  label: string;
  sortKeyName: SortKey;
  align?: 'left' | 'right' | 'center';
  activeSortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = activeSortKey === sortKeyName;
  return (
    <th
      scope="col"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-5 py-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKeyName)}
        className={`inline-flex items-center gap-1 rounded hover:text-ink-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-ink-primary' : ''}`}
      >
        {label}
        {active &&
          (sortDir === 'asc' ? (
            <ChevronUp className="w-3 h-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
          ))}
      </button>
    </th>
  );
}

// ─── Tab ────────────────────────────────────────────────────────────────────

export default function PersonnelTab() {
  const role = useAuthStore((s) => s.user?.role);
  const canFilterDivision = role === 'Director' || role === 'Admin';
  const fieldId = useId();

  const [rows, setRows] = useState<PersonnelRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [divisionId, setDivisionId] = useState<string>('');
  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [nameQuery, setNameQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('activeTasks');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  useEffect(() => {
    if (canFilterDivision) {
      getDivisions().then(setDivisions).catch(() => {});
    }
  }, [canFilterDivision]);

  const fetchPersonnel = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getPersonnelWorkload({
        from: from || undefined,
        to: to || undefined,
        divisionId: divisionId ? Number(divisionId) : undefined,
      });
      setRows(d.personnel);
    } catch (err: unknown) {
      setError(analyticsErrorMessage(err, 'personnel data'));
    } finally {
      setLoading(false);
    }
  }, [from, to, divisionId]);

  useEffect(() => {
    fetchPersonnel();
  }, [fetchPersonnel]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    const q = nameQuery.trim().toLowerCase();
    const filtered = q ? rows.filter((p) => p.name.toLowerCase().includes(q)) : rows;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, nameQuery, sortKey, sortDir]);

  const columnCount = SHOW_CAPA_RCA ? 14 : 12;
  const hasFilters = Boolean(from || to || divisionId || nameQuery);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={`${fieldId}-name`} className="block text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-1">
            Personnel
          </label>
          <input
            id={`${fieldId}-name`}
            type="text"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Search by name…"
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm w-48 text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-signal-blue focus:border-transparent"
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-from`} className="block text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-1">
            From
          </label>
          <input
            id={`${fieldId}-from`}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-signal-blue focus:border-transparent"
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-to`} className="block text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-1">
            To
          </label>
          <input
            id={`${fieldId}-to`}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-signal-blue focus:border-transparent"
          />
        </div>
        {canFilterDivision && (
          <div>
            <label htmlFor={`${fieldId}-division`} className="block text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-1">
              Division
            </label>
            <select
              id={`${fieldId}-division`}
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-signal-blue focus:border-transparent"
            >
              <option value="">All divisions</option>
              {divisions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setFrom('');
              setTo('');
              setDivisionId('');
              setNameQuery('');
            }}
            className="text-sm font-medium text-signal-blue hover:underline rounded px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Personnel table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center gap-2">
          <Users className="w-5 h-5 text-ink-secondary" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink-primary">Personnel</h2>
          <span className="text-sm text-ink-secondary tabular-nums">· {sorted.length}</span>
          <span className="sr-only" aria-live="polite">
            {sorted.length} personnel{hasFilters ? ' matching filters' : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Personnel workload and performance. Use the expand button on a row to open its detail panel.
            </caption>
            <thead>
              <tr className="text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider bg-slate-50">
                <th scope="col" className="px-5 py-3 w-8"><span className="sr-only">Expand</span></th>
                <SortableTh label="Name" sortKeyName="name" align="left" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Active Tasks" sortKeyName="activeTasks" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Est. Hours" sortKeyName="estimatedHours" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="WPs" sortKeyName="wpsManaged" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                {SHOW_CAPA_RCA && (
                  <SortableTh label="Open CAPAs" sortKeyName="openCapas" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                )}
                {SHOW_CAPA_RCA && (
                  <SortableTh label="Active RCAs" sortKeyName="activeRcas" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                )}
                <SortableTh label="Deadlines" sortKeyName="upcomingDeadlines" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Hours Logged" sortKeyName="hoursLogged" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Tasks Done" sortKeyName="tasksCompleted" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Efficiency" sortKeyName="taskEfficiency" align="center" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="On-Time Rate" sortKeyName="onTimeRate" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Overdue/Rejected" sortKeyName="overdueRejectedCount" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Findings Reported" sortKeyName="findingsReported" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-5 py-8 text-center text-ink-secondary">
                    No personnel in scope.
                  </td>
                </tr>
              ) : (
                sorted.map((p) => {
                  const expanded = expandedUserId === p.userId;
                  const panelId = `personnel-detail-${p.userId}`;
                  const toggle = () => setExpandedUserId(expanded ? null : p.userId);
                  return (
                    <Fragment key={p.userId}>
                      <tr className="hover:bg-slate-50 transition-colors">
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={toggle}
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            aria-label={`${expanded ? 'Collapse' : 'Expand'} details for ${p.name}`}
                            className="flex items-center justify-center w-9 h-9 rounded-lg text-ink-muted hover:bg-slate-100 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-blue"
                          >
                            {expanded ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                          </button>
                        </td>
                        <th scope="row" className="px-5 py-3 text-ink-primary font-medium text-left">{p.name}</th>
                        <td className="px-5 py-3 text-right text-ink-primary">{p.workload.activeTasks}</td>
                        <td className="px-5 py-3 text-right text-ink-primary">{formatHours(p.workload.estimatedHours)}</td>
                        <td className="px-5 py-3 text-right text-ink-primary">{p.workload.wpsManaged}</td>
                        {SHOW_CAPA_RCA && (
                          <td className="px-5 py-3 text-right text-ink-primary">{p.workload.openCapas}</td>
                        )}
                        {SHOW_CAPA_RCA && (
                          <td className="px-5 py-3 text-right text-ink-primary">{p.workload.activeRcas}</td>
                        )}
                        <td className="px-5 py-3 text-right">
                          {p.workload.upcomingDeadlines > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-caution-surface text-amber-caution border border-amber-caution/20">
                              {p.workload.upcomingDeadlines}
                            </span>
                          ) : (
                            <span className="text-ink-muted">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-ink-primary">{formatHours(p.performance.hoursLogged)}</td>
                        <td className="px-5 py-3 text-right text-ink-primary">{p.performance.tasksCompleted}</td>
                        <td className="px-5 py-3 text-center">
                          <EfficiencyBadge ratio={p.performance.taskEfficiency} />
                        </td>
                        <td className="px-5 py-3 text-right text-ink-primary">{formatPct(p.performance.onTimeRate)}</td>
                        <td className="px-5 py-3 text-right">
                          {p.performance.overdueRejectedCount > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-finding-surface text-red-finding border border-red-finding/20">
                              {p.performance.overdueRejectedCount}
                            </span>
                          ) : (
                            <span className="text-ink-muted">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-ink-primary">{p.performance.findingsReported}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={columnCount} className="p-0" id={panelId}>
                            <PersonnelDetailPanel userId={p.userId} from={from} to={to} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
