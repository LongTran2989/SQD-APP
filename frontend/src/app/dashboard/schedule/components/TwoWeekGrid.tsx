'use client';

import { useRef, useState, useCallback } from 'react';
import { ScheduleEntry, ScheduleTask, WpBannerItem, ShiftType } from '../../../../api/scheduleApi';
import { AlertTriangle, ListTodo } from 'lucide-react';

interface TwoWeekGridProps {
  dates: Date[];
  users: Array<{ id: number; name: string; employeeId: string }>;
  entries: ScheduleEntry[];
  tasks: ScheduleTask[];
  wpAssignments: WpBannerItem[];
  shiftTypes: ShiftType[];
  canEdit: boolean;
  paintShiftId: number | null;
  onCellPaint: (userId: number, date: string) => void;
  onCellClick: (userId: number, date: string, entries: ScheduleEntry[]) => void;
  today: Date;
}

const WP_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#06B6D4', '#F97316', '#EF4444', '#84CC16', '#6366F1',
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();
}

export default function TwoWeekGrid({
  dates,
  users,
  entries,
  tasks,
  wpAssignments,
  shiftTypes: _shiftTypes,
  canEdit,
  paintShiftId,
  onCellPaint,
  onCellClick,
  today,
}: TwoWeekGridProps) {
  const isDragging = useRef(false);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  // Build lookup maps
  const entriesByKey = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const d = isoDate(new Date(e.date));
    const key = `${e.userId}|${d}`;
    const arr = entriesByKey.get(key) ?? [];
    arr.push(e);
    entriesByKey.set(key, arr);
  }

  // For each slot, draft overrides published
  function effectiveEntries(userId: number, dateStr: string): ScheduleEntry[] {
    const all = entriesByKey.get(`${userId}|${dateStr}`) ?? [];
    const bySlot = new Map<number, ScheduleEntry>();
    for (const e of [...all].sort((a, b) => {
      // nulls (draft) last in sort means they override
      if (a.publishedAt === null && b.publishedAt !== null) return 1;
      if (a.publishedAt !== null && b.publishedAt === null) return -1;
      return 0;
    })) {
      bySlot.set(e.slotIndex, e);
    }
    return [...bySlot.values()].sort((a, b) => a.slotIndex - b.slotIndex);
  }

  // Task conflicts: task deadline on a non-work day
  const conflictDays = new Set<string>();
  for (const t of tasks) {
    if (!t.deadline || !t.assignedToUserId) continue;
    const deadlineDateStr = isoDate(new Date(t.deadline));
    const key = `${t.assignedToUserId}|${deadlineDateStr}`;
    const eff = entriesByKey.get(key) ?? [];
    // Check if first slot is non-work day
    const sorted = [...eff].sort((a, b) => a.slotIndex - b.slotIndex);
    if (sorted.length > 0 && sorted[0] && !sorted[0].shiftType.isWorkDay) {
      conflictDays.add(key);
    }
  }

  // Tasks per (userId, date)
  const tasksByKey = new Map<string, ScheduleTask[]>();
  for (const t of tasks) {
    if (!t.assignedToUserId) continue;
    const start = t.startDate ? new Date(t.startDate) : t.assignedAt ? new Date(t.assignedAt) : null;
    const end = t.deadline ? new Date(t.deadline) : null;
    for (const d of dates) {
      const ds = isoDate(d);
      const inRange = start && end
        ? d >= new Date(isoDate(start)) && d <= new Date(isoDate(end))
        : end
        ? sameDay(d, end)
        : false;
      if (inRange) {
        const key = `${t.assignedToUserId}|${ds}`;
        const arr = tasksByKey.get(key) ?? [];
        arr.push(t);
        tasksByKey.set(key, arr);
      }
    }
  }

  // WP assignments per user
  const wpByUser = new Map<number, WpBannerItem[]>();
  for (const wa of wpAssignments) {
    const arr = wpByUser.get(wa.userId) ?? [];
    arr.push(wa);
    wpByUser.set(wa.userId, arr);
  }
  // Stable color per wp id
  const wpColorMap = new Map<number, string>();
  let colorIdx = 0;
  for (const wa of wpAssignments) {
    if (!wpColorMap.has(wa.wp.id)) {
      wpColorMap.set(wa.wp.id, WP_COLORS[colorIdx % WP_COLORS.length]!);
      colorIdx++;
    }
  }

  const handleMouseDown = useCallback((userId: number, dateStr: string) => {
    if (!canEdit || !paintShiftId) return;
    isDragging.current = true;
    onCellPaint(userId, dateStr);
  }, [canEdit, paintShiftId, onCellPaint]);

  const handleMouseEnter = useCallback((userId: number, dateStr: string) => {
    if (!isDragging.current || !paintShiftId) return;
    onCellPaint(userId, dateStr);
  }, [paintShiftId, onCellPaint]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleClick = useCallback((userId: number, dateStr: string, eff: ScheduleEntry[]) => {
    if (paintShiftId) return; // paint mode handles via mousedown
    onCellClick(userId, dateStr, eff);
  }, [paintShiftId, onCellClick]);

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div
      className="overflow-auto"
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { isDragging.current = false; }}
      style={{ userSelect: 'none' }}
    >
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr>
            {/* User column */}
            <th className="sticky left-0 z-20 bg-white border-b border-r border-slate-200 px-3 py-2 text-left text-slate-500 font-semibold min-w-[160px]">
              Staff
            </th>
            {dates.map((d) => {
              const ds = isoDate(d);
              const isToday = sameDay(d, today);
              const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
              return (
                <th
                  key={ds}
                  className={`border-b border-slate-200 px-1 py-1 text-center font-medium min-w-[72px] ${
                    isToday ? 'bg-blue-50 text-blue-700' : isWeekend ? 'bg-slate-50 text-slate-400' : 'text-slate-600'
                  }`}
                >
                  <div className="text-[10px] text-slate-400">{DAY_NAMES[d.getUTCDay()]}</div>
                  <div className={`text-xs font-semibold ${isToday ? 'text-blue-600' : ''}`}>
                    {d.getUTCDate()} {d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const userWps = wpByUser.get(u.id) ?? [];
            return (
              <tr key={u.id} className="group hover:bg-slate-50/50">
                {/* User name cell */}
                <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50/50 border-b border-r border-slate-200 px-3 py-1.5">
                  <div className="font-medium text-slate-800 truncate max-w-[140px]">{u.name}</div>
                  <div className="text-[10px] text-slate-400">{u.employeeId}</div>
                </td>
                {dates.map((d) => {
                  const ds = isoDate(d);
                  const eff = effectiveEntries(u.id, ds);
                  const cellKey = `${u.id}|${ds}`;
                  const hasConflict = conflictDays.has(cellKey);
                  const cellTasks = tasksByKey.get(cellKey) ?? [];
                  const isToday = sameDay(d, today);
                  const isHovered = hoveredCell === cellKey;

                  // Active WPs on this date
                  const activeWps = userWps.filter((wa) => {
                    if (!wa.wp.timeframeFrom || !wa.wp.timeframeTo) return false;
                    const from = new Date(wa.wp.timeframeFrom);
                    const to = new Date(wa.wp.timeframeTo);
                    return d >= from && d <= to;
                  });

                  return (
                    <td
                      key={ds}
                      className={`border-b border-slate-200 px-0.5 py-0.5 align-top cursor-pointer transition-colors ${
                        isToday ? 'bg-blue-50/40' : ''
                      } ${isHovered && canEdit && paintShiftId ? 'ring-1 ring-inset ring-blue-400' : ''}`}
                      onMouseDown={() => handleMouseDown(u.id, ds)}
                      onMouseEnter={() => {
                        setHoveredCell(cellKey);
                        handleMouseEnter(u.id, ds);
                      }}
                      onMouseLeave={() => setHoveredCell(null)}
                      onClick={() => handleClick(u.id, ds, eff)}
                    >
                      <div className="min-h-[52px] space-y-0.5 p-0.5">
                        {/* Shift badges */}
                        {eff.map((e) => (
                          <div
                            key={e.id}
                            className="flex items-center gap-0.5"
                          >
                            <span
                              className="px-1 py-0.5 rounded text-white text-[10px] font-bold leading-none"
                              style={{ backgroundColor: e.shiftType.color }}
                              title={`${e.shiftType.name}${e.publishedAt === null ? ' (draft)' : ''}`}
                            >
                              {e.shiftType.code}
                            </span>
                            {e.publishedAt === null && (
                              <span className="w-1 h-1 rounded-full bg-amber-400" title="Draft" />
                            )}
                          </div>
                        ))}

                        {/* WP banners */}
                        {activeWps.map((wa) => (
                          <div
                            key={wa.wpId}
                            className="px-1 py-0.5 rounded text-[9px] font-semibold text-white leading-none truncate"
                            style={{ backgroundColor: wpColorMap.get(wa.wp.id) ?? '#6B7280' }}
                            title={`${wa.wp.wpId} — ${wa.wp.name}`}
                          >
                            {wa.wp.wpId}
                          </div>
                        ))}

                        {/* Task indicator */}
                        {cellTasks.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            <ListTodo className="w-3 h-3 text-slate-400" />
                            <span className="text-[10px] text-slate-500">{cellTasks.length}</span>
                            {hasConflict && (
                              <AlertTriangle className="w-3 h-3 text-amber-500" title="Task due on non-work day" />
                            )}
                          </div>
                        )}
                        {!cellTasks.length && hasConflict && (
                          <AlertTriangle className="w-3 h-3 text-amber-500" title="Task due on non-work day" />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
