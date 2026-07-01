import React from 'react';
import { AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import Link from 'next/link';

interface EscalationWidgetProps {
  count?: number;
  isLoading?: boolean;
  /** 'banner': full-width, elevated treatment for when escalations are active.
   *  'cell': compact stat-strip cell for the calm/loading state. Default 'cell'. */
  layout?: 'banner' | 'cell';
}

export function EscalationWidget({ count = 0, isLoading, layout = 'cell' }: EscalationWidgetProps) {
  const user = useAuthStore((state) => state.user);

  if (user?.role !== 'Manager' && user?.role !== 'Director' && user?.role !== 'Admin') {
    return null;
  }

  if (layout === 'banner') {
    return (
      <div
        className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex items-center justify-between gap-4"
        role="status"
        aria-live="polite"
        aria-label={`${count} escalation${count !== 1 ? 's' : ''} pending`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-red-100 shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-finding" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-800">
              <span className="text-lg font-extrabold tracking-tight mr-1.5">{count}</span>
              {count === 1 ? 'escalation requires' : 'escalations require'} your attention
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/escalations"
          className="shrink-0 inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
        >
          Review
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-6 flex flex-col h-full">
      <div className="flex items-center space-x-3 mb-3">
        <div className="p-1.5 rounded-md bg-slate-100">
          <AlertTriangle className="w-4 h-4 text-slate-400" aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold text-slate-600">Escalations</h2>
      </div>

      <div
        className="mt-auto flex flex-col items-center justify-center py-2"
        role="status"
        aria-live="polite"
        aria-label={isLoading ? 'Loading escalations' : 'No pending escalations'}
      >
        {isLoading ? (
          <div className="animate-pulse flex flex-col items-center gap-2 w-full">
            <div className="h-9 bg-slate-200 rounded w-16"></div>
            <div className="h-4 bg-slate-200 rounded w-2/3 mt-1"></div>
          </div>
        ) : (
          <>
            <CheckCircle2 className="w-8 h-8 text-emerald-clear mb-2" aria-hidden="true" />
            <p className="text-xs text-slate-500 font-medium text-center">No pending escalations</p>
          </>
        )}
      </div>
    </div>
  );
}
