import React from 'react';
import { Package, CalendarClock, ChevronRight } from 'lucide-react';
import { DashboardWorkPackage } from '../../api/dashboardApi';
import Link from 'next/link';

interface WorkPackageWidgetProps {
  wps: DashboardWorkPackage[];
  isLoading: boolean;
}

export function WorkPackageWidget({ wps, isLoading }: WorkPackageWidgetProps) {
  return (
    <div className="bg-white/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <Package className="w-5 h-5 text-indigo-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-800">Active Work Packages</h2>
        </div>
        <Link href="/dashboard/work-packages" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 flex items-center">
          View All <ChevronRight className="w-4 h-4 ml-1" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-4 max-h-[350px]">
        {isLoading ? (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse bg-slate-50 rounded-xl p-4 border border-slate-100">
                <div className="h-5 bg-slate-200 rounded w-1/2 mb-3"></div>
                <div className="h-2 bg-slate-200 rounded-full w-full mb-2"></div>
                <div className="flex justify-between">
                  <div className="h-3 bg-slate-200 rounded w-1/4"></div>
                  <div className="h-3 bg-slate-200 rounded w-1/4"></div>
                </div>
              </div>
            ))}
          </>
        ) : wps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 py-8">
            <Package className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No active work packages</p>
          </div>
        ) : (
          wps.map(wp => (
            <Link key={wp.id} href={`/dashboard/work-packages/${wp.id}`}>
              <div className="group bg-white hover:bg-slate-50 rounded-xl p-4 border border-slate-100 hover:border-indigo-100 transition-all cursor-pointer shadow-sm hover:shadow">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">{wp.name}</h3>
                    <div className="flex items-center text-xs text-slate-500 mt-1 space-x-2">
                      <span className="bg-slate-100 px-2 py-0.5 rounded font-medium">{wp.type}</span>
                      <span className="flex items-center">
                        <CalendarClock className="w-3 h-3 mr-1" />
                        Due {new Date(wp.timeframeTo).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg">
                    {wp.progress}%
                  </span>
                </div>
                
                <div className="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
                  <div 
                    className={`h-2 rounded-full transition-all duration-1000 ${
                      wp.progress === 100 ? 'bg-emerald-500' : 
                      wp.progress > 75 ? 'bg-indigo-500' : 
                      wp.progress > 25 ? 'bg-blue-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${Math.max(wp.progress, 2)}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-xs text-slate-500 font-medium">
                  <span>{wp.completedTasks} / {wp.totalTasks} Tasks Completed</span>
                  <span className={wp.status === 'Overdue' ? 'text-red-500 font-bold' : ''}>{wp.status}</span>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
