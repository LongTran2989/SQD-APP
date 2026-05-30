import { apiClient } from './client';
import { WorkPackageEnriched, WorkPackageDetail, WpType } from '../types';

// ─── List & Detail ────────────────────────────────────────────────────────────

export const getWorkPackages = (): Promise<WorkPackageEnriched[]> =>
  apiClient.get('/work-packages').then((r) => r.data);

export const getWorkPackageById = (id: number): Promise<WorkPackageDetail> =>
  apiClient.get(`/work-packages/${id}`).then((r) => r.data);

// ─── Types ────────────────────────────────────────────────────────────────────

export const getWpTypes = (): Promise<WpType[]> =>
  apiClient.get('/work-packages/types').then((r) => r.data);

export const createWpType = (code: string, description?: string): Promise<WpType> =>
  apiClient.post('/work-packages/types', { code, description }).then((r) => r.data);

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateWpPayload {
  name: string;
  type: string;
  divisionId: number;
  timeframeFrom: string;
  timeframeTo: string;
  checkTemplateId?: number;
}

export const createWorkPackage = (payload: CreateWpPayload): Promise<WorkPackageDetail> =>
  apiClient.post('/work-packages', payload).then((r) => r.data);

export interface UpdateWpPayload {
  name?: string;
  timeframeFrom?: string;
  timeframeTo?: string;
  checkTemplateId?: number | null;
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
