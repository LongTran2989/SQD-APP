import { apiClient } from './client';
import { FeedScope, FeedPostEnriched } from '../types';

// ORG is the singleton feed (no scopeId); the other scopes take a polymorphic
// scopeId (taskId / wpId / divisionId).
const feedPath = (scope: FeedScope, scopeId?: number | null): string =>
  scope === 'ORG' ? '/feeds/ORG' : `/feeds/${scope}/${scopeId}`;

export const getFeed = (scope: FeedScope, scopeId?: number | null): Promise<FeedPostEnriched[]> =>
  apiClient.get(feedPath(scope, scopeId)).then((r) => r.data);

export const postFeedComment = (
  scope: FeedScope,
  scopeId: number | null | undefined,
  content: string
): Promise<FeedPostEnriched> =>
  apiClient.post(`${feedPath(scope, scopeId)}/posts`, { content }).then((r) => r.data);

/**
 * Client-side mirror of the backend feed posting RBAC (feedService.canPostToFeed)
 * — used only to hide the composer when the user can't post. The backend remains
 * the source of truth and re-checks on every POST.
 */
export const canPostToFeed = (
  role: string,
  userDivisionId: number | null,
  scope: FeedScope,
  scopeId?: number | null
): boolean => {
  const isDirectorOrAdmin = role === 'Director' || role === 'Admin';
  switch (scope) {
    case 'TASK':
    case 'WP':
      return true;
    case 'DIVISION':
      return isDirectorOrAdmin || scopeId === userDivisionId;
    case 'ORG':
      return isDirectorOrAdmin || role === 'Manager';
    default:
      return false;
  }
};
