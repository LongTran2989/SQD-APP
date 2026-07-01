import { apiClient } from './client';
import { TaskEnriched, TaskActivityEnriched, TimeBooking, TimeBookingEntry, TimeEntry, TimeEntrySummary, ReviewAction, DeadlineDecision, FindingStatus, FindingSeverity } from '../types';

// ─── List endpoints (server-side paginated — Phase 5) ───────────────────────────

export type TaskTab = 'all' | 'my-tasks' | 'unassigned';

export interface TaskListParams {
  tab: TaskTab;
  page?: number;
  pageSize?: number;
  statuses?: string[];
  issuerId?: number;
  assignedToUserId?: number;
  startDate?: string;
  endDate?: string;
  overdueOnly?: boolean;
  dueFilter?: 'today' | 'week';
  search?: string;
  sortColumn?: string;
  sortDir?: 'asc' | 'desc';
}

export interface TaskListResponse {
  tasks: TaskEnriched[];
  total: number;
  page: number;
  pageSize: number;
}

const TAB_PATH: Record<TaskTab, string> = {
  all: '/tasks',
  'my-tasks': '/tasks/my-tasks',
  unassigned: '/tasks/unassigned',
};

export const getTaskList = (p: TaskListParams): Promise<TaskListResponse> => {
  const params = new URLSearchParams();
  if (p.page != null) params.set('page', String(p.page));
  if (p.pageSize != null) params.set('pageSize', String(p.pageSize));
  if (p.statuses) p.statuses.forEach((s) => params.append('statuses', s));
  if (p.issuerId != null) params.set('issuerId', String(p.issuerId));
  if (p.assignedToUserId != null) params.set('assignedToUserId', String(p.assignedToUserId));
  if (p.startDate) params.set('startDate', p.startDate);
  if (p.endDate) params.set('endDate', p.endDate);
  if (p.overdueOnly) params.set('overdueOnly', 'true');
  if (p.dueFilter) params.set('dueFilter', p.dueFilter);
  if (p.search) params.set('search', p.search);
  if (p.sortColumn) params.set('sortColumn', p.sortColumn);
  if (p.sortDir) params.set('sortDir', p.sortDir);
  const qs = params.toString();
  return apiClient.get(`${TAB_PATH[p.tab]}${qs ? `?${qs}` : ''}`).then((r) => r.data);
};

// Tab badge counts (computed server-side).
export interface TaskStats { unassigned: number; myAttention: number; allAttention: number; }
export const getTaskStats = (): Promise<TaskStats> =>
  apiClient.get('/tasks/stats').then((r) => r.data);

// Distinct assignees in the All-Tasks scope (for the assignee dropdown).
export interface TaskAssignee { id: number; name: string; }
export const getTaskAssignees = (): Promise<TaskAssignee[]> =>
  apiClient.get('/tasks/assignees').then((r) => r.data);

// Slim task list for pickers (CAPA link / WP selector).
export interface TaskOption { id: number; taskId: string; title: string | null; status: string; }
export const getTaskOptions = (search?: string): Promise<TaskOption[]> =>
  apiClient.get(`/tasks/options${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((r) => r.data);

// Link an existing task to a Work Package, or clear it (wpId: null).
export const relinkTaskWp = (id: number, wpId: number | null): Promise<TaskEnriched> =>
  apiClient.patch(`/tasks/${id}/wp`, { wpId }).then((r) => r.data);

// ─── Single task ───────────────────────────────────────────────────────────────

export const getTaskById = (id: number): Promise<TaskEnriched> =>
  apiClient.get(`/tasks/${id}`).then((r) => r.data);

// Every finding this task is connected to — whether it raised it (source), is a
// follow-up of it (parent), or a CAPA action on it links here. Drives the
// back-to-finding link on the task page + quick-view drawer (covers CAPA-only
// tasks that have no parentFinding and aren't a source).
export interface RelatedFinding {
  id: number;
  status: FindingStatus;
  severity: FindingSeverity | null;
  description: string;
}

export const getRelatedFindings = (id: number): Promise<RelatedFinding[]> =>
  apiClient.get(`/tasks/${id}/related-findings`).then((r) => r.data);

// ─── Create ────────────────────────────────────────────────────────────────────

export interface CreateTaskPayload {
  templateId: number;
  targetDivisionId: number;
  assignedToUserId?: number;
  deadline?: string;
  estimatedHours?: number;
  skillLevel?: number;
  requiresApproval?: boolean;
  wpId?: number;
  issuanceNote?: string;
  title?: string;
}

export const createTask = (payload: CreateTaskPayload): Promise<TaskEnriched> =>
  apiClient.post('/tasks', payload).then((r) => r.data);

export interface QuickTaskPayload {
  title: string;
  issuanceNote?: string;
  assignedToUserId?: number;
  deadline?: string;
  estimatedHours?: number;
  skillLevel?: number;
  requiresApproval?: boolean;
}

export const createQuickTask = (payload: QuickTaskPayload): Promise<TaskEnriched> =>
  apiClient.post('/tasks/quick', payload).then((r) => r.data);

// ─── Assignment ────────────────────────────────────────────────────────────────

export const selfAssignTask = (id: number): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/self-assign`).then((r) => r.data);

export const assignTask = (id: number, assignedToUserId: number): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/assign`, { assignedToUserId }).then((r) => r.data);

export const reassignTask = (
  id: number,
  payload: { assignedToUserId: number; reason: string }
): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/reassign`, payload).then((r) => r.data);

export const transferIssuerRights = (
  id: number,
  newIssuerId: number
): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/transfer-issuer`, { newIssuerId }).then((r) => r.data);

// ─── Task execution ────────────────────────────────────────────────────────────

export const saveTaskData = (
  id: number,
  data: Record<string, unknown>
): Promise<{ message: string; status: string }> =>
  apiClient.put(`/tasks/${id}/data`, { data }).then((r) => r.data);

export const submitTask = (id: number): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/submit`).then((r) => r.data);

// ─── Review workflow ───────────────────────────────────────────────────────────

export const reviewTask = (
  id: number,
  action: ReviewAction,
  comment?: string
): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/review`, { action, comment }).then((r) => r.data);

export const postRejectionAction = (
  id: number,
  action: 'terminate' | 'reassign',
  payload?: { assignedToUserId?: number; reason?: string }
): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/post-rejection`, { action, ...payload }).then((r) => r.data);

// ─── Lifecycle management ──────────────────────────────────────────────────────

export const inactivateTask = (id: number, reason: string): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/inactive`, { reason }).then((r) => r.data);

export const reactivateTask = (id: number): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/reactivate`).then((r) => r.data);

// Admin/Director re-opens a Closed task (back to Assigned/Unassigned).
export const reopenTask = (id: number, reason: string): Promise<TaskEnriched> =>
  apiClient.patch(`/tasks/${id}/reopen`, { reason }).then((r) => r.data);

// ─── Deadline management ───────────────────────────────────────────────────────

export const setDeadline = (id: number, deadline: string): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/deadline`, { deadline }).then((r) => r.data);

export const requestDeadlineExtension = (
  id: number,
  reason: string
): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/deadline/request`, { reason }).then((r) => r.data);

export const decideDeadlineExtension = (
  id: number,
  extensionIndex: number,
  decision: DeadlineDecision,
  newDeadline?: string
): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/deadline/decide`, { extensionIndex, decision, newDeadline }).then((r) => r.data);

// ─── Rating ────────────────────────────────────────────────────────────────────

export const rateTask = (id: number, rating: number): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/rate`, { rating }).then((r) => r.data);

// ─── Activity feed ─────────────────────────────────────────────────────────────

// Backward-compatible: returns the NEWEST page (ascending) as an array. The task
// activity feed is keyset-paginated (H2); the cursor for older entries rides the
// X-Next-Cursor header — use getTaskActivityPage when you need to page back.
export const getTaskActivity = (id: number): Promise<TaskActivityEnriched[]> =>
  apiClient.get(`/tasks/${id}/activity`).then((r) => r.data);

export interface TaskActivityPage {
  activities: TaskActivityEnriched[];
  nextCursor: number | null;
}

export const getTaskActivityPage = (
  id: number,
  opts: { limit?: number; before?: number | null; types?: string[]; includeHidden?: boolean } = {}
): Promise<TaskActivityPage> => {
  const params: Record<string, string> = {};
  if (opts.limit != null) params.limit = String(opts.limit);
  if (opts.before != null) params.before = String(opts.before);
  if (opts.types && opts.types.length) params.types = opts.types.join(',');
  if (opts.includeHidden) params.includeHidden = 'true';
  return apiClient.get(`/tasks/${id}/activity`, { params }).then((r) => ({
    activities: r.data as TaskActivityEnriched[],
    nextCursor: r.headers['x-next-cursor'] ? Number(r.headers['x-next-cursor']) : null,
  }));
};

export const postTaskComment = (
  id: number,
  content: string,
  mentionUserIds?: number[]
): Promise<TaskActivityEnriched> =>
  apiClient
    .post(`/tasks/${id}/activity`, { content, ...(mentionUserIds?.length ? { mentionUserIds } : {}) })
    .then((r) => r.data);

// ─── Time Booking (Phase 5.6) ─────────────────────────────────────────────────

export interface TimeBookingPayload {
  assigneeEntry: TimeBookingEntry;
  collaborators: TimeBookingEntry[];
}

export const createTimeBooking = (
  id: number,
  payload: TimeBookingPayload
): Promise<TimeBooking> =>
  apiClient.post(`/tasks/${id}/time-booking`, payload).then((r) => r.data);

export const updateTimeBooking = (
  id: number,
  payload: TimeBookingPayload
): Promise<TimeBooking> =>
  apiClient.put(`/tasks/${id}/time-booking`, payload).then((r) => r.data);

// ─── Time Entries (Phase 6.1) ──────────────────────────────────────────────────

export const createTimeEntry = (taskId: number, payload: object): Promise<TimeEntry> =>
  apiClient.post(`/tasks/${taskId}/time-entries`, payload).then((r) => r.data);

export const getTimeEntries = (taskId: number): Promise<TimeEntry[]> =>
  apiClient.get(`/tasks/${taskId}/time-entries`).then((r) => r.data);

export const getTimeEntrySummary = (taskId: number): Promise<TimeEntrySummary> =>
  apiClient.get(`/tasks/${taskId}/time-entries/summary`).then((r) => r.data);

// ─── Analytics (Phase 7) ───────────────────────────────────────────────────────

export interface TemplateEfficiencyRow {
  templateId: number;
  templateCode: string;
  title: string;
  taskCount: number;
  avgActualHours: number | null;
  estimatedHours: number | null;
  efficiencyRatio: number | null;
  overBudgetCount: number;
  topOverBudgetReason: string | null;
}

export interface StaffPerformanceRow {
  userId: number;
  name: string;
  avgRating: number | null;
  ratedTaskCount: number;
  avgEfficiencyRatio: number | null;
}

export interface TimeBookingAnalytics {
  templates: TemplateEfficiencyRow[];
  staff: StaffPerformanceRow[];
  incompleteBookings: number;
}

export const getTimeBookingAnalytics = async (params?: {
  templateId?: number;
  divisionId?: number;
  from?: string;
  to?: string;
}): Promise<TimeBookingAnalytics> =>
  apiClient.get('/analytics/time-booking', { params }).then((r) => r.data);

// ─── Findings analytics ──────────────────────────────────────────────────────

export interface CountBucket {
  key: string;
  count: number;
}

export interface DepartmentBucket {
  id: number;
  name: string;
  count: number;
}

export interface AtaChapterBucket {
  id: number;
  code: string;
  title: string;
  count: number;
}

export interface MonthBucket {
  month: string; // YYYY-MM
  count: number;
}

export interface FindingsAnalytics {
  totalCount: number;
  openCount: number;
  closedCount: number;
  dismissedCount: number;
  avgDaysToClose: number | null;
  bySeverity: CountBucket[];
  byStatus: CountBucket[];
  byEventType: CountBucket[];
  byDepartment: DepartmentBucket[];
  byAtaChapter: AtaChapterBucket[];
  byMonth: MonthBucket[];
}

export const getFindingsAnalytics = async (params?: {
  divisionId?: number;
  departmentId?: number;
  severity?: string;
  eventType?: string;
  from?: string;
  to?: string;
}): Promise<FindingsAnalytics> =>
  apiClient.get('/analytics/findings', { params }).then((r) => r.data);

// ─── Datasources (used in create form) ────────────────────────────────────────

export const getDivisions = (): Promise<{ value: string; label: string }[]> =>
  apiClient.get('/datasources/divisions').then((r) => r.data);

export const getUsers = (): Promise<{ value: string; label: string; divisionId: number | null }[]> =>
  apiClient.get('/datasources/users').then((r) => r.data);

export const getDatasource = (
  source: string,
  params?: { q?: string; limit?: number; divisionId?: number }
): Promise<{ value: string; label: string; divisionId?: number | null }[]> =>
  apiClient.get(`/datasources/${source}`, { params }).then((r) => r.data);
