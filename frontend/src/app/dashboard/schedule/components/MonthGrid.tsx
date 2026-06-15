'use client';

import { ScheduleEntry, WpBannerItem } from '../../../../api/scheduleApi';

interface MonthGridProps {
  dates: Date[];
  users: Array<{ id: number; name: string; employeeId: string }>;
  entries: ScheduleEntry[];
  wpAssignments: WpBannerItem[];
  today: Date;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();
}

export default function MonthGrid({ dates, users, entries, wpAssignments, today }: MonthGridProps) {
  const entriesByKey = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const d = isoDate(new Date(e.date));
    const key = `${e.userId}|${d}`;
    const arr = entriesByKey.get(key) ?? [];
    arr.push(e);
    entriesByKey.set(key, arr);
  }

  // Effective first slot per cell (draft overrides published)
  function primaryEntry(userId: number, dateStr: string): ScheduleEntry | null {
    const all = entriesByKey.get(`${userId}|${dateStr}`) ?? [];
    if (all.length === 0) return null;
    // Sort: nulls (draft) first so they override
    const sorted = [...all].sort((a, b) => {
      if (a.publishedAt === null && b.publishedAt !== null) return -1;
      if (a.publishedAt !== null && b.publishedAt === null) return 1;
      return a.slotIndex - b.slotIndex;
    });
    const bySlot = new Map<number, ScheduleEntry>();
    for (const e of sorted) {
      if (!bySlot.has(e.slotIndex)) bySlot.set(e.slotIndex, e);
    }
    return bySlot.get(0) ?? [...bySlot.values()][0] ?? null;
  }

  const wpsByUser = new Map<number, WpBannerItem[]>();
  for (const wa of wpAssignments) {
    const arr = wpsByUser.get(wa.userId) ?? [];
    arr.push(wa);
    wpsByUser.set(wa.userId, arr);
  }

  const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="overflow-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 bg-white border-b border-r border-slate-200 px-3 py-1.5 text-left text-slate-500 font-semibold min-w-[140px]">
              Staff
            </th>
            {dates.map((d) => {
              const ds = isoDate(d);
              const isToday = sameDay(d, today);
              const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
              return (
                <th
                  key={ds}
                  className={`border-b border-slate-200 px-0.5 py-1 text-center font-medium w-8 ${
                    isToday ? 'bg-blue-50 text-blue-700' : isWeekend ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  <div className="text-[9px]">{DAY_NAMES[d.getUTCDay()]}</div>
                  <div className={`text-[10px] font-bold ${isToday ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center mx-auto' : ''}`}>
                    {d.getUTCDate()}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-slate-50/50">
              <td className="sticky left-0 z-10 bg-white hover:bg-slate-50/50 border-b border-r border-slate-200 px-3 py-1">
                <div className="font-medium text-slate-700 truncate max-w-[130px] text-xs">{u.name}</div>
              </td>
              {dates.map((d) => {
                const ds = isoDate(d);
                const entry = primaryEntry(u.id, ds);
                const isToday = sameDay(d, today);

                return (
                  <td
                    key={ds}
                    className={`border-b border-slate-100 text-center p-0.5 ${isToday ? 'bg-blue-50/30' : ''}`}
                    title={entry ? `${entry.shiftType.name}${entry.publishedAt === null ? ' (draft)' : ''}` : ''}
                  >
                    {entry && (
                      <span
                        className="inline-block w-6 h-5 rounded text-white text-[9px] font-bold leading-5 truncate"
                        style={{ backgroundColor: entry.shiftType.color }}
                      >
                        {entry.shiftType.code.slice(0, 3)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
