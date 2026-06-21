'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TaskEnriched } from '../../types';
import { getTaskById } from '../../api/taskApi';
import TaskStatusBadge from '../tasks/TaskStatusBadge';
import { ResponseActionBadge } from './FindingBadges';
import { X, ExternalLink, AlertTriangle, ClipboardList } from 'lucide-react';

interface Props {
  taskId: number;
  onClose: () => void;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Preview a follow-up task inline on the finding page — no navigation. Reuses
// getTaskById so the drawer shows live status/assignee/etc., with an explicit
// "Open full task" link for the full page.
export default function TaskQuickViewPanel({ taskId, onClose }: Props) {
  const [task, setTask] = useState<TaskEnriched | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTaskById(taskId)
      .then((t) => { if (active) { setTask(t); setError(null); } })
      .catch(() => { if (active) setError('Failed to load task'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [taskId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <h3 className="text-base font-bold text-slate-800 truncate">
              {task ? task.taskId : 'Task'}
            </h3>
            {task && <TaskStatusBadge status={task.status} size="sm" />}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-7 w-7 border-t-2 border-b-2 border-blue-500" />
            </div>
          ) : error || !task ? (
            <div className="text-center py-10">
              <AlertTriangle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">{error ?? 'Task not found.'}</p>
            </div>
          ) : (
            <>
              <div>
                <h4 className="text-base font-semibold text-slate-800">{task.title ?? task.template?.title ?? 'Task'}</h4>
                {task.isOverdue && (
                  <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-[10px] font-bold border border-red-200">
                    <AlertTriangle className="w-2.5 h-2.5" /> OVERDUE
                  </span>
                )}
              </div>

              <dl className="space-y-3 text-sm">
                <Row label="Template" value={task.template?.title ?? '—'} />
                <Row label="Assignee" value={task.assignedToUser?.name ?? 'Unassigned'} />
                <Row label="Division" value={task.targetDivision?.name ?? '—'} />
                <Row label="Work Package" value={task.wp ? `${task.wp.wpId} — ${task.wp.name}` : '—'} />
                <Row label="Deadline" value={formatDate(task.deadline)} />
                <div className="flex items-start gap-3">
                  <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">Type</dt>
                  <dd className="flex-1 flex items-center gap-2 flex-wrap">
                    {task.responseActionType ? <ResponseActionBadge type={task.responseActionType} /> : <span className="text-slate-400 italic">—</span>}
                    {task.requiresDirectorApproval && (
                      <span className="text-xs text-purple-600 font-medium">Director approval required</span>
                    )}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Close</button>
          <Link
            href={`/dashboard/tasks/${taskId}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Open full task
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-slate-700 flex-1 break-words">{value}</dd>
    </div>
  );
}
