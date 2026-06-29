'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  autoFocus?: boolean;
}

/**
 * Password field with a show/hide toggle (audit U2). Shared by the login,
 * update-password and reset-password screens so the toggle behaves identically
 * everywhere and the markup lives in one place.
 */
export default function PasswordInput({
  id,
  value,
  onChange,
  label,
  placeholder = '••••••••',
  autoComplete,
  required,
  autoFocus,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  // Fall back to a generated id so the label is always associated with the
  // input even when a caller passes `label` without an explicit `id` (audit #5).
  const reactId = useId();
  const inputId = id ?? reactId;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          required={required}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow duration-150"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors focus:outline-none focus:text-blue-600"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
