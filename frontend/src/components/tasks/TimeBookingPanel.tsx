'use client';

import { useState, useEffect } from 'react';
import { TaskEnriched, User, TimeBookingEntry } from '../../types';
import { createTimeBooking, updateTimeBooking, getUsers } from '../../api/taskApi';
import { Clock, Plus, Trash2, Edit2, Check, X } from 'lucide-react';
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
  onBookingChange: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHours(h: number): string {
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
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

// ─── Sub-component: Read-only booking summary ────────────────────────────────

function BookingSummary({
  task,
  allUsers,
  onEdit,
  canEdit,
}: {
  task: TaskEnriched;
  allUsers: UserOption[];
  onEdit: () => void;
  canEdit: boolean;
}) {
  const booking = task.timeBooking!;

  const getUserLabel = (userId: number) =>
    allUsers.find((u) => Number(u.value) === userId)?.label?.split(' (')[0] ?? `User ${userId}`;

  const hasEstimate = booking.estimatedHours !== null && booking.estimatedHours !== undefined;
  const overBudget = hasEstimate && booking.totalHours > booking.estimatedHours!;

  return (
    <div className="space-y-3">
      {/* Assignee row */}
      <div className="flex items-start gap-3 py-2 border-b border-slate-50">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">
          Assignee
        </span>
        <div className="flex-1 text-sm text-slate-700">
          <span className="font-medium">{getUserLabel(booking.assigneeEntry.userId)}</span>
          <span className="text-slate-500 ml-2">— {formatHours(booking.assigneeEntry.hoursLogged)}</span>
          {booking.assigneeEntry.notes && (
            <p className="text-slate-500 text-xs mt-0.5">{booking.assigneeEntry.notes}</p>
          )}
        </div>
      </div>

      {/* Collaborators */}
      {booking.collaborators.length > 0 && (
        <div className="flex items-start gap-3 py-2 border-b border-slate-50">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">
            Collaborators
          </span>
          <div className="flex-1 space-y-1.5">
            {booking.collaborators.map((c, i) => (
              <div key={i} className="text-sm text-slate-700">
                <span className="font-medium">{getUserLabel(c.userId)}</span>
                <span className="text-slate-500 ml-2">— {formatHours(c.hoursLogged)}</span>
                {c.notes && <p className="text-slate-500 text-xs mt-0.5">{c.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Total row */}
      <div className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0">
          Total
        </span>
        <div className="flex-1 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-bold text-slate-800">
            {formatHours(booking.totalHours)} actual
          </span>
          {hasEstimate && (
            <>
              <span className="text-slate-300">vs</span>
              <span className="text-sm text-slate-500">
                {formatHours(booking.estimatedHours!)} estimated
              </span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  overBudget
                    ? 'bg-red-50 text-red-600 border border-red-200'
                    : 'bg-green-50 text-green-600 border border-green-200'
                }`}
              >
                {overBudget
                  ? `+${formatHours(booking.totalHours - booking.estimatedHours!)} over`
                  : `−${formatHours(booking.estimatedHours! - booking.totalHours)} under`}
              </span>
            </>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Edit Booking
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TimeBookingPanel({ task, currentUser, onBookingChange }: Props) {
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [myHours, setMyHours] = useState<number>(0);
  const [myNotes, setMyNotes] = useState('');
  const [collaborators, setCollaborators] = useState<CollaboratorDraft[]>([]);

  const booking = task.timeBooking;
  const isAssignee = task.assignedToUserId === currentUser.id;
  const isAdminOrDirector = currentUser.role === 'Admin' || currentUser.role === 'Director';
  const canEdit = isAssignee || isAdminOrDirector;
  const isCreateMode = !booking;

  // Fetch user list once (for collaborator search)
  useEffect(() => {
    getUsers().then(setAllUsers).catch(() => {});
  }, []);

  // Pre-fill form when switching into edit mode on an existing booking
  useEffect(() => {
    if (isEditing && booking) {
      setMyHours(booking.assigneeEntry.hoursLogged);
      setMyNotes(booking.assigneeEntry.notes);
      setCollaborators(
        booking.collaborators.map((c) => ({ ...c, _key: nextKey() }))
      );
    } else if (!booking) {
      setMyHours(0);
      setMyNotes('');
      setCollaborators([]);
    }
  }, [isEditing, booking]);

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

  const handleSubmit = async () => {
    // Client-side guard: collaborators must have userId selected
    const invalidCollab = collaborators.find((c) => !c.userId);
    if (invalidCollab) {
      toast.error('Please select a user for each collaborator entry.');
      return;
    }

    const assigneeUserId = isCreateMode
      ? currentUser.id
      : (task.assignedToUserId ?? currentUser.id);

    const payload = {
      assigneeEntry: {
        userId: assigneeUserId,
        hoursLogged: myHours,
        notes: myNotes,
      },
      collaborators: collaborators.map(({ userId, hoursLogged, notes }) => ({
        userId,
        hoursLogged,
        notes,
      })),
    };

    setSubmitting(true);
    try {
      if (isCreateMode) {
        await createTimeBooking(task.id, payload);
        toast.success('Time logged successfully.');
      } else {
        await updateTimeBooking(task.id, payload);
        toast.success('Time booking updated.');
        setIsEditing(false);
      }
      onBookingChange();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save time booking.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Form (create mode or edit mode) ──────────────────────────────────────

  const showForm = isCreateMode || isEditing;

  if (!showForm && !booking) {
    // No booking, not the assignee, not admin/director
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700">Time Booking</h3>
        </div>
        <p className="text-sm text-slate-400 italic">No time has been logged for this task.</p>
      </div>
    );
  }

  if (!showForm && booking) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-slate-700">Time Booking</h3>
        </div>
        <BookingSummary
          task={task}
          allUsers={allUsers}
          onEdit={() => setIsEditing(true)}
          canEdit={canEdit}
        />
      </div>
    );
  }

  // Form UI
  const collaboratorUserIds = collaborators.map((c) => c.userId);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-slate-700">
            {isCreateMode ? 'Log Your Time' : 'Edit Time Booking'}
          </h3>
        </div>
        {!isCreateMode && (
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Own hours */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Your Hours <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-3">
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder="0.0"
              className="w-28 text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={myHours || ''}
              onChange={(e) => setMyHours(Math.max(0, parseFloat(e.target.value) || 0))}
            />
            <input
              type="text"
              placeholder="Notes (optional)"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={myNotes}
              onChange={(e) => setMyNotes(e.target.value)}
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

        {/* Total preview */}
        {(myHours > 0 || collaborators.some((c) => c.hoursLogged > 0)) && (
          <div className="flex items-center gap-2 text-xs text-slate-500 pt-1 border-t border-slate-50">
            <Clock className="w-3.5 h-3.5" />
            <span>
              Total:{' '}
              <strong className="text-slate-700">
                {formatHours(
                  myHours + collaborators.reduce((sum, c) => sum + c.hoursLogged, 0)
                )}
              </strong>
              {task.estimatedHours && (
                <span className="ml-1">/ {formatHours(task.estimatedHours)} estimated</span>
              )}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || myHours < 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Check className="w-4 h-4" />
            {submitting ? 'Saving…' : isCreateMode ? 'Log Time' : 'Update'}
          </button>
          {!isCreateMode && (
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={submitting}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
