import { apiClient } from './client';
import { WorkPackageEnriched, WorkPackageDetail, WpType } from '../types';

// ─── List & Detail ────────────────────────────────────────────────────────────

export const getWorkPackages = (): Promise<WorkPackageEnriched[]> =>
  apiClient.get('/work-packages').then((r) => r.data);

export const getWorkPackageById = (id: number): Promise<WorkPackageDetail> =>
  apiClient.get(`/work-packages/${id}`).then((r) => r.data);

// ─── Types ────────────────────────────────────────────────────────────────────

export const getWpTypes = (): Promise<WpType[]> =>
  apiClient.get('/taxonomy/wp-types').then((r) => r.data);

export const createWpType = (code: string, description?: string): Promise<WpType> =>
  apiClient.post('/taxonomy/wp-types', { code, description }).then((r) => r.data);

// ─── CRUD ─────────────────────────────────────────────────────────────────────

// Auto-generate config accepted by both create and update.
export interface AutoGenPayload {
  autoGenerate?: boolean;
  autoGenMode?: 'SINGLE_SHOT' | 'REPEAT' | null;
  autoGenInterval?: number | null;
  autoGenTemplateId?: number | null;
  autoGenSetId?: number | null;
  autoGenInlineSet?: unknown;
}

export interface CreateWpPayload extends AutoGenPayload {
  name: string;
  type: string;
  divisionId: number;
  timeframeFrom: string;
  timeframeTo: string;
  acRegistration?: string | null;
  customer?: string | null;
  authority?: string | null;
  targetDepartmentId?: number | null;
}

export const createWorkPackage = (payload: CreateWpPayload): Promise<WorkPackageDetail> =>
  apiClient.post('/work-packages', payload).then((r) => r.data);

export interface UpdateWpPayload extends AutoGenPayload {
  name?: string;
  timeframeFrom?: string;
  timeframeTo?: string;
  acRegistration?: string | null;
  customer?: string | null;
  authority?: string | null;
  targetDepartmentId?: number | null;
}

export const updateWorkPackage = (id: number, payload: UpdateWpPayload): Promise<WorkPackageDetail> =>
  apiClient.put(`/work-packages/${id}`, payload).then((r) => r.data);

// ─── Status ───────────────────────────────────────────────────────────────────

export const updateWpStatus = (
  id: number,
  status: 'Closed' | 'Inactive' | 'Open',
  reason?: string
): Promise<WorkPackageDetail> =>
  apiClient.put(`/work-packages/${id}/status`, { status, reason }).then((r) => r.data);

// ─── Assignments ──────────────────────────────────────────────────────────────

export const assignUserToWp = (wpId: number, userId: number) =>
  apiClient.post(`/work-packages/${wpId}/assign`, { userId }).then((r) => r.data);

export const removeUserFromWp = (wpId: number, userId: number) =>
  apiClient.delete(`/work-packages/${wpId}/assign/${userId}`).then((r) => r.data);
