'use client';

import { Check, X } from 'lucide-react';

/**
 * Client-side mirror of the backend password policy
 * (backend/src/utils/passwordPolicy.ts). Kept in sync deliberately so the
 * frontend never promises something the server will reject (audit U1, H1).
 */
export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;

const byteLength = (pw: string): number =>
  typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(pw).length : pw.length;

interface Rule {
  label: string;
  test: (pw: string) => boolean;
}

// Every rule the server enforces is shown here, so the checklist can never be
// all-green while the server (or isPasswordValid) rejects the password — e.g.
// the 72-byte cap, which previously failed silently (audit #7).
const RULES: Rule[] = [
  { label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: (pw) => pw.length >= MIN_PASSWORD_LENGTH },
  { label: 'Contains a letter', test: (pw) => /[A-Za-z]/.test(pw) },
  { label: 'Contains a number', test: (pw) => /[0-9]/.test(pw) },
  { label: `${MAX_PASSWORD_BYTES} characters or fewer`, test: (pw) => byteLength(pw) <= MAX_PASSWORD_BYTES },
];

/** True when every policy rule passes — use to gate submit (matches the server). */
export const isPasswordValid = (pw: string): boolean => RULES.every((r) => r.test(pw));

const strengthLabel = (pw: string): { label: string; color: string; width: string } => {
  if (pw.length === 0) return { label: '', color: 'bg-slate-200', width: '0%' };

  const allValid = RULES.every((r) => r.test(pw));
  // Until every hard rule passes the password cannot be submitted, so never show
  // better than 'Weak' — the meter must not contradict a blocked submit.
  if (!allValid) return { label: 'Weak', color: 'bg-red-500', width: '33%' };

  // All rules pass → at least 'Fair'; reward extra length / character variety.
  const bonus = (pw.length >= 12 ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
  return bonus >= 1
    ? { label: 'Strong', color: 'bg-green-500', width: '100%' }
    : { label: 'Fair', color: 'bg-amber-500', width: '66%' };
};

export default function PasswordStrength({ password }: { password: string }) {
  if (password.length === 0) return null;

  const { label, color, width } = strengthLabel(password);

  return (
    <div className="mt-2 space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div className={`h-full ${color} transition-all duration-200`} style={{ width }} />
        </div>
        {label && <span className="text-xs font-medium text-slate-500 w-12 text-right">{label}</span>}
      </div>
      <ul className="space-y-1">
        {RULES.map((rule) => {
          const passed = rule.test(password);
          return (
            <li key={rule.label} className="flex items-center gap-1.5 text-xs">
              {passed ? (
                <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0" aria-hidden="true" />
              ) : (
                <X className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" aria-hidden="true" />
              )}
              <span className={passed ? 'text-slate-600' : 'text-slate-400'}>{rule.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
