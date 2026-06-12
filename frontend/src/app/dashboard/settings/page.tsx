'use client';

import { useState } from 'react';
import { Settings, AlertTriangle, Loader2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../store/authStore';
import { changeMyPassword } from '../../../api/userApi';
import { apiErrorMessage } from '../../../api/errorMessage';

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPassword.trim()) {
      toast.error('Current password is required');
      return;
    }
    if (!newPassword.trim()) {
      toast.error('New password is required');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setChanged(true);
      setTimeout(() => setChanged(false), 3000);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to change password'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <Settings className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
          <p className="text-sm text-slate-500">Manage your profile and security</p>
        </div>
      </div>

      {/* Force password change banner */}
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
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Profile</h2>
          <div className="grid grid-cols-2 gap-4 md:gap-6">
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                Name
              </label>
              <p className="text-sm font-medium text-slate-800">{user?.name ?? '—'}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                Employee ID
              </label>
              <p className="text-sm font-mono text-slate-600">{user?.employeeId ?? '—'}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                Email
              </label>
              <p className="text-sm text-slate-600">{user?.email ?? '—'}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                Role
              </label>
              <p className="text-sm font-medium text-slate-800">{user?.role ?? '—'}</p>
            </div>
          </div>
        </div>

        {/* Change password card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Change Password</h2>
          <div className="space-y-4 max-w-sm">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Current Password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter a new password (min 6 chars)"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your new password"
                className={inputCls}
              />
            </div>

            {changed && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-sm">
                <Check className="w-4 h-4 flex-shrink-0" />
                Password changed successfully!
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={saving || !currentPassword.trim() || !newPassword.trim()}
              className="w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
