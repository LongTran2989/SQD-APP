import React from 'react';
import { PlusCircle, Briefcase, RefreshCw, CalendarClock } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import Link from 'next/link';

interface QuickActionBarProps {
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function QuickActionBar({ onRefresh, isRefreshing }: QuickActionBarProps) {
  const user = useAuthStore((state) => state.user);
  const isManagerOrDirector = user?.role === 'Manager' || user?.role === 'Director' || user?.role === 'Admin';

  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
          className="p-2 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} aria-hidden="true" />
        </button>
        <div className="h-6 w-px bg-slate-200" />
        <h2 className="text-sm font-semibold text-slate-600">Quick Actions</h2>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/tasks/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors"
        >
          <Briefcase className="w-4 h-4" aria-hidden="true" />
          Create Task
        </Link>

        {isManagerOrDirector && (
          <>
            <Link
              href="/dashboard/master-calendar"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors"
            >
              <CalendarClock className="w-4 h-4" aria-hidden="true" />
              Schedule
            </Link>
            <Link
              href="/dashboard/work-packages/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-blue-200"
            >
              <PlusCircle className="w-4 h-4" aria-hidden="true" />
              New Work Package
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
