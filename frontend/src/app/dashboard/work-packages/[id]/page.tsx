'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../../store/authStore';
import { WorkPackageDetail, WpStatus, TaskEnriched } from '../../../../types';
import { getWorkPackageById, updateWpStatus } from '../../../../api/wpApi';
import { getTasks, relinkTaskWp } from '../../../../api/taskApi';
import WorkPackageStatusBadge from '../../../../components/work-packages/WorkPackageStatusBadge';
import WorkPackageAssignmentPanel from '../../../../components/work-packages/WorkPackageAssignmentPanel';
import TaskStatusBadge from '../../../../components/tasks/TaskStatusBadge';
import FeedPanel from '../../../../components/feed/FeedPanel';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  AlertTriangle,
  CalendarRange,
  Edit2,
  FolderOpen,
  Plus,
  Power,
  PowerOff,
  CheckCircle2,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Status change modal ──────────────────────────────────────────────────────

interface StatusModalProps {
  action: 'Inactive' | 'Closed' | 'Open';
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function StatusModal({ action, onConfirm, onCancel, loading }: StatusModalProps) {
  const [reason, setReason] = useState('');

  const requiresReason = action === 'Inactive';
  const labels: Record<string, { title: string; desc: string; btn: string; btnColor: string }> = {
    Inactive: {
      title: 'Inactivate Work Package',
      desc: 'Please provide a reason for inactivating this work package.',
      btn: 'Inactivate',
      btnColor: 'bg-orange-600 hover:bg-orange-700',
    },
    Closed: {
      title: 'Close Work Package',
      desc: 'This will mark the work package as Closed. All tasks must be in a final state first.',
      btn: 'Close Work Package',
      btnColor: 'bg-green-600 hover:bg-green-700',
    },
    Open: {
      title: 'Reactivate Work Package',
      desc: 'This will reactivate the work package and clear the inactivation record.',
      btn: 'Reactivate',
      btnColor: 'bg-blue-600 hover:bg-blue-700',
    },
  };

  const cfg = labels[action]!;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-slate-800">{cfg.title}</h2>
        <p className="text-sm text-slate-600">{cfg.desc}</p>
        {requiresReason && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason..."
            rows={3}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        )}
        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(requiresReason ? reason : undefined)}
            disabled={loading || (requiresReason && !reason.trim())}
            className={`px-5 py-2 ${cfg.btnColor} disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processing...
              </span>
            ) : cfg.btn}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const STATUS_CHANGE_ROLES = ['Admin', 'Director'];
const EDIT_ROLES = ['Manager', 'Director', 'Admin'];

export default function WorkPackageDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();

  const wpId = Number(params.id);

  const [wp, setWp] = useState<WorkPackageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState<'Inactive' | 'Closed' | 'Open' | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);

  // "Add Existing Task" modal
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [orphanTasks, setOrphanTasks] = useState<TaskEnriched[]>([]);
  const [linkingTaskId, setLinkingTaskId] = useState<number | null>(null);

  const loadWp = useCallback(async () => {
    try {
      const data = await getWorkPackageById(wpId);
      setWp(data);
    } catch (err: any) {
      if (err.response?.status === 404) setError('Work Package not found.');
      else if (err.response?.status === 403) setError('You do not have permission to view this work package.');
      else setError('Failed to load work package.');
    } finally {
      setLoading(false);
    }
  }, [wpId]);

  useEffect(() => { loadWp(); }, [loadWp]);

  const openAddExisting = async () => {
    if (!wp) return;
    try {
      const all = await getTasks();
      // Orphaned, non-final tasks in the same division as this WP.
      const FINAL = ['Closed', 'Rejected', 'Terminated'];
      setOrphanTasks(
        all.filter((t) => t.wpId === null && !FINAL.includes(t.status) && t.targetDivisionId === wp.divisionId)
      );
      setShowAddExisting(true);
    } catch {
      toast.error('Failed to load tasks');
    }
  };

  const handleLinkExisting = async (taskId: number) => {
    if (!wp) return;
    setLinkingTaskId(taskId);
    try {
      await relinkTaskWp(taskId, wp.id);
      toast.success('Task linked to this Work Package');
      setShowAddExisting(false);
      await loadWp();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to link task');
    } finally {
      setLinkingTaskId(null);
    }
  };

  const handleStatusChange = async (reason?: string) => {
    if (!statusModal || !wp) return;
    setStatusChanging(true);
    try {
      await updateWpStatus(wp.id, statusModal as 'Closed' | 'Inactive' | 'Open', reason);
      toast.success(`Work Package ${statusModal === 'Open' ? 'reactivated' : statusModal === 'Closed' ? 'closed' : 'inactivated'}`);
      setStatusModal(null);
      await loadWp();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update status');
    } finally {
      setStatusChanging(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !wp || !user) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-800">{error ?? 'Something went wrong'}</h1>
        <Link href="/dashboard/work-packages" className="text-blue-600 hover:underline text-sm">
          ← Back to Work Packages
        </Link>
      </div>
    );
  }

  const isCreator = user.id === wp.creatorId;
  const isWpMember = wp.assignments.some((a) => a.userId === user.id);
  const canChangeStatus = isCreator || STATUS_CHANGE_ROLES.includes(user.role);
  const canEdit = EDIT_ROLES.includes(user.role) && wp.computedStatus !== 'Closed';
  const canCreateTask = (EDIT_ROLES.includes(user.role) || isWpMember) && wp.computedStatus !== 'Closed';

  const showInactivate = canChangeStatus && wp.computedStatus !== 'Inactive' && wp.computedStatus !== 'Closed';
  const showReactivate = canChangeStatus && wp.computedStatus === 'Inactive';
  const showClose = canChangeStatus && wp.computedStatus !== 'Closed' && wp.computedStatus !== 'Inactive';

  return (
    <div className="max-w-7xl mx-auto space-y-5">

      {/* Page header */}
      <div className="flex items-start gap-4">
        <Link
          href="/dashboard/work-packages"
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0 mt-0.5"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-bold font-mono text-sm border border-slate-200">
              {wp.wpId}
            </span>
            <WorkPackageStatusBadge status={wp.computedStatus} />
            <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-semibold border border-purple-100">
              {wp.type}
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-800 truncate">{wp.name}</h1>
        </div>

        {/* Header actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {canEdit && (
            <Link
              href={`/dashboard/work-packages/${wp.id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              Edit
            </Link>
          )}
          {showInactivate && (
            <button
              onClick={() => setStatusModal('Inactive')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-orange-600 hover:bg-orange-50 border border-orange-200 rounded-xl transition-colors"
            >
              <PowerOff className="w-4 h-4" />
              Inactivate
            </button>
          )}
          {showReactivate && (
            <button
              onClick={() => setStatusModal('Open')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-xl transition-colors"
            >
              <Power className="w-4 h-4" />
              Reactivate
            </button>
          )}
          {showClose && (
            <button
              onClick={() => setStatusModal('Closed')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-green-600 hover:bg-green-50 border border-green-200 rounded-xl transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              Close WP
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">

        {/* ── Left column (2/5): metadata + assignments ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Metadata card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-800">Details</h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Division</span>
                <span className="font-medium text-slate-700">{wp.division?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Creator</span>
                <span className="font-medium text-slate-700">{wp.creator?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500 flex items-center gap-1">
                  <CalendarRange className="w-3.5 h-3.5" /> Timeframe
                </span>
                <span className="font-medium text-slate-700 text-right">
                  {formatDate(wp.timeframeFrom)} – {formatDate(wp.timeframeTo)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Created</span>
                <span className="font-medium text-slate-700">{formatDate(wp.createdAt)}</span>
              </div>
              {wp.autoGenerate && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Auto-generate</span>
                    <span className="font-medium text-slate-700">
                      {wp.autoGenMode === 'REPEAT'
                        ? `Repeat · every ${wp.autoGenInterval ?? 1} day(s)`
                        : 'Single shot'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Source</span>
                    <span className="font-medium text-slate-700">
                      {wp.autoGenSetId
                        ? `Saved set #${wp.autoGenSetId}`
                        : wp.autoGenTemplateId
                          ? `Template ID ${wp.autoGenTemplateId}`
                          : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last generated</span>
                    <span className="font-medium text-slate-700">
                      {wp.autoGenFiredAt ? formatDate(wp.autoGenFiredAt) : 'Never'}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Inactivation log */}
            {wp.inactivationLog && (
              <div className="mt-2 p-3 bg-orange-50 border border-orange-100 rounded-xl text-xs text-orange-700 space-y-1">
                <div className="font-semibold">Inactivated</div>
                <div>{wp.inactivationLog.reason}</div>
                <div className="text-orange-500">{formatDate(wp.inactivationLog.inactivatedAt)}</div>
              </div>
            )}
          </div>

          {/* Assignments */}
          <WorkPackageAssignmentPanel wp={wp} onUpdated={loadWp} />
        </div>

        {/* ── Right column (3/5): tasks ── */}
        <div className="lg:col-span-3 space-y-5">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-slate-500" />
                Tasks
                <span className="ml-1 px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-bold">
                  {wp.tasks.length}
                </span>
              </h3>
              {canCreateTask && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openAddExisting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Existing Task
                  </button>
                  <Link
                    href={`/dashboard/tasks/new?wpId=${wp.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create Task
                  </Link>
                </div>
              )}
            </div>

            {wp.tasks.length === 0 ? (
              <div className="p-10 text-center">
                <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No tasks yet.</p>
                {canCreateTask && (
                  <Link
                    href={`/dashboard/tasks/new?wpId=${wp.id}`}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Create the first task
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Task ID</th>
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Template</th>
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Assignee</th>
                      <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Deadline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {wp.tasks.map((task) => (
                      <tr
                        key={task.id}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                        onClick={() => router.push(`/dashboard/tasks/${task.id}`)}
                      >
                        <td className="p-4 align-middle">
                          <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-bold font-mono border border-slate-200">
                            {task.taskId}
                          </span>
                        </td>
                        <td className="p-4 align-middle text-sm text-slate-700 max-w-[200px] truncate">
                          {task.template?.title ?? '—'}
                        </td>
                        <td className="p-4 align-middle">
                          <TaskStatusBadge status={task.status} size="sm" />
                        </td>
                        <td className="p-4 align-middle text-sm text-slate-600">
                          {task.assignedToUser?.name ?? <span className="text-slate-400 italic">Unassigned</span>}
                        </td>
                        <td className="p-4 align-middle text-sm text-slate-600">
                          {task.deadline ? formatDate(task.deadline) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Work Package feed */}
      <div className="h-[28rem]">
        <FeedPanel scope="WP" scopeId={wp.id} currentUser={user} title="Work Package Feed" />
      </div>

      {/* Status modal */}
      {statusModal && (
        <StatusModal
          action={statusModal}
          onConfirm={handleStatusChange}
          onCancel={() => setStatusModal(null)}
          loading={statusChanging}
        />
      )}

      {showAddExisting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800">Add Existing Task</h3>
              <button onClick={() => setShowAddExisting(false)} className="text-slate-400 hover:text-slate-600 text-sm">Close</button>
            </div>
            <div className="p-4 overflow-y-auto">
              {orphanTasks.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  No unlinked tasks available in this division.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {orphanTasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between py-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-slate-700">{t.taskId}</div>
                        <div className="text-sm text-slate-600 truncate">{t.template?.title ?? t.title ?? '—'}</div>
                      </div>
                      <button
                        onClick={() => handleLinkExisting(t.id)}
                        disabled={linkingTaskId === t.id}
                        className="ml-3 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg disabled:opacity-50"
                      >
                        {linkingTaskId === t.id ? 'Linking…' : 'Link'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
