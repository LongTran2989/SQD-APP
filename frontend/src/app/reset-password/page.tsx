'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '../../api/client';
import PasswordInput from '../../components/auth/PasswordInput';
import PasswordStrength, { isPasswordValid } from '../../components/auth/PasswordStrength';
import { KeyRound, ShieldAlert, CheckCircle2 } from 'lucide-react';

function ResetPasswordForm() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  if (!token && status !== 'success') {
    return (
      <div className="text-center">
        <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-slate-800 mb-2">Invalid Link</h1>
        <p className="text-slate-500 mb-6">No reset token was provided in the URL.</p>
        <Link href="/login" className="text-blue-600 font-semibold hover:text-blue-700">Return to Login</Link>
      </div>
    );
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');

    if (newPassword !== confirmPassword) {
      setStatus('error');
      setMessage('Passwords do not match.');
      return;
    }

    // Mirror the server policy so we fail fast instead of round-tripping a 400.
    if (!isPasswordValid(newPassword)) {
      setStatus('error');
      setMessage('Password must be at least 8 characters and include both letters and numbers.');
      return;
    }

    setStatus('loading');
    try {
      await apiClient.post('/auth/reset-password', { token, newPassword });
      setStatus('success');
      setMessage('Your password has been successfully reset.');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.response?.data?.message || 'The reset link is invalid or has expired.');
    }
  };

  if (status === 'success') {
    return (
      <div className="text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Password Reset</h1>
        <p className="text-slate-500 mb-8">{message}</p>
        <Link href="/login" className="inline-block py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all">
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center mb-6">
        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
          <KeyRound className="text-blue-600 w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight text-center">Set New Password</h1>
        <p className="text-slate-500 text-center mt-2">Please enter your new password below.</p>
      </div>

      {status === 'error' && (
        <div role="alert" aria-live="polite" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <p className="text-sm text-red-700">{message}</p>
        </div>
      )}

      <form onSubmit={handleReset} className="space-y-5">
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
            label="Confirm Password"
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
          disabled={status === 'loading'}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all flex justify-center"
        >
          {status === 'loading' ? 'Resetting...' : 'Reset Password'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-xl border border-slate-100">
        <Suspense fallback={<div className="text-center text-slate-500">Loading...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
