'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { WpBlueprint } from '../../../types';
import { getWpBlueprints } from '../../../api/wpBlueprintApi';
import toast from 'react-hot-toast';
import { CalendarClock, Building2, ClipboardList, CalendarDays, History } from 'lucide-react';

const MANAGER_ROLES = ['Manager', 'Director', 'Admin'];

// Master Calendar — a schedule list of every recurring blueprint, ordered by its
// next auto-launch date. LAST_DONE blueprints with no scheduled run (awaiting the
// current instance to close) sort last with an "Awaiting completion" badge.
export default function MasterCalendarPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [blueprints, setBlueprints] = useState<WpBlueprint[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getWpBlueprints({ activeOnly: true });
      const recurring = all.filter((b) => b.recurrenceType != null);
      recurring.sort((a, b) => {
        // nulls (awaiting completion) last; otherwise ascending by nextRunAt.
        if (a.nextRunAt == null && b.nextRunAt == null) return 0;
        if (a.nextRunAt == null) return 1;
        if (b.nextRunAt == null) return -1;
        return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
      });
      setBlueprints(recurring);
    } catch {
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && !MANAGER_ROLES.includes(user.role)) router.replace('/dashboard');
  }, [user, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (!user || !MANAGER_ROLES.includes(user.role)) return null;

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
          <CalendarClock className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Master Calendar</h1>
          <p className="text-slate-500 mt-0.5 text-sm">Upcoming auto-launches from recurring Work Package blueprints</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-violet-500" />
        </div>
      ) : blueprints.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
          <CalendarClock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No recurring blueprints scheduled.</p>
          <button onClick={() => router.push('/dashboard/wp-blueprints')} className="mt-3 text-sm font-medium text-violet-600 hover:underline">
            Manage blueprints
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
          {blueprints.map((b) => {
            const isCalendar = b.recurrenceType === 'CALENDAR';
            return (
              <button key={b.id} onClick={() => router.push('/dashboard/wp-blueprints')}
                className="w-full text-left flex items-center justify-between gap-4 p-4 hover:bg-slate-50 transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 truncate">{b.name}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{b.type}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${isCalendar ? 'bg-violet-50 text-violet-600' : 'bg-amber-50 text-amber-600'}`}>
                      {isCalendar ? <CalendarDays className="w-3 h-3" /> : <History className="w-3 h-3" />}
                      {isCalendar ? 'Calendar' : 'Last-done'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                    <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{b.division?.name ?? `Division ${b.divisionId}`}</span>
                    <span>every {b.recurrenceInterval} day(s)</span>
                    <span className="inline-flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />{b._count?.instances ?? 0} launched</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {b.nextRunAt ? (
                    <>
                      <div className="text-xs text-slate-400">Next launch</div>
                      <div className="text-sm font-semibold text-slate-800">{fmtDate(b.nextRunAt)}</div>
                    </>
                  ) : (
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-500">Awaiting completion</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
