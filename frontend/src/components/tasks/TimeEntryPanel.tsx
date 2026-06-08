'use client';

import { useState, useEffect, useCallback } from 'react';
import { TaskEnriched, User, TimeBookingEntry, TimeEntry } from '../../types';
import { createTimeEntry, getTimeEntries, getUsers } from '../../api/taskApi';
import { Clock, Plus, Trash2, Check } from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserOption {
  value: string;
  label: string;
}

interface CollaboratorDraft extends TimeBookingEntry {
  _key: number;  // stable react key
}

interface Props {
  task: TaskEnriched;
  currentUser: User;
  onEntryAdded: () => void;
}

// ─── Over-budget reason options ────────────────────────────────────────────────

const OVER_BUDGET_OPTIONS = [
  { value: 'COMPLEX_TASK', label: 'Complex task' },
  { value: 'WAIT_TIME', label: 'Wait time needed' },
  { value: 'ADDITIONAL_WORK', label: 'Additional work found' },
  { value: 'OTHER', label: 'Other' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHours(h: number): string {
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hours}:${minutes}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

let _keyCounter = 0;
function nextKey(): number {
  return ++_keyCounter;
}

// ─── Sub-component: Collaborator row in the form ──────────────────────────────

function CollaboratorRow({
  entry,
  allUsers,
  selfId,
  otherCollaboratorIds,
  onChange,
  onRemove,
}: {
  entry: CollaboratorDraft;
  allUsers: UserOption[];
  selfId: number;
  otherCollaboratorIds: number[];
  onChange: (updated: CollaboratorDraft) => void;
  onRemove: () => void;
}) {
  const availableUsers = allUsers.filter(
    (u) => Number(u.value) !== selfId && !otherCollaboratorIds.includes(Number(u.value))
  );

  return (
    <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select
          className="col-span-1 sm:col-span-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={entry.userId || ''}
          onChange={(e) => onChange({ ...entry, userId: Number(e.target.value) })}
        >
          <option value="">Select user…</option>
          {availableUsers.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
          {/* Keep selected user visible even if not in the filtered list */}
          {entry.userId && !availableUsers.find((u) => Number(u.value) === entry.userId) && (
            <option value={entry.userId}>
              {allUsers.find((u) => Number(u.value) === entry.userId)?.label ?? `User ${entry.userId}`}
            </option>
          )}
        </select>

        <input
          type="number"
          min={0}
          step={0.5}
          placeholder="Hours"
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
          value={entry.hoursLogged === 0 && entry.userId === 0 ? '' : entry.hoursLogged}
          onChange={(e) => onChange({ ...entry, hoursLogged: Math.max(0, parseFloat(e.target.value) || 0) })}
        />

        <input
          type="text"
          placeholder="Notes (optional)"
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
          value={entry.notes}
          onChange={(e) => onChange({ ...entry, notes: e.target.value })}
        />
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="mt-1 p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
        title="Remove collaborator"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TimeEntryPanel({ task, currentUser, onEntryAdded }: Props) {
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [sessionHours, setSessionHours] = useState<number>(0);
  const [sessionNotes, setSessionNotes] = useState('');
  const [collaborators, setCollaborators] = useState<CollaboratorDraft[]>([]);
  const [overBudgetReason, setOverBudgetReason] = useState('');
  const [overBudgetNote, setOverBudgetNote] = useState('');

  const isAssignee = task.assignedToUserId === currentUser.id;

  // Fetch user list once (for collaborator search)
  useEffect(() => {
    getUsers().then(setAllUsers).catch(() => {});
  }, []);

  // Load entry history (refreshed after each successful create)
  const loadEntries = useCallback(() => {
    getTimeEntries(task.id).then(setEntries).catch(() => {});
  }, [task.id]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // ── Derived totals ────────────────────────────────────────────────────────
  const getUserLabel = (userId: number) =>
    allUsers.find((u) => Number(u.value) === userId)?.label?.split(' (')[0] ?? `User ${userId}`;

  // Sum of all existing session hours logged by the current assignee
  const existingAssigneeHours = entries
    .filter((e) => e.loggedByUserId === task.assignedToUserId)
    .reduce((sum, e) => sum + e.sessionHours, 0);

  // Running total across all entries (assignee sessions + collaborator hours)
  const historyTotal = entries.reduce((sum, e) => {
    const collabSum = (e.collaboratorEntries ?? []).reduce((s, c) => s + c.hoursLogged, 0);
    return sum + e.sessionHours + collabSum;
  }, 0);

  const formCollabHours = collaborators.reduce((sum, c) => sum + c.hoursLogged, 0);
  const formRunningTotal = existingAssigneeHours + sessionHours + formCollabHours;

  const showOverBudget =
    task.estimatedHours !== null &&
    task.estimatedHours !== undefined &&
    formRunningTotal > task.estimatedHours * 1.2;

  const overBudgetMissing = showOverBudget && !overBudgetReason;

  // ── Form handlers ───────────────────────────────────────────────────────────
  const handleAddCollaborator = () => {
    setCollaborators((prev) => [
      ...prev,
      { userId: 0, hoursLogged: 0, notes: '', _key: nextKey() },
    ]);
  };

  const handleUpdateCollaborator = (key: number, updated: CollaboratorDraft) => {
    setCollaborators((prev) => prev.map((c) => (c._key === key ? updated : c)));
  };

  const handleRemoveCollaborator = (key: number) => {
    setCollaborators((prev) => prev.filter((c) => c._key !== key));
  };

  const resetForm = () => {
    setSessionHours(0);
    setSessionNotes('');
    setCollaborators([]);
    setOverBudgetReason('');
    setOverBudgetNote('');
  };

  const handleSubmit = async () => {
    // Client-side guard: collaborators must have userId selected
    const invalidCollab = collaborators.find((c) => !c.userId);
    if (invalidCollab) {
      toast.error('Please select a user for each collaborator entry.');
      return;
    }

    if (!sessionNotes.trim()) {
      toast.error('Please describe what was done in this session.');
      return;
    }

    // Zero-hours soft warning
    if (sessionHours === 0) {
      if (!window.confirm('You are logging 0 hours. Continue?')) return;
    }

    // Immutability confirmation
    if (!window.confirm('This entry cannot be edited later. Continue?')) return;

    // Over-budget reason gate
    if (overBudgetMissing) {
      toast.error('Please select a reason for exceeding the estimated time.');
      return;
    }

    const payload = {
      sessionHours,
      sessionNotes,
      collaboratorEntries: collaborators.map(({ userId, hoursLogged, notes }) => ({
        userId,
        hoursLogged,
        notes,
      })),
      overBudgetReason: overBudgetReason || null,
      overBudgetNote: overBudgetNote || null,
    };

    setSubmitting(true);
    try {
      await createTimeEntry(task.id, payload);
      toast.success('Session logged.');
      resetForm();
      loadEntries();
      onEntryAdded();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to log session.');
    } finally {
      setSubmitting(false);
    }
  };

  const collaboratorUserIds = collaborators.map((c) => c.userId);
  const hasEstimate = task.estimatedHours !== null && task.estimatedHours !== undefined;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold text-slate-700">Work Log</h3>
      </div>

      {/* ── History section (visible to everyone) ──────────────────────────── */}
      <div className="space-y-1">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No sessions logged yet.</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {entries.map((entry) => {
              const collabCount = entry.collaboratorEntries?.length ?? 0;
              return (
                <div key={entry.id} className="py-2.5">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="text-xs text-slate-400">{formatDateTime(entry.loggedAt)}</span>
                    <span className="font-semibold text-slate-700">{formatHours(entry.sessionHours)}</span>
                    {collabCount > 0 && (
                      <span className="text-xs text-blue-600">
                        + {collabCount} collaborator{collabCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {entry.sessionNotes && (
                    <p className="text-xs text-slate-500 mt-0.5">{truncate(entry.sessionNotes, 80)}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Running total */}
        <div className="flex items-center gap-2 text-xs text-slate-500 pt-2 mt-1 border-t border-slate-50">
          <Clock className="w-3.5 h-3.5" />
          <span>
            <strong className="text-slate-700">{historyTotal.toFixed(1)}h logged</strong>
            {hasEstimate && <span className="ml-1">/ {task.estimatedHours!.toFixed(1)}h estimated</span>}
          </span>
        </div>
      </div>

      {/* ── Entry form (assignee only) ─────────────────────────────────────── */}
      {isAssignee && (
        <div className="space-y-4 mt-5 pt-5 border-t border-slate-100">
          {/* Session hours + notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Session Hours <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-3">
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="0.0"
                className="w-28 text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={sessionHours || ''}
                onChange={(e) => setSessionHours(Math.max(0, parseFloat(e.target.value) || 0))}
              />
              <input
                type="text"
                placeholder="What did you do this session?"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Collaborators */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Collaborators
              </label>
              <button
                type="button"
                onClick={handleAddCollaborator}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>

            {collaborators.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No collaborators added.</p>
            ) : (
              <div className="space-y-2">
                {collaborators.map((c) => (
                  <CollaboratorRow
                    key={c._key}
                    entry={c}
                    allUsers={allUsers}
                    selfId={task.assignedToUserId ?? currentUser.id}
                    otherCollaboratorIds={collaboratorUserIds.filter((id) => id !== c.userId)}
                    onChange={(updated) => handleUpdateCollaborator(c._key, updated)}
                    onRemove={() => handleRemoveCollaborator(c._key)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Over-budget reason (conditional) */}
          {showOverBudget && (
            <div className="space-y-2 p-3 bg-red-50 rounded-xl border border-red-100">
              <label className="block text-xs font-semibold text-red-600 uppercase tracking-wide">
                Over-Budget Reason <span className="text-red-400">*</span>
              </label>
              <select
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={overBudgetReason}
                onChange={(e) => setOverBudgetReason(e.target.value)}
              >
                <option value="">Select a reason…</option>
                {OVER_BUDGET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {overBudgetReason === 'OTHER' && (
                <input
                  type="text"
                  placeholder="Please describe the reason"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={overBudgetNote}
                  onChange={(e) => setOverBudgetNote(e.target.value)}
                />
              )}
            </div>
          )}

          {/* Total preview */}
          {(sessionHours > 0 || collaborators.some((c) => c.hoursLogged > 0)) && (
            <div className="flex items-center gap-2 text-xs text-slate-500 pt-1 border-t border-slate-50">
              <Clock className="w-3.5 h-3.5" />
              <span>
                Running total:{' '}
                <strong className="text-slate-700">{formatHours(formRunningTotal)}</strong>
                {hasEstimate && <span className="ml-1">/ {formatHours(task.estimatedHours!)} estimated</span>}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || sessionHours < 0 || overBudgetMissing}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              <Check className="w-4 h-4" />
              {submitting ? 'Logging…' : 'Log Session'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
