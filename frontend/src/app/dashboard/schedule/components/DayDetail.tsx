'use client';

import { ScheduleEntry, ScheduleTask, WpBannerItem } from '../../../../api/scheduleApi';
import { Clock, FolderOpen, AlertTriangle } from 'lucide-react';

interface DayDetailProps {
  date: Date;
  users: Array<{ id: number; name: string; employeeId: string }>;
  entries: ScheduleEntry[];
  tasks: ScheduleTask[];
  wpAssignments: WpBannerItem[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function DayDetail({ date, users, entries, tasks, wpAssignments }: DayDetailProps) {
  const ds = isoDate(date);

  const entriesByUser = new Map<number, ScheduleEntry[]>();
  for (const e of entries) {
    if (isoDate(new Date(e.date)) !== ds) continue;
    const arr = entriesByUser.get(e.userId) ?? [];
    arr.push(e);
    entriesByUser.set(e.userId, arr);
  }

  const tasksByUser = new Map<number, ScheduleTask[]>();
  for (const t of tasks) {
    if (!t.assignedToUserId) continue;
    const start = t.startDate ? new Date(t.startDate) : t.assignedAt ? new Date(t.assignedAt) : null;
    const end = t.deadline ? new Date(t.deadline) : null;
    const inRange = start && end
      ? date >= new Date(isoDate(start)) && date <= new Date(isoDate(end))
      : end
      ? isoDate(end) === ds
      : false;
    if (inRange) {
      const arr = tasksByUser.get(t.assignedToUserId) ?? [];
      arr.push(t);
      tasksByUser.set(t.assignedToUserId, arr);
    }
  }

  const wpsByUser = new Map<number, WpBannerItem[]>();
  for (const wa of wpAssignments) {
    if (!wa.wp.timeframeFrom || !wa.wp.timeframeTo) continue;
    const from = new Date(wa.wp.timeframeFrom);
    const to = new Date(wa.wp.timeframeTo);
    if (date >= from && date <= to) {
      const arr = wpsByUser.get(wa.userId) ?? [];
      arr.push(wa);
      wpsByUser.set(wa.userId, arr);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-slate-700">{formatDate(date)}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {users.map((u) => {
          const userEntries = (entriesByUser.get(u.id) ?? []).sort((a, b) => a.slotIndex - b.slotIndex);
          const userTasks = tasksByUser.get(u.id) ?? [];
          const userWps = wpsByUser.get(u.id) ?? [];

          // Find conflicts
          const hasOffShift = userEntries.length > 0 && userEntries[0] && !userEntries[0].shiftType.isWorkDay;
          const hasTaskConflict = hasOffShift && userTasks.some(t => t.deadline && isoDate(new Date(t.deadline)) === ds);

          return (
            <div key={u.id} className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{u.name}</div>
                  <div className="text-xs text-slate-400">{u.employeeId}</div>
                </div>
                {hasTaskConflict && (
                  <AlertTriangle className="w-4 h-4 text-amber-500" title="Task due on non-work day" />
                )}
              </div>

              {/* Shifts */}
              {userEntries.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {userEntries.map((e) => (
                    <span
                      key={e.id}
                      className="px-2 py-0.5 rounded-full text-white text-xs font-bold"
                      style={{ backgroundColor: e.shiftType.color }}
                      title={e.shiftType.name}
                    >
                      {e.shiftType.code}
                      {e.publishedAt === null && ' •'}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 italic">No schedule</div>
              )}

              {/* WPs */}
              {userWps.length > 0 && (
                <div className="space-y-1">
                  {userWps.map((wa) => (
                    <div key={wa.wpId} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <FolderOpen className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="font-medium">{wa.wp.wpId}</span>
                      <span className="truncate text-slate-400">{wa.wp.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tasks */}
              {userTasks.length > 0 && (
                <div className="space-y-1 border-t border-slate-100 pt-2">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Tasks</p>
                  {userTasks.map((t) => (
                    <div key={t.id} className="flex items-start gap-1.5 text-xs">
                      <Clock className="w-3 h-3 text-slate-300 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate text-slate-700 font-medium">{t.title}</div>
                        <div className="text-slate-400">{t.status}{t.deadline ? ` · due ${new Date(t.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
