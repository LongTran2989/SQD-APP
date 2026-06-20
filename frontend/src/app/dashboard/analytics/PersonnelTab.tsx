'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Users } from 'lucide-react';
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

// Open CAPAs / Active RCAs columns and detail panels are hidden for now but
// kept fully wired so they can be re-enabled by flipping this flag.
const SHOW_CAPA_RCA = false;

// ─── Display helpers ────────────────────────────────────────────────────────

function formatHours(h: number): string {
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

function formatPct(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${Math.round(ratio * 100)}%`;
}

function EfficiencyBadge({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-slate-400">N/A</span>;
  const over = ratio > 1.0;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
        over
          ? 'bg-red-50 text-red-600 border border-red-200'
          : 'bg-green-50 text-green-600 border border-green-200'
      }`}
    >
      {ratio.toFixed(2)}×
    </span>
  );
}

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
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !detail) {
    return <p className="text-sm text-red-500 py-4">{error ?? 'No data.'}</p>;
  }

  const gaugeValue = detail.taskEfficiency !== null ? Math.min(detail.taskEfficiency, 2) * 50 : 0;
  const gaugeOver = detail.taskEfficiency !== null && detail.taskEfficiency > 1.0;

  return (
    <div className="grid lg:grid-cols-3 gap-6 p-5 bg-slate-50">
      {/* Efficiency gauge */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-600 mb-2">Task Efficiency</h3>
        {detail.taskEfficiency === null ? (
          <p className="text-sm text-slate-400 py-8 text-center">No rated tasks yet.</p>
        ) : (
          <div className="relative h-36">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                innerRadius="70%"
                outerRadius="100%"
                data={[{ value: gaugeValue, fill: gaugeOver ? '#ef4444' : '#22c55e' }]}
                startAngle={180}
                endAngle={0}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background dataKey="value" cornerRadius={8} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className={`text-2xl font-bold ${gaugeOver ? 'text-red-500' : 'text-green-600'}`}>
                {detail.taskEfficiency.toFixed(2)}×
              </span>
              <span className="text-xs text-slate-400">actual / estimated</span>
            </div>
          </div>
        )}
      </div>

      {/* Hours logged trend */}
      <div className="bg-white rounded-xl border border-slate-100 p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold text-slate-600 mb-2">
          Hours Logged {from || to ? '(selected range)' : '(last 12 months)'}
        </h3>
        {detail.hoursLoggedByMonth.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">No time entries yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={detail.hoursLoggedByMonth}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(m: string) => m.slice(2)} />
              <YAxis tick={{ fontSize: 11 }} width={30} />
              <Tooltip formatter={(v) => [`${v}h`, 'Hours']} />
              <Bar dataKey="hours" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Upcoming deadlines */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-600 mb-2">
          Upcoming Deadlines ({detail.deadlineWindowDays}d)
        </h3>
        {detail.upcomingDeadlines.length === 0 ? (
          <p className="text-sm text-slate-400">None.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.upcomingDeadlines.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="text-slate-700 truncate">{t.title}</span>
                <span className="text-slate-400 whitespace-nowrap">
                  {new Date(t.deadline).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Active tasks */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-600 mb-2">Active Tasks ({detail.activeTasks.length})</h3>
        {detail.activeTasks.length === 0 ? (
          <p className="text-sm text-slate-400">None.</p>
        ) : (
          <ul className="space-y-2 text-sm max-h-40 overflow-y-auto">
            {detail.activeTasks.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="text-slate-700 truncate">{t.title}</span>
                <span className="text-slate-400 whitespace-nowrap">
                  {t.deadline ? new Date(t.deadline).toLocaleDateString() : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Work packages assigned */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-600 mb-2">Work Packages Assigned ({detail.activeWps.length})</h3>
        {detail.activeWps.length === 0 ? (
          <p className="text-sm text-slate-400">None.</p>
        ) : (
          <ul className="space-y-2 text-sm max-h-40 overflow-y-auto">
            {detail.activeWps.map((w) => (
              <li key={w.id} className="flex justify-between gap-2">
                <span className="text-slate-700 truncate">{w.name}</span>
                <span className="text-slate-400 whitespace-nowrap">{w.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Open CAPAs */}
      {SHOW_CAPA_RCA && (
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Open CAPAs</h3>
          {detail.openCapas.length === 0 ? (
            <p className="text-sm text-slate-400">None.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.openCapas.map((c) => (
                <li key={c.id} className="text-slate-700 truncate" title={c.description}>
                  {c.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Active RCAs */}
      {SHOW_CAPA_RCA && (
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <h3 className="text-sm font-semibold text-slate-600 mb-2">Active RCAs</h3>
          {detail.activeRcas.length === 0 ? (
            <p className="text-sm text-slate-400">None.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.activeRcas.map((r) => (
                <li key={r.id} className="text-slate-700 truncate" title={r.findingDescription}>
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
  | 'taskEfficiency'
  | 'rejectionRate'
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
    case 'taskEfficiency':
      return p.performance.taskEfficiency ?? -Infinity;
    case 'rejectionRate':
      return p.performance.rejectionRate ?? -Infinity;
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
      className={`px-5 py-3 cursor-pointer select-none hover:text-slate-600 ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
      onClick={() => onSort(sortKeyName)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {active &&
          (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}

// ─── Tab ────────────────────────────────────────────────────────────────────

export default function PersonnelTab() {
  const role = useAuthStore((s) => s.user?.role);
  const canFilterDivision = role === 'Director' || role === 'Admin';

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
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(
        status === 403
          ? 'You do not have permission to view personnel data.'
          : 'Failed to load personnel data. Please try again.'
      );
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

  const columnCount = SHOW_CAPA_RCA ? 13 : 11;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-800">{error}</h1>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Personnel
          </label>
          <input
            type="text"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Search by name…"
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-48"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
            From
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
            To
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
        {canFilterDivision && (
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Division
            </label>
            <select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
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
        {(from || to || divisionId || nameQuery) && (
          <button
            type="button"
            onClick={() => {
              setFrom('');
              setTo('');
              setDivisionId('');
              setNameQuery('');
            }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Personnel table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center gap-2">
          <Users className="w-5 h-5 text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-700">Personnel</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                <th className="px-5 py-3 w-8" />
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
                <SortableTh label="Efficiency" sortKeyName="taskEfficiency" align="center" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Rejection Rate" sortKeyName="rejectionRate" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Overdue/Rejected" sortKeyName="overdueRejectedCount" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Findings Reported" sortKeyName="findingsReported" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-5 py-8 text-center text-slate-400">
                    No personnel in scope.
                  </td>
                </tr>
              ) : (
                sorted.map((p) => {
                  const expanded = expandedUserId === p.userId;
                  return (
                    <Fragment key={p.userId}>
                      <tr
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => setExpandedUserId(expanded ? null : p.userId)}
                      >
                        <td className="px-5 py-3 text-slate-400">
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-5 py-3 text-slate-700 font-medium">{p.name}</td>
                        <td className="px-5 py-3 text-right text-slate-700">{p.workload.activeTasks}</td>
                        <td className="px-5 py-3 text-right text-slate-700">{formatHours(p.workload.estimatedHours)}</td>
                        <td className="px-5 py-3 text-right text-slate-700">{p.workload.wpsManaged}</td>
                        {SHOW_CAPA_RCA && (
                          <td className="px-5 py-3 text-right text-slate-700">{p.workload.openCapas}</td>
                        )}
                        {SHOW_CAPA_RCA && (
                          <td className="px-5 py-3 text-right text-slate-700">{p.workload.activeRcas}</td>
                        )}
                        <td className="px-5 py-3 text-right">
                          {p.workload.upcomingDeadlines > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200">
                              {p.workload.upcomingDeadlines}
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-700">{formatHours(p.performance.hoursLogged)}</td>
                        <td className="px-5 py-3 text-center">
                          <EfficiencyBadge ratio={p.performance.taskEfficiency} />
                        </td>
                        <td className="px-5 py-3 text-right text-slate-700">{formatPct(p.performance.rejectionRate)}</td>
                        <td className="px-5 py-3 text-right">
                          {p.performance.overdueRejectedCount > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200">
                              {p.performance.overdueRejectedCount}
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-700">{p.performance.findingsReported}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={columnCount} className="p-0">
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
