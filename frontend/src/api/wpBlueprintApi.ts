import { apiClient } from './client';
import { WpBlueprint, WorkPackageDetail } from '../types';

export interface WpBlueprintPayload {
  name: string;
  description?: string | null;
  type: string;
  divisionId: number;
  defaultDuration: number;
  acRegistration?: string | null;
  customer?: string | null;
  authority?: string | null;
  targetDepartmentId?: number | null;
  defaultAutoGenerate?: boolean;
  defaultAutoGenMode?: 'SINGLE_SHOT' | 'REPEAT' | null;
  defaultAutoGenInterval?: number | null;
  defaultAutoGenTemplateId?: number | null;
  defaultAutoGenSetId?: number | null;
  recurrenceType?: 'CALENDAR' | 'LAST_DONE' | null;
  recurrenceInterval?: number | null;
  recurrenceStartDate?: string | null;
}

export type UpdateWpBlueprintPayload = Partial<WpBlueprintPayload> & { isActive?: boolean };

export interface LaunchBlueprintPayload {
  name?: string;
  timeframeFrom?: string;
  timeframeTo?: string;
}

export const getWpBlueprints = (params?: { activeOnly?: boolean; divisionId?: number }): Promise<WpBlueprint[]> => {
  const q = new URLSearchParams();
  if (params?.activeOnly) q.set('activeOnly', 'true');
  if (params?.divisionId) q.set('divisionId', String(params.divisionId));
  const qs = q.toString();
  return apiClient.get(`/wp-blueprints${qs ? `?${qs}` : ''}`).then((r) => r.data);
};

export const getWpBlueprint = (id: number): Promise<WpBlueprint> =>
  apiClient.get(`/wp-blueprints/${id}`).then((r) => r.data);

export const createWpBlueprint = (payload: WpBlueprintPayload): Promise<WpBlueprint> =>
  apiClient.post('/wp-blueprints', payload).then((r) => r.data);

export const updateWpBlueprint = (id: number, payload: UpdateWpBlueprintPayload): Promise<WpBlueprint> =>
  apiClient.put(`/wp-blueprints/${id}`, payload).then((r) => r.data);

export const disableWpBlueprint = (id: number): Promise<WpBlueprint> =>
  apiClient.delete(`/wp-blueprints/${id}`).then((r) => r.data);

export const launchBlueprint = (id: number, payload: LaunchBlueprintPayload): Promise<WorkPackageDetail> =>
  apiClient.post(`/wp-blueprints/${id}/launch`, payload).then((r) => r.data);
