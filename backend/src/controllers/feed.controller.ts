import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  createFeedPost,
  buildFeedPostScope,
  canPostToFeed,
  commentLengthError,
  isFeedScope,
  parseFeedLimit,
  parseFeedBefore,
  parseFeedTypes,
  FeedScope,
} from '../services/feedService';
import { canActionFlag } from '../services/escalationService';
import { notifyFeedWatchers } from '../services/notificationService';

import { prisma } from '../lib/prisma';

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
    return { ok: false, status: 400, message: `Invalid feed scope: ${rawScope}. Must be TASK, WP, DIVISION, ORG, or FINDING.` };
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
  } else if (scope === 'FINDING') {
    const finding = await prisma.finding.findUnique({ where: { id: scopeId, deletedAt: null }, select: { id: true } });
    if (!finding) return { ok: false, status: 404, message: 'Finding not found' };
  }

  return { ok: true, scope, scopeId };
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

    // Keyset pagination (H2): newest-first on the primary key, capped page size,
    // optional `before` cursor (page older than an id) and `types` filter. The
    // page is reversed to ascending below for chat-style (oldest-at-top) render.
    const limit = parseFeedLimit(req.query.limit);
    const before = parseFeedBefore(req.query.before);
    const types = parseFeedTypes(req.query.types);

    const where: Prisma.FeedPostWhereInput = buildFeedPostScope(target.scope, target.scopeId);
    if (types) where.type = { in: types };
    if (before != null) where.id = { lt: before };

    const rows = await prisma.feedPost.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit,
    });
    // A full page implies there may be older posts: the oldest row's id is the
    // next `before` cursor. A short page means we reached the start of the feed.
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
    res.setHeader('X-Next-Cursor', nextCursor != null ? String(nextCursor) : '');
    const posts = rows.reverse();

    // Author names, live flag statuses, and the (WP-only) feed division are all
    // independent of one another — batch them in a single round-trip rather than
    // chaining awaits. canAction is computed server-side with the same
    // canActionFlag the action endpoint uses (single source of truth); every
    // ESCALATION_CARD on a feed shares the feed's scope + division, so it's
    // resolved once and only when a card is actually present.
    const authorIds = [...new Set(posts.map((p) => p.authorId).filter((id): id is number => typeof id === 'number'))];
    const flagIds = [...new Set(posts.map((p) => p.flagId).filter((id): id is number => typeof id === 'number'))];
    const hasEscalationCard = posts.some((p) => p.type === 'ESCALATION_CARD');
    const needsWpDivision = !!req.user && hasEscalationCard && target.scope === 'WP' && target.scopeId != null;

    const [authors, flags, wp] = await Promise.all([
      authorIds.length > 0
        ? prisma.user.findMany({ where: { id: { in: authorIds }, deletedAt: null }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: number; name: string }[]),
      flagIds.length > 0
        ? prisma.escalationFlag.findMany({ where: { id: { in: flagIds } }, select: { id: true, status: true } })
        : Promise.resolve([] as { id: number; status: string }[]),
      needsWpDivision
        ? prisma.workPackage.findUnique({ where: { id: target.scopeId!, deletedAt: null }, select: { divisionId: true } })
        : Promise.resolve(null),
    ]);

    const authorMap = new Map(authors.map((a) => [a.id, a.name]));
    const statusMap = new Map(flags.map((f) => [f.id, f.status]));

    let viewerCanAction = false;
    if (req.user && hasEscalationCard) {
      const feedDivisionId =
        target.scope === 'DIVISION' ? target.scopeId :
        target.scope === 'WP' ? (wp?.divisionId ?? null) :
        null;
      viewerCanAction = canActionFlag(
        { role: req.user.role, divisionId: req.user.divisionId, permissions: req.user.permissions },
        { targetScope: target.scope, divisionId: feedDivisionId }
      );
    }

    res.json(posts.map((p) => ({
      ...p,
      author: p.authorId ? { id: p.authorId, name: authorMap.get(p.authorId) ?? null } : null,
      flagStatus: p.flagId != null ? statusMap.get(p.flagId) ?? null : null,
      canAction: p.type === 'ESCALATION_CARD' ? viewerCanAction : false,
    })));
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

    const lenErr = commentLengthError(content);
    if (lenErr) {
      res.status(400).json({ message: lenErr });
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

    // Notify the feed's watchers of the new comment (TASK/WP only) — best-effort.
    await notifyFeedWatchers(prisma, target.scope, target.scopeId, userId, content.trim());

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
