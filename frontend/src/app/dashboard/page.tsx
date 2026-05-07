'use client';

import { useAuthStore } from '../../store/authStore';
import { PlaneTakeoff, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

export default function DashboardHome() {
  const user = useAuthStore((state) => state.user);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Welcome back, {user?.name}!</h1>
          <p className="text-slate-500">Here's what is happening in your maintenance division today.</p>
        </div>
        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center border border-blue-100">
          <PlaneTakeoff className="text-blue-600 w-8 h-8" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-700">Completed</h2>
          </div>
          <span className="text-4xl font-bold text-slate-800">24</span>
          <span className="text-sm text-slate-500 mt-2">Tasks this week</span>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-amber-50 rounded-lg">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-700">Pending</h2>
          </div>
          <span className="text-4xl font-bold text-slate-800">12</span>
          <span className="text-sm text-slate-500 mt-2">Require your attention</span>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-red-50 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-700">Findings</h2>
          </div>
          <span className="text-4xl font-bold text-slate-800">3</span>
          <span className="text-sm text-slate-500 mt-2">Critical issues logged</span>
        </div>
      </div>
    </div>
  );
}
