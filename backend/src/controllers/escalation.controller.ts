import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { createFeedPost, FeedScope } from '../services/feedService';
import { hasPrivilege } from '../utils/privilegeAccess';
import {
  SCOPE_LEVEL,
  isEscalationTargetScope,
  resolveEscalationOrigin,
  placeEscalationCards,
  canActionFlag,
  resolveFlagDivision,
  EscalationTargetScope,
} from '../services/escalationService';
import { createTaskService, reassignTaskService } from './task.controller';
import { createFindingService } from './finding.controller';
import { HttpError, isHttpError } from '../utils/httpError';
import { createNotifications, resolvePrivilegedUserIds } from '../services/notificationService';
import { emitRealtimeEvent } from '../realtime/pgEvents';

import { prisma } from '../lib/prisma';

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
    // FINDING sits outside the escalation hierarchy (SCOPE_LEVEL -1). Reject it
    // explicitly with a correct message instead of letting it fall through the
    // level comparisons to a misleading "Org-level" error.
    if (sourcePost.scope === 'FINDING') {
      res.status(400).json({ message: 'Finding comments cannot be escalated.' });
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

    const flagger = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, name: true } });
    const flaggedByName = flagger?.name ?? `User ${userId}`;

    const result = await prisma.$transaction(async (tx) => {
      // Dedup guard (#21): at most ONE PENDING flag per (sourcePostId, targetScope).
      // Re-flagging is allowed once the prior flag leaves PENDING (DISMISSED/ACTIONED),
      // so a full @@unique constraint would be wrong; the check lives in a Serializable
      // transaction (below) so two concurrent flags can't both slip past it.
      const existingPending = await tx.escalationFlag.findFirst({
        where: { sourcePostId: postId, targetScope, status: 'PENDING' },
        select: { id: true },
      });
      if (existingPending) {
        throw new HttpError(409, `An escalation to ${TARGET_FEED_LABEL[targetScope]} is already pending for this comment.`);
      }

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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Notify everyone who can ACTION this flag (post-commit, best-effort). The
    // recipient set mirrors canActionFlag: Director/Admin reach any division;
    // escalation:review holders are division-scoped (ORG flags → any holder).
    let flagDivision: number | null = null;
    if (targetScope === 'DIVISION') {
      flagDivision = origin.divisionId;
    } else if (targetScope === 'WP' && origin.wpId != null) {
      const wp = await prisma.workPackage.findUnique({
        where: { id: origin.wpId, deletedAt: null },
        select: { divisionId: true },
      });
      flagDivision = wp?.divisionId ?? null;
    }
    const reviewerIds = await resolvePrivilegedUserIds(
      prisma,
      'escalation:review',
      targetScope === 'ORG' ? null : flagDivision
    );
    await createNotifications(
      prisma,
      reviewerIds.map((uid) => ({
        userId: uid,
        type: 'ESCALATION_QUEUED' as const,
        title: 'New escalation in your queue',
        body: `${flaggedByName} escalated a comment to ${TARGET_FEED_LABEL[targetScope]}.`,
        linkScope: 'ESCALATION' as const,
        linkId: result.flag.id,
      })),
      [userId]
    );
    // Also nudge the existing escalation bell so it refreshes instantly rather
    // than waiting for its 60s poll.
    for (const uid of reviewerIds) {
      if (uid === userId) continue;
      await emitRealtimeEvent(prisma, { kind: 'escalation', userId: uid });
    }

    res.status(201).json({ flag: result.flag, cards: result.cards });
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    // Two flags racing the same (sourcePostId, targetScope): the in-tx findFirst
    // catches the sequential case, but two genuinely-concurrent Serializable
    // transactions abort the loser with P2034 — surface that as the same 409,
    // not a 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      res.status(409).json({ message: 'An escalation is already pending for this comment.' });
      return;
    }
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
    if (!hasPrivilege(req.user!, 'escalation:review')) {
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
      // Manager: batch-resolve the division of each WP-target flag, then gate via
      // the shared canActionFlag predicate (one source of truth with the action endpoint).
      const wpTargetIds = flags
        .filter((f) => f.targetScope === 'WP')
        .map((f) => f.cards[0]?.scopeId)
        .filter((id): id is number => typeof id === 'number');
      const wps = wpTargetIds.length
        ? await prisma.workPackage.findMany({ where: { id: { in: wpTargetIds }, deletedAt: null }, select: { id: true, divisionId: true } })
        : [];
      const wpDiv = new Map(wps.map((w) => [w.id, w.divisionId]));

      actionable = flags.filter((f) => {
        const card = f.cards[0];
        let flagDiv: number | null = null;
        if (f.targetScope === 'DIVISION') flagDiv = card?.scopeId ?? null;
        else if (f.targetScope === 'WP') flagDiv = card ? wpDiv.get(card.scopeId as number) ?? null : null;
        return canActionFlag({ role, divisionId, permissions: req.user!.permissions }, { targetScope: f.targetScope, divisionId: flagDiv });
      });
    }

    // Resolve names for both the flagger AND the reviewer (who actioned the flag)
    // in a single batch — the history view shows "Actioned by <reviewer>".
    const userIds = [
      ...new Set(
        actionable.flatMap((f) =>
          f.reviewedByUserId != null ? [f.flaggedByUserId, f.reviewedByUserId] : [f.flaggedByUserId]
        )
      ),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, name: true } })
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
          // Action result (null while PENDING) — drives the history summary line.
          action: f.action ?? null,
          actionedAt: f.actionedAt ?? null,
          reviewedBy: f.reviewedByUserId
            ? { id: f.reviewedByUserId, name: nameMap.get(f.reviewedByUserId) ?? null }
            : null,
        };
      })
    );
  } catch (error) {
    console.error('Error listing escalations:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/escalations/:id/action ─────────────────────────────────────────
// Action a PENDING flag (RBAC: Director/Admin any; Manager own-div WP/Division +
// all Org). One flag tracks the whole lifecycle. Each action reuses the existing
// workflow (createFinding / createTask / reassignTask) verbatim, runs in ONE
// atomic transaction, dual-writes AuditLog + a SYSTEM_EVENT on the target feed,
// and flips the flag out of PENDING (final-state flags are not re-actionable).

const ESCALATION_ACTIONS = ['ACKNOWLEDGE', 'DISMISS', 'RAISE_FINDING', 'CREATE_TASK', 'REASSIGN_TASK', 'DISSEMINATE'] as const;

function isEscalationAction(value: string): value is (typeof ESCALATION_ACTIONS)[number] {
  return (ESCALATION_ACTIONS as readonly string[]).includes(value);
}

export const actionEscalation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;

    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const flagId = parseInt(idParam ?? '', 10);
    if (Number.isNaN(flagId)) {
      res.status(400).json({ message: 'A numeric escalation id is required.' });
      return;
    }

    const action = (req.body?.action ?? '').toString().toUpperCase();
    if (!isEscalationAction(action)) {
      res.status(400).json({ message: `action must be one of: ${ESCALATION_ACTIONS.join(', ')}.` });
      return;
    }
    const payload = req.body?.payload ?? {};

    const flag = await prisma.escalationFlag.findUnique({
      where: { id: flagId },
      include: {
        cards: {
          where: { type: 'ESCALATION_CARD' },
          select: { id: true, scope: true, scopeId: true, sourceExcerpt: true, sourceTaskId: true, sourceWpId: true },
        },
      },
    });
    if (!flag) {
      res.status(404).json({ message: 'Escalation not found.' });
      return;
    }
    // Final-state flags are not re-actionable.
    if (flag.status !== 'PENDING') {
      res.status(400).json({ message: `This escalation has already been ${flag.status.toLowerCase()}.` });
      return;
    }

    // RBAC — shared predicate (one source of truth with getEscalations).
    const flagDiv = await resolveFlagDivision(prisma, flag);
    if (!canActionFlag({ role, divisionId, permissions: req.user!.permissions }, { targetScope: flag.targetScope, divisionId: flagDiv })) {
      res.status(403).json({ message: 'You do not have permission to action this escalation.' });
      return;
    }

    const sourcePost = await prisma.feedPost.findUnique({ where: { id: flag.sourcePostId }, select: { scope: true, scopeId: true } });
    const card = flag.cards[0] ?? null;
    const targetScope = flag.targetScope as FeedScope; // the feed where the escalation card lives
    const targetScopeId = card?.scopeId ?? null;
    const actor = { userId, role, divisionId };

    const updated = await prisma.$transaction(async (tx) => {
      const actorUser = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { name: true } });
      const actorName = actorUser?.name ?? `User ${userId}`;

      let linkedEntityType: string | null = null;
      let linkedEntityId: string | null = null;
      let newStatus: 'ACTIONED' | 'DISMISSED' = 'ACTIONED';
      let systemEventText: string;

      switch (action) {
        case 'ACKNOWLEDGE':
          systemEventText = `${actorName} acknowledged this escalation.`;
          break;

        case 'DISMISS':
          newStatus = 'DISMISSED';
          systemEventText = `${actorName} dismissed this escalation.`;
          break;

        case 'RAISE_FINDING': {
          // Only when the source is a Task comment (the reused createFinding then
          // enforces the template's allowsFindings rule).
          if (!sourcePost || sourcePost.scope !== 'TASK' || card?.sourceTaskId == null) {
            throw new HttpError(400, 'Raise Finding is only available for escalations whose source is a task comment.');
          }
          const finding = await createFindingService(tx, { userId }, {
            taskId: card.sourceTaskId,
            eventType: payload.eventType,
            departmentId: payload.departmentId,
            description: payload.description,
            fieldId: payload.fieldId,
            aircraftRegistration: payload.aircraftRegistration,
            regulatoryReference: payload.regulatoryReference,
          });
          linkedEntityType = 'Finding';
          linkedEntityId = String(finding.id);
          systemEventText = `${actorName} raised Finding #${finding.id} from this escalation.`;
          break;
        }

        case 'CREATE_TASK': {
          const task = await createTaskService(tx, actor, {
            templateId: payload.templateId,
            targetDivisionId: payload.targetDivisionId,
            wpId: payload.wpId,
            assignedToUserId: payload.assignedToUserId,
            deadline: payload.deadline,
            estimatedHours: payload.estimatedHours,
          });
          linkedEntityType = 'Task';
          linkedEntityId = String(task.id);
          systemEventText = `${actorName} created Task ${task.taskId} from this escalation.`;
          break;
        }

        case 'REASSIGN_TASK': {
          if (card?.sourceTaskId == null) {
            throw new HttpError(400, 'This escalation has no source task to reassign.');
          }
          await reassignTaskService(tx, actor, {
            taskId: card.sourceTaskId,
            newAssigneeId: payload.newAssigneeId,
            reason: payload.reason,
          });
          linkedEntityType = 'Task';
          linkedEntityId = String(card.sourceTaskId);
          systemEventText = `${actorName} reassigned the source task from this escalation.`;
          break;
        }

        case 'DISSEMINATE': {
          // Reuse the SAME flag — post an ESCALATION_CARD to ORG; do NOT create a second flag.
          const taggedDivisionIds = Array.isArray(payload.taggedDivisionIds)
            ? (payload.taggedDivisionIds as unknown[]).filter((n): n is number => typeof n === 'number')
            : null;
          await createFeedPost(tx, {
            type: 'ESCALATION_CARD',
            scope: 'ORG',
            scopeId: null,
            content: `Disseminated org-wide by ${actorName}.`,
            authorId: null,
            sourcePostId: flag.sourcePostId,
            sourceExcerpt: card?.sourceExcerpt ?? null,
            sourceTaskId: card?.sourceTaskId ?? null,
            sourceWpId: card?.sourceWpId ?? null,
            flagId: flag.id,
            taggedDivisionIds,
          });
          systemEventText = `${actorName} disseminated this escalation to the Org Feed.`;
          break;
        }

        default:
          throw new HttpError(400, 'Unknown action.');
      }

      const flagRow = await tx.escalationFlag.update({
        where: { id: flag.id },
        data: { status: newStatus, action, reviewedByUserId: userId, actionedAt: new Date(), linkedEntityType, linkedEntityId },
      });

      // Dual-write (Rule 3): AuditLog (compliance) + SYSTEM_EVENT on the target feed.
      await tx.auditLog.create({
        data: {
          actionType: 'ESCALATION_ACTIONED',
          entityType: 'EscalationFlag',
          entityId: String(flag.id),
          performedByUserId: userId,
          details: { action, status: newStatus, linkedEntityType, linkedEntityId } as any,
        },
      });

      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT',
        scope: targetScope,
        scopeId: targetScopeId,
        content: systemEventText,
        authorId: null,
        flagId: flag.id,
      });

      return flagRow;
    });

    res.json(updated);
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Error actioning escalation:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
