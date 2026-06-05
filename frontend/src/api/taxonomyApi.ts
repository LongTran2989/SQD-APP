import { apiClient } from './client';
import { AtaChapter, CauseCode, HazardTag } from '../types';

// ─── Reads (any authenticated user — used by pickers) ─────────────────────────

export const listAtaChapters = (activeOnly = true): Promise<AtaChapter[]> =>
  apiClient.get('/taxonomy/ata-chapters', { params: { activeOnly } }).then((r) => r.data);

export const listCauseCodes = (activeOnly = true): Promise<CauseCode[]> =>
  apiClient.get('/taxonomy/cause-codes', { params: { activeOnly } }).then((r) => r.data);

export const listHazardTags = (activeOnly = true): Promise<HazardTag[]> =>
  apiClient.get('/taxonomy/hazard-tags', { params: { activeOnly } }).then((r) => r.data);

// ─── Admin/Director management ────────────────────────────────────────────────

export const createAtaChapter = (payload: { code: string; title: string }): Promise<AtaChapter> =>
  apiClient.post('/taxonomy/ata-chapters', payload).then((r) => r.data);

export const createCauseCode = (payload: { code: string; name: string; groupCode: string; groupName: string }): Promise<CauseCode> =>
  apiClient.post('/taxonomy/cause-codes', payload).then((r) => r.data);

export const createHazardTag = (payload: { label: string; description?: string }): Promise<HazardTag> =>
  apiClient.post('/taxonomy/hazard-tags', payload).then((r) => r.data);
