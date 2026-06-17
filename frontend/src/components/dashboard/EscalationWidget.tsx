import React from 'react';
import { AlertTriangle, ShieldAlert, ArrowRight } from 'lucide-react';
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

  return (
    <div className="bg-gradient-to-br from-red-50 to-white p-5 rounded-2xl shadow-sm border border-red-100 flex flex-col relative overflow-hidden group hover:shadow-md transition-all duration-300 h-full">
      <div className="absolute -right-2 -top-2 opacity-5 transform group-hover:scale-110 transition-transform duration-500 pointer-events-none">
        <ShieldAlert className="w-24 h-24 text-red-600" />
      </div>
      
      <div className="flex items-center space-x-3 mb-3 relative z-10">
        <div className="p-2 bg-red-100 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600" />
        </div>
        <h2 className="text-base font-semibold text-slate-800">Action Center</h2>
      </div>
      
      <div className="relative z-10 mt-auto flex flex-col items-center justify-center py-4">
        {isLoading ? (
          <div className="animate-pulse flex flex-col items-center gap-2 w-full">
            <div className="h-10 bg-red-200/50 rounded w-16"></div>
            <div className="h-4 bg-red-200/50 rounded w-2/3 mt-1"></div>
          </div>
        ) : (
          <>
            <span className="text-4xl font-extrabold text-red-600 tracking-tight leading-none">{count}</span>
            <p className="text-xs text-slate-600 mt-2 font-medium text-center">
              {count === 1 ? 'Escalation requires' : 'Escalations require'} your attention
            </p>
          </>
        )}
      </div>
      
      {!isLoading && count > 0 ? (
        <Link 
          href="/dashboard/escalations" 
          className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-red-200 relative z-10 flex items-center justify-center gap-2"
        >
          Review
          <ArrowRight className="w-4 h-4" />
        </Link>
      ) : (
        <div className="mt-3 h-9" />
      )}
    </div>
  );
}
