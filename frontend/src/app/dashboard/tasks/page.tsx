'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../store/authStore';
import { TaskEnriched, TaskStatus, DeadlineStatus } from '../../../types';
import { getTasks, getMyTasks, getUnassignedTasks, selfAssignTask, createQuickTask } from '../../../api/taskApi';
import { updateMyPreferences } from '../../../api/userApi';
import TaskStatusBadge, { STATUS_CONFIG } from '../../../components/tasks/TaskStatusBadge';
import toast from 'react-hot-toast';
import {
  Plus,
  Search,
  ClipboardList,
  AlertTriangle,
  Eye,
  Zap,
  Columns3,
  ChevronDown,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

type ActiveTab = 'unassigned' | 'my-tasks' | 'all';

const TASK_CREATOR_ROLES = ['Manager', 'Director', 'Admin'];

const ALL_STATUSES: TaskStatus[] = [
  'Unassigned', 'Assigned', 'In Progress', 'In Review',
  'Follow-up Required', 'Closed', 'Rejected', 'Terminated', 'Inactive',
];

// Toggleable list columns (Actions is always shown). Order here = render order.
const TASK_COLUMNS: { key: string; label: string }[] = [
  { key: 'taskId', label: 'Task ID' },
  { key: 'title', label: 'Title' },
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

// Tiered deadline badge styling: increasing urgency Yellow → Orange → Red.
const DEADLINE_BADGE: Record<Exclude<DeadlineStatus, null>, { label: string; className: string }> = {
  'Due Soon':  { label: 'DUE SOON',  className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  'Due Today': { label: 'DUE TODAY', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  'Overdue':   { label: 'OVERDUE',   className: 'bg-red-50 text-red-600 border-red-200' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDeadline(deadline: string | null): string {
  if (!deadline) return '—';
  return new Date(deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaskListPage() {
  const router = useRouter();
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
  useEffect(() => {
    if (!showColMenu && !showStatusMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (colMenuRef.current && !colMenuRef.current.contains(target)) setShowColMenu(false);
      if (statusMenuRef.current && !statusMenuRef.current.contains(target)) setShowStatusMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('all');
  const [statusFilters, setStatusFilters] = useState<TaskStatus[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<number | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  // ── Data state ──
  const [tasks, setTasks] = useState<TaskEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [selfAssigning, setSelfAssigning] = useState<number | null>(null);

  // Quick Task modal
  const [showQuickTask, setShowQuickTask] = useState(false);
  const [qtTitle, setQtTitle] = useState('');
  const [qtNote, setQtNote] = useState('');
  const [qtDeadline, setQtDeadline] = useState('');
  const [qtSkillLevel, setQtSkillLevel] = useState(0);
  const [qtRequiresApproval, setQtRequiresApproval] = useState(true);
  const [qtSubmitting, setQtSubmitting] = useState(false);

  // ── Fetch on tab change ──
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      let data: TaskEnriched[];
      if (activeTab === 'unassigned') data = await getUnassignedTasks();
      else if (activeTab === 'my-tasks') data = await getMyTasks();
      else data = await getTasks();
      setTasks(data);
    } catch {
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Distinct assignees present in the current list (for the assignee dropdown).
  const assigneeOptions = Array.from(
    new Map(tasks.filter((t) => t.assignedToUser).map((t) => [t.assignedToUser!.id, t.assignedToUser!])).values()
  );

  // ── Filters ──
  const filteredTasks = tasks.filter((t) => {
    if (statusFilters.length > 0 && !statusFilters.includes(t.status)) return false;
    if (assigneeFilter !== '' && t.assignedToUserId !== assigneeFilter) return false;
    if (startDate && new Date(t.createdAt) < new Date(startDate)) return false;
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      if (new Date(t.createdAt) > end) return false;
    }
    if (overdueOnly && !t.isOverdue) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const title = (t.schemaSnapshot as any)?.[0]?.label ?? t.template?.title ?? '';
      return (
        t.taskId.toLowerCase().includes(q) ||
        title.toLowerCase().includes(q) ||
        (t.template?.title ?? '').toLowerCase().includes(q)
      );
    }
    return true;
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
    }
  };

  // ── Tab click resets status filter ──
  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    setStatusFilters([]);
    setAssigneeFilter('');
    setStartDate('');
    setEndDate('');
    setOverdueOnly(false);
    setShowStatusMenu(false);
  };

  const canCreateTask = user && TASK_CREATOR_ROLES.includes(user.role);

  const handleQuickTaskSubmit = async () => {
    if (!qtTitle.trim()) { toast.error('Title is required'); return; }
    setQtSubmitting(true);
    try {
      const task = await createQuickTask({
        title: qtTitle.trim(),
        issuanceNote: qtNote.trim() || undefined,
        deadline: qtDeadline || undefined,
        skillLevel: qtSkillLevel,
        requiresApproval: qtRequiresApproval,
      });
      toast.success(`Quick task ${task.taskId} created`);
      setShowQuickTask(false);
      setQtTitle(''); setQtNote(''); setQtDeadline(''); setQtSkillLevel(0); setQtRequiresApproval(true);
      router.push(`/dashboard/tasks/${task.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create quick task');
    } finally {
      setQtSubmitting(false);
    }
  };

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
          <div className="flex items-center gap-2">
            <button
              id="quick-task-button"
              onClick={() => setShowQuickTask(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl shadow-sm transition-all"
            >
              <Zap className="w-5 h-5" />
              Quick Task
            </button>
            <Link
              href="/dashboard/tasks/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm transition-all"
            >
              <Plus className="w-5 h-5" />
              New Task
            </Link>
          </div>
        )}
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100">
          {([
            { key: 'unassigned', label: 'Unassigned' },
            { key: 'my-tasks', label: 'My Tasks' },
            { key: 'all', label: 'All Tasks' },
          ] as { key: ActiveTab; label: string }[]).map((tab) => (
            <button
              key={tab.key}
              id={`tab-${tab.key}`}
              onClick={() => handleTabChange(tab.key)}
              className={`px-6 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="p-4 flex flex-col sm:flex-row gap-3 border-b border-slate-50">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="task-search"
              type="text"
              placeholder="Search by Task ID or title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* Status filter dropdown (multi-select) */}
          <div className="relative" ref={statusMenuRef}>
            <button
              id="status-filter-button"
              onClick={() => setShowStatusMenu((v) => !v)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                statusFilters.length > 0
                  ? 'bg-blue-50 text-blue-700 border-blue-300'
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
              <div className="absolute left-0 mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-2">
                <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm font-semibold text-slate-700">
                  <input
                    id="status-filter-all"
                    type="checkbox"
                    checked={statusFilters.length === 0}
                    onChange={() => setStatusFilters([])}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  All Statuses
                </label>
                <div className="my-1 border-t border-slate-100" />
                {ALL_STATUSES.map((s) => {
                  const cfg = STATUS_CONFIG[s];
                  return (
                    <label
                      key={s}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm"
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
                        className="w-4 h-4 text-blue-600 rounded"
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
                ? 'bg-red-50 text-red-700 border-red-200'
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
        </div>

        {/* Secondary filters: assignee + created-date range */}
        <div className="px-4 pb-4 flex flex-col sm:flex-row gap-3 border-b border-slate-50">
          <select
            id="assignee-filter"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value ? Number(e.target.value) : '')}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All assignees</option>
            {assigneeOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500" htmlFor="filter-start-date">Created</label>
            <input
              id="filter-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-slate-400 text-sm">→</span>
            <input
              id="filter-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Column selector */}
          <div className="relative sm:ml-auto" ref={colMenuRef}>
            <button
              id="columns-button"
              onClick={() => setShowColMenu((v) => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:border-slate-400"
            >
              <Columns3 className="w-4 h-4" />
              Columns
            </button>
            {showColMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-2">
                {TASK_COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={isColVisible(c.key)}
                      onChange={() => toggleColumn(c.key)}
                      className="w-4 h-4 text-blue-600 rounded"
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
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">
              {tasks.length === 0 ? 'No tasks found' : 'No matching tasks'}
            </h2>
            <p className="text-slate-500">
              {tasks.length === 0
                ? activeTab === 'unassigned'
                  ? 'There are no unassigned tasks in your division right now.'
                  : 'No tasks match the current view.'
                : 'Try adjusting your search or filter criteria.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {isColVisible('taskId') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Task ID</th>}
                  {isColVisible('title') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Title</th>}
                  {isColVisible('status') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>}
                  {isColVisible('assignee') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Assignee</th>}
                  {isColVisible('issuer') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Issuer</th>}
                  {isColVisible('deadline') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Deadline</th>}
                  {isColVisible('division') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Division</th>}
                  {isColVisible('lastActivity') && <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Activity</th>}
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/80 transition-colors group">
                    {/* Task ID */}
                    {isColVisible('taskId') && (
                    <td className="p-4 align-middle">
                      <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-bold font-mono border border-slate-200">
                        {task.taskId}
                      </span>
                    </td>
                    )}

                    {/* Title */}
                    {isColVisible('title') && (
                    <td className="p-4 align-middle max-w-xs">
                      <div className="font-medium text-slate-800 truncate">
                        {task.template?.title ?? '—'}
                      </div>
                      {task.wp && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          WP: {task.wp.wpId}
                        </div>
                      )}
                    </td>
                    )}

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
                        <span className="text-slate-400 italic">Unassigned</span>
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
                        task.deadlineStatus === 'Overdue' ? 'text-red-600 font-semibold'
                        : task.deadlineStatus === 'Due Today' ? 'text-orange-600 font-semibold'
                        : task.deadlineStatus === 'Due Soon' ? 'text-yellow-700 font-medium'
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

                    {/* Last Activity */}
                    {isColVisible('lastActivity') && (
                    <td className="p-4 align-middle text-sm text-slate-500">
                      {task.lastActivityAt ? formatDeadline(task.lastActivityAt) : '—'}
                    </td>
                    )}

                    {/* Actions */}
                    <td className="p-4 align-middle">
                      <div className="flex items-center justify-end gap-2">
                        {/* View */}
                        <Link
                          href={`/dashboard/tasks/${task.id}`}
                          id={`view-task-${task.id}`}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View Task"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>

                        {/* PERFORM THIS TASK — Unassigned tab only */}
                        {activeTab === 'unassigned' && task.status === 'Unassigned' && (
                          <button
                            id={`self-assign-${task.id}`}
                            onClick={() => handleSelfAssign(task)}
                            disabled={selfAssigning === task.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg transition-all"
                          >
                            {selfAssigning === task.id ? (
                              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Zap className="w-3.5 h-3.5" />
                            )}
                            PERFORM THIS TASK
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
      </div>

      {/* Quick Task modal */}
      {showQuickTask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" /> Quick Task
              </h3>
              <button onClick={() => setShowQuickTask(false)} className="text-slate-400 hover:text-slate-600 text-sm">Close</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-title">Title *</label>
                <input id="qt-title" type="text" value={qtTitle} onChange={(e) => setQtTitle(e.target.value)}
                  placeholder="What needs doing?"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-note">Instruction / Note</label>
                <textarea id="qt-note" rows={3} value={qtNote} onChange={(e) => setQtNote(e.target.value)}
                  placeholder="Optional context or guidance"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-deadline">Deadline</label>
                  <input id="qt-deadline" type="date" value={qtDeadline} min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setQtDeadline(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-skill">Skill Level</label>
                  <select id="qt-skill" value={qtSkillLevel} onChange={(e) => setQtSkillLevel(Number(e.target.value))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                    {[0, 1, 2, 3, 4].map((l) => <option key={l} value={l}>Level {l}</option>)}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={qtRequiresApproval} onChange={(e) => setQtRequiresApproval(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
                <span className="text-sm font-medium text-slate-700">Requires Approval</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-slate-100">
              <button onClick={() => setShowQuickTask(false)} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-xl">Cancel</button>
              <button onClick={handleQuickTaskSubmit} disabled={qtSubmitting}
                className="px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl disabled:opacity-50">
                {qtSubmitting ? 'Creating…' : 'Issue Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
