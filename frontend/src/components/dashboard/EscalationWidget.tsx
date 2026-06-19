import React from 'react';
import { AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import Link from 'next/link';

interface EscalationWidgetProps {
  count?: number;
  isLoading?: boolean;
}

export function EscalationWidget({ count = 0, isLoading }: EscalationWidgetProps) {
  const user = useAuthStore((state) => state.user);
  
  if (user?.role !== 'Manager' && user?.role !== 'Director' && user?.role !== 'Admin') {
    return null;
  }

  const hasEscalations = !isLoading && count > 0;

  return (
    <div className={`p-5 rounded-xl shadow-sm border flex flex-col h-full ${hasEscalations ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center space-x-3 mb-3">
        <div className={`p-2 rounded-lg ${hasEscalations ? 'bg-red-100' : 'bg-slate-100'}`}>
          <AlertTriangle className={`w-5 h-5 ${hasEscalations ? 'text-red-600' : 'text-slate-400'}`} aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold text-slate-800">Escalations</h2>
      </div>

      <div
        className="mt-auto flex flex-col items-center justify-center py-4"
        role="status"
        aria-live="polite"
        aria-label={isLoading ? 'Loading escalations' : `${count} escalation${count !== 1 ? 's' : ''} pending`}
      >
        {isLoading ? (
          <div className="animate-pulse flex flex-col items-center gap-2 w-full">
            <div className="h-10 bg-slate-200 rounded w-16"></div>
            <div className="h-4 bg-slate-200 rounded w-2/3 mt-1"></div>
          </div>
        ) : count > 0 ? (
          <>
            <span className="text-4xl font-extrabold text-red-600 tracking-tight leading-none">{count}</span>
            <p className="text-xs text-slate-600 mt-2 font-medium text-center">
              {count === 1 ? 'Escalation requires' : 'Escalations require'} your attention
            </p>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" aria-hidden="true" />
            <p className="text-xs text-slate-500 font-medium text-center">No pending escalations</p>
          </>
        )}
      </div>

      {!isLoading && (
        count > 0 ? (
          <Link
            href="/dashboard/escalations"
            className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-red-200 flex items-center justify-center gap-2"
          >
            Review
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        ) : (
          <div className="mt-3 h-9" />
        )
      )}
    </div>
  );
}
