'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../store/authStore';
import { TaskEnriched, TaskStatus, DeadlineStatus } from '../../../types';
import { getTasks, getMyTasks, getUnassignedTasks, selfAssignTask } from '../../../api/taskApi';
import TaskStatusBadge, { STATUS_CONFIG } from '../../../components/tasks/TaskStatusBadge';
import toast from 'react-hot-toast';
import {
  Plus,
  Search,
  ClipboardList,
  AlertTriangle,
  Eye,
  Zap,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

type ActiveTab = 'unassigned' | 'my-tasks' | 'all';

const TASK_CREATOR_ROLES = ['Manager', 'Director', 'Admin'];

const ALL_STATUSES: TaskStatus[] = [
  'Unassigned', 'Assigned', 'In Progress', 'In Review',
  'Follow-up Required', 'Closed', 'Rejected', 'Terminated', 'Inactive',
];

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
  const { user } = useAuthStore();

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
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm transition-all"
          >
            <Plus className="w-5 h-5" />
            New Task
          </Link>
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

          {/* Status filter pills (multi-select) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="status-filter-all"
              onClick={() => setStatusFilters([])}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                statusFilters.length === 0
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              All
            </button>
            {ALL_STATUSES.map((s) => {
              const cfg = STATUS_CONFIG[s];
              const isActive = statusFilters.includes(s);
              return (
                <button
                  key={s}
                  id={`status-filter-${s.replace(/\s+/g, '-').toLowerCase()}`}
                  onClick={() =>
                    setStatusFilters((prev) =>
                      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                    )
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    isActive ? cfg.color + ' border-current' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {cfg.label}
                </button>
              );
            })}
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
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Task ID</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Title</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Assignee</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Issuer</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Deadline</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Division</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Activity</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/80 transition-colors group">
                    {/* Task ID */}
                    <td className="p-4 align-middle">
                      <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-bold font-mono border border-slate-200">
                        {task.taskId}
                      </span>
                    </td>

                    {/* Title */}
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

                    {/* Status + overdue badge */}
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

                    {/* Assignee */}
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {task.assignedToUser?.name ?? (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>

                    {/* Issuer */}
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {task.issuer?.name ?? '—'}
                    </td>

                    {/* Deadline */}
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

                    {/* Division */}
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {task.targetDivision?.name ?? '—'}
                    </td>

                    {/* Last Activity */}
                    <td className="p-4 align-middle text-sm text-slate-500">
                      {task.lastActivityAt ? formatDeadline(task.lastActivityAt) : '—'}
                    </td>

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
    </div>
  );
}
