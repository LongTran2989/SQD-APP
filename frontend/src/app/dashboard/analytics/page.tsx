'use client';

import { useEffect, useState } from 'react';
import { BarChart2, Star, AlertTriangle } from 'lucide-react';
import {
  getTimeBookingAnalytics,
  TimeBookingAnalytics,
} from '../../../api/taskApi';

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

function formatHours(h: number | null): string {
  if (h === null) return '—';
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

// Efficiency ratio badge — green when on/under budget (<= 1.0), red when over.
function EfficiencyBadge({ ratio }: { ratio: number | null }) {
  if (ratio === null) {
    return <span className="text-slate-400">N/A</span>;
  }
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data, setData] = useState<TimeBookingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTimeBookingAnalytics()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(
            err.response?.status === 403
              ? 'You do not have permission to view analytics.'
              : 'Failed to load analytics. Please try again.'
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

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  // ── Error ──
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
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
        <div className="p-3 bg-blue-50 rounded-xl">
          <BarChart2 className="w-7 h-7 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
          <p className="text-slate-500">Time efficiency and staff performance across tasks.</p>
        </div>
      </div>

      {/* Incomplete bookings notice */}
      {data.incompleteBookings > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {data.incompleteBookings} closed task{data.incompleteBookings === 1 ? '' : 's'}{' '}
          {data.incompleteBookings === 1 ? 'is' : 'are'} missing a time booking and excluded from efficiency data.
        </div>
      )}

      {/* Template Efficiency */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-700">Template Efficiency</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                <th className="px-5 py-3">Template ID</th>
                <th className="px-5 py-3">Title</th>
                <th className="px-5 py-3 text-right">Tasks</th>
                <th className="px-5 py-3 text-right">Avg Actual</th>
                <th className="px-5 py-3 text-right">Avg Estimated</th>
                <th className="px-5 py-3 text-center">Efficiency</th>
                <th className="px-5 py-3 text-right">Over-Budget</th>
                <th className="px-5 py-3">Top Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                    No completed tasks with time data yet.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.templateId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono font-semibold text-slate-600">{t.templateCode}</td>
                    <td className="px-5 py-3 text-slate-700">{t.title}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{t.taskCount}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatHours(t.avgActualHours)}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatHours(t.avgEstimatedHours)}</td>
                    <td className="px-5 py-3 text-center">
                      <EfficiencyBadge ratio={t.efficiencyRatio} />
                    </td>
                    <td className="px-5 py-3 text-right text-slate-700">{t.overBudgetCount}</td>
                    <td className="px-5 py-3 text-slate-600">{reasonLabel(t.topOverBudgetReason)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Staff Performance */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-700">Staff Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3 text-center">Avg Rating</th>
                <th className="px-5 py-3 text-right">Tasks Rated</th>
                <th className="px-5 py-3 text-center">Avg Efficiency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                    No rated tasks yet.
                  </td>
                </tr>
              ) : (
                staff.map((s) => (
                  <tr key={s.userId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-slate-700 font-medium">{s.name}</td>
                    <td className="px-5 py-3 text-center">
                      {s.avgRating === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            s.avgRating >= 4 ? 'text-amber-500' : 'text-slate-500'
                          }`}
                        >
                          <Star className="w-3.5 h-3.5 fill-current" />
                          {s.avgRating.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-700">{s.ratedTaskCount}</td>
                    <td className="px-5 py-3 text-center">
                      {s.avgEfficiencyRatio === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <EfficiencyBadge ratio={s.avgEfficiencyRatio} />
                      )}
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
