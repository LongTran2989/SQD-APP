import { apiClient } from './client';
import { Template } from '../types';

// Fetches templates and narrows to Published ones — the only templates a new Task
// (or an escalation→Create Task) may be created from. Centralised so the
// GET /templates + Published filter lives in one place (was duplicated in the
// new-task page and the escalation action modal).
export const getPublishedTemplates = (): Promise<Template[]> =>
  apiClient.get('/templates').then((r) => (r.data as Template[]).filter((t) => t.status === 'Published'));
