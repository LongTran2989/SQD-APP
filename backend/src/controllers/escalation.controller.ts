import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { createFeedPost, FeedScope } from '../services/feedService';
import {
  SCOPE_LEVEL,
  isEscalationTargetScope,
  resolveEscalationOrigin,
  placeEscalationCards,
  EscalationTargetScope,
} from '../services/escalationService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Human-readable target names for the source-feed SYSTEM_EVENT.
const TARGET_FEED_LABEL: Record<EscalationTargetScope, string> = {
  WP: 'the Work Package feed',
  DIVISION: 'the Division Board',
  ORG: 'the Org Feed',
};

// ─── POST /api/feeds/posts/:id/flag ───────────────────────────────────────────
// Any authenticated user may flag a COMMENT. Creates a PENDING EscalationFlag,
// places the cards per the matrix, and dual-writes AuditLog + a SYSTEM_EVENT on
// the source feed — all atomically.

export const flagPost = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.user!;

    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const postId = parseInt(idParam ?? '', 10);
    if (Number.isNaN(postId)) {
      res.status(400).json({ message: 'A numeric post id is required.' });
      return;
    }

    const targetScopeRaw = (req.body?.targetScope ?? '').toString().toUpperCase();
    if (!isEscalationTargetScope(targetScopeRaw)) {
      res.status(400).json({ message: 'targetScope is required and must be WP, DIVISION, or ORG.' });
      return;
    }
    const targetScope: EscalationTargetScope = targetScopeRaw;

    const sourcePost = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!sourcePost) {
      res.status(404).json({ message: 'Comment not found.' });
      return;
    }
    if (sourcePost.type !== 'COMMENT') {
      res.status(400).json({ message: 'Only comments can be escalated.' });
      return;
    }

    const originLevel = SCOPE_LEVEL[sourcePost.scope as FeedScope];
    if (originLevel === undefined) {
      res.status(400).json({ message: 'Unknown source scope.' });
      return;
    }
    if (sourcePost.scope === 'ORG') {
      res.status(400).json({ message: 'Org-level comments cannot be escalated further.' });
      return;
    }
    const targetLevel = SCOPE_LEVEL[targetScope];
    if (targetLevel <= originLevel) {
      res.status(400).json({
        message: `Cannot escalate a ${sourcePost.scope} comment to ${targetScope}; the target must be a higher scope.`,
      });
      return;
    }

    const resolved = await resolveEscalationOrigin(prisma, sourcePost);
    if (!resolved.ok) {
      res.status(resolved.status).json({ message: resolved.message });
      return;
    }
    const origin = resolved.origin;

    if (targetScope === 'WP' && origin.wpId == null) {
      res.status(400).json({ message: 'This task is not in a Work Package; it cannot be escalated to WP scope.' });
      return;
    }
    if (targetScope === 'DIVISION' && origin.divisionId == null) {
      res.status(400).json({ message: 'No division context for this comment; it cannot be escalated to Division scope.' });
      return;
    }

    const flagger = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    const flaggedByName = flagger?.name ?? `User ${userId}`;

    const result = await prisma.$transaction(async (tx) => {
      const flag = await tx.escalationFlag.create({
        data: {
          sourcePostId: postId,
          flaggedByUserId: userId,
          targetScope,
          status: 'PENDING',
        },
      });

      const cards = await placeEscalationCards(tx, { flag, sourcePost, origin, flaggedByName });

      // Dual-write (Rule 3): AuditLog (compliance) + SYSTEM_EVENT on the source feed.
      await tx.auditLog.create({
        data: {
          actionType: 'ESCALATION_RAISED',
          entityType: 'EscalationFlag',
          entityId: String(flag.id),
          performedByUserId: userId,
          details: { targetScope, sourcePostId: postId, sourceScope: sourcePost.scope } as any,
        },
      });

      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT',
        scope: sourcePost.scope as FeedScope,
        scopeId: sourcePost.scopeId,
        content: `${flaggedByName} escalated this comment to ${TARGET_FEED_LABEL[targetScope]}.`,
        authorId: null,
        flagId: flag.id,
      });

      return { flag, cards };
    });

    res.status(201).json({ flag: result.flag, cards: result.cards });
  } catch (error) {
    console.error('Error flagging post:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/escalations?status=PENDING ──────────────────────────────────────
// Returns the viewer's ACTIONABLE escalation queue (drives the bell badge + list).
// Director/Admin → all; Manager → own-division WP/Division flags + all Org flags;
// Group Leader / Staff → none (they still SEE cards on feeds via transparency).

export const getEscalations = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId: _userId, role, divisionId } = req.user!;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;

    const isDirectorOrAdmin = role === 'Director' || role === 'Admin';
    if (!isDirectorOrAdmin && role !== 'Manager') {
      res.json([]);
      return;
    }

    const where: { status?: string } = {};
    if (statusFilter) where.status = statusFilter;

    const flags = await prisma.escalationFlag.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        cards: {
          where: { type: 'ESCALATION_CARD' },
          select: { scope: true, scopeId: true, sourceExcerpt: true, sourceTaskId: true, sourceWpId: true },
        },
      },
    });

    let actionable = flags;
    if (!isDirectorOrAdmin) {
      // Manager: resolve the target division of each WP-target flag to scope by division.
      const wpTargetIds = flags
        .filter((f) => f.targetScope === 'WP')
        .map((f) => f.cards[0]?.scopeId)
        .filter((id): id is number => typeof id === 'number');
      const wps = wpTargetIds.length
        ? await prisma.workPackage.findMany({ where: { id: { in: wpTargetIds } }, select: { id: true, divisionId: true } })
        : [];
      const wpDiv = new Map(wps.map((w) => [w.id, w.divisionId]));

      actionable = flags.filter((f) => {
        if (f.targetScope === 'ORG') return true; // any Manager may action Org flags
        const card = f.cards[0];
        if (!card) return false;
        if (f.targetScope === 'DIVISION') return card.scopeId === divisionId;
        if (f.targetScope === 'WP') return wpDiv.get(card.scopeId as number) === divisionId;
        return false;
      });
    }

    const flaggerIds = [...new Set(actionable.map((f) => f.flaggedByUserId))];
    const users = flaggerIds.length
      ? await prisma.user.findMany({ where: { id: { in: flaggerIds } }, select: { id: true, name: true } })
      : [];
    const nameMap = new Map(users.map((u) => [u.id, u.name]));

    res.json(
      actionable.map((f) => {
        const card = f.cards[0] ?? null;
        return {
          id: f.id,
          targetScope: f.targetScope,
          status: f.status,
          createdAt: f.createdAt,
          sourcePostId: f.sourcePostId,
          sourceExcerpt: card?.sourceExcerpt ?? null,
          sourceTaskId: card?.sourceTaskId ?? null,
          sourceWpId: card?.sourceWpId ?? null,
          flaggedByUserId: f.flaggedByUserId,
          flaggedBy: { id: f.flaggedByUserId, name: nameMap.get(f.flaggedByUserId) ?? null },
          card: card ? { scope: card.scope, scopeId: card.scopeId } : null,
        };
      })
    );
  } catch (error) {
    console.error('Error listing escalations:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
