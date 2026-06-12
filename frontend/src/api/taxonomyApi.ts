import { apiClient } from './client';
import { AtaChapter, CauseCode, HazardTag, EventType, WpType } from '../types';

// ─── Reads (any authenticated user — used by pickers) ─────────────────────────

export const listAtaChapters = (activeOnly = true): Promise<AtaChapter[]> =>
  apiClient.get('/taxonomy/ata-chapters', { params: { activeOnly } }).then((r) => r.data);

export const listCauseCodes = (activeOnly = true): Promise<CauseCode[]> =>
  apiClient.get('/taxonomy/cause-codes', { params: { activeOnly } }).then((r) => r.data);

export const listHazardTags = (activeOnly = true): Promise<HazardTag[]> =>
  apiClient.get('/taxonomy/hazard-tags', { params: { activeOnly } }).then((r) => r.data);

export const listEventTypes = (activeOnly = true): Promise<EventType[]> =>
  apiClient.get('/taxonomy/event-types', { params: { activeOnly } }).then((r) => r.data);

export const listWpTypes = (activeOnly = false): Promise<WpType[]> =>
  apiClient.get('/taxonomy/wp-types', { params: { activeOnly } }).then((r) => r.data);

// ─── Admin/Director management — create ───────────────────────────────────────

export const createAtaChapter = (payload: { code: string; title: string }): Promise<AtaChapter> =>
  apiClient.post('/taxonomy/ata-chapters', payload).then((r) => r.data);

export const createCauseCode = (payload: { code: string; name: string; groupCode: string; groupName: string }): Promise<CauseCode> =>
  apiClient.post('/taxonomy/cause-codes', payload).then((r) => r.data);

export const createHazardTag = (payload: { label: string; description?: string }): Promise<HazardTag> =>
  apiClient.post('/taxonomy/hazard-tags', payload).then((r) => r.data);

export const createEventType = (payload: { code: string; description?: string }): Promise<EventType> =>
  apiClient.post('/taxonomy/event-types', payload).then((r) => r.data);

export const createWpType = (payload: { code: string; description?: string }): Promise<WpType> =>
  apiClient.post('/taxonomy/wp-types', payload).then((r) => r.data);

// ─── Admin/Director management — update (incl. isActive toggle) ───────────────

export const updateAtaChapter = (id: number, payload: Partial<{ code: string; title: string; isActive: boolean }>): Promise<AtaChapter> =>
  apiClient.put(`/taxonomy/ata-chapters/${id}`, payload).then((r) => r.data);

export const updateCauseCode = (id: number, payload: Partial<{ code: string; name: string; groupCode: string; groupName: string; isActive: boolean }>): Promise<CauseCode> =>
  apiClient.put(`/taxonomy/cause-codes/${id}`, payload).then((r) => r.data);

export const updateHazardTag = (id: number, payload: Partial<{ label: string; description: string; isActive: boolean }>): Promise<HazardTag> =>
  apiClient.put(`/taxonomy/hazard-tags/${id}`, payload).then((r) => r.data);

export const updateEventType = (id: number, payload: Partial<{ code: string; description: string; isActive: boolean }>): Promise<EventType> =>
  apiClient.put(`/taxonomy/event-types/${id}`, payload).then((r) => r.data);

export const updateWpType = (id: number, payload: Partial<{ code: string; description: string; isActive: boolean }>): Promise<WpType> =>
  apiClient.put(`/taxonomy/wp-types/${id}`, payload).then((r) => r.data);
