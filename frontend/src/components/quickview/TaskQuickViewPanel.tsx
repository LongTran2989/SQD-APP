'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TaskEnriched, TaskActivityEnriched } from '../../types';
import { getTaskById, getTaskActivity, getRelatedFindings, RelatedFinding } from '../../api/taskApi';
import { formatTimestamp } from '../../utils/feedHelpers';
import { useQuickView } from './QuickViewProvider';
import TaskStatusBadge from '../tasks/TaskStatusBadge';
import { ResponseActionBadge } from '../findings/FindingBadges';
import { X, ExternalLink, AlertTriangle, ClipboardList, Flag, FileText } from 'lucide-react';

interface Props {
  taskId: number;
  onClose: () => void;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Preview a task inline anywhere it is referenced — no navigation. Pulls the
// live task, its related finding(s), and the latest activity so the drawer
// answers "what is this, who owns it, where did it come from, what just
// happened" without leaving the page. Mounted once by QuickViewProvider.
export default function TaskQuickViewPanel({ taskId, onClose }: Props) {
  const { openFinding } = useQuickView();
  const [task, setTask] = useState<TaskEnriched | null>(null);
  const [activity, setActivity] = useState<TaskActivityEnriched[]>([]);
  const [relatedFindings, setRelatedFindings] = useState<RelatedFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getTaskById(taskId),
      getTaskActivity(taskId).catch(() => [] as TaskActivityEnriched[]),
      getRelatedFindings(taskId).catch(() => [] as RelatedFinding[]),
    ])
      .then(([t, acts, findings]) => { if (active) { setTask(t); setActivity(acts); setRelatedFindings(findings); setError(null); } })
      .catch(() => { if (active) setError('Failed to load task'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [taskId]);

  // Most recent few entries, newest first.
  const recent = activity.slice(-5).reverse();
  const hasReport = !!task?.taskData?.data && Object.keys(task.taskData.data).length > 0;

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

              {relatedFindings.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                    {relatedFindings.length > 1 ? 'Related findings' : 'Related finding'}
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {relatedFindings.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => openFinding(f.id)}
                        title={f.description}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition-colors"
                      >
                        <Flag className="w-3 h-3" /> Finding #{f.id}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <dl className="space-y-3 text-sm">
                <Row label="Template" value={task.template?.title ?? '—'} />
                <Row label="Issuer" value={task.issuer?.name ?? '—'} />
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

              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Latest activity</h4>
                {recent.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No activity yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {recent.map((entry) => (
                      <li key={entry.id} className="text-xs">
                        <p className={`leading-relaxed break-words ${entry.type === 'SYSTEM_EVENT' ? 'text-slate-500 italic' : 'text-slate-700'}`}>
                          {entry.type !== 'SYSTEM_EVENT' && (
                            <span className="font-semibold text-slate-600">{entry.author?.name ?? 'Unknown'}: </span>
                          )}
                          {entry.content}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatTimestamp(entry.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Close</button>
          {hasReport && (
            <Link
              href={`/tasks/${taskId}/report`}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-600 text-sm font-semibold rounded-xl transition-colors"
            >
              <FileText className="w-4 h-4" /> Report
            </Link>
          )}
          <Link
            href={`/dashboard/tasks/${taskId}`}
            onClick={onClose}
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
