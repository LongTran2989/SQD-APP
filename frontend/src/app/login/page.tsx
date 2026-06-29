'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { apiClient, AUTH_NOTICE_KEY } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import PasswordInput from '../../components/auth/PasswordInput';
import { ShieldAlert, Info } from 'lucide-react';

export default function LoginPage() {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const idRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    idRef.current?.focus();
    // Show (and clear) any "why you were signed out" notice left by the API
    // client's 401 handler — e.g. another user signed in to this browser, or
    // the account signed in on another device (audit U8).
    const stashed = sessionStorage.getItem(AUTH_NOTICE_KEY);
    if (stashed) {
      // Read post-mount, not in a lazy initializer: sessionStorage doesn't exist
      // during SSR, and seeding initial state from it would cause a hydration
      // mismatch. Setting it in the effect is the correct pattern here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice(stashed);
      sessionStorage.removeItem(AUTH_NOTICE_KEY);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiClient.post('/auth/login', { employeeId, password });

      if (response.status === 202 && response.data.requirePasswordChange) {
        router.push('/update-password');
        return;
      }

      const { user } = response.data;
      login(user);
      router.push('/dashboard');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } } };
      const status = axiosErr.response?.status;
      if (status === 401) {
        setError('Invalid Staff ID or password.');
      } else if (status === 429) {
        // Surface the rate-limit response rather than disguising it as a
        // connection problem (audit U5).
        setError(axiosErr.response?.data?.message || 'Too many attempts. Please try again in a few minutes.');
      } else {
        setError('An error occurred connecting to the server.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-50"
      style={{
        backgroundImage: 'radial-gradient(circle, #e2e8f0 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="w-full max-w-md px-4 py-8">
        <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-[0_8px_24px_rgba(15,23,42,0.10),0_2px_6px_rgba(15,23,42,0.06)]">

          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 flex items-center justify-center mb-4">
              <Image src="/logo.png" alt="SQD Logo" width={64} height={64} className="w-full h-full object-contain" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight text-balance">
              SQD-APP
            </h1>
            <p className="text-slate-500 text-sm font-medium mt-1">Aviation QA System</p>
          </div>

          {/* Sign-out notice (e.g. another user signed in to this browser) */}
          {notice && (
            <div
              role="status"
              aria-live="polite"
              className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3"
            >
              <Info className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-amber-800">{notice}</p>
            </div>
          )}

          {/* Error alert */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3"
            >
              <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="employeeId" className="block text-sm font-semibold text-slate-700">
                Staff ID
              </label>
              <input
                ref={idRef}
                id="employeeId"
                type="text"
                required
                autoComplete="username"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow duration-150"
                placeholder="e.g. VAE00071"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors duration-150"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-semibold rounded-xl shadow-[0_2px_6px_rgba(37,99,235,0.25)] hover:shadow-[0_4px_12px_rgba(37,99,235,0.30)] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 flex justify-center items-center gap-2"
            >
              {loading ? (
                <>
                  <span
                    className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin"
                    aria-hidden="true"
                  />
                  <span>Signing in…</span>
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          SQD-APP · Aviation MRO Quality Assurance
        </p>
      </div>
    </div>
  );
}
