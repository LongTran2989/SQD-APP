'use client';

import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { WorkPackageDetail } from '../../types';
import { assignUserToWp, removeUserFromWp } from '../../api/wpApi';
import { getDatasource } from '../../api/taskApi';
import AsyncSearchableSelect from '../ui/AsyncSearchableSelect';
import toast from 'react-hot-toast';
import { UserPlus, X, Users } from 'lucide-react';

interface Props {
  wp: WorkPackageDetail;
  onUpdated: () => void;
}

const CAN_ASSIGN_ROLES = ['Manager', 'Director', 'Admin'];

export default function WorkPackageAssignmentPanel({ wp, onUpdated }: Props) {
  const { user } = useAuthStore();

  const [showModal, setShowModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const canManage = user && CAN_ASSIGN_ROLES.includes(user.role) && wp.computedStatus !== 'Closed';

  const assignedUserIds = new Set(wp.assignments.map((a) => a.userId));
  const fetchAvailableUsers = (q: string) =>
    getDatasource('users', { q, limit: 20 }).then((opts) =>
      opts.filter((o) => !assignedUserIds.has(Number(o.value)))
    );

  const handleAssign = async () => {
    if (!selectedUserId) return;
    setAssigning(true);
    try {
      await assignUserToWp(wp.id, Number(selectedUserId));
      toast.success('User assigned to work package');
      setShowModal(false);
      setSelectedUserId('');
      onUpdated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to assign user');
    } finally {
      setAssigning(false);
    }
  };

  const handleRemove = async (userId: number, userName: string) => {
    if (!confirm(`Remove ${userName} from this work package?`)) return;
    setRemovingId(userId);
    try {
      await removeUserFromWp(wp.id, userId);
      toast.success(`${userName} removed`);
      onUpdated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to remove user');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          Assigned Users
          <span className="ml-1 px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-bold">
            {wp.assignments.length}
          </span>
        </h3>
        {canManage && (
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Assign User
          </button>
        )}
      </div>

      {wp.assignments.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No users assigned yet.</p>
      ) : (
        <ul className="space-y-2">
          {wp.assignments.map((a) => (
            <li key={a.userId} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-xl">
              <span className="text-sm font-medium text-slate-700">{a.user.name}</span>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="truncate max-w-[160px]">{a.user.email}</span>
                {canManage && (
                  <button
                    onClick={() => handleRemove(a.userId, a.user.name)}
                    disabled={removingId === a.userId}
                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Remove"
                  >
                    {removingId === a.userId ? (
                      <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Assign modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Assign User</h2>

            <AsyncSearchableSelect
              value={selectedUserId}
              onChange={setSelectedUserId}
              fetchOptions={fetchAvailableUsers}
              placeholder="Search for a user…"
            />

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => { setShowModal(false); setSelectedUserId(''); }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={!selectedUserId || assigning}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all"
              >
                {assigning ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Assigning...
                  </span>
                ) : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
