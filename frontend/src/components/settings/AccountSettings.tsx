'use client';

import { useState } from 'react';
import { Check, Loader2, Pencil, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { changeMyPassword, updateMyProfile } from '../../api/userApi';
import { apiErrorMessage } from '../../api/errorMessage';

export default function AccountSettings() {
  const { user, updateProfile } = useAuthStore();

  const [editing, setEditing] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const startEdit = () => {
    setEditEmail(user?.email ?? '');
    setEditPhone(user?.phone ?? '');
    setEditing(true);
  };

  const handlePhoneChange = (v: string) => {
    setEditPhone(v.replace(/\D/g, '').slice(0, 12));
  };

  const handleProfileSave = async () => {
    setProfileSaving(true);
    try {
      const result = await updateMyProfile({
        email: editEmail || null,
        phone: editPhone || null,
      });
      updateProfile({ email: result.user.email, phone: result.user.phone });
      toast.success('Profile updated');
      setEditing(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to update profile'));
    } finally {
      setProfileSaving(false);
    }
  };

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwChanged, setPwChanged] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPassword.trim()) { toast.error('Current password is required'); return; }
    if (!newPassword.trim()) { toast.error('New password is required'); return; }
    if (newPassword.length < 6) { toast.error('New password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }

    setPwSaving(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwChanged(true);
      setTimeout(() => setPwChanged(false), 3000);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to change password'));
    } finally {
      setPwSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="p-8">
      {user?.forcePasswordChange && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-amber-800 text-sm">Password change required</h3>
            <p className="text-xs text-amber-700 mt-1">
              You must change your password on first login. Please do so below.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {/* Profile card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">Profile</h2>
            {!editing && (
              <button
                onClick={startEdit}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-blue-600 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Name</label>
              <p className="text-sm font-medium text-slate-800">{user?.name ?? '—'}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Employee ID</label>
              <p className="text-sm font-mono text-slate-600">{user?.employeeId ?? '—'}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Role</label>
              <p className="text-sm font-medium text-slate-800">{user?.role ?? '—'}</p>
            </div>
            <div />

            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Email</label>
              {editing ? (
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputCls}
                />
              ) : (
                <p className="text-sm text-slate-600">{user?.email ?? '—'}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                Phone{' '}
                <span className="normal-case font-normal text-slate-400">(digits only, max 12)</span>
              </label>
              {editing ? (
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="0901234567"
                  maxLength={12}
                  className={inputCls}
                />
              ) : (
                <p className="text-sm text-slate-600">{user?.phone ?? '—'}</p>
              )}
            </div>
          </div>

          {editing && (
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
              <button
                onClick={() => setEditing(false)}
                disabled={profileSaving}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg font-medium"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                onClick={handleProfileSave}
                disabled={profileSaving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-lg font-medium"
              >
                {profileSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {profileSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* Change password card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Change Password</h2>
          <div className="space-y-4 max-w-sm">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter a new password (min 6 chars)"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your new password"
                className={inputCls}
              />
            </div>

            {pwChanged && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-sm">
                <Check className="w-4 h-4 flex-shrink-0" />
                Password changed successfully!
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={pwSaving || !currentPassword.trim() || !newPassword.trim()}
              className="w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              {pwSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {pwSaving ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
