import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  createFeedPost,
  buildFeedPostScope,
  canPostToFeed,
  isFeedScope,
  FeedScope,
} from '../services/feedService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalises + validates the :scope / :scopeId route params for a feed request.
 * ORG is the singleton feed (no scopeId). Every other scope requires a numeric
 * scopeId and the referenced entity must exist (soft-delete aware for Task/WP).
 * Returns the resolved scope/scopeId, or an error to send back to the caller.
 */
type RouteParam = string | string[] | undefined;

async function resolveFeedTarget(
  rawScope: RouteParam,
  rawScopeId: RouteParam
): Promise<
  | { ok: true; scope: FeedScope; scopeId: number | null }
  | { ok: false; status: number; message: string }
> {
  const scopeStr = Array.isArray(rawScope) ? rawScope[0] : rawScope;
  const scopeIdStr = Array.isArray(rawScopeId) ? rawScopeId[0] : rawScopeId;
  const scope = (scopeStr ?? '').toUpperCase();
  if (!isFeedScope(scope)) {
    return { ok: false, status: 400, message: `Invalid feed scope: ${rawScope}. Must be TASK, WP, DIVISION, or ORG.` };
  }

  if (scope === 'ORG') {
    return { ok: true, scope, scopeId: null };
  }

  const scopeId = parseInt(scopeIdStr ?? '', 10);
  if (Number.isNaN(scopeId)) {
    return { ok: false, status: 400, message: `A numeric scopeId is required for ${scope} feeds.` };
  }

  // Validate the referenced entity exists (transparency: anyone may read, but the
  // feed target must be real so we don't silently return an empty list).
  if (scope === 'TASK') {
    const task = await prisma.task.findUnique({ where: { id: scopeId, deletedAt: null }, select: { id: true } });
    if (!task) return { ok: false, status: 404, message: 'Task not found' };
  } else if (scope === 'WP') {
    const wp = await prisma.workPackage.findUnique({ where: { id: scopeId, deletedAt: null }, select: { id: true } });
    if (!wp) return { ok: false, status: 404, message: 'Work Package not found' };
  } else if (scope === 'DIVISION') {
    const division = await prisma.division.findUnique({ where: { id: scopeId }, select: { id: true } });
    if (!division) return { ok: false, status: 404, message: 'Division not found' };
  }

  return { ok: true, scope, scopeId };
}

/** Enriches posts with the author's name (mirrors task.controller.getTaskActivity). */
async function enrichAuthors<T extends { authorId: number | null }>(posts: T[]) {
  const authorIds = [...new Set(posts.map((p) => p.authorId).filter(Boolean))] as number[];
  const authors = authorIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
    : [];
  const authorMap = new Map(authors.map((a) => [a.id, a.name]));
  return posts.map((p) => ({
    ...p,
    author: p.authorId ? { id: p.authorId, name: authorMap.get(p.authorId) ?? null } : null,
  }));
}

/**
 * Attaches the LIVE EscalationFlag status to ESCALATION_CARD / INFO_CARD posts
 * (which carry a flagId). Without this a card keeps showing its original
 * "Pending" badge after the flag is actioned (pending issue #20). Cards reference
 * the flag by id, so we batch-load statuses and map them on.
 */
async function enrichFlagStatus<T extends { flagId: number | null }>(posts: T[]) {
  const flagIds = [...new Set(posts.map((p) => p.flagId).filter((id): id is number => typeof id === 'number'))];
  const flags = flagIds.length > 0
    ? await prisma.escalationFlag.findMany({ where: { id: { in: flagIds } }, select: { id: true, status: true } })
    : [];
  const statusMap = new Map(flags.map((f) => [f.id, f.status]));
  return posts.map((p) => ({
    ...p,
    flagStatus: p.flagId != null ? statusMap.get(p.flagId) ?? null : null,
  }));
}

// ─── GET /api/feeds/:scope/:scopeId? ──────────────────────────────────────────
// Returns every post on a feed, oldest-first. All authenticated users may read
// any feed (transparency default).

export const getFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const target = await resolveFeedTarget(req.params.scope, req.params.scopeId);
    if (!target.ok) {
      res.status(target.status).json({ message: target.message });
      return;
    }

    const posts = await prisma.feedPost.findMany({
      where: buildFeedPostScope(target.scope, target.scopeId),
      orderBy: { createdAt: 'asc' },
    });

    res.json(await enrichFlagStatus(await enrichAuthors(posts)));
  } catch (error) {
    console.error('Error fetching feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feeds/:scope/:scopeId?/posts ───────────────────────────────────
// Creates a COMMENT on a feed. Plain comments are NOT written to AuditLog (this
// matches the existing task-comment behavior); only system events dual-write.

export const postFeedComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    const { content } = req.body;

    if (!content || !content.trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }

    const target = await resolveFeedTarget(req.params.scope, req.params.scopeId);
    if (!target.ok) {
      res.status(target.status).json({ message: target.message });
      return;
    }

    if (!canPostToFeed({ role, divisionId }, target.scope, target.scopeId)) {
      res.status(403).json({ message: 'Forbidden: You do not have permission to post on this feed.' });
      return;
    }

    const post = await createFeedPost(prisma, {
      type: 'COMMENT',
      scope: target.scope,
      scopeId: target.scopeId,
      content: content.trim(),
      authorId: userId,
    });

    const author = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });

    res.status(201).json({
      ...post,
      author: author ? { id: author.id, name: author.name } : null,
    });
  } catch (error) {
    console.error('Error posting feed comment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
