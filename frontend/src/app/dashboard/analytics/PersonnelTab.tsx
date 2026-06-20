'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Users } from 'lucide-react';
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

function PersonnelDetailPanel({ userId }: { userId: number }) {
  const [detail, setDetail] = useState<PersonnelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getPersonnelDetail(userId);
      setDetail(d);
    } catch {
      setError('Failed to load detail.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

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
        <h3 className="text-sm font-semibold text-slate-600 mb-2">Hours Logged (last 12 months)</h3>
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

      {/* Open CAPAs */}
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

      {/* Active RCAs */}
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
    </div>
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

  const sorted = useMemo(
    () => (rows ? [...rows].sort((a, b) => b.workload.activeTasks - a.workload.activeTasks) : []),
    [rows]
  );

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
        {(from || to || divisionId) && (
          <button
            type="button"
            onClick={() => {
              setFrom('');
              setTo('');
              setDivisionId('');
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
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3 text-right">Active Tasks</th>
                <th className="px-5 py-3 text-right">Est. Hours</th>
                <th className="px-5 py-3 text-right">WPs</th>
                <th className="px-5 py-3 text-right">Open CAPAs</th>
                <th className="px-5 py-3 text-right">Active RCAs</th>
                <th className="px-5 py-3 text-right">Deadlines</th>
                <th className="px-5 py-3 text-right">Hours Logged</th>
                <th className="px-5 py-3 text-center">Efficiency</th>
                <th className="px-5 py-3 text-right">Rejection Rate</th>
                <th className="px-5 py-3 text-right">Findings Reported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-5 py-8 text-center text-slate-400">
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
                        <td className="px-5 py-3 text-right text-slate-700">{p.workload.openCapas}</td>
                        <td className="px-5 py-3 text-right text-slate-700">{p.workload.activeRcas}</td>
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
                        <td className="px-5 py-3 text-right text-slate-700">{p.performance.findingsReported}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={12} className="p-0">
                            <PersonnelDetailPanel userId={p.userId} />
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
