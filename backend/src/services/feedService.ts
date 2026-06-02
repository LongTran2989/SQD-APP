import { PrismaClient, Prisma } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type FeedScope = 'TASK' | 'WP' | 'DIVISION' | 'ORG';
export type FeedPostType = 'COMMENT' | 'SYSTEM_EVENT' | 'ESCALATION_CARD' | 'INFO_CARD';

export interface CreateFeedPostInput {
  type: FeedPostType;
  scope: FeedScope;
  scopeId?: number | null; // NULL for the singleton ORG feed
  content: string;
  authorId?: number | null; // NULL for SYSTEM_EVENT / auto-generated cards
  metadata?: Record<string, unknown> | null;
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
  return client.feedPost.create({
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
}
