'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Plus,
  Search,
  Pencil,
  Trash2,
  KeyRound,
  Lock,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  UserX,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import {
  AdminUser,
  UserFormData,
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  adminResetUserPassword,
} from '../../api/userApi';
import { getDivisions } from '../../api/taskApi';
import { apiErrorMessage } from '../../api/errorMessage';

const ROLE_NAMES = ['Director', 'Admin', 'Manager', 'Group Leader', 'Staff'];
const PAGE_SIZE = 20;

type DivisionOption = { value: string; label: string };

function RoleBadge({ role }: { role: string }) {
  const colours: Record<string, string> = {
    Director: 'bg-purple-100 text-purple-700',
    Admin: 'bg-red-100 text-red-700',
    Manager: 'bg-blue-100 text-blue-700',
    'Group Leader': 'bg-teal-100 text-teal-700',
    Staff: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${colours[role] ?? 'bg-slate-100 text-slate-600'}`}>
      {role}
    </span>
  );
}

interface UserFormModalProps {
  editing: AdminUser | null;
  divisions: DivisionOption[];
  onClose: () => void;
  onSaved: () => void;
}

function UserFormModal({ editing, divisions, onClose, onSaved }: UserFormModalProps) {
  const [form, setForm] = useState<UserFormData>({
    employeeId: editing?.employeeId ?? '',
    name: editing?.name ?? '',
    email: editing?.email ?? '',
    phone: editing?.phone ?? '',
    roleName: editing?.role.name ?? '',
    divisionId: editing?.divisionId ?? 0,
  });
  const [saving, setSaving] = useState(false);

  const field = (key: keyof UserFormData, value: string | number) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.roleName) { toast.error('Role is required'); return; }
    if (!form.divisionId) { toast.error('Division is required'); return; }

    setSaving(true);
    try {
      if (editing) {
        await updateAdminUser(editing.id, form);
        toast.success('User updated');
      } else {
        await createAdminUser(form);
        toast.success('User created — they will be prompted to set a password on first login');
      }
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, editing ? 'Failed to update user' : 'Failed to create user'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-800">
            {editing ? 'Edit User' : 'New User'}
          </h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Employee ID</label>
              <input className={inputCls} value={form.employeeId ?? ''} onChange={(e) => field('employeeId', e.target.value)} placeholder="VAE00001" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name <span className="text-red-500">*</span></label>
              <input className={inputCls} value={form.name} onChange={(e) => field('name', e.target.value)} placeholder="Full name" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input className={inputCls} type="email" value={form.email ?? ''} onChange={(e) => field('email', e.target.value)} placeholder="user@example.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
            <input className={inputCls} value={form.phone ?? ''} onChange={(e) => field('phone', e.target.value)} placeholder="+84 xxx xxx xxx" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Role <span className="text-red-500">*</span></label>
              <select className={inputCls} value={form.roleName} onChange={(e) => field('roleName', e.target.value)}>
                <option value="">Select role…</option>
                {ROLE_NAMES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Division <span className="text-red-500">*</span></label>
              <select className={inputCls} value={form.divisionId || ''} onChange={(e) => field('divisionId', Number(e.target.value))}>
                <option value="">Select division…</option>
                {divisions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
          {!editing && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              New user will be created with a temporary password and prompted to set their own on first login.
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg font-medium">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-lg font-medium flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editing ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}

function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose, loading }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-2">{title}</h2>
        <p className="text-sm text-slate-500 mb-5">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg font-medium">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-50 ${
              danger ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserManagementSettings() {
  const user = useAuthStore((s) => s.user);
  const canAccess = user?.role === 'Admin' || user?.role === 'Director';
  const canManage = user?.role === 'Admin';

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const [divisions, setDivisions] = useState<DivisionOption[]>([]);
  const [formModal, setFormModal] = useState<{ open: boolean; target: AdminUser | null }>({ open: false, target: null });
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; target: AdminUser | null; loading: boolean }>({ open: false, target: null, loading: false });
  const [resetModal, setResetModal] = useState<{ open: boolean; target: AdminUser | null; loading: boolean }>({ open: false, target: null, loading: false });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!canAccess) return;
    getDivisions().then(setDivisions).catch(() => {});
  }, [canAccess]);

  const fetchUsers = useCallback(() => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    listAdminUsers({ page, limit: PAGE_SIZE, q: debouncedQ, includeDeleted })
      .then((data) => {
        setUsers(data.users);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load users')))
      .finally(() => setLoading(false));
  }, [canAccess, page, debouncedQ, includeDeleted]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { setPage(1); }, [debouncedQ, includeDeleted]);

  const handleDelete = async () => {
    if (!deleteModal.target) return;
    setDeleteModal((m) => ({ ...m, loading: true }));
    try {
      await deleteAdminUser(deleteModal.target.id);
      toast.success('User deleted');
      setDeleteModal({ open: false, target: null, loading: false });
      fetchUsers();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to delete user'));
      setDeleteModal((m) => ({ ...m, loading: false }));
    }
  };

  const handleReset = async () => {
    if (!resetModal.target) return;
    setResetModal((m) => ({ ...m, loading: true }));
    try {
      await adminResetUserPassword(resetModal.target.id);
      toast.success('Password reset — the user must set a new password on next login');
      setResetModal({ open: false, target: null, loading: false });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to reset password'));
      setResetModal((m) => ({ ...m, loading: false }));
    }
  };

  if (!canAccess) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <Lock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-800">Access restricted</h1>
          <p className="text-sm text-slate-500 mt-1">Only Admins and Directors can manage users.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">User Management</h2>
            <p className="text-sm text-slate-500">{total} user{total !== 1 ? 's' : ''} total</p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={() => setFormModal({ open: true, target: null })}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            New User
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, ID or email…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => setIncludeDeleted(e.target.checked)}
            className="rounded border-slate-300 text-blue-600"
          />
          <span className="flex items-center gap-1"><UserX className="w-3.5 h-3.5" /> Show deleted</span>
        </label>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users className="w-8 h-8 mb-2" />
            <p className="text-sm">No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left font-semibold text-slate-600 px-5 py-3">Employee ID</th>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Name</th>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Email</th>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Role</th>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Division</th>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Status</th>
                  {canManage && <th className="text-right font-semibold text-slate-600 px-5 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b border-slate-50 hover:bg-slate-50/40 ${u.deletedAt ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{u.employeeId ?? '—'}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {u.name}
                      {u.forcePasswordChange && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 font-medium">
                          Must change pw
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.email ?? '—'}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role.name} /></td>
                    <td className="px-4 py-3 text-slate-600">{u.division.name}</td>
                    <td className="px-4 py-3">
                      {u.deletedAt ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-600">
                          <UserX className="w-3 h-3" /> Deleted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {!u.deletedAt && (
                            <>
                              <button
                                onClick={() => setFormModal({ open: true, target: u })}
                                title="Edit user"
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setResetModal({ open: true, target: u, loading: false })}
                                title="Reset password to default"
                                className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                              >
                                <KeyRound className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteModal({ open: true, target: u, loading: false })}
                                title="Delete user"
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
          <span>Page {page} of {totalPages} — {total} users</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {formModal.open && (
        <UserFormModal
          editing={formModal.target}
          divisions={divisions}
          onClose={() => setFormModal({ open: false, target: null })}
          onSaved={() => {
            setFormModal({ open: false, target: null });
            fetchUsers();
          }}
        />
      )}

      {deleteModal.open && deleteModal.target && (
        <ConfirmModal
          title="Delete user?"
          message={`${deleteModal.target.name} will be soft-deleted and can no longer log in. This action can be reversed by an Admin.`}
          confirmLabel="Delete"
          danger
          loading={deleteModal.loading}
          onConfirm={handleDelete}
          onClose={() => setDeleteModal({ open: false, target: null, loading: false })}
        />
      )}

      {resetModal.open && resetModal.target && (
        <ConfirmModal
          title="Reset password?"
          message={`${resetModal.target.name}'s password will be reset to a temporary password. They will be required to set a new one on next login, and any active session will be signed out.`}
          confirmLabel="Reset Password"
          loading={resetModal.loading}
          onConfirm={handleReset}
          onClose={() => setResetModal({ open: false, target: null, loading: false })}
        />
      )}
    </div>
  );
}
