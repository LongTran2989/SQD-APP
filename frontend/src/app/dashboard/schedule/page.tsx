'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../../store/authStore';
import {
  getSchedule,
  upsertEntries,
  acquireLock,
  releaseLock,
  takeoverLock,
  publishSchedule,
  copyWeek as copyWeekApi,
  listPatterns,
  applyPattern,
  ScheduleData,
  ScheduleEntry,
  SchedulePattern,
} from '../../../api/scheduleApi';
import { listShiftTypes } from '../../../api/taxonomyApi';
import { ShiftType } from '../../../api/scheduleApi';
import { getDivisions } from '../../../api/taskApi';
import toast from 'react-hot-toast';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Paintbrush,
  Send,
  Copy,
  Layers,
  Lock,
  Unlock,
  RefreshCw,
  CalendarDays,
} from 'lucide-react';
import TwoWeekGrid from './components/TwoWeekGrid';
import MonthGrid from './components/MonthGrid';
import DayDetail from './components/DayDetail';
import PaintModePanel from './components/PaintModePanel';
import PublishModal from './components/PublishModal';

type ViewMode = '2week' | 'month' | 'day';

// Generate array of UTC dates from start (inclusive) for n days
function generateDates(start: Date, n: number): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d);
  }
  return dates;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUTCDay(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function startOfUTCMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// For 2-week view: center today at position 4 (0-indexed) so today is day 5 of 14
function get2WeekStart(today: Date): Date {
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 4);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

const LOCK_HEARTBEAT_MS = 90 * 1000; // renew 30s before TTL

export default function SchedulePage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'Manager' || user?.role === 'Director' || user?.role === 'Admin';

  const today = startOfUTCDay(new Date());

  const [viewMode, setViewMode] = useState<ViewMode>('2week');
  const [anchor, setAnchor] = useState<Date>(() => get2WeekStart(today));
  const [selectedDay, setSelectedDay] = useState<Date>(today);
  const [divisionId, setDivisionId] = useState<number | null>(user?.divisionId ?? null);
  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);

  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [patterns, setPatterns] = useState<SchedulePattern[]>([]);
  const [users, setUsers] = useState<Array<{ id: number; name: string; employeeId: string }>>([]);
  const [loading, setLoading] = useState(false);

  const [paintMode, setPaintMode] = useState(false);
  const [paintShiftId, setPaintShiftId] = useState<number | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showPatternPanel, setShowPatternPanel] = useState(false);
  const [selectedPatternId, setSelectedPatternId] = useState<number | null>(null);
  const [patternRange, setPatternRange] = useState({ from: '', to: '' });

  const lockHeartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lockState, setLockState] = useState<ScheduleData['lock']>(null);

  // Compute visible dates based on view mode
  const dates = (() => {
    if (viewMode === '2week') return generateDates(anchor, 14);
    if (viewMode === 'month') return generateDates(startOfUTCMonth(anchor), new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate());
    return [selectedDay];
  })();

  const dateFrom = isoDate(dates[0]!);
  const dateTo = isoDate(dates[dates.length - 1]!);

  // Load static data
  useEffect(() => {
    Promise.all([
      listShiftTypes(),
      getDivisions(),
    ]).then(([sts, divs]) => {
      setShiftTypes(sts.filter((s) => s.isActive));
      setDivisions(divs);
    }).catch(() => toast.error('Failed to load reference data'));
  }, []);

  // Load patterns when edit permission
  useEffect(() => {
    if (!canEdit) return;
    listPatterns().then(setPatterns).catch(() => {});
  }, [canEdit]);

  // Fetch schedule data
  const fetchSchedule = useCallback(async () => {
    if (!divisionId) return;
    setLoading(true);
    try {
      const data = await getSchedule(divisionId, dateFrom, dateTo);
      setScheduleData(data);
      setLockState(data.lock);

      // Extract unique users from entries + tasks
      const userMap = new Map<number, { id: number; name: string; employeeId: string }>();
      for (const e of data.entries) {
        if (!userMap.has(e.userId)) {
          userMap.set(e.userId, { id: e.userId, name: `User #${e.userId}`, employeeId: '' });
        }
      }
      for (const t of data.tasks) {
        if (t.assignedToUserId && !userMap.has(t.assignedToUserId)) {
          userMap.set(t.assignedToUserId, { id: t.assignedToUserId, name: `User #${t.assignedToUserId}`, employeeId: '' });
        }
      }
      // We need user names — fetch from division user list via the task API getUsers
      // For now we'll enrich from entries if shiftType.user is available
      setUsers([...userMap.values()]);
    } catch {
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [divisionId, dateFrom, dateTo]);

  // Also fetch division users to get names
  useEffect(() => {
    if (!divisionId) return;
    import('../../../api/taskApi').then(({ getUsers }) => {
      getUsers().then((allUsers) => {
        const divUsers = allUsers
          .filter((u) => {
            // getUsers returns { value, label, divisionId }
            return u.divisionId === divisionId;
          })
          .map((u) => ({
            id: Number(u.value),
            name: u.label.split(' — ')[0] ?? u.label,
            employeeId: u.label.split(' — ')[1] ?? '',
          }));
        if (divUsers.length > 0) setUsers(divUsers);
      }).catch(() => {});
    });
  }, [divisionId]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // Lock heartbeat: renew lock every 90s while paint mode active
  useEffect(() => {
    if (!canEdit || !paintMode || !divisionId) {
      if (lockHeartbeat.current) clearInterval(lockHeartbeat.current);
      return;
    }
    const renew = () => {
      acquireLock(divisionId).catch(() => {});
    };
    renew();
    lockHeartbeat.current = setInterval(renew, LOCK_HEARTBEAT_MS);
    return () => {
      if (lockHeartbeat.current) clearInterval(lockHeartbeat.current);
    };
  }, [canEdit, paintMode, divisionId]);

  // Release lock on unmount
  useEffect(() => {
    return () => {
      if (divisionId && lockState?.heldByMe) {
        releaseLock(divisionId).catch(() => {});
      }
    };
  }, [divisionId, lockState?.heldByMe]);

  const handleEnterPaintMode = async () => {
    if (!divisionId) return;
    // Check lock
    if (lockState?.locked && !lockState.heldByMe && !lockState.isExpired) {
      toast.error('Schedule is locked by another manager');
      return;
    }
    try {
      if (lockState?.locked && !lockState.heldByMe && lockState.isExpired) {
        await takeoverLock(divisionId);
        toast.success('Took over expired lock');
      } else if (!lockState?.heldByMe) {
        await acquireLock(divisionId);
      }
      setPaintMode(true);
      setPaintShiftId(shiftTypes[0]?.id ?? null);
    } catch {
      toast.error('Could not acquire schedule lock');
    }
  };

  const handleExitPaintMode = async () => {
    setPaintMode(false);
    setPaintShiftId(null);
    if (divisionId) {
      await releaseLock(divisionId).catch(() => {});
      setLockState(null);
    }
  };

  const handleCellPaint = useCallback(async (userId: number, dateStr: string) => {
    if (!divisionId || !paintShiftId) return;
    try {
      await upsertEntries(divisionId, [{ userId, date: dateStr, slotIndex: 0, shiftTypeId: paintShiftId }]);
      fetchSchedule();
    } catch {
      toast.error('Failed to update entry');
    }
  }, [divisionId, paintShiftId, fetchSchedule]);

  const handleCellClick = useCallback((_userId: number, dateStr: string, _entries: ScheduleEntry[]) => {
    if (viewMode === '2week') {
      setSelectedDay(new Date(dateStr + 'T00:00:00Z'));
      setViewMode('day');
    }
  }, [viewMode]);

  const handlePublish = async (note: string) => {
    if (!divisionId) return;
    try {
      const result = await publishSchedule(divisionId, note);
      toast.success(`Published ${result.published} entries${result.conflicts ? ` (${result.conflicts} conflict${result.conflicts !== 1 ? 's' : ''})` : ''}`);
      setShowPublishModal(false);
      fetchSchedule();
    } catch {
      toast.error('Failed to publish schedule');
    }
  };

  const handleCopyWeek = async () => {
    if (!divisionId || dates.length < 7) return;
    const sourceFrom = isoDate(dates[0]!);
    const sourceTo = isoDate(dates[6]!);
    try {
      const result = await copyWeekApi(divisionId, sourceFrom, sourceTo);
      toast.success(`Copied ${result.copied} entries to next week`);
      fetchSchedule();
    } catch {
      toast.error('Failed to copy week');
    }
  };

  const handleApplyPattern = async () => {
    if (!divisionId || !selectedPatternId || !patternRange.from || !patternRange.to) return;
    const userIds = users.map((u) => u.id);
    try {
      const result = await applyPattern(divisionId, selectedPatternId, {
        userIds,
        dateFrom: patternRange.from,
        dateTo: patternRange.to,
      });
      toast.success(`Applied pattern to ${result.applied} slots`);
      setShowPatternPanel(false);
      fetchSchedule();
    } catch {
      toast.error('Failed to apply pattern');
    }
  };

  // Navigation
  const navPrev = () => {
    if (viewMode === '2week') {
      setAnchor((a) => { const n = new Date(a); n.setUTCDate(n.getUTCDate() - 7); return n; });
    } else if (viewMode === 'month') {
      setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1)));
    } else {
      setSelectedDay((d) => { const n = new Date(d); n.setUTCDate(n.getUTCDate() - 1); return n; });
    }
  };

  const navNext = () => {
    if (viewMode === '2week') {
      setAnchor((a) => { const n = new Date(a); n.setUTCDate(n.getUTCDate() + 7); return n; });
    } else if (viewMode === 'month') {
      setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1)));
    } else {
      setSelectedDay((d) => { const n = new Date(d); n.setUTCDate(n.getUTCDate() + 1); return n; });
    }
  };

  const navToday = () => {
    setAnchor(get2WeekStart(today));
    setSelectedDay(today);
  };

  const draftCount = scheduleData?.entries.filter((e) => e.publishedAt === null).length ?? 0;

  const periodLabel = (() => {
    if (viewMode === '2week') {
      return `${new Date(dateFrom + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} – ${new Date(dateTo + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
    }
    if (viewMode === 'month') {
      return anchor.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    return selectedDay.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  })();

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-slate-800">Staff Schedule</h1>
        </div>

        {/* Division selector (Directors/Admins see all) */}
        {(user?.role === 'Director' || user?.role === 'Admin') && (
          <select
            value={divisionId ?? ''}
            onChange={(e) => setDivisionId(e.target.value ? Number(e.target.value) : null)}
            className="text-sm border border-slate-200 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select division</option>
            {divisions.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        )}

        {/* View toggle */}
        <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white text-sm">
          {(['2week', 'month', 'day'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => {
                setViewMode(v);
                if (v === 'month') setAnchor(startOfUTCMonth(today));
                if (v === '2week') setAnchor(get2WeekStart(today));
              }}
              className={`px-3 py-1.5 font-medium transition-colors ${
                viewMode === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {v === '2week' ? '2 Weeks' : v === 'month' ? 'Month' : 'Day'}
            </button>
          ))}
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-1">
          <button onClick={navPrev} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-slate-700 min-w-[180px] text-center">{periodLabel}</span>
          <button onClick={navNext} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={navToday} className="ml-1 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
            Today
          </button>
        </div>

        <div className="flex-1" />

        {/* Actions (edit role only) */}
        {canEdit && (
          <div className="flex items-center gap-2">
            {/* Lock status */}
            {lockState?.locked && !lockState.heldByMe && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                <Lock className="w-3.5 h-3.5" />
                Locked by another manager
              </span>
            )}
            {lockState?.heldByMe && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                <Unlock className="w-3.5 h-3.5" />
                You have the lock
              </span>
            )}

            {paintMode ? (
              <button
                onClick={handleExitPaintMode}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-200 transition-colors"
              >
                <Paintbrush className="w-4 h-4" />
                Exit Paint
              </button>
            ) : (
              <button
                onClick={handleEnterPaintMode}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors"
              >
                <Paintbrush className="w-4 h-4" />
                Paint
              </button>
            )}

            {viewMode === '2week' && (
              <button
                onClick={handleCopyWeek}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy Week
              </button>
            )}

            <button
              onClick={() => setShowPatternPanel(!showPatternPanel)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors"
            >
              <Layers className="w-4 h-4" />
              Patterns
            </button>

            {draftCount > 0 && (
              <button
                onClick={() => setShowPublishModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-sm transition-all"
              >
                <Send className="w-4 h-4" />
                Publish ({draftCount})
              </button>
            )}

            <button onClick={fetchSchedule} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Pattern panel */}
      {showPatternPanel && canEdit && patterns.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Pattern</label>
            <select
              value={selectedPatternId ?? ''}
              onChange={(e) => setSelectedPatternId(e.target.value ? Number(e.target.value) : null)}
              className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select pattern…</option>
              {patterns.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">From</label>
            <input type="date" value={patternRange.from} onChange={(e) => setPatternRange((r) => ({ ...r, from: e.target.value }))}
              className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">To</label>
            <input type="date" value={patternRange.to} onChange={(e) => setPatternRange((r) => ({ ...r, to: e.target.value }))}
              className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button
            onClick={handleApplyPattern}
            disabled={!selectedPatternId || !patternRange.from || !patternRange.to}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Apply to All Staff
          </button>
          <button onClick={() => setShowPatternPanel(false)} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
        </div>
      )}

      {/* No division selected */}
      {!divisionId && (
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <div className="text-center space-y-2">
            <CalendarDays className="w-12 h-12 mx-auto text-slate-300" />
            <p className="font-medium">Select a division to view the schedule</p>
          </div>
        </div>
      )}

      {/* Main content */}
      {divisionId && (
        <div className="flex gap-4 flex-1 overflow-hidden min-h-0">
          {/* Paint palette sidebar */}
          {paintMode && (
            <PaintModePanel
              shiftTypes={shiftTypes}
              selectedShiftId={paintShiftId}
              onSelect={setPaintShiftId}
              onExit={handleExitPaintMode}
            />
          )}

          {/* Grid */}
          <div className="flex-1 bg-white rounded-2xl border border-slate-200 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
              </div>
            ) : !scheduleData ? null : viewMode === '2week' ? (
              <TwoWeekGrid
                dates={dates}
                users={users}
                entries={scheduleData.entries}
                tasks={scheduleData.tasks}
                wpAssignments={scheduleData.wpAssignments}
                shiftTypes={shiftTypes}
                canEdit={canEdit}
                paintShiftId={paintMode ? paintShiftId : null}
                onCellPaint={handleCellPaint}
                onCellClick={handleCellClick}
                today={today}
              />
            ) : viewMode === 'month' ? (
              <MonthGrid
                dates={dates}
                users={users}
                entries={scheduleData.entries}
                wpAssignments={scheduleData.wpAssignments}
                today={today}
              />
            ) : (
              <div className="p-4">
                <DayDetail
                  date={selectedDay}
                  users={users}
                  entries={scheduleData.entries}
                  tasks={scheduleData.tasks}
                  wpAssignments={scheduleData.wpAssignments}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showPublishModal && (
        <PublishModal
          draftCount={draftCount}
          onConfirm={handlePublish}
          onClose={() => setShowPublishModal(false)}
        />
      )}
    </div>
  );
}
