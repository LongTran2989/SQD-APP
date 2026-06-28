import { apiClient } from './client';
import { FeedScope, FeedPostEnriched, FeedPostType } from '../types';

// ORG is the singleton feed (no scopeId); the other scopes take a polymorphic
// scopeId (taskId / wpId / divisionId).
const feedPath = (scope: FeedScope, scopeId?: number | null): string =>
  scope === 'ORG' ? '/feeds/ORG' : `/feeds/${scope}/${scopeId}`;

// Reads return the NEWEST page (ascending for chat-style render); the keyset
// cursor for loading older posts rides the X-Next-Cursor response header (H2).
export interface FeedQueryOptions {
  limit?: number;
  before?: number | null; // page strictly older than this post id
  types?: FeedPostType[];
  includeHidden?: boolean; // Director/Admin only — include soft-hidden comments
}

export interface FeedPage {
  posts: FeedPostEnriched[];
  nextCursor: number | null; // pass back as `before` to load the previous page; null = start of feed
}

const buildFeedParams = (opts: FeedQueryOptions): Record<string, string> => {
  const params: Record<string, string> = {};
  if (opts.limit != null) params.limit = String(opts.limit);
  if (opts.before != null) params.before = String(opts.before);
  if (opts.types && opts.types.length) params.types = opts.types.join(',');
  if (opts.includeHidden) params.includeHidden = 'true';
  return params;
};

// Backward-compatible: still returns the (newest) page as a plain array. Used by
// lightweight callers (quickview previews) that don't paginate.
export const getFeed = (scope: FeedScope, scopeId?: number | null): Promise<FeedPostEnriched[]> =>
  apiClient.get(feedPath(scope, scopeId)).then((r) => r.data);

// Paginating callers: returns the page plus the next cursor read from the header.
export const getFeedPage = (
  scope: FeedScope,
  scopeId: number | null | undefined,
  opts: FeedQueryOptions = {}
): Promise<FeedPage> =>
  apiClient.get(feedPath(scope, scopeId), { params: buildFeedParams(opts) }).then((r) => ({
    posts: r.data as FeedPostEnriched[],
    nextCursor: r.headers['x-next-cursor'] ? Number(r.headers['x-next-cursor']) : null,
  }));

// ─── Moderation (Phase D) ─────────────────────────────────────────────────────

const pinnedPath = (scope: FeedScope, scopeId?: number | null): string =>
  scope === 'ORG' ? '/feeds/pinned/ORG' : `/feeds/pinned/${scope}/${scopeId}`;

// Pinned comments for a WP / Division / Org feed (TASK / FINDING → always empty).
export const getPinnedFeed = (scope: FeedScope, scopeId?: number | null): Promise<FeedPostEnriched[]> =>
  apiClient.get(pinnedPath(scope, scopeId)).then((r) => r.data);

// Director/Admin only. reason is optional.
export const hidePost = (postId: number, reason?: string): Promise<void> =>
  apiClient.post(`/feeds/posts/${postId}/hide`, reason ? { reason } : {}).then(() => undefined);

export const unhidePost = (postId: number): Promise<void> =>
  apiClient.post(`/feeds/posts/${postId}/unhide`, {}).then(() => undefined);

// Scope-gated (mirrors posting rights); WP / Division / Org comments only.
export const pinPost = (postId: number): Promise<void> =>
  apiClient.post(`/feeds/posts/${postId}/pin`, {}).then(() => undefined);

export const unpinPost = (postId: number): Promise<void> =>
  apiClient.post(`/feeds/posts/${postId}/unpin`, {}).then(() => undefined);

// Acknowledge ("I have read this") a comment — idempotent (Phase G).
export const ackPost = (postId: number): Promise<{ id: number; acknowledged: boolean; ackCount: number }> =>
  apiClient.post(`/feeds/posts/${postId}/ack`, {}).then((r) => r.data);

export const postFeedComment = (
  scope: FeedScope,
  scopeId: number | null | undefined,
  content: string,
  mentionUserIds?: number[]
): Promise<FeedPostEnriched> =>
  apiClient
    .post(`${feedPath(scope, scopeId)}/posts`, { content, ...(mentionUserIds?.length ? { mentionUserIds } : {}) })
    .then((r) => r.data);

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
    case 'FINDING':
      return true;
    case 'DIVISION':
      return isDirectorOrAdmin || scopeId === userDivisionId;
    case 'ORG':
      return isDirectorOrAdmin || role === 'Manager';
    default:
      return false;
  }
};
