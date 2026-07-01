import React from 'react';
import { ClipboardList, CalendarClock, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { DashboardTask } from '../../api/dashboardApi';
import TaskStatusBadge from '../tasks/TaskStatusBadge';

interface MyTasksWidgetProps {
  tasks: DashboardTask[];
  isLoading: boolean;
}

export function MyTasksWidget({ tasks, isLoading }: MyTasksWidgetProps) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-signal-blue-surface rounded-lg">
            <ClipboardList className="w-5 h-5 text-signal-blue" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-slate-800">My Active Tasks</h2>
        </div>
        <Link href="/dashboard/tasks" className="text-sm font-semibold text-signal-blue hover:text-signal-blue-hover flex items-center gap-1">
          View All <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-3 max-h-[350px]">
        {isLoading ? (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse bg-slate-50 rounded-xl p-4 border border-slate-100">
                <div className="h-5 bg-slate-200 rounded w-1/2 mb-3"></div>
                <div className="flex justify-between">
                  <div className="h-3 bg-slate-200 rounded w-1/4"></div>
                  <div className="h-3 bg-slate-200 rounded w-1/4"></div>
                </div>
              </div>
            ))}
          </>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 py-8">
            <ClipboardList className="w-8 h-8 mb-2 opacity-50" aria-hidden="true" />
            <p className="text-sm">No active tasks assigned to you</p>
          </div>
        ) : (
          tasks.map(task => (
            <Link key={task.id} href={`/dashboard/tasks/${task.id}`}>
              <div className="group bg-white hover:bg-slate-50 rounded-xl p-4 border border-slate-200 hover:border-slate-300 transition-colors">
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-800 group-hover:text-signal-blue transition-colors truncate">{task.title}</h3>
                    <div className="flex items-center text-xs text-slate-500 mt-1 space-x-2">
                      <span className="bg-slate-100 px-2 py-0.5 rounded font-medium">{task.itemType}</span>
                      {task.wpId && (
                        <span className="bg-slate-100 px-2 py-0.5 rounded font-medium">{task.wpId}</span>
                      )}
                    </div>
                  </div>
                  <TaskStatusBadge status={task.status} size="sm" />
                </div>
                {task.deadline && (
                  <div className="flex items-center text-xs text-slate-500">
                    <CalendarClock className="w-3 h-3 mr-1" aria-hidden="true" />
                    Due {new Date(task.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
