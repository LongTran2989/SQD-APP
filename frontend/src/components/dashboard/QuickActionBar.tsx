import React from 'react';
import { PlusCircle, Briefcase, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import Link from 'next/link';

interface QuickActionBarProps {
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function QuickActionBar({ onRefresh, isRefreshing }: QuickActionBarProps) {
  const user = useAuthStore((state) => state.user);
  const isManagerOrDirector = user?.role === 'Manager' || user?.role === 'Director';

  return (
    <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-wrap items-center justify-between gap-4 sticky top-4 z-10">
      <div className="flex items-center gap-3">
        <button 
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
          title="Refresh Dashboard"
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-indigo-600' : ''}`} />
        </button>
        <div className="h-6 w-px bg-slate-200"></div>
        <h2 className="text-sm font-semibold text-slate-700 tracking-wide uppercase">Quick Actions</h2>
      </div>

      <div className="flex items-center gap-3">
        <Link 
          href="/dashboard/tasks/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors"
        >
          <Briefcase className="w-4 h-4" />
          Create Task
        </Link>
        
        {isManagerOrDirector && (
          <Link 
            href="/dashboard/work-packages/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-indigo-200"
          >
            <PlusCircle className="w-4 h-4" />
            New Work Package
          </Link>
        )}
      </div>
    </div>
  );
}
