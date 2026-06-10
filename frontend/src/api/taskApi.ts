import { apiClient } from './client';
import { TaskEnriched, TaskActivityEnriched, TimeBooking, TimeBookingEntry, TimeEntry, TimeEntrySummary } from '../types';

// ─── List endpoints ────────────────────────────────────────────────────────────

export const getTasks = (): Promise<TaskEnriched[]> =>
  apiClient.get('/tasks').then((r) => r.data);

export const getMyTasks = (): Promise<TaskEnriched[]> =>
  apiClient.get('/tasks/my-tasks').then((r) => r.data);

export const getUnassignedTasks = (): Promise<TaskEnriched[]> =>
  apiClient.get('/tasks/unassigned').then((r) => r.data);

// ─── Single task ───────────────────────────────────────────────────────────────

export const getTaskById = (id: number): Promise<TaskEnriched> =>
  apiClient.get(`/tasks/${id}`).then((r) => r.data);

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
}

export const createTask = (payload: CreateTaskPayload): Promise<TaskEnriched> =>
  apiClient.post('/tasks', payload).then((r) => r.data);

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
  action: 'approve' | 'reject' | 'follow-up',
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
  decision: 'approved' | 'denied',
  newDeadline?: string
): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/deadline/decide`, { extensionIndex, decision, newDeadline }).then((r) => r.data);

// ─── Rating ────────────────────────────────────────────────────────────────────

export const rateTask = (id: number, rating: number): Promise<TaskEnriched> =>
  apiClient.put(`/tasks/${id}/rate`, { rating }).then((r) => r.data);

// ─── Activity feed ─────────────────────────────────────────────────────────────

export const getTaskActivity = (id: number): Promise<TaskActivityEnriched[]> =>
  apiClient.get(`/tasks/${id}/activity`).then((r) => r.data);

export const postTaskComment = (
  id: number,
  content: string
): Promise<TaskActivityEnriched> =>
  apiClient.post(`/tasks/${id}/activity`, { content }).then((r) => r.data);

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

// ─── Datasources (used in create form) ────────────────────────────────────────

export const getDivisions = (): Promise<{ value: string; label: string }[]> =>
  apiClient.get('/datasources/divisions').then((r) => r.data);

export const getUsers = (): Promise<{ value: string; label: string; divisionId: number | null }[]> =>
  apiClient.get('/datasources/users').then((r) => r.data);

export const getDatasource = (
  source: string
): Promise<{ value: string; label: string }[]> =>
  apiClient.get(`/datasources/${source}`).then((r) => r.data);
