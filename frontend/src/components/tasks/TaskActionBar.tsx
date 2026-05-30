'use client';

import { useState } from 'react';
import { TaskEnriched, User, TaskStatus } from '../../types';
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
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const FINAL_TASK_STATUSES: TaskStatus[] = ['Closed', 'Rejected', 'Terminated'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeIsReviewer(user: User, task: TaskEnriched): boolean {
  return (
    user.id === task.issuerId ||
    user.role === 'Director' ||
    (user.role === 'Manager' && user.divisionId === task.targetDivisionId)
  );
}

function computeCanRate(user: User, task: TaskEnriched): boolean {
  if (!FINAL_TASK_STATUSES.includes(task.status)) return false;
  if (task.status === 'Inactive') return false;
  const assigneeRole = (task.assignedToUser as any)?.role?.name;
  if (user.role === 'Director' && assigneeRole === 'Manager') return true;
  if (user.role === 'Manager' && task.targetDivisionId === user.divisionId) return true;
  return false;
}

function hasPendingExtensionRequest(task: TaskEnriched): boolean {
  if (!task.deadlineExtensions || !Array.isArray(task.deadlineExtensions)) return false;
  return (task.deadlineExtensions as any[]).some((e) => !e.decision);
}

// ─── Inline action input helpers ──────────────────────────────────────────────

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

// ─── Action button ────────────────────────────────────────────────────────────

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
  onSaveProgress: () => void; // triggers parent to call saveTaskData
  savingProgress: boolean;
  onSubmitTask: () => void; // triggers parent to save and submit
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

  // Inline form states
  const [showReviewInput, setShowReviewInput] = useState<'follow-up' | 'reject' | null>(null);
  const [reviewComment, setReviewComment] = useState('');

  const [showInactivateInput, setShowInactivateInput] = useState(false);
  const [inactivateReason, setInactivateReason] = useState('');

  const [showReassignInput, setShowReassignInput] = useState(false);
  const [reassignUserId, setReassignUserId] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  const [showAssignInput, setShowAssignInput] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');

  const [showExtensionInput, setShowExtensionInput] = useState(false);
  const [extensionReason, setExtensionReason] = useState('');

  const [showDecideExtension, setShowDecideExtension] = useState(false);
  const [extensionNewDeadline, setExtensionNewDeadline] = useState('');

  const [ratingValue, setRatingValue] = useState<number | null>(task.rating);

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

  // Self-approve guard: same person can't be issuer+assignee AND reviewer
  const selfApproveBlocked =
    task.issuerId === currentUser.id && task.assignedToUserId === currentUser.id;

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
    if (!assignUserId) {
      toast.error('Please enter a user ID to assign');
      return;
    }
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
    if (!reviewComment.trim()) {
      toast.error('A comment is required');
      return;
    }
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

  const handleReassign = () => {
    if (!reassignUserId || !reassignReason.trim()) {
      toast.error('User and reason are required for reassignment');
      return;
    }
    handle('reassign', async () => {
      const r = await reassignTask(task.id, {
        assignedToUserId: Number(reassignUserId),
        reason: reassignReason.trim(),
      });
      toast.success('Task reassigned');
      setShowReassignInput(false);
      setReassignUserId('');
      setReassignReason('');
      return r;
    });
  };

  const handleInactivate = () => {
    if (!inactivateReason.trim()) {
      toast.error('A reason is required to inactivate this task');
      return;
    }
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

  const handleRate = () => {
    if (ratingValue === null) return;
    handle('rate', async () => {
      const r = await rateTask(task.id, ratingValue);
      toast.success(`Task rated ${ratingValue}/5`);
      return r;
    });
  };

  const handleRequestExtension = () => {
    if (!extensionReason.trim()) {
      toast.error('A reason is required for the extension request');
      return;
    }
    handle('request-extension', async () => {
      const r = await requestDeadlineExtension(task.id, extensionReason.trim());
      toast.success('Deadline extension requested');
      setShowExtensionInput(false);
      setExtensionReason('');
      return r;
    });
  };

  const handleDecideExtension = (decision: 'approved' | 'denied') => {
    if (decision === 'approved' && extensionNewDeadline) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(extensionNewDeadline) || isNaN(Date.parse(extensionNewDeadline))) {
        toast.error('Invalid date format for new deadline. Please use a valid date.');
        return;
      }
    }
    handle(`extension-${decision}`, async () => {
      const r = await decideDeadlineExtension(
        task.id,
        decision,
        decision === 'approved' && extensionNewDeadline ? extensionNewDeadline : undefined
      );
      toast.success(decision === 'approved' ? 'Extension approved' : 'Extension denied');
      setShowDecideExtension(false);
      setExtensionNewDeadline('');
      return r;
    });
  };

  // If no buttons will render, return null
  const noActions =
    !hasSelfAssignRight &&
    !canAssign &&
    !isEditable &&
    task.status !== 'In Review' &&
    task.status !== 'Rejected' &&
    !canInactivate &&
    !canReactivate &&
    !canRate &&
    !pendingExtension;

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
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">Assignee User ID *</label>
                  <input
                    type="number"
                    id="assign-user-id"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    placeholder="Enter user ID"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[10px] text-slate-400">Phase 5.5: will replace with user picker</p>
                </div>
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
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <ActionButton id="btn-approve-extension" onClick={() => handleDecideExtension('approved')} disabled={loading === 'extension-approved'} variant="success" icon={CheckCircle2}>
                    Approve
                  </ActionButton>
                  <ActionButton id="btn-deny-extension" onClick={() => handleDecideExtension('denied')} disabled={loading === 'extension-denied'} variant="danger" icon={XCircle}>
                    Deny
                  </ActionButton>
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
                id="btn-toggle-reassign"
                onClick={() => setShowReassignInput(!showReassignInput)}
                variant="warning"
                icon={UserCheck}
              >
                Reassign
              </ActionButton>
            </div>

            {showReassignInput && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">New Assignee User ID *</label>
                  <input
                    type="number"
                    value={reassignUserId}
                    onChange={(e) => setReassignUserId(e.target.value)}
                    placeholder="Enter user ID"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[10px] text-slate-400">Phase 5.5: will replace with user picker</p>
                </div>
                <InlineInput label="Reason for reassignment *" value={reassignReason} onChange={setReassignReason} placeholder="Why is this task being reassigned?" multiline />
                <div className="flex gap-2">
                  <ActionButton id="btn-confirm-reassign" onClick={handleReassign} disabled={loading === 'reassign'} variant="warning" icon={UserCheck}>
                    {loading === 'reassign' ? 'Reassigning...' : 'Confirm Reassign'}
                  </ActionButton>
                  <ActionButton id="btn-cancel-reassign" onClick={() => { setShowReassignInput(false); setReassignUserId(''); setReassignReason(''); }} variant="ghost">Cancel</ActionButton>
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

        {/* ── RATING ───────────────────────────────────────── */}
        {canRate && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5" />
              Rate this task (1–5)
            </p>
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
