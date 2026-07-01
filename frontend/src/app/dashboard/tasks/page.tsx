'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../store/authStore';
import { TaskEnriched, TaskStatus, DeadlineStatus } from '../../../types';
import { getTaskList, getTaskStats, getTaskAssignees, TaskAssignee, TaskTab, selfAssignTask } from '../../../api/taskApi';
import { updateMyPreferences } from '../../../api/userApi';
import { formatRelativeTime } from '../../../utils/feedHelpers';
import TaskStatusBadge, { STATUS_CONFIG } from '../../../components/tasks/TaskStatusBadge';
import toast from 'react-hot-toast';
import {
  Plus,
  Search,
  ClipboardList,
  AlertTriangle,
  UserCheck,
  Columns3,
  ChevronDown,
  ArrowUpDown,
  ChevronUp,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

type ActiveTab = 'unassigned' | 'my-tasks' | 'all';

const TASK_CREATOR_ROLES = ['Manager', 'Director', 'Admin'];

const ALL_STATUSES: TaskStatus[] = [
  'Unassigned', 'Assigned', 'In Progress', 'In Review',
  'Follow-up Required', 'Closed', 'Rejected', 'Terminated', 'Inactive',
];

const FILTERS_STORAGE_KEY = 'sqd:taskListFilters';

// Toggleable list columns (Title and Actions are always shown — Title is the
// row's only navigation entry point now that the separate View icon is gone).
const TASK_COLUMNS: { key: string; label: string }[] = [
  { key: 'taskId', label: 'Task ID' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'issuer', label: 'Issuer' },
  { key: 'deadline', label: 'Deadline' },
  { key: 'division', label: 'Division' },
  { key: 'lastActivity', label: 'Last Activity' },
];
// Default-hidden columns (per plan); everything else visible by default.
const DEFAULT_HIDDEN_COLUMNS = ['taskId', 'division'];
const DEFAULT_VISIBLE_COLUMNS = TASK_COLUMNS.map((c) => c.key).filter((k) => !DEFAULT_HIDDEN_COLUMNS.includes(k));

type SortColumn = 'taskId' | 'title' | 'status' | 'deadline' | 'lastActivity';
type DueFilter = 'today' | 'week' | null;

// Tiered deadline badge styling, on the same two-tier severity vocabulary as
// TaskStatusBadge: Caution (Amber) for approaching, Finding (Red) for overdue.
const DEADLINE_BADGE: Record<Exclude<DeadlineStatus, null>, { label: string; className: string }> = {
  'Due Soon':  { label: 'DUE SOON',  className: 'bg-amber-caution-surface text-amber-caution border-amber-caution/20' },
  'Due Today': { label: 'DUE TODAY', className: 'bg-amber-caution-surface text-amber-caution border-amber-caution/20' },
  'Overdue':   { label: 'OVERDUE',   className: 'bg-red-finding-surface text-red-finding border-red-finding/20' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDeadline(deadline: string | null): string {
  if (!deadline) return '—';
  return new Date(deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// ─── Component ────────────────────────────────────────────────────────────────

function TaskListPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, setPreferences } = useAuthStore();

  // ── Column visibility (persisted to User.preferences) ──
  const [visibleCols, setVisibleCols] = useState<string[]>(
    user?.preferences?.taskColumns ?? DEFAULT_VISIBLE_COLUMNS
  );
  const [showColMenu, setShowColMenu] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const isColVisible = (key: string) => visibleCols.includes(key);

  // Close either dropdown when the user clicks outside of it.
  const colMenuRef = useRef<HTMLDivElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const colButtonRef = useRef<HTMLButtonElement>(null);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!showColMenu && !showStatusMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (colMenuRef.current && !colMenuRef.current.contains(target)) setShowColMenu(false);
      if (statusMenuRef.current && !statusMenuRef.current.contains(target)) setShowStatusMenu(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showColMenu) { setShowColMenu(false); colButtonRef.current?.focus(); }
      if (showStatusMenu) { setShowStatusMenu(false); statusButtonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showColMenu, showStatusMenu]);

  const toggleColumn = async (key: string) => {
    const next = visibleCols.includes(key)
      ? visibleCols.filter((k) => k !== key)
      : [...visibleCols, key];
    setVisibleCols(next);
    try {
      const { preferences } = await updateMyPreferences({ taskColumns: next });
      setPreferences(preferences);
    } catch {
      toast.error('Failed to save column preferences');
    }
  };

  // ── Tab & filter state (persists within session via component state) ──
  // Seeded from the URL first (dashboard drill-through links land pre-filtered),
  // falling back to the sessionStorage-persisted view below when no URL filter is present.
  const [activeTab, setActiveTab] = useState<ActiveTab>('all');
  const [statusFilters, setStatusFilters] = useState<TaskStatus[]>(() => {
    const s = searchParams.get('status');
    return s && (ALL_STATUSES as string[]).includes(s) ? [s as TaskStatus] : [];
  });
  const [assigneeFilter, setAssigneeFilter] = useState<number | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(() => searchParams.get('overdueOnly') === 'true');
  const [dueFilter, setDueFilter] = useState<DueFilter>(() => {
    const d = searchParams.get('dueFilter');
    return d === 'today' || d === 'week' ? d : null;
  });
  const [pendingRatingOnly, setPendingRatingOnly] = useState(() => searchParams.get('pendingRatingOnly') === 'true');

  // ── Sorting ──
  const [sortColumn, setSortColumn] = useState<SortColumn>('deadline');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortColumn(col); setSortDirection('asc'); }
  };

  const renderSortIcon = (col: SortColumn) => {
    if (sortColumn !== col) return <ArrowUpDown className="w-3 h-3 ml-1 inline text-slate-300" />;
    return sortDirection === 'asc'
      ? <ChevronUp className="w-3 h-3 ml-1 inline text-signal-blue" />
      : <ChevronDown className="w-3 h-3 ml-1 inline text-signal-blue" />;
  };

  // Quick presets for the "Created" date range — fill the existing inputs, no new filter dimension.
  const applyCreatedPreset = (preset: 'today' | 'last3' | 'week') => {
    const today = startOfDay(new Date());
    const start = new Date(today);
    if (preset === 'last3') start.setDate(start.getDate() - 2);
    else if (preset === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    setStartDate(toInputDate(start));
    setEndDate(toInputDate(today));
  };

  // ── Data state (server-side paginated — Phase 5) ──
  const [tasks, setTasks] = useState<TaskEnriched[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selfAssigning, setSelfAssigning] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Distinct assignees for the dropdown (server-provided, scope-aware).
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);

  // Debounce the free-text search so it doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // lastActivity is derived from FeedPost server-side and has no sortable column,
  // so it is handled client-side on the loaded page; all other columns sort server-side.
  const serverSortColumn = sortColumn === 'lastActivity' ? undefined : sortColumn;

  // ── Persisted filters: hydrate once on mount ──
  // Skipped entirely when the URL carries a drill-through filter — otherwise a
  // stale saved view would immediately clobber the state a dashboard link just seeded.
  useEffect(() => {
    if (searchParams.toString()) return;
    try {
      const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.activeTab) setActiveTab(saved.activeTab);
      if (saved.statusFilters) setStatusFilters(saved.statusFilters);
      if (saved.assigneeFilter !== undefined) setAssigneeFilter(saved.assigneeFilter);
      if (saved.startDate) setStartDate(saved.startDate);
      if (saved.endDate) setEndDate(saved.endDate);
      if (saved.overdueOnly) setOverdueOnly(saved.overdueOnly);
      if (saved.dueFilter) setDueFilter(saved.dueFilter);
      if (saved.pendingRatingOnly) setPendingRatingOnly(saved.pendingRatingOnly);
    } catch {
      // Corrupt or unavailable storage — fall back to defaults silently.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persisted filters: save on every change (search query excluded — it's a one-off lookup, not a saved view) ──
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
        activeTab, statusFilters, assigneeFilter, startDate, endDate, overdueOnly, dueFilter, pendingRatingOnly,
      }));
    } catch {
      // sessionStorage unavailable (private browsing, etc.) — filters just won't persist.
    }
  }, [activeTab, statusFilters, assigneeFilter, startDate, endDate, overdueOnly, dueFilter, pendingRatingOnly]);

  // Clear any pending self-assign confirmation timeout on unmount.
  useEffect(() => () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
  }, []);

  // ── Fetch the current page (server applies scope + filters + sort) ──
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await getTaskList({
        tab: activeTab as TaskTab,
        page,
        pageSize: PAGE_SIZE,
        statuses: statusFilters.length > 0 ? statusFilters : undefined,
        assignedToUserId: assigneeFilter !== '' ? assigneeFilter : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        overdueOnly: overdueOnly || undefined,
        dueFilter: dueFilter ?? undefined,
        pendingRatingOnly: pendingRatingOnly || undefined,
        search: debouncedSearch || undefined,
        sortColumn: serverSortColumn,
        sortDir: sortDirection,
      });
      setTasks(res.tasks);
      setTotal(res.total);
    } catch {
      setFetchError('Failed to load tasks. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, statusFilters, assigneeFilter, startDate, endDate, overdueOnly, dueFilter, pendingRatingOnly, debouncedSearch, serverSortColumn, sortDirection]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // When the result set (tab / filters / sort) changes, snap back to page 1 — done
  // during render via React's "adjust state when a value changes" pattern (compare
  // against the previous filters key held in state), so the reset lands BEFORE the
  // fetch effect runs. This avoids firing a wasted request for a now-out-of-range
  // page (and the empty-table flash) that a separate reset effect would cause.
  const filtersKey = JSON.stringify([activeTab, statusFilters, assigneeFilter, startDate, endDate, overdueOnly, dueFilter, pendingRatingOnly, debouncedSearch, serverSortColumn, sortDirection]);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1); // no-op when already 1; otherwise re-renders and the fetch runs once on page 1
  }

  // ── Tab badges (server-computed) + assignee options ──
  const [unassignedCount, setUnassignedCount] = useState<number | null>(null);
  const [myAttentionCount, setMyAttentionCount] = useState<number | null>(null);
  const [allAttentionCount, setAllAttentionCount] = useState<number | null>(null);

  // Bumped after a self-assign so badges + assignee options refresh.
  const [statsRefresh, setStatsRefresh] = useState(0);

  // Badges are scope-level totals (independent of the page's filters). Refresh them
  // on mount, on tab navigation, and after a self-assign — so they don't sit stale
  // for a whole session while the underlying data shifts under the user.
  useEffect(() => {
    getTaskStats()
      .then((s) => { setUnassignedCount(s.unassigned); setMyAttentionCount(s.myAttention); setAllAttentionCount(s.allAttention); })
      .catch(() => {});
    getTaskAssignees().then(setAssignees).catch(() => {});
  }, [statsRefresh, activeTab]);

  const assigneeOptions = assignees;

  // Distinguishes "this scope is genuinely empty" from "your filters matched nothing"
  // for the empty-state copy (server-side filtering means an empty page can be either).
  const hasActiveFilters =
    statusFilters.length > 0 || assigneeFilter !== '' || !!startDate || !!endDate ||
    overdueOnly || !!dueFilter || pendingRatingOnly || !!debouncedSearch;

  // The server already applied scope + filters; keep the name for the render. Only
  // the lastActivity sort is resolved client-side (no sortable column server-side).
  const filteredTasks = tasks;
  const sortedTasks = sortColumn !== 'lastActivity' ? tasks : [...tasks].sort((a, b) => {
    let comparison: number;
    if (!a.lastActivityAt && !b.lastActivityAt) comparison = 0;
    else if (!a.lastActivityAt) comparison = 1;
    else if (!b.lastActivityAt) comparison = -1;
    else comparison = new Date(a.lastActivityAt).getTime() - new Date(b.lastActivityAt).getTime();
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // ── Self-assign handler ──
  const handleSelfAssign = async (task: TaskEnriched) => {
    setSelfAssigning(task.id);
    try {
      await selfAssignTask(task.id);
      toast.success(`Task ${task.taskId} assigned to you`);
      router.push(`/dashboard/tasks/${task.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to self-assign task');
      setSelfAssigning(null);
      setStatsRefresh((n) => n + 1); // badge counts may have shifted under us
    }
  };

  // First click arms a 3-second confirmation window; a second click within
  // that window commits the assignment. Claiming the wrong task creates an
  // audit trail under the user's name, so this isn't a single-click action.
  const handlePerformClick = (task: TaskEnriched) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    if (confirmingId === task.id) {
      setConfirmingId(null);
      handleSelfAssign(task);
      return;
    }
    setConfirmingId(task.id);
    confirmTimeoutRef.current = setTimeout(() => setConfirmingId(null), 3000);
  };

  // ── Tab click switches the data source; filters persist across tabs ──
  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    setShowStatusMenu(false);
  };

  const canCreateTask = user && TASK_CREATOR_ROLES.includes(user.role);

  // ─── Loading state ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tasks</h1>
          <p className="text-slate-500 mt-1">Manage and track QA audit tasks</p>
        </div>
        {canCreateTask && (
          <Link
            href="/dashboard/tasks/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-signal-blue hover:bg-signal-blue-hover text-white font-semibold rounded-xl shadow-[0_2px_6px_rgba(37,99,235,0.25)] transition-all"
          >
            <Plus className="w-5 h-5" />
            Create Task
          </Link>
        )}
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-2xl border border-slate-100">
        <div className="flex border-b border-slate-100 rounded-t-2xl overflow-hidden">
          {([
            { key: 'unassigned', label: 'Unassigned', count: unassignedCount },
            { key: 'my-tasks', label: 'My Tasks', count: myAttentionCount },
            { key: 'all', label: 'All Tasks', count: allAttentionCount },
          ] as { key: ActiveTab; label: string; count: number | null }[]).map((tab) => (
            <button
              key={tab.key}
              id={`tab-${tab.key}`}
              onClick={() => handleTabChange(tab.key)}
              className={`inline-flex items-center gap-2 px-6 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-signal-blue text-signal-blue bg-signal-blue-surface/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              {tab.label}
              {!!tab.count && (
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-bold bg-amber-caution-surface text-amber-caution">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="p-4 flex flex-col sm:flex-row gap-3 border-b border-slate-50">
          {/* Search */}
          <div className="relative flex-1">
            <label htmlFor="task-search" className="sr-only">Search by Task ID or title</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="task-search"
              type="text"
              placeholder="Search by Task ID or title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-signal-blue transition-all"
            />
          </div>

          {/* Status filter dropdown (multi-select) */}
          <div className="relative" ref={statusMenuRef}>
            <button
              id="status-filter-button"
              ref={statusButtonRef}
              onClick={() => setShowStatusMenu((v) => !v)}
              aria-haspopup="true"
              aria-expanded={showStatusMenu}
              aria-controls="status-filter-menu"
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                statusFilters.length > 0
                  ? 'bg-signal-blue-surface text-signal-blue border-signal-blue/30'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {statusFilters.length === 0
                ? 'All Statuses'
                : statusFilters.length === 1
                ? STATUS_CONFIG[statusFilters[0]].label
                : `${statusFilters.length} selected`}
              <ChevronDown className="w-4 h-4" />
            </button>
            {showStatusMenu && (
              <div
                id="status-filter-menu"
                role="group"
                aria-label="Filter by status"
                className="absolute left-0 mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-2"
              >
                <label className="flex items-center gap-2 px-2 py-2.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm font-semibold text-slate-700 min-h-11">
                  <input
                    id="status-filter-all"
                    type="checkbox"
                    checked={statusFilters.length === 0}
                    onChange={() => setStatusFilters([])}
                    className="w-4 h-4 text-signal-blue rounded"
                  />
                  All Statuses
                </label>
                <div className="my-1 border-t border-slate-100" />
                {ALL_STATUSES.map((s) => {
                  const cfg = STATUS_CONFIG[s];
                  return (
                    <label
                      key={s}
                      className="flex items-center gap-2 px-2 py-2.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm min-h-11"
                    >
                      <input
                        id={`status-filter-${s.replace(/\s+/g, '-').toLowerCase()}`}
                        type="checkbox"
                        checked={statusFilters.includes(s)}
                        onChange={() =>
                          setStatusFilters((prev) =>
                            prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                          )
                        }
                        className="w-4 h-4 text-signal-blue rounded"
                      />
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Overdue toggle */}
          <label
            id="overdue-toggle"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer select-none transition-colors ${
              overdueOnly
                ? 'bg-red-finding-surface text-red-finding border-red-finding/20'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
            }`}
          >
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="sr-only"
            />
            <AlertTriangle className="w-3.5 h-3.5" />
            Overdue Only
          </label>

          {/* Due quick filter — upcoming deadlines, separate dimension from Overdue */}
          <div className="flex items-center gap-1.5" role="group" aria-label="Filter by upcoming deadline">
            {([
              { key: 'today' as const, label: 'Due Today' },
              { key: 'week' as const, label: 'Due This Week' },
            ]).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setDueFilter((prev) => (prev === opt.key ? null : opt.key))}
                aria-pressed={dueFilter === opt.key}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  dueFilter === opt.key
                    ? 'bg-amber-caution-surface text-amber-caution border-amber-caution/20'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Secondary filters: assignee + created-date range */}
        <div className="px-4 pb-4 flex flex-col sm:flex-row gap-3 border-b border-slate-50">
          <label htmlFor="assignee-filter" className="sr-only">Filter by assignee</label>
          <select
            id="assignee-filter"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value ? Number(e.target.value) : '')}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-signal-blue"
          >
            <option value="">All assignees</option>
            {assigneeOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-slate-500" htmlFor="filter-start-date">Created</label>
            <input
              id="filter-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-signal-blue"
            />
            <span className="text-slate-400 text-sm">→</span>
            <input
              id="filter-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-signal-blue"
            />
            <div className="flex items-center gap-1" role="group" aria-label="Created date quick presets">
              {([
                { key: 'today' as const, label: 'Today' },
                { key: 'last3' as const, label: 'Last 3 Days' },
                { key: 'week' as const, label: 'This Week' },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => applyCreatedPreset(opt.key)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-500 border border-slate-200 hover:border-slate-400 hover:text-slate-700 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Column selector */}
          <div className="relative sm:ml-auto" ref={colMenuRef}>
            <button
              id="columns-button"
              ref={colButtonRef}
              onClick={() => setShowColMenu((v) => !v)}
              aria-haspopup="true"
              aria-expanded={showColMenu}
              aria-controls="columns-menu"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:border-slate-400"
            >
              <Columns3 className="w-4 h-4" />
              Columns
            </button>
            {showColMenu && (
              <div
                id="columns-menu"
                role="group"
                aria-label="Toggle visible columns"
                className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-2"
              >
                {TASK_COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-2 py-2.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm min-h-11">
                    <input
                      type="checkbox"
                      checked={isColVisible(c.key)}
                      onChange={() => toggleColumn(c.key)}
                      className="w-4 h-4 text-signal-blue rounded"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center h-48 rounded-b-2xl overflow-hidden">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-signal-blue" />
          </div>
        ) : fetchError ? (
          <div className="p-12 text-center rounded-b-2xl overflow-hidden">
            <AlertTriangle className="w-12 h-12 text-red-finding/40 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">Couldn&apos;t load tasks</h2>
            <p className="text-slate-500 mb-4">{fetchError}</p>
            <button
              onClick={fetchTasks}
              className="inline-flex items-center gap-2 px-4 py-2 bg-signal-blue hover:bg-signal-blue-hover text-white text-sm font-semibold rounded-xl transition-all"
            >
              Try again
            </button>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-12 text-center rounded-b-2xl overflow-hidden">
            <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">
              {hasActiveFilters ? 'No matching tasks' : 'No tasks found'}
            </h2>
            <p className="text-slate-500">
              {hasActiveFilters
                ? 'Try adjusting your search or filter criteria.'
                : activeTab === 'unassigned'
                  ? 'There are no unassigned tasks in your division right now.'
                  : 'No tasks match the current view.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-b-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {isColVisible('taskId') && (
                    <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <button onClick={() => handleSort('taskId')} className="inline-flex items-center hover:text-slate-700 transition-colors">
                        Task ID{renderSortIcon('taskId')}
                      </button>
                    </th>
                  )}
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <button onClick={() => handleSort('title')} className="inline-flex items-center hover:text-slate-700 transition-colors">
                      Title{renderSortIcon('title')}
                    </button>
                  </th>
                  {isColVisible('status') && (
                    <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <button onClick={() => handleSort('status')} className="inline-flex items-center hover:text-slate-700 transition-colors">
                        Status{renderSortIcon('status')}
                      </button>
                    </th>
                  )}
                  {isColVisible('assignee') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Assignee</th>}
                  {isColVisible('issuer') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Issuer</th>}
                  {isColVisible('deadline') && (
                    <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <button onClick={() => handleSort('deadline')} className="inline-flex items-center hover:text-slate-700 transition-colors">
                        Deadline{renderSortIcon('deadline')}
                      </button>
                    </th>
                  )}
                  {isColVisible('division') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Division</th>}
                  {isColVisible('lastActivity') && (
                    <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <button onClick={() => handleSort('lastActivity')} className="inline-flex items-center hover:text-slate-700 transition-colors">
                        Last Activity{renderSortIcon('lastActivity')}
                      </button>
                    </th>
                  )}
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedTasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/80 transition-colors group">
                    {/* Task ID */}
                    {isColVisible('taskId') && (
                    <td className="p-4 align-middle">
                      <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-bold font-mono border border-slate-200">
                        {task.taskId}
                      </span>
                    </td>
                    )}

                    {/* Title — the row's primary link to the detail page. Custom
                        Task.title overrides the template title when set. */}
                    <td className="p-4 align-middle max-w-xs">
                      <Link
                        href={`/dashboard/tasks/${task.id}`}
                        id={`view-task-${task.id}`}
                        aria-label={`View task ${task.taskId}`}
                        className="font-medium text-slate-800 hover:text-signal-blue block focus:outline-none focus:underline whitespace-normal break-words"
                      >
                        {task.title ?? task.template?.title ?? '—'}
                      </Link>
                      {(task.wp || task.parentFinding?.findingId || task.template?.title) && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          {[
                            task.wp ? `WP: ${task.wp.wpId}` : null,
                            task.parentFinding?.findingId ? `Finding: ${task.parentFinding.findingId}` : null,
                            task.template?.title ? `Template: ${task.template.title}` : null,
                          ].filter(Boolean).join(' | ')}
                        </div>
                      )}
                    </td>

                    {/* Status + overdue badge */}
                    {isColVisible('status') && (
                    <td className="p-4 align-middle">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TaskStatusBadge status={task.status} />
                        {task.deadlineStatus && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${DEADLINE_BADGE[task.deadlineStatus].className}`}>
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {DEADLINE_BADGE[task.deadlineStatus].label}
                          </span>
                        )}
                      </div>
                    </td>
                    )}

                    {/* Assignee */}
                    {isColVisible('assignee') && (
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {task.assignedToUser?.name ?? (
                        <span className="text-ink-secondary italic">Unassigned</span>
                      )}
                    </td>
                    )}

                    {/* Issuer */}
                    {isColVisible('issuer') && (
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {task.issuer?.name ?? '—'}
                    </td>
                    )}

                    {/* Deadline */}
                    {isColVisible('deadline') && (
                    <td className="p-4 align-middle text-sm">
                      <span className={
                        task.deadlineStatus === 'Overdue' ? 'text-red-finding font-semibold'
                        : task.deadlineStatus === 'Due Today' ? 'text-amber-caution font-semibold'
                        : task.deadlineStatus === 'Due Soon' ? 'text-amber-caution font-medium'
                        : 'text-slate-600'
                      }>
                        {formatDeadline(task.deadline)}
                      </span>
                    </td>
                    )}

                    {/* Division */}
                    {isColVisible('division') && (
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {task.targetDivision?.name ?? '—'}
                    </td>
                    )}

                    {/* Last Activity — up to 2 most recent feed-post summaries, relative time */}
                    {isColVisible('lastActivity') && (
                    <td className="p-4 align-middle text-sm">
                      {task.recentActivities && task.recentActivities.length > 0 ? (
                        <div className="space-y-0.5 max-w-[220px]">
                          {task.recentActivities.map((a, i) => (
                            <div key={i} className="truncate text-slate-600">
                              <span className="truncate">{a.content}</span>
                              <span className="text-slate-400"> — {formatRelativeTime(a.createdAt)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500">
                          {task.lastActivityAt ? formatRelativeTime(task.lastActivityAt) : '—'}
                        </span>
                      )}
                    </td>
                    )}

                    {/* Actions — title is now the row's view link; this column is
                        self-assign only, and empty otherwise. */}
                    <td className="p-4 align-middle">
                      <div className="flex items-center justify-end gap-2">
                        {/* PERFORM THIS TASK — Unassigned tab only. First click arms a
                            3s confirmation window; second click commits. */}
                        {activeTab === 'unassigned' && task.status === 'Unassigned' && (
                          <button
                            id={`self-assign-${task.id}`}
                            onClick={() => handlePerformClick(task)}
                            disabled={selfAssigning === task.id}
                            aria-label={
                              confirmingId === task.id
                                ? `Confirm assigning task ${task.taskId} to yourself`
                                : `Perform task ${task.taskId}`
                            }
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 disabled:opacity-60 text-xs font-semibold rounded-lg transition-all ${
                              confirmingId === task.id
                                ? 'bg-amber-caution-surface text-amber-caution border border-amber-caution/30'
                                : 'bg-signal-blue hover:bg-signal-blue-hover text-white'
                            }`}
                          >
                            {selfAssigning === task.id ? (
                              <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <UserCheck className="w-3.5 h-3.5" />
                            )}
                            {confirmingId === task.id ? 'Confirm?' : 'Perform This Task'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer — server-side paged (Phase 5) */}
        {!loading && !fetchError && total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-600 rounded-b-2xl">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 disabled:opacity-40 hover:border-slate-400 transition-colors"
              >
                Previous
              </button>
              <span className="text-slate-500">Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
              <button
                onClick={() => setPage((p) => (p * PAGE_SIZE < total ? p + 1 : p))}
                disabled={page * PAGE_SIZE >= total}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 disabled:opacity-40 hover:border-slate-400 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

export default function TaskListPage() {
  return (
    <Suspense>
      <TaskListPageInner />
    </Suspense>
  );
}
