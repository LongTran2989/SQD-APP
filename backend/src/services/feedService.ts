import { PrismaClient, Prisma } from '@prisma/client';
import { emitRealtimeEvent } from '../realtime/pgEvents';

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
  await emitRealtimeEvent(client, { kind: 'feed', scope: input.scope, scopeId: input.scopeId ?? null });

  return post;
}

export const FEED_SCOPES: FeedScope[] = ['TASK', 'WP', 'DIVISION', 'ORG', 'FINDING'];

export function isFeedScope(value: string): value is FeedScope {
  return (FEED_SCOPES as string[]).includes(value);
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
