'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { getSecuritySettings, updateSecuritySettings } from '../../api/securitySettingsApi';
import { apiErrorMessage } from '../../api/errorMessage';

const ADMIN_ONLY = ['Admin'];

export default function SecuritySettings() {
  const user = useAuthStore((s) => s.user);
  const canManage = user ? ADMIN_ONLY.includes(user.role) : false;

  const [enforceSingleSession, setEnforceSingleSession] = useState(true);
  const [loading, setLoading] = useState(canManage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    getSecuritySettings()
      .then((res) => {
        if (!cancelled) setEnforceSingleSession(res.enforceSingleSession);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Failed to load security settings.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const handleToggle = async (next: boolean) => {
    const prev = enforceSingleSession;
    setEnforceSingleSession(next); // optimistic
    setSaving(true);
    try {
      const res = await updateSecuritySettings({ enforceSingleSession: next });
      setEnforceSingleSession(res.enforceSingleSession);
      toast.success('Security settings saved.');
    } catch (err) {
      setEnforceSingleSession(prev); // revert
      toast.error(apiErrorMessage(err, 'Failed to save security settings.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-3 text-slate-500">
          <Lock className="w-5 h-5" />
          <p>You do not have permission to manage security settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      {error && (
        <div role="alert" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Enforce single active session</h3>
                <p className="text-sm text-slate-500 mt-1">
                  When enabled, signing in revokes the user&apos;s other active session, so each account is
                  logged in from one place at a time. Disable it to let a user stay signed in on several
                  devices simultaneously.
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={enforceSingleSession}
              aria-label="Enforce single active session"
              disabled={saving}
              onClick={() => handleToggle(!enforceSingleSession)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                enforceSingleSession ? 'bg-blue-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  enforceSingleSession ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
