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
  resolveMentions,
  mentionIdsFromMetadata,
  resolveEntityLinksForPosts,
  resolveAttachmentsForPosts,
  resolveAcksForPosts,
  FeedScope,
} from '../services/feedService';
import { canActionFlag } from '../services/escalationService';
import { notifyFeedWatchers, notifyMentions } from '../services/notificationService';

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

    // Hidden COMMENTs (M4) are excluded from reads. Director/Admin may opt in with
    // ?includeHidden=true (e.g. to review/unhide); everyone else never sees them.
    const isDirectorOrAdmin = req.user?.role === 'Director' || req.user?.role === 'Admin';
    const includeHidden = isDirectorOrAdmin && req.query.includeHidden === 'true';

    const where: Prisma.FeedPostWhereInput = buildFeedPostScope(target.scope, target.scopeId);
    if (types) where.type = { in: types };
    if (before != null) where.id = { lt: before };
    if (!includeHidden) where.hiddenAt = null;

    const rows = await prisma.feedPost.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit,
    });
    // A full page implies there may be older posts: the oldest row's id is the
    // next `before` cursor. A short page means we reached the start of the feed.
    const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
    res.setHeader('X-Next-Cursor', nextCursor != null ? String(nextCursor) : '');
    const posts = rows.reverse();

    // Author names, live flag statuses, and the (WP-only) feed division are all
    // independent of one another — batch them in a single round-trip rather than
    // chaining awaits. canAction is computed server-side with the same
    // canActionFlag the action endpoint uses (single source of truth); every
    // ESCALATION_CARD on a feed shares the feed's scope + division, so it's
    // resolved once and only when a card is actually present.
    // Mentioned user ids referenced across the page (Phase E) — resolved to names
    // alongside authors so a comment can render its "mentions" chips.
    const mentionIdsByPost = new Map(posts.map((p) => [p.id, mentionIdsFromMetadata(p.metadata)]));
    const allMentionIds = [...new Set([...mentionIdsByPost.values()].flat())];

    const authorIds = [...new Set([
      ...posts.map((p) => p.authorId).filter((id): id is number => typeof id === 'number'),
      ...allMentionIds,
    ])];
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

    // Inline #CODE entity links (E.2) + comment attachments (F) + acks (G).
    const commentIds = posts.filter((p) => p.type === 'COMMENT').map((p) => p.id);
    const [entityLinksByPost, attachmentsByPost, acksByPost] = await Promise.all([
      resolveEntityLinksForPosts(prisma, posts),
      resolveAttachmentsForPosts(prisma, posts.map((p) => p.id)),
      resolveAcksForPosts(prisma, commentIds, req.user?.userId ?? null),
    ]);

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
      hidden: p.hiddenAt != null,
      pinned: p.pinnedAt != null,
      mentions: (mentionIdsByPost.get(p.id) ?? [])
        .filter((id) => authorMap.has(id))
        .map((id) => ({ id, name: authorMap.get(id) ?? null })),
      entityLinks: entityLinksByPost.get(p.id) ?? {},
      attachments: attachmentsByPost.get(p.id) ?? [],
      ackCount: acksByPost.get(p.id)?.ackCount ?? 0,
      acknowledged: acksByPost.get(p.id)?.acknowledged ?? false,
    })));
  } catch (error) {
    console.error('Error fetching feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/feeds/search?q=&scope=&scopeId=&limit=&before= ───────────────────
// Full-text-ish search over COMMENT bodies (case-insensitive substring), newest
// first, keyset-paginated. Hidden comments are excluded for everyone. Optional
// scope[/scopeId] narrows to one feed (per-feed search); omit for a global search.
// Transparency model: any authenticated user may search all feeds.
export const searchFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = (Array.isArray(req.query.q) ? req.query.q[0] ?? '' : req.query.q ?? '').toString().trim();
    if (q.length < 2) { res.setHeader('X-Next-Cursor', ''); res.json([]); return; }

    const limit = parseFeedLimit(req.query.limit);
    const before = parseFeedBefore(req.query.before);
    const scopeRaw = (Array.isArray(req.query.scope) ? req.query.scope[0] ?? '' : req.query.scope ?? '').toString().toUpperCase();
    const scope = isFeedScope(scopeRaw) ? scopeRaw : null;
    const scopeId = parseFeedBefore(req.query.scopeId); // reuse the positive-int parser

    const where: Prisma.FeedPostWhereInput = {
      type: 'COMMENT',
      hiddenAt: null,
      content: { contains: q, mode: 'insensitive' },
    };
    if (scope) where.scope = scope;
    if (scope && scope !== 'ORG' && scopeId != null) where.scopeId = scopeId;
    if (before != null) where.id = { lt: before };

    const rows = await prisma.feedPost.findMany({ where, orderBy: { id: 'desc' }, take: limit });
    const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
    res.setHeader('X-Next-Cursor', nextCursor != null ? String(nextCursor) : '');

    const authorIds = [...new Set(rows.map((r) => r.authorId).filter((id): id is number => typeof id === 'number'))];
    const authors = authorIds.length
      ? await prisma.user.findMany({ where: { id: { in: authorIds }, deletedAt: null }, select: { id: true, name: true } })
      : [];
    const authorMap = new Map(authors.map((a) => [a.id, a.name]));

    // Newest-first flat result list (not reversed — search isn't a chat transcript).
    res.json(rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      scopeId: r.scopeId,
      content: r.content,
      createdAt: r.createdAt,
      author: r.authorId ? { id: r.authorId, name: authorMap.get(r.authorId) ?? null } : null,
    })));
  } catch (error) {
    console.error('Error searching feed:', error);
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

    // @mentions (Phase E): validate the client-supplied ids → real users only,
    // store on the post (metadata.mentions) and notify them after creation.
    const mentions = await resolveMentions(prisma, req.body?.mentionUserIds);
    const mentionIds = mentions.map((m) => m.id);

    const post = await createFeedPost(prisma, {
      type: 'COMMENT',
      scope: target.scope,
      scopeId: target.scopeId,
      content: content.trim(),
      authorId: userId,
      metadata: mentionIds.length ? { mentions: mentionIds } : undefined,
    });

    // Notify the feed's watchers of the new comment (TASK/WP only) — best-effort.
    await notifyFeedWatchers(prisma, target.scope, target.scopeId, userId, content.trim());

    const author = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });

    // Notify the mentioned users (excludes the author) — best-effort.
    await notifyMentions(prisma, mentionIds, userId, target.scope, target.scopeId, content.trim(), author?.name ?? `User ${userId}`);

    res.status(201).json({
      ...post,
      author: author ? { id: author.id, name: author.name } : null,
      mentions,
    });
  } catch (error) {
    console.error('Error posting feed comment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── Moderation: hide / unhide (M4) & pin / unpin (Phase D) ───────────────────
// All operate on a COMMENT only (system events and escalation cards are never
// moderated) and dual-write AuditLog + a SYSTEM_EVENT on the post's own feed.

const PINNABLE_SCOPES: FeedScope[] = ['WP', 'DIVISION', 'ORG'];

function parsePostId(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? '', 10);
  return Number.isNaN(n) ? null : n;
}

// ─── POST /api/feeds/posts/:id/hide ───────────────────────────────────────────
// Director/Admin only. Soft-hides a comment: it is kept (immutable trail) but
// dropped from feed reads. Reversible via /unhide.
export const hidePost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role } = req.user!;
    if (role !== 'Director' && role !== 'Admin') {
      res.status(403).json({ message: 'Only a Director or Admin can hide a comment.' });
      return;
    }
    const postId = parsePostId(req.params.id);
    if (postId === null) { res.status(400).json({ message: 'A numeric post id is required.' }); return; }
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null;

    const post = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) { res.status(404).json({ message: 'Comment not found.' }); return; }
    if (post.type !== 'COMMENT') { res.status(400).json({ message: 'Only comments can be hidden.' }); return; }
    if (post.hiddenAt) { res.status(400).json({ message: 'This comment is already hidden.' }); return; }

    await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { name: true } });
      const actorName = actor?.name ?? `User ${userId}`;
      await tx.feedPost.update({ where: { id: postId }, data: { hiddenAt: new Date(), hiddenByUserId: userId, hiddenReason: reason } });
      await tx.auditLog.create({
        data: { actionType: 'FEED_POST_HIDDEN', entityType: 'FeedPost', entityId: String(postId), performedByUserId: userId, details: { reason } as any },
      });
      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT', scope: post.scope as FeedScope, scopeId: post.scopeId,
        content: `${actorName} hid a comment${reason ? `: ${reason}` : ''}.`, authorId: null,
      });
    });

    res.json({ id: postId, hidden: true });
  } catch (error) {
    console.error('Error hiding post:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feeds/posts/:id/unhide ─────────────────────────────────────────
export const unhidePost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role } = req.user!;
    if (role !== 'Director' && role !== 'Admin') {
      res.status(403).json({ message: 'Only a Director or Admin can unhide a comment.' });
      return;
    }
    const postId = parsePostId(req.params.id);
    if (postId === null) { res.status(400).json({ message: 'A numeric post id is required.' }); return; }

    const post = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) { res.status(404).json({ message: 'Comment not found.' }); return; }
    if (!post.hiddenAt) { res.status(400).json({ message: 'This comment is not hidden.' }); return; }

    await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { name: true } });
      const actorName = actor?.name ?? `User ${userId}`;
      await tx.feedPost.update({ where: { id: postId }, data: { hiddenAt: null, hiddenByUserId: null, hiddenReason: null } });
      await tx.auditLog.create({
        data: { actionType: 'FEED_POST_UNHIDDEN', entityType: 'FeedPost', entityId: String(postId), performedByUserId: userId, details: {} as any },
      });
      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT', scope: post.scope as FeedScope, scopeId: post.scopeId,
        content: `${actorName} restored a previously hidden comment.`, authorId: null,
      });
    });

    res.json({ id: postId, hidden: false });
  } catch (error) {
    console.error('Error unhiding post:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feeds/posts/:id/pin ────────────────────────────────────────────
// Pins a comment to a WP / Division / Org feed. RBAC mirrors posting rights for
// that scope (canPostToFeed) — Director/Admin any; Manager Org; own-division for
// Division. TASK / FINDING feeds are not pinnable.
export const pinPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    const postId = parsePostId(req.params.id);
    if (postId === null) { res.status(400).json({ message: 'A numeric post id is required.' }); return; }

    const post = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) { res.status(404).json({ message: 'Comment not found.' }); return; }
    if (post.type !== 'COMMENT') { res.status(400).json({ message: 'Only comments can be pinned.' }); return; }
    if (!PINNABLE_SCOPES.includes(post.scope as FeedScope)) {
      res.status(400).json({ message: 'Only Work Package, Division and Org comments can be pinned.' });
      return;
    }
    if (!canPostToFeed({ role, divisionId }, post.scope as FeedScope, post.scopeId)) {
      res.status(403).json({ message: 'You do not have permission to pin on this feed.' });
      return;
    }
    if (post.hiddenAt) { res.status(400).json({ message: 'A hidden comment cannot be pinned.' }); return; }
    if (post.pinnedAt) { res.status(400).json({ message: 'This comment is already pinned.' }); return; }

    await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { name: true } });
      const actorName = actor?.name ?? `User ${userId}`;
      await tx.feedPost.update({ where: { id: postId }, data: { pinnedAt: new Date(), pinnedByUserId: userId } });
      await tx.auditLog.create({
        data: { actionType: 'FEED_POST_PINNED', entityType: 'FeedPost', entityId: String(postId), performedByUserId: userId, details: {} as any },
      });
      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT', scope: post.scope as FeedScope, scopeId: post.scopeId,
        content: `${actorName} pinned a comment.`, authorId: null,
      });
    });

    res.json({ id: postId, pinned: true });
  } catch (error) {
    console.error('Error pinning post:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feeds/posts/:id/unpin ──────────────────────────────────────────
export const unpinPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    const postId = parsePostId(req.params.id);
    if (postId === null) { res.status(400).json({ message: 'A numeric post id is required.' }); return; }

    const post = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!post) { res.status(404).json({ message: 'Comment not found.' }); return; }
    if (!canPostToFeed({ role, divisionId }, post.scope as FeedScope, post.scopeId)) {
      res.status(403).json({ message: 'You do not have permission to unpin on this feed.' });
      return;
    }
    if (!post.pinnedAt) { res.status(400).json({ message: 'This comment is not pinned.' }); return; }

    await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { name: true } });
      const actorName = actor?.name ?? `User ${userId}`;
      await tx.feedPost.update({ where: { id: postId }, data: { pinnedAt: null, pinnedByUserId: null } });
      await tx.auditLog.create({
        data: { actionType: 'FEED_POST_UNPINNED', entityType: 'FeedPost', entityId: String(postId), performedByUserId: userId, details: {} as any },
      });
      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT', scope: post.scope as FeedScope, scopeId: post.scopeId,
        content: `${actorName} unpinned a comment.`, authorId: null,
      });
    });

    res.json({ id: postId, pinned: false });
  } catch (error) {
    console.error('Error unpinning post:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feeds/posts/:id/ack ────────────────────────────────────────────
// Any authenticated user acknowledges ("I have read this") a COMMENT. Idempotent
// via the unique (feedPostId,userId) constraint; the dual-write (AuditLog +
// SYSTEM_EVENT) fires only on the FIRST ack per user.
export const ackPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.user!;
    const postId = parsePostId(req.params.id);
    if (postId === null) { res.status(400).json({ message: 'A numeric post id is required.' }); return; }

    const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { id: true, type: true, scope: true, scopeId: true, hiddenAt: true } });
    if (!post) { res.status(404).json({ message: 'Comment not found.' }); return; }
    if (post.type !== 'COMMENT') { res.status(400).json({ message: 'Only comments can be acknowledged.' }); return; }
    if (post.hiddenAt) { res.status(400).json({ message: 'A hidden comment cannot be acknowledged.' }); return; }

    // Attempt the first-ack write atomically; a concurrent duplicate aborts on the
    // unique constraint (P2002) and is treated as an already-acknowledged no-op.
    try {
      await prisma.$transaction(async (tx) => {
        const actor = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { name: true } });
        const actorName = actor?.name ?? `User ${userId}`;
        await tx.feedPostAcknowledgement.create({ data: { feedPostId: postId, userId } });
        await tx.auditLog.create({
          data: { actionType: 'FEED_POST_ACKNOWLEDGED', entityType: 'FeedPost', entityId: String(postId), performedByUserId: userId, details: {} as any },
        });
        await createFeedPost(tx, {
          type: 'SYSTEM_EVENT', scope: post.scope as FeedScope, scopeId: post.scopeId,
          content: `${actorName} acknowledged a comment.`, authorId: null,
        });
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // already acknowledged — fall through and just return the current count
    }

    const ackCount = await prisma.feedPostAcknowledgement.count({ where: { feedPostId: postId } });
    res.json({ id: postId, acknowledged: true, ackCount });
  } catch (error) {
    console.error('Error acknowledging post:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/feeds/pinned/:scope/:scopeId? ───────────────────────────────────
// Returns the (non-hidden) pinned comments for a WP / Division / Org feed, newest
// pin first. TASK / FINDING feeds are not pinnable → always empty.
export const getPinnedFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const target = await resolveFeedTarget(req.params.scope, req.params.scopeId);
    if (!target.ok) { res.status(target.status).json({ message: target.message }); return; }
    if (!PINNABLE_SCOPES.includes(target.scope)) { res.json([]); return; }

    const pinned = await prisma.feedPost.findMany({
      where: { ...buildFeedPostScope(target.scope, target.scopeId), pinnedAt: { not: null }, hiddenAt: null },
      orderBy: { pinnedAt: 'desc' },
    });

    // Resolve author + mention names together (mirrors getFeed) so a pinned
    // comment renders its @mention line in the pinned strip.
    const mentionIdsByPost = new Map(pinned.map((p) => [p.id, mentionIdsFromMetadata(p.metadata)]));
    const allMentionIds = [...new Set([...mentionIdsByPost.values()].flat())];
    const authorIds = [...new Set([
      ...pinned.map((p) => p.authorId).filter((id): id is number => typeof id === 'number'),
      ...allMentionIds,
    ])];
    const authors = authorIds.length
      ? await prisma.user.findMany({ where: { id: { in: authorIds }, deletedAt: null }, select: { id: true, name: true } })
      : [];
    const authorMap = new Map(authors.map((a) => [a.id, a.name]));
    const pinnedIds = pinned.map((p) => p.id);
    const [entityLinksByPost, attachmentsByPost, acksByPost] = await Promise.all([
      resolveEntityLinksForPosts(prisma, pinned),
      resolveAttachmentsForPosts(prisma, pinnedIds),
      resolveAcksForPosts(prisma, pinnedIds, req.user?.userId ?? null),
    ]);

    res.json(pinned.map((p) => ({
      ...p,
      author: p.authorId ? { id: p.authorId, name: authorMap.get(p.authorId) ?? null } : null,
      hidden: false,
      pinned: true,
      entityLinks: entityLinksByPost.get(p.id) ?? {},
      attachments: attachmentsByPost.get(p.id) ?? [],
      ackCount: acksByPost.get(p.id)?.ackCount ?? 0,
      acknowledged: acksByPost.get(p.id)?.acknowledged ?? false,
      mentions: (mentionIdsByPost.get(p.id) ?? [])
        .filter((id) => authorMap.has(id))
        .map((id) => ({ id, name: authorMap.get(id) ?? null })),
    })));
  } catch (error) {
    console.error('Error fetching pinned feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
