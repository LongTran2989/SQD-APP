import { apiClient } from './client';
import {
  Finding,
  FindingDetail,
  FindingsListResponse,
  FindingListItem,
  FindingSeverity,
} from '../types';

// ─── List & detail ──────────────────────────────────────────────────────────

export interface FindingListParams {
  status?: string;
  severity?: string;
  divisionId?: number;
  reportedBy?: number;
  taskId?: number;
  page?: number;
  pageSize?: number;
}

export const listFindings = (params: FindingListParams = {}): Promise<FindingsListResponse> =>
  apiClient.get('/findings', { params }).then((r) => r.data);

export const getFindingById = (id: number): Promise<FindingDetail> =>
  apiClient.get(`/findings/${id}`).then((r) => r.data);

// All findings raised on a given source task (used by the Task detail page).
export const getFindingsByTask = (taskId: number): Promise<FindingListItem[]> =>
  apiClient.get('/findings', { params: { taskId, pageSize: 100 } }).then((r) => r.data.findings);

// ─── Create (raise) ─────────────────────────────────────────────────────────

export interface RaiseFindingPayload {
  taskId: number;
  eventType: string;
  departmentId: number;
  description: string;
  aircraftRegistration?: string;
  regulatoryReference?: string;
  fieldId?: string;
}

export const raiseFinding = (payload: RaiseFindingPayload): Promise<Finding> =>
  apiClient.post('/findings', payload).then((r) => r.data);

// ─── Review ───────────────────────────────────────────────────────────────────

export const reviewFinding = (
  id: number,
  payload: { severity: FindingSeverity; dueDate?: string }
): Promise<Finding> =>
  apiClient.put(`/findings/${id}/review`, payload).then((r) => r.data);

// ─── Follow-up task generation ──────────────────────────────────────────────

export interface FollowUpTaskInput {
  templateId: number;
  title: string;
  wpId?: number;
  createNewWp?: boolean;
  newWpName?: string;
}

export const generateFollowUpTasks = (
  id: number,
  tasks: FollowUpTaskInput[]
): Promise<{ findingId: number; createdTasks: { id: number; taskId: string }[] }> =>
  apiClient.post(`/findings/${id}/tasks`, { tasks }).then((r) => r.data);

// ─── Stage 2 + close ──────────────────────────────────────────────────────────

export interface Stage2Payload {
  errorCode?: string;
  rootCause?: string;
  correctiveAction?: string;
  recurrence?: boolean;
  violatorIds?: unknown;
}

export const completeStage2 = (id: number, payload: Stage2Payload): Promise<Finding> =>
  apiClient.put(`/findings/${id}/stage2`, payload).then((r) => r.data);

export const closeFinding = (id: number): Promise<Finding> =>
  apiClient.put(`/findings/${id}/close`).then((r) => r.data);
