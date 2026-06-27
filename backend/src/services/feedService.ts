import { PrismaClient, Prisma } from '@prisma/client';
import { emitRealtimeEvent } from '../realtime/pgEvents';
import { resolveTaskWatchers, resolveWpWatchers, resolveFindingWatchers } from './notificationService';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type FeedScope = 'TASK' | 'WP' | 'DIVISION' | 'ORG' | 'FINDING';
export type FeedPostType = 'COMMENT' | 'SYSTEM_EVENT' | 'ESCALATION_CARD' | 'INFO_CARD';

export interface CreateFeedPostInput {
  type: FeedPostType;
  scope: FeedScope;
  scopeId?: number | null; // NULL for the singleton ORG feed
  content: string;
  authorId?: number | null; // NULL for SYSTEM_EVENT / auto-generated cards
  metadata?: Record<string, unknown> | null | undefined;
  // Escalation linkage (used from Phase 3 onward)
  sourcePostId?: number | null;
  sourceExcerpt?: string | null;
  sourceTaskId?: number | null;
  sourceWpId?: number | null;
  flagId?: number | null;
  taggedDivisionIds?: number[] | null;
}

/**
 * Creates a FeedPost on the given scope. Accepts a PrismaClient OR a transaction
 * client so callers that mutate inside a $transaction keep writes atomic.
 *
 * This is the single entry point for writing the unified feed — the Task feed
 * (scope 'TASK', scopeId = task.id) replaces the former TaskActivity model.
 */
export async function createFeedPost(client: PrismaLike, input: CreateFeedPostInput) {
  const post = await client.feedPost.create({
    data: {
      type: input.type,
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      content: input.content,
      authorId: input.authorId ?? null,
      metadata: (input.metadata as any) ?? Prisma.DbNull,
      sourcePostId: input.sourcePostId ?? null,
      sourceExcerpt: input.sourceExcerpt ?? null,
      sourceTaskId: input.sourceTaskId ?? null,
      sourceWpId: input.sourceWpId ?? null,
      flagId: input.flagId ?? null,
      taggedDivisionIds: (input.taggedDivisionIds as any) ?? Prisma.DbNull,
    },
  });

  // Realtime SIGNAL for the "new updates" pill + soft refetch. Rides the
  // caller's transaction client so the NOTIFY only fires on COMMIT (no refetch
  // race), is best-effort (never throws), and is a no-op under NODE_ENV=test.
  //
  // M1: scope the signal. TASK/WP/FINDING feeds have a bounded watcher set, so we
  // resolve it here (emit-time) and fan out to just those users — instead of the
  // old broadcast-to-everyone, which was O(comments × connected users). DIVISION/
  // ORG are genuinely shared feeds and stay a broadcast (userIds omitted). Watcher
  // resolution is wrapped so it can never break the feed write (best-effort like
  // the emit itself), and skipped entirely under test where emit is a no-op.
  if (process.env.NODE_ENV !== 'test') {
    try {
      const sid = input.scopeId ?? null;
      let userIds: number[] | undefined;
      if (sid != null) {
        if (input.scope === 'TASK') userIds = await resolveTaskWatchers(client, sid);
        else if (input.scope === 'WP') userIds = await resolveWpWatchers(client, sid);
        else if (input.scope === 'FINDING') userIds = await resolveFindingWatchers(client, sid);
      }
      await emitRealtimeEvent(client, { kind: 'feed', scope: input.scope, scopeId: sid, userIds });
    } catch (err) {
      console.error('[realtime] feed signal scoping failed (non-fatal):', err);
    }
  }

  return post;
}

export const FEED_SCOPES: FeedScope[] = ['TASK', 'WP', 'DIVISION', 'ORG', 'FINDING'];

export function isFeedScope(value: string): value is FeedScope {
  return (FEED_SCOPES as string[]).includes(value);
}

export const FEED_POST_TYPES: FeedPostType[] = ['COMMENT', 'SYSTEM_EVENT', 'ESCALATION_CARD', 'INFO_CARD'];

// Feed read pagination (H2). Reads are keyset-paginated newest-first on the
// primary key (FeedPost.id is monotonic with creation, so id-desc == createdAt-
// desc) and the controller reverses the page to ascending for chat-style display.
export const DEFAULT_FEED_LIMIT = 30;
export const MAX_FEED_LIMIT = 100;

/** Clamps a requested page size to [1, MAX_FEED_LIMIT], defaulting when absent/invalid. */
export function parseFeedLimit(raw: unknown): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_FEED_LIMIT;
  return Math.min(n, MAX_FEED_LIMIT);
}

/** Parses the keyset cursor: the id to page *before* (older than). Null when absent/invalid. */
export function parseFeedBefore(raw: unknown): number | null {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isNaN(n) || n < 1 ? null : n;
}

/**
 * Parses an optional `types` filter ("COMMENT,SYSTEM_EVENT") into a validated,
 * de-duplicated FeedPostType[]. Returns null when absent/empty/all-invalid so the
 * caller omits the type filter entirely (= all types).
 */
export function parseFeedTypes(raw: unknown): FeedPostType[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parts = raw.split(',').map((s) => s.trim().toUpperCase());
  const valid = parts.filter((p): p is FeedPostType => (FEED_POST_TYPES as string[]).includes(p));
  return valid.length > 0 ? [...new Set(valid)] : null;
}

/**
 * Maximum length of a single feed COMMENT. Mirrors the cap the Task feed has
 * always enforced (task.controller's MAX_COMMENT_LEN). Centralised here so EVERY
 * comment path (task, WP, division, org, finding) shares one ceiling — see H1 in
 * FEED_FEATURES_AUDIT.md: the generic feed endpoint previously had no cap.
 */
export const MAX_COMMENT_LEN = 5000;

/**
 * Validates a comment body's length. Returns an error message string when the
 * (trimmed) content exceeds MAX_COMMENT_LEN, or null when it is acceptable.
 * Callers handle the empty/whitespace case separately (a 400 "content required").
 */
export function commentLengthError(content: string): string | null {
  if (content.trim().length > MAX_COMMENT_LEN) {
    return `Comment is too long (max ${MAX_COMMENT_LEN} characters).`;
  }
  return null;
}

/**
 * Builds the Prisma WHERE clause that selects every post on a single feed.
 * scopeId is polymorphic (taskId / wpId / divisionId) and ignored for the
 * singleton ORG feed (always scopeId NULL). Reads are open to all authenticated
 * users (transparency default) — this helper only locates the feed, not who may
 * see it. Provided for any future filtered reads as well.
 */
export function buildFeedPostScope(scope: FeedScope, scopeId: number | null): Prisma.FeedPostWhereInput {
  if (scope === 'ORG') return { scope: 'ORG', scopeId: null };
  return { scope, scopeId };
}

/**
 * RBAC gate for posting a COMMENT to a feed (mirrors the plan's RBAC matrix):
 *   - TASK / WP    → any authenticated user (transparent commenting).
 *   - DIVISION     → own division only; Director / Admin may post to any.
 *   - ORG          → Director / Admin / Manager only.
 * Director / Admin bypass division checks throughout.
 */
export function canPostToFeed(
  user: { role: string; divisionId: number },
  scope: FeedScope,
  scopeId: number | null
): boolean {
  const isDirectorOrAdmin = user.role === 'Director' || user.role === 'Admin';
  switch (scope) {
    case 'TASK':
    case 'WP':
    case 'FINDING':  // open commenting — any authenticated user (findings are globally readable)
      return true;
    case 'DIVISION':
      return isDirectorOrAdmin || scopeId === user.divisionId;
    case 'ORG':
      return isDirectorOrAdmin || user.role === 'Manager';
    default:
      return false;
  }
}
