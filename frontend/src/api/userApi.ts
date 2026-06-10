import { apiClient } from './client';
import { UserPreferences } from '../types';

// Deep-merges an allowlisted subset of UI state into the caller's own preferences.
export const updateMyPreferences = (preferences: UserPreferences): Promise<{ preferences: UserPreferences }> =>
  apiClient.patch('/users/me/preferences', { preferences }).then((r) => r.data);
