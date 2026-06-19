import { apiClient } from './client';
import { Template } from '../types';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
export interface TemplateSearchParams {
  q?: string;
  type?: string;
  divisionId?: number;
  status?: string;
  page?: number;
  limit?: number;
}

export interface TemplateSearchResult {
  data: Template[];
  total: number;
  page: number;
  limit: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// API functions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Server-side paginated template search with optional filters.
 * Used by TemplatePickerModal.
 */
export const searchTemplates = (
  params: TemplateSearchParams = {}
): Promise<TemplateSearchResult> =>
  apiClient.get('/templates', { params }).then((r) => r.data as TemplateSearchResult);

/**
 * Backward-compat helper — fetches all published templates in one call.
 * Kept for existing consumers that expect a flat Template[]; migrate them to
 * searchTemplates() over time.
 * @deprecated Use searchTemplates() for new code.
 */
export const getPublishedTemplates = (): Promise<Template[]> =>
  searchTemplates({ status: 'Published', limit: 200 }).then((r) => r.data);
