import { apiClient } from './client';

export interface ShiftType {
  id: number;
  code: string;
  name: string;
  groupCode: string | null;
  groupName: string | null;
  color: string;
  startTime: string | null;
  endTime: string | null;
  isWorkDay: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface ScheduleEntry {
  id: number;
  userId: number;
  divisionId: number;
  date: string;
  slotIndex: number;
  shiftTypeId: number;
  shiftType: ShiftType;
  note: string | null;
  publishedAt: string | null;
  publishedBy: number | null;
}

export interface ScheduleTask {
  id: number;
  taskId: string;
  title: string;
  status: string;
  assignedToUserId: number | null;
  deadline: string | null;
  assignedAt: string | null;
  startDate: string | null;
  wpId: number | null;
  wp: { wpId: string; name: string } | null;
}

export interface WpBannerItem {
  id: number;
  userId: number;
  wpId: number;
  wp: {
    id: number;
    wpId: string;
    name: string;
    timeframeFrom: string | null;
    timeframeTo: string | null;
  };
}

export interface ScheduleLock {
  locked: boolean;
  lockedByUserId?: number;
  lockExpiresAt?: string;
  isExpired?: boolean;
  heldByMe?: boolean;
}

export interface ScheduleData {
  entries: ScheduleEntry[];
  tasks: ScheduleTask[];
  wpAssignments: WpBannerItem[];
  lock: ScheduleLock | null;
}

export interface WorkloadData {
  tasks: Array<{
    id: number;
    taskId: string;
    title: string;
    status: string;
    deadline: string | null;
    assignedAt: string | null;
    startDate: string | null;
  }>;
  openCount: number;
}

export interface SchedulePattern {
  id: number;
  name: string;
  divisionId: number | null;
  weekTemplate: Record<string, number>;
  createdByUserId: number;
  isActive: boolean;
}

export const getSchedule = (
  divisionId: number,
  dateFrom: string,
  dateTo: string
): Promise<ScheduleData> =>
  apiClient.get(`/schedules/${divisionId}`, { params: { dateFrom, dateTo } }).then((r) => r.data);

export const upsertEntries = (
  divisionId: number,
  entries: Array<{
    userId: number;
    date: string;
    slotIndex?: number;
    shiftTypeId: number;
    note?: string;
  }>
): Promise<{ created: number; entries: ScheduleEntry[] }> =>
  apiClient.put(`/schedules/${divisionId}/entries`, { entries }).then((r) => r.data);

export const deleteEntry = (divisionId: number, entryId: number): Promise<{ message: string }> =>
  apiClient.delete(`/schedules/${divisionId}/entries/${entryId}`).then((r) => r.data);

export const publishSchedule = (
  divisionId: number,
  note?: string
): Promise<{ published: number; dateFrom: string | null; dateTo: string | null; conflicts: number }> =>
  apiClient.post(`/schedules/${divisionId}/publish`, { note }).then((r) => r.data);

export const getLock = (divisionId: number): Promise<ScheduleLock> =>
  apiClient.get(`/schedules/${divisionId}/lock`).then((r) => r.data);

export const acquireLock = (divisionId: number): Promise<{ locked: boolean; lockExpiresAt: string }> =>
  apiClient.post(`/schedules/${divisionId}/lock`).then((r) => r.data);

export const releaseLock = (divisionId: number): Promise<{ message: string }> =>
  apiClient.delete(`/schedules/${divisionId}/lock`).then((r) => r.data);

export const takeoverLock = (divisionId: number): Promise<{ locked: boolean; lockExpiresAt: string }> =>
  apiClient.post(`/schedules/${divisionId}/lock/takeover`).then((r) => r.data);

export const conflictCheck = (
  userId: number,
  date: string
): Promise<{
  entry: {
    shiftTypeCode: string;
    shiftTypeName: string;
    isWorkDay: boolean;
    isDraft: boolean;
  } | null;
}> =>
  apiClient.get('/schedules/conflict-check', { params: { userId, date } }).then((r) => r.data);

export const copyWeek = (
  divisionId: number,
  sourceFrom: string,
  sourceTo: string
): Promise<{ copied: number }> =>
  apiClient
    .post(`/schedules/${divisionId}/copy-week`, { sourceFrom, sourceTo })
    .then((r) => r.data);

export const listPatterns = (): Promise<SchedulePattern[]> =>
  apiClient.get('/schedules/patterns').then((r) => r.data);

export const createPattern = (payload: {
  name: string;
  weekTemplate: Record<string, number>;
  isGlobal?: boolean;
}): Promise<SchedulePattern> =>
  apiClient.post('/schedules/patterns', payload).then((r) => r.data);

export const applyPattern = (
  divisionId: number,
  patternId: number,
  payload: { userIds: number[]; dateFrom: string; dateTo: string }
): Promise<{ applied: number }> =>
  apiClient
    .post(`/schedules/${divisionId}/patterns/${patternId}/apply`, payload)
    .then((r) => r.data);

export const getWorkload = (userId: number): Promise<WorkloadData> =>
  apiClient.get(`/schedules/workload/${userId}`).then((r) => r.data);
