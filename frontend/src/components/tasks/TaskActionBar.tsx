'use client';

import { useState, useEffect } from 'react';
import { TaskEnriched, User } from '../../types';
import { FINAL_TASK_STATUSES } from '../../constants/taskStatus';
import StarRating from './StarRating';
import {
  reviewTask,
  postRejectionAction,
  inactivateTask,
  reactivateTask,
  rateTask,
  requestDeadlineExtension,
  decideDeadlineExtension,
  reassignTask,
  selfAssignTask,
  assignTask,
  transferIssuerRights,
  setDeadline,
  reopenTask,
  getUsers,
} from '../../api/taskApi';
import toast from 'react-hot-toast';
import {
  Zap,
  Send,
  CheckCircle2,
  MessageSquare,
  XCircle,
  Ban,
  UserCheck,
  PowerOff,
  Power,
  Calendar,
  Star,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RefreshCw,
  Clock,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserOption {
  value: string;
  label: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeIsReviewer(user: User, task: TaskEnriched): boolean {
  return (
    user.id === task.issuerId ||
    user.role === 'Director' ||
    (user.role === 'Manager' && user.divisionId === task.targetDivisionId)
  );
}

function computeCanRate(user: User, task: TaskEnriched): boolean {
  // 'Inactive' is not in FINAL_TASK_STATUSES, so this already excludes it.
  if (!FINAL_TASK_STATUSES.includes(task.status)) return false;
  // The API returns assignedToUser.role as a nested { name } relation; tolerate a
  // flat string too so this keeps working if the shape is ever normalised.
  const rawRole = (task.assignedToUser as any)?.role;
  const assigneeRole = typeof rawRole === 'string' ? rawRole : rawRole?.name;
  if (user.role === 'Director' && assigneeRole === 'Manager') return true;
  if (user.role === 'Manager' && task.targetDivisionId === user.divisionId) return true;
  return false;
}

function hasPendingExtensionRequest(task: TaskEnriched): boolean {
  if (!task.deadlineExtensions || !Array.isArray(task.deadlineExtensions)) return false;
  return (task.deadlineExtensions as any[]).some((e) => !e.decision);
}

function getPendingExtensionIndex(task: TaskEnriched): number {
  if (!task.deadlineExtensions || !Array.isArray(task.deadlineExtensions)) return -1;
  return (task.deadlineExtensions as any[]).findIndex((e) => !e.decision);
}

function formatHours(h: number): string {
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InlineInput({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const base = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all';
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={base}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={base}
        />
      )}
    </div>
  );
}

function UserSelect({
  label,
  value,
  onChange,
  users,
  placeholder = 'Select user…',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  users: UserOption[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
      >
        <option value="">{placeholder}</option>
        {users.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ActionButton({
  id,
  onClick,
  disabled,
  variant = 'primary',
  icon: Icon,
  children,
}: {
  id: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'success' | 'danger' | 'warning' | 'ghost';
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    success: 'bg-green-600 hover:bg-green-700 text-white',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white',
    warning: 'bg-amber-500 hover:bg-amber-600 text-white',
    ghost: 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700',
  };
  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]}`}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface TaskActionBarProps {
  task: TaskEnriched;
  currentUser: User;
  onTaskUpdated: (updated: TaskEnriched) => void;
  onSaveProgress: () => void;
  savingProgress: boolean;
  onSubmitTask: () => void;
}

export default function TaskActionBar({
  task,
  currentUser,
  onTaskUpdated,
  onSaveProgress,
  savingProgress,
  onSubmitTask,
}: TaskActionBarProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);

  // Review
  const [showReviewInput, setShowReviewInput] = useState<'follow-up' | 'reject' | null>(null);
  const [reviewComment, setReviewComment] = useState('');

  // Inactivate
  const [showInactivateInput, setShowInactivateInput] = useState(false);
  const [inactivateReason, setInactivateReason] = useState('');

  // Assign unassigned task
  const [showAssignInput, setShowAssignInput] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');

  // Post-rejection reassign (status = Rejected — must use postRejectionAction)
  const [showPostRejectReassign, setShowPostRejectReassign] = useState(false);
  const [postRejectAssigneeId, setPostRejectAssigneeId] = useState('');
  const [postRejectReason, setPostRejectReason] = useState('');

  // General reassign (any non-final non-inactive non-unassigned state)
  const [showGeneralReassign, setShowGeneralReassign] = useState(false);
  const [generalReassignUserId, setGeneralReassignUserId] = useState('');
  const [generalReassignReason, setGeneralReassignReason] = useState('');

  // Transfer issuer rights
  const [showTransferIssuer, setShowTransferIssuer] = useState(false);
  const [transferToUserId, setTransferToUserId] = useState('');

  // Deadline
  const [showExtensionInput, setShowExtensionInput] = useState(false);
  const [extensionReason, setExtensionReason] = useState('');
  const [showDecideExtension, setShowDecideExtension] = useState(false);
  const [extensionNewDeadline, setExtensionNewDeadline] = useState('');
  const [showSetDeadline, setShowSetDeadline] = useState(false);
  const [newDeadlineValue, setNewDeadlineValue] = useState('');

  // Admin re-open (Closed task)
  const [showReopenInput, setShowReopenInput] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  // Rating — synced to the task prop via the React-recommended "adjust state
  // during render" pattern, so a refreshed task (re-rated elsewhere, or updated
  // by another action) updates the widget instead of showing a stale value.
  const [ratingValue, setRatingValue] = useState<number | null>(task.rating);
  const [ratingSyncedFor, setRatingSyncedFor] = useState<number | null>(task.rating);
  if (task.rating !== ratingSyncedFor) {
    setRatingSyncedFor(task.rating);
    setRatingValue(task.rating);
  }

  // Fetch the user list only for states where a user-picker action can appear
  // (assign / reassign / transfer-issuer). Closed and Terminated tasks never
  // show one, so the request is skipped there. Surface failures instead of
  // swallowing them — an empty picker with no message looks like "no users".
  const needsUserList = task.status !== 'Closed' && task.status !== 'Terminated';
  useEffect(() => {
    if (!needsUserList) return;
    getUsers()
      .then(setAllUsers)
      .catch(() => toast.error('Failed to load the user list. Please refresh to assign or reassign.'));
  }, [needsUserList]);

  // ── Computed permissions ──
  const isAssignee = currentUser.id === task.assignedToUserId;
  const isReviewer = computeIsReviewer(currentUser, task);
  const canRate = computeCanRate(currentUser, task);
  const isFinal = FINAL_TASK_STATUSES.includes(task.status);
  const isInactive = task.status === 'Inactive';
  const isUnassigned = task.status === 'Unassigned';
  const canInactivate =
    !isFinal &&
    !isInactive &&
    (currentUser.id === task.issuerId || currentUser.role === 'Admin');
  const canReactivate =
    isInactive &&
    (currentUser.id === task.issuerId || currentUser.role === 'Admin');
  const isEditable = ['Assigned', 'In Progress', 'Follow-up Required'].includes(task.status);
  const pendingExtension = hasPendingExtensionRequest(task);
  const hasSelfAssignRight =
    isUnassigned &&
    (currentUser.role === 'Director' ||
      currentUser.role === 'Admin' ||
      currentUser.divisionId === task.targetDivisionId);
  const canAssign =
    isUnassigned &&
    ['Director', 'Admin', 'Manager'].includes(currentUser.role);
  // Self-approve guard: same person cannot be both issuer+assignee AND reviewer
  const selfApproveBlocked =
    task.issuerId === currentUser.id && task.assignedToUserId === currentUser.id;
  // General reassign: reviewer rights, not final, not inactive, has an assignee
  const canGeneralReassign =
    isReviewer && !isFinal && !isInactive && !isUnassigned;
  // Transfer issuer: only the current issuer, not final
  const canTransferIssuer =
    currentUser.id === task.issuerId && !isFinal;
  // Set deadline: reviewer rights, not final, not inactive
  const canSetDeadline =
    isReviewer && !isFinal && !isInactive;
  // Admin re-open: only a Closed task, only Admin/Director.
  const canReopen =
    task.status === 'Closed' && ['Admin', 'Director'].includes(currentUser.role);

  // ── Action handlers ──

  async function handle(key: string, fn: () => Promise<TaskEnriched | void>) {
    setLoading(key);
    try {
      const result = await fn();
      if (result) onTaskUpdated(result as TaskEnriched);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Action failed');
    } finally {
      setLoading(null);
    }
  }

  const handleSelfAssign = () =>
    handle('self-assign', async () => {
      const r = await selfAssignTask(task.id);
      toast.success('Task claimed — you are now the assignee');
      return r;
    });

  const handleAssign = () => {
    if (!assignUserId) { toast.error('Please select a user to assign'); return; }
    handle('assign', async () => {
      const r = await assignTask(task.id, Number(assignUserId));
      toast.success('Task assigned successfully');
      setShowAssignInput(false);
      setAssignUserId('');
      return r;
    });
  };

  const handleApprove = () =>
    handle('approve', async () => {
      const r = await reviewTask(task.id, 'approve');
      toast.success('Task approved and closed');
      return r;
    });

  const handleReview = (action: 'follow-up' | 'reject') => {
    if (!reviewComment.trim()) { toast.error('A comment is required'); return; }
    handle(action, async () => {
      const r = await reviewTask(task.id, action, reviewComment.trim());
      toast.success(action === 'follow-up' ? 'Follow-up requested' : 'Task rejected');
      setShowReviewInput(null);
      setReviewComment('');
      return r;
    });
  };

  const handleTerminate = () =>
    handle('terminate', async () => {
      const r = await postRejectionAction(task.id, 'terminate');
      toast.success('Task terminated');
      return r;
    });

  // Post-rejection reassign: task is Rejected, must go through postRejectionAction
  const handlePostRejectReassign = () => {
    if (!postRejectAssigneeId || !postRejectReason.trim()) {
      toast.error('Assignee and reason are required');
      return;
    }
    handle('post-reject-reassign', async () => {
      const r = await postRejectionAction(task.id, 'reassign', {
        assignedToUserId: Number(postRejectAssigneeId),
        reason: postRejectReason.trim(),
      });
      toast.success('Task reassigned');
      setShowPostRejectReassign(false);
      setPostRejectAssigneeId('');
      setPostRejectReason('');
      return r;
    });
  };

  // General reassign: task is in a non-final, non-inactive state with an existing assignee
  const handleGeneralReassign = () => {
    if (!generalReassignUserId || !generalReassignReason.trim()) {
      toast.error('Assignee and reason are required for reassignment');
      return;
    }
    handle('general-reassign', async () => {
      const r = await reassignTask(task.id, {
        assignedToUserId: Number(generalReassignUserId),
        reason: generalReassignReason.trim(),
      });
      toast.success('Task reassigned');
      setShowGeneralReassign(false);
      setGeneralReassignUserId('');
      setGeneralReassignReason('');
      return r;
    });
  };

  const handleTransferIssuer = () => {
    if (!transferToUserId) { toast.error('Please select a user to transfer issuer rights to'); return; }
    handle('transfer-issuer', async () => {
      const r = await transferIssuerRights(task.id, Number(transferToUserId));
      toast.success('Issuer rights transferred');
      setShowTransferIssuer(false);
      setTransferToUserId('');
      return r;
    });
  };

  const handleInactivate = () => {
    if (!inactivateReason.trim()) { toast.error('A reason is required to inactivate this task'); return; }
    handle('inactivate', async () => {
      const r = await inactivateTask(task.id, inactivateReason.trim());
      toast.success('Task inactivated');
      setShowInactivateInput(false);
      setInactivateReason('');
      return r;
    });
  };

  const handleReactivate = () =>
    handle('reactivate', async () => {
      const r = await reactivateTask(task.id);
      toast.success('Task reactivated');
      return r;
    });

  const handleReopen = () => {
    if (!reopenReason.trim()) { toast.error('A reason is required to re-open this task'); return; }
    handle('reopen', async () => {
      const r = await reopenTask(task.id, reopenReason.trim());
      toast.success('Task re-opened');
      setShowReopenInput(false);
      setReopenReason('');
      return r;
    });
  };

  const handleRate = () => {
    if (ratingValue === null) return;
    handle('rate', async () => {
      const r = await rateTask(task.id, ratingValue);
      toast.success(`Task rated ${ratingValue}/5`);
      return r;
    });
  };

  const handleRequestExtension = () => {
    if (!extensionReason.trim()) { toast.error('A reason is required for the extension request'); return; }
    handle('request-extension', async () => {
      const r = await requestDeadlineExtension(task.id, extensionReason.trim());
      toast.success('Deadline extension requested');
      setShowExtensionInput(false);
      setExtensionReason('');
      return r;
    });
  };

  const handleDecideExtension = (decision: 'approve' | 'deny') => {
    const extensionIndex = getPendingExtensionIndex(task);
    if (extensionIndex === -1) {
      toast.error('No pending extension request found');
      return;
    }
    if (decision === 'approve' && extensionNewDeadline) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(extensionNewDeadline) || isNaN(Date.parse(extensionNewDeadline))) {
        toast.error('Invalid date format for new deadline. Please use a valid date.');
        return;
      }
    }
    handle(`extension-${decision}`, async () => {
      const r = await decideDeadlineExtension(
        task.id,
        extensionIndex,
        decision,
        decision === 'approve' && extensionNewDeadline ? extensionNewDeadline : undefined
      );
      toast.success(decision === 'approve' ? 'Extension approved' : 'Extension denied');
      setShowDecideExtension(false);
      setExtensionNewDeadline('');
      return r;
    });
  };

  const handleSetDeadline = () => {
    if (!newDeadlineValue) { toast.error('Please select a deadline date'); return; }
    handle('set-deadline', async () => {
      const r = await setDeadline(task.id, newDeadlineValue);
      toast.success('Deadline set');
      setShowSetDeadline(false);
      setNewDeadlineValue('');
      return r;
    });
  };

  // If no actions will render, return null
  const noActions =
    !hasSelfAssignRight &&
    !canAssign &&
    !isEditable &&
    task.status !== 'In Review' &&
    task.status !== 'Rejected' &&
    !canInactivate &&
    !canReactivate &&
    !canRate &&
    !pendingExtension &&
    !canGeneralReassign &&
    !canTransferIssuer &&
    !canSetDeadline &&
    !canReopen;

  if (noActions) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Actions</h3>
      </div>

      <div className="px-5 py-4 space-y-3">

        {/* ── PERFORM THIS TASK ────────────────────────────── */}
        {hasSelfAssignRight && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
            <p className="text-sm text-blue-700 font-medium">
              This task is unassigned. Click below to claim it and begin work.
            </p>
            <ActionButton
              id="btn-self-assign"
              onClick={handleSelfAssign}
              disabled={loading === 'self-assign'}
              variant="primary"
              icon={Zap}
            >
              {loading === 'self-assign' ? 'Claiming...' : 'PERFORM THIS TASK'}
            </ActionButton>
          </div>
        )}

        {/* ── ASSIGN TASK — Director / Admin / Manager on Unassigned ── */}
        {canAssign && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <p className="text-sm text-slate-700 font-medium flex items-center gap-1.5">
              <UserCheck className="w-4 h-4" />
              Assign this task to a staff member
            </p>
            <button
              id="btn-toggle-assign"
              onClick={() => setShowAssignInput(!showAssignInput)}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-semibold transition-colors"
            >
              {showAssignInput ? 'Cancel' : 'Assign Task...'}
              {showAssignInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showAssignInput && (
              <div className="space-y-2">
                <UserSelect
                  label="Assign to *"
                  value={assignUserId}
                  onChange={setAssignUserId}
                  users={allUsers}
                />
                <div className="flex gap-2">
                  <ActionButton
                    id="btn-confirm-assign"
                    onClick={handleAssign}
                    disabled={loading === 'assign'}
                    variant="primary"
                    icon={UserCheck}
                  >
                    {loading === 'assign' ? 'Assigning...' : 'Confirm Assign'}
                  </ActionButton>
                  <ActionButton
                    id="btn-cancel-assign"
                    onClick={() => { setShowAssignInput(false); setAssignUserId(''); }}
                    variant="ghost"
                  >
                    Cancel
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ASSIGNEE actions ─────────────────────────────── */}
        {isEditable && isAssignee && (
          <>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                id="btn-save-progress"
                onClick={onSaveProgress}
                disabled={savingProgress}
                variant="ghost"
                icon={CheckCircle2}
              >
                {savingProgress ? 'Saving...' : 'Save Progress'}
              </ActionButton>
              <ActionButton
                id="btn-submit"
                onClick={onSubmitTask}
                disabled={savingProgress || loading === 'submit'}
                variant="primary"
                icon={Send}
              >
                {loading === 'submit' ? 'Submitting...' : 'Submit'}
              </ActionButton>
            </div>
            <div className="w-full mt-2 text-xs text-amber-600 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>After submitting, <a href="#time-booking-section" className="font-bold underline hover:text-amber-800 transition-colors">Please perform final time booking!</a></span>
            </div>
          </>
        )}

        {/* Deadline extension request — assignee only, has deadline, not final */}
        {isAssignee && !isFinal && !isInactive && task.deadline && !pendingExtension && (
          <div>
            <button
              id="btn-toggle-extension"
              onClick={() => setShowExtensionInput(!showExtensionInput)}
              className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              Request deadline extension
              {showExtensionInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showExtensionInput && (
              <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <InlineInput
                  label="Reason for extension request *"
                  value={extensionReason}
                  onChange={setExtensionReason}
                  placeholder="Explain why more time is needed"
                  multiline
                />
                <div className="flex gap-2">
                  <ActionButton id="btn-submit-extension" onClick={handleRequestExtension} disabled={loading === 'request-extension'} variant="warning" icon={Calendar}>
                    Request Extension
                  </ActionButton>
                  <ActionButton id="btn-cancel-extension" onClick={() => { setShowExtensionInput(false); setExtensionReason(''); }} variant="ghost">
                    Cancel
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── REVIEWER actions — In Review ─────────────────── */}
        {task.status === 'In Review' && isReviewer && !selfApproveBlocked && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <ActionButton id="btn-approve" onClick={handleApprove} disabled={loading === 'approve'} variant="success" icon={CheckCircle2}>
                {loading === 'approve' ? 'Approving...' : 'Approve'}
              </ActionButton>
              <ActionButton
                id="btn-follow-up"
                onClick={() => { setShowReviewInput(showReviewInput === 'follow-up' ? null : 'follow-up'); setReviewComment(''); }}
                variant="warning"
                icon={MessageSquare}
              >
                Request Follow-up
              </ActionButton>
              <ActionButton
                id="btn-reject"
                onClick={() => { setShowReviewInput(showReviewInput === 'reject' ? null : 'reject'); setReviewComment(''); }}
                variant="danger"
                icon={XCircle}
              >
                Reject
              </ActionButton>
            </div>

            {showReviewInput && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <InlineInput
                  label={showReviewInput === 'follow-up' ? 'Follow-up instructions *' : 'Rejection reason *'}
                  value={reviewComment}
                  onChange={setReviewComment}
                  placeholder={
                    showReviewInput === 'follow-up'
                      ? 'Describe what needs to be revised...'
                      : 'Explain why the task is being rejected...'
                  }
                  multiline
                />
                <div className="flex gap-2">
                  <ActionButton
                    id={`btn-confirm-${showReviewInput}`}
                    onClick={() => handleReview(showReviewInput)}
                    disabled={loading === showReviewInput}
                    variant={showReviewInput === 'reject' ? 'danger' : 'warning'}
                  >
                    {loading === showReviewInput ? 'Submitting...' : showReviewInput === 'reject' ? 'Confirm Reject' : 'Confirm Follow-up'}
                  </ActionButton>
                  <ActionButton id="btn-cancel-review" onClick={() => { setShowReviewInput(null); setReviewComment(''); }} variant="ghost">Cancel</ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Self-approve blocked notice */}
        {task.status === 'In Review' && selfApproveBlocked && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Aviation QA integrity: you cannot approve a task you submitted yourself.
          </div>
        )}

        {/* Final time booking nudge — stays visible until the assignee books their time */}
        {task.status === 'In Review' && isAssignee && !task.timeBooking && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
            <Clock className="w-4 h-4 flex-shrink-0" />
            <span>
              <a href="#time-booking-section" className="font-bold underline hover:text-amber-800 transition-colors">
                Log your final time
              </a>
              {' '}— required before your manager can rate this task.
            </span>
          </div>
        )}

        {/* Deadline extension decision — reviewer only, pending request exists */}
        {pendingExtension && isReviewer && !isFinal && (
          <div>
            <button
              id="btn-toggle-decide-extension"
              onClick={() => setShowDecideExtension(!showDecideExtension)}
              className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 font-semibold transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Pending deadline extension request
              {showDecideExtension ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showDecideExtension && (
              <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">New deadline (if approving)</label>
                  <input
                    type="date"
                    value={extensionNewDeadline}
                    onChange={(e) => setExtensionNewDeadline(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    max="9999-12-31"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <ActionButton id="btn-approve-extension" onClick={() => handleDecideExtension('approve')} disabled={loading === 'extension-approve'} variant="success" icon={CheckCircle2}>
                    Approve
                  </ActionButton>
                  <ActionButton id="btn-deny-extension" onClick={() => handleDecideExtension('deny')} disabled={loading === 'extension-deny'} variant="danger" icon={XCircle}>
                    Deny
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SET / UPDATE DEADLINE — reviewer, non-final ───── */}
        {canSetDeadline && (
          <div>
            <button
              id="btn-toggle-set-deadline"
              onClick={() => setShowSetDeadline(!showSetDeadline)}
              className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5" />
              {task.deadline ? 'Update deadline' : 'Set deadline'}
              {showSetDeadline ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showSetDeadline && (
              <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">
                    {task.deadline ? 'New deadline *' : 'Deadline *'}
                  </label>
                  <input
                    type="date"
                    value={newDeadlineValue}
                    onChange={(e) => setNewDeadlineValue(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    max="9999-12-31"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <ActionButton id="btn-confirm-deadline" onClick={handleSetDeadline} disabled={loading === 'set-deadline'} variant="primary" icon={Calendar}>
                    {loading === 'set-deadline' ? 'Saving...' : task.deadline ? 'Update Deadline' : 'Set Deadline'}
                  </ActionButton>
                  <ActionButton id="btn-cancel-deadline" onClick={() => { setShowSetDeadline(false); setNewDeadlineValue(''); }} variant="ghost">Cancel</ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── POST-REJECTION — Rejected ─────────────────────── */}
        {task.status === 'Rejected' && isReviewer && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <ActionButton id="btn-terminate" onClick={handleTerminate} disabled={loading === 'terminate'} variant="danger" icon={Ban}>
                {loading === 'terminate' ? 'Terminating...' : 'Terminate'}
              </ActionButton>
              <ActionButton
                id="btn-toggle-post-reject-reassign"
                onClick={() => setShowPostRejectReassign(!showPostRejectReassign)}
                variant="warning"
                icon={UserCheck}
              >
                Reassign
              </ActionButton>
            </div>

            {showPostRejectReassign && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <UserSelect
                  label="New assignee *"
                  value={postRejectAssigneeId}
                  onChange={setPostRejectAssigneeId}
                  users={allUsers}
                />
                <InlineInput label="Reason for reassignment *" value={postRejectReason} onChange={setPostRejectReason} placeholder="Why is this task being reassigned?" multiline />
                <div className="flex gap-2">
                  <ActionButton id="btn-confirm-post-reject-reassign" onClick={handlePostRejectReassign} disabled={loading === 'post-reject-reassign'} variant="warning" icon={UserCheck}>
                    {loading === 'post-reject-reassign' ? 'Reassigning...' : 'Confirm Reassign'}
                  </ActionButton>
                  <ActionButton id="btn-cancel-post-reject-reassign" onClick={() => { setShowPostRejectReassign(false); setPostRejectAssigneeId(''); setPostRejectReason(''); }} variant="ghost">Cancel</ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── GENERAL REASSIGN — any non-final, non-inactive, non-unassigned ── */}
        {canGeneralReassign && (
          <div>
            <button
              id="btn-toggle-general-reassign"
              onClick={() => setShowGeneralReassign(!showGeneralReassign)}
              className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reassign task
              {showGeneralReassign ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showGeneralReassign && (
              <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <UserSelect
                  label="New assignee *"
                  value={generalReassignUserId}
                  onChange={setGeneralReassignUserId}
                  users={allUsers}
                />
                <InlineInput label="Reason for reassignment *" value={generalReassignReason} onChange={setGeneralReassignReason} placeholder="Why is this task being reassigned?" multiline />
                <div className="flex gap-2">
                  <ActionButton id="btn-confirm-general-reassign" onClick={handleGeneralReassign} disabled={loading === 'general-reassign'} variant="warning" icon={RefreshCw}>
                    {loading === 'general-reassign' ? 'Reassigning...' : 'Confirm Reassign'}
                  </ActionButton>
                  <ActionButton id="btn-cancel-general-reassign" onClick={() => { setShowGeneralReassign(false); setGeneralReassignUserId(''); setGeneralReassignReason(''); }} variant="ghost">Cancel</ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TRANSFER ISSUER RIGHTS ────────────────────────── */}
        {canTransferIssuer && (
          <div>
            <button
              id="btn-toggle-transfer-issuer"
              onClick={() => setShowTransferIssuer(!showTransferIssuer)}
              className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Transfer issuer rights
              {showTransferIssuer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showTransferIssuer && (
              <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <UserSelect
                  label="Transfer issuer rights to *"
                  value={transferToUserId}
                  onChange={setTransferToUserId}
                  users={allUsers.filter((u) => Number(u.value) !== currentUser.id)}
                />
                <div className="flex gap-2">
                  <ActionButton id="btn-confirm-transfer-issuer" onClick={handleTransferIssuer} disabled={loading === 'transfer-issuer'} variant="primary" icon={UserCheck}>
                    {loading === 'transfer-issuer' ? 'Transferring...' : 'Transfer Rights'}
                  </ActionButton>
                  <ActionButton id="btn-cancel-transfer-issuer" onClick={() => { setShowTransferIssuer(false); setTransferToUserId(''); }} variant="ghost">Cancel</ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── INACTIVATE / REACTIVATE ──────────────────────── */}
        {canInactivate && (
          <div>
            <button
              id="btn-toggle-inactivate"
              onClick={() => setShowInactivateInput(!showInactivateInput)}
              className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 transition-colors"
            >
              <PowerOff className="w-3.5 h-3.5" />
              Inactivate task
              {showInactivateInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showInactivateInput && (
              <div className="mt-2 p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                <InlineInput label="Reason for inactivation *" value={inactivateReason} onChange={setInactivateReason} placeholder="Why is this task being inactivated?" multiline />
                <div className="flex gap-2">
                  <ActionButton id="btn-confirm-inactivate" onClick={handleInactivate} disabled={loading === 'inactivate'} variant="danger" icon={PowerOff}>
                    {loading === 'inactivate' ? 'Inactivating...' : 'Inactivate Task'}
                  </ActionButton>
                  <ActionButton id="btn-cancel-inactivate" onClick={() => { setShowInactivateInput(false); setInactivateReason(''); }} variant="ghost">Cancel</ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {canReactivate && (
          <ActionButton id="btn-reactivate" onClick={handleReactivate} disabled={loading === 'reactivate'} variant="success" icon={Power}>
            {loading === 'reactivate' ? 'Reactivating...' : 'Reactivate Task'}
          </ActionButton>
        )}

        {/* ── ADMIN RE-OPEN — Closed task ──────────────────── */}
        {canReopen && (
          <div>
            <button
              id="btn-toggle-reopen"
              onClick={() => setShowReopenInput(!showReopenInput)}
              className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-open task (Admin)
              {showReopenInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showReopenInput && (
              <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                <InlineInput label="Reason for re-opening *" value={reopenReason} onChange={setReopenReason} placeholder="Why is this Closed task being re-opened?" multiline />
                <div className="flex gap-2">
                  <ActionButton id="btn-confirm-reopen" onClick={handleReopen} disabled={loading === 'reopen'} variant="primary" icon={RefreshCw}>
                    {loading === 'reopen' ? 'Re-opening...' : 'Re-open Task'}
                  </ActionButton>
                  <ActionButton id="btn-cancel-reopen" onClick={() => { setShowReopenInput(false); setReopenReason(''); }} variant="ghost">Cancel</ActionButton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── RATING ───────────────────────────────────────── */}
        {canRate && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5" />
              Rate this task (1–5)
            </p>
            {task.timeBooking && task.timeBooking.estimatedHours != null && (
              <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 mb-2">
                <span>Actual:{' '}<strong className="text-slate-700">{formatHours(task.timeBooking.totalHours)}</strong></span>
                <span className="text-slate-300">vs</span>
                <span>Estimated:{' '}<strong className="text-slate-700">{formatHours(task.timeBooking.estimatedHours)}</strong></span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${task.timeBooking.totalHours > task.timeBooking.estimatedHours ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-600 border border-green-200'}`}>
                  {task.timeBooking.totalHours > task.timeBooking.estimatedHours
                    ? `+${formatHours(task.timeBooking.totalHours - task.timeBooking.estimatedHours)} over`
                    : `−${formatHours(task.timeBooking.estimatedHours - task.timeBooking.totalHours)} under`}
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <StarRating
                value={ratingValue}
                onChange={setRatingValue}
                readOnly={false}
              />
              <ActionButton
                id="btn-submit-rating"
                onClick={handleRate}
                disabled={ratingValue === null || loading === 'rate'}
                variant="primary"
              >
                {loading === 'rate' ? 'Saving...' : task.rating != null ? 'Update Rating' : 'Submit Rating'}
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
