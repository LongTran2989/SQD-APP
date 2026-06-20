import { apiClient } from './client';
import { TemplateSet } from '../types';

// Item payload sent on create/update (id-less; the set owns ordering).
export interface TemplateSetItemPayload {
  templateId: number;
  orderIndex?: number;
  deadlineOffsetDays?: number | null;
  estimatedHours?: number | null;
  skillLevel?: number | null;
  requiresApproval?: boolean | null;
  defaultNote?: string | null;
}

export interface CreateTemplateSetPayload {
  name: string;
  description?: string | null;
  divisionId: number;
  items: TemplateSetItemPayload[];
}

export interface UpdateTemplateSetPayload {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  items?: TemplateSetItemPayload[];
}

export const getTemplateSets = (params?: { activeOnly?: boolean; divisionId?: number }): Promise<TemplateSet[]> => {
  const q = new URLSearchParams();
  if (params?.activeOnly) q.set('activeOnly', 'true');
  if (params?.divisionId) q.set('divisionId', String(params.divisionId));
  const qs = q.toString();
  return apiClient.get(`/template-sets${qs ? `?${qs}` : ''}`).then((r) => r.data);
};

export const getTemplateSet = (id: number): Promise<TemplateSet> =>
  apiClient.get(`/template-sets/${id}`).then((r) => r.data);

export const createTemplateSet = (payload: CreateTemplateSetPayload): Promise<TemplateSet> =>
  apiClient.post('/template-sets', payload).then((r) => r.data);

export const updateTemplateSet = (id: number, payload: UpdateTemplateSetPayload): Promise<TemplateSet> =>
  apiClient.put(`/template-sets/${id}`, payload).then((r) => r.data);

export const disableTemplateSet = (id: number): Promise<TemplateSet> =>
  apiClient.delete(`/template-sets/${id}`).then((r) => r.data);
