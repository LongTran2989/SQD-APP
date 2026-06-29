'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../api/client';
import { apiErrorMessage } from '../../api/errorMessage';
import { useAuthStore } from '../../store/authStore';
import PasswordInput from '../../components/auth/PasswordInput';
import PasswordStrength, { isPasswordValid } from '../../components/auth/PasswordStrength';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

export default function UpdatePasswordPage() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const login = useAuthStore((state) => state.login);

  // No client-side guard token: the forced-change session lives in the httpOnly
  // cookie. If the cookie is missing/invalid, the update-password request below
  // returns 401 and the response interceptor redirects to /login.

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!oldPassword) {
      setError('Please enter your current password.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // Mirror the server policy so we fail fast instead of round-tripping a 400.
    if (!isPasswordValid(newPassword)) {
      setError('Password must be at least 8 characters and include both letters and numbers.');
      return;
    }

    if (newPassword === oldPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setLoading(true);
    try {
      // Auth is carried by the httpOnly cookie (withCredentials); the backend
      // refreshes the cookie with the new session on success.
      const response = await apiClient.post('/auth/update-password', { oldPassword, newPassword });

      const { user } = response.data;

      // Log the user in officially.
      login(user);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(apiErrorMessage(err, 'An error occurred updating your password.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-xl border border-slate-100">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
            <ShieldCheck className="text-blue-600 w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight text-center">Welcome to SQD-APP</h1>
          <p className="text-slate-500 text-center mt-2">For security reasons, you must change your temporary password before accessing the dashboard.</p>
        </div>

        {error && (
          <div role="alert" aria-live="polite" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleUpdate} className="space-y-5">
          <PasswordInput
            label="Current Password"
            required
            autoComplete="current-password"
            value={oldPassword}
            onChange={setOldPassword}
          />

          <div>
            <PasswordInput
              label="New Password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={setNewPassword}
            />
            <PasswordStrength password={newPassword} />
          </div>

          <div>
            <PasswordInput
              label="Confirm New Password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            {confirmPassword.length > 0 && confirmPassword !== newPassword && (
              <p className="mt-1.5 text-xs text-red-600">Passwords do not match.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all flex justify-center"
          >
            {loading ? 'Updating...' : 'Update Password & Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
