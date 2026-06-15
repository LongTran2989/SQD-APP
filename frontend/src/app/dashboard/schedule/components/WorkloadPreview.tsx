'use client';

import { useEffect, useState } from 'react';
import { getWorkload, WorkloadData } from '../../../../api/scheduleApi';
import { Briefcase, Clock, AlertCircle } from 'lucide-react';

interface WorkloadPreviewProps {
  userId: number;
  userName?: string;
}

const STATUS_LABELS: Record<string, string> = {
  Unassigned: 'Unassigned',
  Assigned: 'Assigned',
  InProgress: 'In Progress',
  InReview: 'In Review',
  Review: 'In Review',
  FollowupRequired: 'Follow-up',
};

function formatDeadline(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function getLoadColor(count: number): string {
  if (count <= 3) return 'bg-emerald-500';
  if (count <= 6) return 'bg-amber-500';
  return 'bg-red-500';
}

function getLoadLabel(count: number): string {
  if (count <= 3) return 'Low';
  if (count <= 6) return 'Moderate';
  return 'High';
}

function getLoadTextColor(count: number): string {
  if (count <= 3) return 'text-emerald-700';
  if (count <= 6) return 'text-amber-700';
  return 'text-red-700';
}

export default function WorkloadPreview({ userId, userName }: WorkloadPreviewProps) {
  const [data, setData] = useState<WorkloadData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getWorkload(userId)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 animate-pulse">
        <div className="h-3 bg-slate-200 rounded w-1/2 mb-2" />
        <div className="h-2 bg-slate-200 rounded w-full mb-1" />
        <div className="h-2 bg-slate-200 rounded w-3/4" />
      </div>
    );
  }

  if (!data) return null;

  const count = data.openCount;
  const barWidth = Math.min(100, (count / 9) * 100);
  const barColor = getLoadColor(count);
  const loadLabel = getLoadLabel(count);
  const loadTextColor = getLoadTextColor(count);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <Briefcase className="w-3.5 h-3.5" />
          {userName ? `${userName}'s workload` : 'Current workload'}
        </div>
        <span className={`text-xs font-bold ${loadTextColor}`}>
          {count} open task{count !== 1 ? 's' : ''} — {loadLabel}
        </span>
      </div>

      {/* Load bar */}
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      {/* Task list */}
      {count === 0 ? (
        <p className="text-xs text-slate-400 italic">No open tasks</p>
      ) : (
        <ul className="space-y-1 max-h-36 overflow-y-auto">
          {data.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1 text-slate-700 font-medium">{t.title}</span>
              <span className="shrink-0 text-slate-400">{STATUS_LABELS[t.status] ?? t.status}</span>
              {t.deadline && (
                <span className="shrink-0 flex items-center gap-0.5 text-slate-500">
                  <Clock className="w-3 h-3" />
                  {formatDeadline(t.deadline)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {count >= 7 && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          High workload — consider reassigning before adding more tasks
        </div>
      )}
    </div>
  );
}
