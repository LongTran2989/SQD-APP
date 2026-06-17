import React from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

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
    <div className="bg-gradient-to-br from-red-50 to-white p-6 rounded-2xl shadow-sm border border-red-100 flex flex-col relative overflow-hidden group hover:shadow-md transition-all duration-300">
      <div className="absolute -right-4 -top-4 opacity-10 transform group-hover:scale-110 transition-transform duration-500">
        <ShieldAlert className="w-32 h-32 text-red-600" />
      </div>
      
      <div className="flex items-center space-x-3 mb-2 relative z-10">
        <div className="p-2 bg-red-100 rounded-lg">
          <AlertTriangle className="w-6 h-6 text-red-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">Action Center</h2>
      </div>
      
      <div className="relative z-10 mt-2">
        {isLoading ? (
          <div className="animate-pulse flex flex-col gap-2">
            <div className="h-10 bg-red-200/50 rounded w-16"></div>
            <div className="h-4 bg-red-200/50 rounded w-32 mt-1"></div>
          </div>
        ) : (
          <>
            <span className="text-4xl font-bold text-red-600 tracking-tight">{count}</span>
            <p className="text-sm text-slate-600 mt-2 font-medium">
              {count === 1 ? 'Escalation requires' : 'Escalations require'} your immediate attention
            </p>
          </>
        )}
      </div>
      
      {!isLoading && count > 0 && (
        <button className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm shadow-red-200 relative z-10">
          Review Escalations
        </button>
      )}
    </div>
  );
}
