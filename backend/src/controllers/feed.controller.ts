import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_TARGET_SCOPES = ['WP', 'DIVISION', 'ORG'];

// Scope hierarchy rank — escalation may only target a strictly higher level.
const SCOPE_RANK: Record<string, number> = { TASK: 0, WP: 1, DIVISION: 2, ORG: 3 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getUserName(userId: number): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? `User ${userId}`;
}

/** Loads feed posts for a scope/scopeId pair and flattens the author relation to { id, name, role }. */
async function loadFeed(scope: string, scopeId: number) {
  const posts = await prisma.feedPost.findMany({
    where: { scope, scopeId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, name: true, role: { select: { name: true } } } } }
  });
  return posts.map((p) => ({
    ...p,
    author: p.author ? { id: p.author.id, name: p.author.name, role: p.author.role?.name ?? null } : null
  }));
}

// ─── GET /api/feed/task/:taskId ───────────────────────────────────────────────

export const getTaskFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId as string, 10);

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true }
    });
    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Transparent viewing model — any authenticated user may read.
    const posts = await loadFeed('TASK', taskId);
    res.json({ posts });
  } catch (error) {
    console.error('Error fetching task feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feed/task/:taskId ──────────────────────────────────────────────

export const postTaskComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(req.params.taskId as string, 10);
    const { userId } = req.user!;
    const { content } = req.body;

    if (!content || !String(content).trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true }
    });
    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    const post = await prisma.feedPost.create({
      data: {
        type: 'COMMENT',
        scope: 'TASK',
        scopeId: taskId,
        authorId: userId,
        content: String(content).trim(),
        metadata: Prisma.DbNull
      },
      include: { author: { select: { id: true, name: true, role: { select: { name: true } } } } }
    });

    res.status(201).json({
      ...post,
      author: post.author ? { id: post.author.id, name: post.author.name, role: post.author.role?.name ?? null } : null
    });
  } catch (error) {
    console.error('Error posting task comment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/feed/wp/:wpId ───────────────────────────────────────────────────

export const getWpFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const wpId = parseInt(req.params.wpId as string, 10);

    const wp = await prisma.workPackage.findUnique({
      where: { id: wpId, deletedAt: null },
      select: { id: true }
    });
    if (!wp) {
      res.status(404).json({ message: 'Work Package not found' });
      return;
    }

    const posts = await loadFeed('WP', wpId);
    res.json({ posts });
  } catch (error) {
    console.error('Error fetching WP feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feed/wp/:wpId ──────────────────────────────────────────────────

export const postWpComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const wpId = parseInt(req.params.wpId as string, 10);
    const { userId } = req.user!;
    const { content } = req.body;

    if (!content || !String(content).trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }

    const wp = await prisma.workPackage.findUnique({
      where: { id: wpId, deletedAt: null },
      select: { id: true }
    });
    if (!wp) {
      res.status(404).json({ message: 'Work Package not found' });
      return;
    }

    const post = await prisma.feedPost.create({
      data: {
        type: 'COMMENT',
        scope: 'WP',
        scopeId: wpId,
        authorId: userId,
        content: String(content).trim(),
        metadata: Prisma.DbNull
      },
      include: { author: { select: { id: true, name: true, role: { select: { name: true } } } } }
    });

    res.status(201).json({
      ...post,
      author: post.author ? { id: post.author.id, name: post.author.name, role: post.author.role?.name ?? null } : null
    });
  } catch (error) {
    console.error('Error posting WP comment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feed/posts/:postId/escalate ────────────────────────────────────

export const escalatePost = async (req: Request, res: Response): Promise<void> => {
  try {
    const postId = parseInt(req.params.postId as string, 10);
    const { userId } = req.user!;
    const { targetScope, reason } = req.body;

    // 1. Validate targetScope is one of the three valid values.
    if (!targetScope || !VALID_TARGET_SCOPES.includes(targetScope)) {
      res.status(400).json({ message: `targetScope is required and must be one of: ${VALID_TARGET_SCOPES.join(', ')}` });
      return;
    }

    // 2. Load the source post.
    const sourcePost = await prisma.feedPost.findUnique({ where: { id: postId } });
    if (!sourcePost) {
      res.status(404).json({ message: 'Post not found' });
      return;
    }
    if (sourcePost.type !== 'COMMENT') {
      res.status(400).json({ message: 'Only comments can be escalated' });
      return;
    }
    if (sourcePost.flagId) {
      res.status(400).json({ message: 'This post has already been escalated' });
      return;
    }

    // 3. Validate scope hierarchy — target must be strictly higher than source.
    if (sourcePost.scope === 'ORG') {
      res.status(400).json({ message: 'Cannot escalate from Org Feed' });
      return;
    }
    if ((SCOPE_RANK[targetScope] ?? -1) <= (SCOPE_RANK[sourcePost.scope] ?? -1)) {
      res.status(400).json({ message: 'Target scope must be higher than the source scope' });
      return;
    }

    // 4. Resolve the origin context (task / WP / division) for denormalization.
    let sourceTaskId: number | null = null;
    let sourceWpId: number | null = null;
    let sourceDivisionId: number | null = null;

    if (sourcePost.scope === 'TASK') {
      const task = await prisma.task.findFirst({
        where: { id: sourcePost.scopeId!, deletedAt: null },
        select: { id: true, wpId: true, targetDivisionId: true }
      });
      if (task) {
        sourceTaskId = task.id;
        sourceWpId = task.wpId ?? null;
        sourceDivisionId = task.targetDivisionId ?? null;
      }
    } else if (sourcePost.scope === 'WP') {
      const wp = await prisma.workPackage.findFirst({
        where: { id: sourcePost.scopeId!, deletedAt: null },
        select: { id: true, divisionId: true }
      });
      if (wp) {
        sourceWpId = wp.id;
        sourceDivisionId = wp.divisionId;
      }
    } else if (sourcePost.scope === 'DIVISION') {
      sourceDivisionId = sourcePost.scopeId ?? null;
    }

    // 5. Determine the target scopeId.
    let targetScopeId: number | null = null;
    if (targetScope === 'WP') {
      if (!sourceWpId) {
        res.status(400).json({ message: 'Cannot escalate to WP: this task is not linked to a Work Package' });
        return;
      }
      targetScopeId = sourceWpId;
    } else if (targetScope === 'DIVISION') {
      if (!sourceDivisionId) {
        res.status(400).json({ message: 'Cannot escalate to Division: no division could be determined from source' });
        return;
      }
      targetScopeId = sourceDivisionId;
    } else {
      // ORG — no scopeId.
      targetScopeId = null;
    }

    // 6. Determine skipped scopes (levels between source and target that get an INFO_CARD).
    const skipped: Array<{ scope: string; scopeId: number | null }> = [];
    if (sourcePost.scope === 'TASK' && targetScope === 'DIVISION') {
      if (sourceWpId) skipped.push({ scope: 'WP', scopeId: sourceWpId });
    }
    if (sourcePost.scope === 'TASK' && targetScope === 'ORG') {
      if (sourceWpId) skipped.push({ scope: 'WP', scopeId: sourceWpId });
      if (sourceDivisionId) skipped.push({ scope: 'DIVISION', scopeId: sourceDivisionId });
    }
    if (sourcePost.scope === 'WP' && targetScope === 'ORG') {
      if (sourceDivisionId) skipped.push({ scope: 'DIVISION', scopeId: sourceDivisionId });
    }

    // 7. Build the denormalized excerpt (max 200 chars).
    const sourceExcerpt =
      sourcePost.content.length > 200 ? sourcePost.content.slice(0, 197) + '...' : sourcePost.content;

    const actorName = await getUserName(userId);

    // 8. Atomically create the flag, the ESCALATION_CARD, the source-post link, and INFO_CARDs.
    const result = await prisma.$transaction(async (tx) => {
      const flag = await tx.escalationFlag.create({
        data: {
          sourcePostId: sourcePost.id,
          flaggedByUserId: userId,
          reason: reason ?? null,
          targetScope,
          status: 'PENDING'
        }
      });

      const escalationCard = await tx.feedPost.create({
        data: {
          type: 'ESCALATION_CARD',
          scope: targetScope,
          scopeId: targetScopeId,
          authorId: null,
          content: `Escalated by ${actorName}: ${sourceExcerpt}`,
          sourcePostId: sourcePost.id,
          sourceExcerpt,
          sourceTaskId,
          sourceWpId,
          flagId: flag.id
        }
      });

      await tx.feedPost.update({
        where: { id: sourcePost.id },
        data: { flagId: flag.id }
      });

      const infoCards = [];
      for (const { scope, scopeId } of skipped) {
        const card = await tx.feedPost.create({
          data: {
            type: 'INFO_CARD',
            scope,
            scopeId,
            authorId: null,
            content: `A comment was escalated past this level to ${targetScope} feed.`,
            sourcePostId: sourcePost.id,
            sourceExcerpt,
            sourceTaskId,
            sourceWpId,
            flagId: flag.id
          }
        });
        infoCards.push(card);
      }

      return { flag, escalationCard, infoCards };
    });

    // 9. Compliance dual-write — best-effort, never breaks the escalation.
    try {
      await prisma.auditLog.create({
        data: {
          actionType: 'ESCALATION_FLAG_CREATED',
          entityType: 'EscalationFlag',
          entityId: String(result.flag.id),
          performedByUserId: userId,
          details: { sourcePostId: sourcePost.id, targetScope, reason: reason ?? null } as any
        }
      });
    } catch (err) {
      console.error('AuditLog write failed for escalation:', err);
    }

    res.status(201).json({
      flag: result.flag,
      escalationCard: result.escalationCard,
      infoCards: result.infoCards
    });
  } catch (error) {
    console.error('Error escalating post:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── Phase 8.2 Constants ───────────────────────────────────────────────────────

// Task states from which a reassign is blocked (mirrors task.controller.ts).
const FINAL_TASK_STATUSES = ['Closed', 'Rejected', 'Terminated'];

// Valid flag actions. DISMISSED is included (handled like a terminal dismissal).
const VALID_FLAG_ACTIONS = [
  'ACKNOWLEDGED',
  'FINDING_RAISED',
  'DISSEMINATED',
  'TASK_CREATED',
  'REASSIGNED',
  'DISMISSED'
];

/** Generates the next sequential human-readable taskId for a division code. Call inside a $transaction. */
async function generateTaskId(divisionCode: string, tx: Prisma.TransactionClient): Promise<string> {
  const lastTask = await tx.task.findFirst({
    where: { taskId: { startsWith: `${divisionCode}-` }, deletedAt: null },
    orderBy: { id: 'desc' },
    select: { taskId: true }
  });

  let nextSeq = 1;
  if (lastTask?.taskId) {
    const parts = lastTask.taskId.split('-');
    const seqPart = parts[parts.length - 1];
    if (seqPart) nextSeq = parseInt(seqPart, 10) + 1;
  }

  return `${divisionCode}-${String(nextSeq).padStart(6, '0')}`;
}

// ─── GET /api/feed/division/:divisionId ────────────────────────────────────────

export const getDivisionFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(req.params.divisionId as string, 10);

    const division = await prisma.division.findUnique({ where: { id: divisionId }, select: { id: true } });
    if (!division) {
      res.status(404).json({ message: 'Division not found' });
      return;
    }

    // Transparent viewing model — any authenticated user may read.
    const posts = await loadFeed('DIVISION', divisionId);
    res.json({ posts });
  } catch (error) {
    console.error('Error fetching division feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feed/division/:divisionId ───────────────────────────────────────

export const postDivisionMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(req.params.divisionId as string, 10);
    const { userId, role, divisionId: userDivisionId } = req.user!;
    const { content } = req.body;

    const division = await prisma.division.findUnique({ where: { id: divisionId }, select: { id: true } });
    if (!division) {
      res.status(404).json({ message: 'Division not found' });
      return;
    }

    if (!content || !String(content).trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }

    // RBAC: only members of that division can post original messages. Directors bypass.
    if (role !== 'Director' && userDivisionId !== divisionId) {
      res.status(403).json({ message: 'Only members of this division can post to its board' });
      return;
    }

    const post = await prisma.feedPost.create({
      data: {
        type: 'COMMENT',
        scope: 'DIVISION',
        scopeId: divisionId,
        authorId: userId,
        content: String(content).trim(),
        metadata: Prisma.DbNull
      },
      include: { author: { select: { id: true, name: true, role: { select: { name: true } } } } }
    });

    res.status(201).json({
      ...post,
      author: post.author ? { id: post.author.id, name: post.author.name, role: post.author.role?.name ?? null } : null
    });
  } catch (error) {
    console.error('Error posting division message:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/feed/org ─────────────────────────────────────────────────────────

export const getOrgFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionTagRaw = req.query.divisionTag as string | undefined;
    const divisionTag = divisionTagRaw ? parseInt(divisionTagRaw, 10) : undefined;

    // Approach: Prisma JSON `array_contains` filter on taggedDivisionIds.
    // Falls back to fetching all ORG posts (no scopeId — Org posts have scopeId: null).
    const where: Prisma.FeedPostWhereInput =
      divisionTag !== undefined && !Number.isNaN(divisionTag)
        ? { scope: 'ORG', taggedDivisionIds: { array_contains: divisionTag } }
        : { scope: 'ORG' };

    const rawPosts = await prisma.feedPost.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, role: { select: { name: true } } } } }
    });

    const posts = rawPosts.map((p) => ({
      ...p,
      author: p.author ? { id: p.author.id, name: p.author.name, role: p.author.role?.name ?? null } : null
    }));

    res.json({ posts });
  } catch (error) {
    console.error('Error fetching org feed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/feed/org ────────────────────────────────────────────────────────

export const postOrgMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role } = req.user!;
    const { content, taggedDivisionIds } = req.body;

    // RBAC: Director or Manager only.
    if (role !== 'Director' && role !== 'Manager') {
      res.status(403).json({ message: 'Only Directors and Managers can post to the Org Feed' });
      return;
    }

    if (!content || !String(content).trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }

    const post = await prisma.feedPost.create({
      data: {
        type: 'COMMENT',
        scope: 'ORG',
        scopeId: null,
        authorId: userId,
        content: String(content).trim(),
        taggedDivisionIds: taggedDivisionIds ?? Prisma.DbNull,
        metadata: Prisma.DbNull
      },
      include: { author: { select: { id: true, name: true, role: { select: { name: true } } } } }
    });

    res.status(201).json({
      ...post,
      author: post.author ? { id: post.author.id, name: post.author.name, role: post.author.role?.name ?? null } : null
    });
  } catch (error) {
    console.error('Error posting org message:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/feed/flags/pending ───────────────────────────────────────────────

export const getPendingFlags = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, divisionId, userId } = req.user!;

    if (role !== 'Director' && role !== 'Manager') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    let flags;

    if (role === 'Director') {
      // Director sees ALL pending flags regardless of scope or division.
      flags = await prisma.escalationFlag.findMany({
        where: { status: 'PENDING' },
        include: {
          flaggedByUser: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'asc' }
      });
    } else {
      // Manager — scope to their division (WP/DIVISION flags) + all ORG-level flags.
      const allPending = await prisma.escalationFlag.findMany({
        where: { status: 'PENDING' },
        include: {
          flaggedByUser: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'asc' }
      });

      // The ESCALATION_CARD carries the denormalized origin context for each flag.
      const flagIds = allPending.map((f) => f.id);
      const escalationCards = await prisma.feedPost.findMany({
        where: { flagId: { in: flagIds }, type: 'ESCALATION_CARD' }
      });
      const cardByFlagId: Record<number, (typeof escalationCards)[number]> = Object.fromEntries(
        escalationCards.map((c) => [c.flagId!, c])
      );

      // Resolve the origin division via the card's sourceTaskId / sourceWpId.
      const taskIds = escalationCards.filter((c) => c.sourceTaskId).map((c) => c.sourceTaskId!);
      const wpIds = escalationCards.filter((c) => c.sourceWpId).map((c) => c.sourceWpId!);

      const [tasks, wps] = await Promise.all([
        taskIds.length > 0
          ? prisma.task.findMany({
              where: { id: { in: taskIds }, deletedAt: null },
              select: { id: true, targetDivisionId: true }
            })
          : Promise.resolve([] as { id: number; targetDivisionId: number | null }[]),
        wpIds.length > 0
          ? prisma.workPackage.findMany({
              where: { id: { in: wpIds }, deletedAt: null },
              select: { id: true, divisionId: true }
            })
          : Promise.resolve([] as { id: number; divisionId: number }[])
      ]);

      const taskDivMap: Record<number, number | null> = Object.fromEntries(
        tasks.map((t) => [t.id, t.targetDivisionId])
      );
      const wpDivMap: Record<number, number> = Object.fromEntries(wps.map((w) => [w.id, w.divisionId]));

      flags = allPending.filter((flag) => {
        const card = cardByFlagId[flag.id];
        if (!card) return false;
        if (card.scope === 'ORG') return true; // Managers can act on Org-level flags.
        const taskDiv = card.sourceTaskId ? taskDivMap[card.sourceTaskId] : null;
        const wpDiv = card.sourceWpId ? wpDivMap[card.sourceWpId] : null;
        return taskDiv === divisionId || wpDiv === divisionId;
      });
    }

    res.status(200).json({ flags });
  } catch (error) {
    console.error('Error fetching pending flags:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/feed/flags/:flagId/action ────────────────────────────────────────

export const actOnFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    const flagId = parseInt(req.params.flagId as string, 10);
    const { userId, role, divisionId } = req.user!;
    const { action, taggedDivisionIds, findingOverride, taskOverride, newAssigneeId, reason } = req.body;

    // RBAC: Director or Manager only.
    if (role !== 'Director' && role !== 'Manager') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    // Validate action value up-front.
    if (!action || !VALID_FLAG_ACTIONS.includes(action)) {
      res.status(400).json({ message: `action is required and must be one of: ${VALID_FLAG_ACTIONS.join(', ')}` });
      return;
    }

    const flag = await prisma.escalationFlag.findUnique({ where: { id: flagId } });
    if (!flag) {
      res.status(404).json({ message: 'Flag not found' });
      return;
    }
    if (flag.status !== 'PENDING') {
      res.status(400).json({ message: 'Flag has already been actioned' });
      return;
    }

    // EscalationFlag has no Prisma relation to its source post — load it by id.
    const sourcePost = await prisma.feedPost.findUnique({ where: { id: flag.sourcePostId } });
    if (!sourcePost) {
      res.status(404).json({ message: 'Source post for this flag no longer exists' });
      return;
    }
    let linkedEntityId: string | null = null;

    // ─── ACKNOWLEDGED ───────────────────────────────────────────────────────
    if (action === 'ACKNOWLEDGED') {
      await prisma.escalationFlag.update({
        where: { id: flag.id },
        data: {
          status: 'ACTIONED',
          action: 'ACKNOWLEDGED',
          reviewedByUserId: userId,
          actionedAt: new Date()
        }
      });

      // ─── DISMISSED ──────────────────────────────────────────────────────────
    } else if (action === 'DISMISSED') {
      await prisma.escalationFlag.update({
        where: { id: flag.id },
        data: {
          status: 'DISMISSED',
          action: 'DISMISSED',
          reviewedByUserId: userId,
          actionedAt: new Date()
        }
      });

      // ─── FINDING_RAISED ──────────────────────────────────────────────────────
    } else if (action === 'FINDING_RAISED') {
      const eventType = findingOverride?.eventType;
      const departmentId = findingOverride?.departmentId;
      if (!eventType || !departmentId) {
        res.status(400).json({ message: 'departmentId and eventType are required to raise a finding' });
        return;
      }

      const sourceTaskId = sourcePost.sourceTaskId ?? sourcePost.scopeId;
      const finding = await prisma.finding.create({
        data: {
          sourceTaskId: sourceTaskId ?? null,
          reportedByUserId: userId,
          eventType,
          departmentId,
          description: findingOverride?.description ?? sourcePost.sourceExcerpt ?? sourcePost.content,
          status: 'Open'
        }
      });
      linkedEntityId = String(finding.id);

      await prisma.escalationFlag.update({
        where: { id: flag.id },
        data: {
          status: 'ACTIONED',
          action: 'FINDING_RAISED',
          reviewedByUserId: userId,
          actionedAt: new Date(),
          linkedEntityId
        }
      });

      // ─── TASK_CREATED ────────────────────────────────────────────────────────
    } else if (action === 'TASK_CREATED') {
      const templateId = taskOverride?.templateId;
      if (!templateId) {
        res.status(400).json({ message: 'taskOverride.templateId is required to create a task' });
        return;
      }

      // Template model has no deletedAt — must exist and be Published.
      const template = await prisma.template.findFirst({
        where: { id: templateId, status: 'Published' },
        select: { id: true, formSchema: true, divisionId: true, division: { select: { id: true, code: true } } }
      });
      if (!template) {
        res.status(400).json({ message: 'Template not found or not published' });
        return;
      }

      const assignedToUserId: number | undefined = taskOverride?.assignedToUserId;

      const newTask = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Division" WHERE id = ${template.divisionId} FOR UPDATE`;
        const newTaskId = await generateTaskId(template.division.code, tx);
        return tx.task.create({
          data: {
            taskId: newTaskId,
            title: taskOverride?.title ?? null,
            templateId: template.id,
            issuerId: userId,
            assignedToUserId: assignedToUserId ?? null,
            targetDivisionId: template.divisionId,
            status: assignedToUserId ? 'Assigned' : 'Unassigned',
            schemaSnapshot: template.formSchema as any,
            assignmentType: 'INDIVIDUAL'
          }
        });
      });
      linkedEntityId = newTask.taskId;

      await prisma.escalationFlag.update({
        where: { id: flag.id },
        data: {
          status: 'ACTIONED',
          action: 'TASK_CREATED',
          reviewedByUserId: userId,
          actionedAt: new Date(),
          linkedEntityId
        }
      });

      // ─── REASSIGNED ──────────────────────────────────────────────────────────
    } else if (action === 'REASSIGNED') {
      if (!newAssigneeId || !reason?.trim()) {
        res.status(400).json({ message: 'newAssigneeId and reason are required to reassign' });
        return;
      }

      const sourceTaskId =
        sourcePost.sourceTaskId ?? (sourcePost.scope === 'TASK' ? sourcePost.scopeId : null);
      if (!sourceTaskId) {
        res.status(400).json({ message: 'Cannot reassign: no source task found' });
        return;
      }

      const sourceTask = await prisma.task.findUnique({
        where: { id: sourceTaskId, deletedAt: null },
        select: { id: true, status: true }
      });
      if (!sourceTask) {
        res.status(400).json({ message: 'Cannot reassign: no source task found' });
        return;
      }
      if (FINAL_TASK_STATUSES.includes(sourceTask.status)) {
        res.status(400).json({ message: `Cannot reassign a task in a final state (${sourceTask.status})` });
        return;
      }

      const assignee = await prisma.user.findUnique({
        where: { id: newAssigneeId, deletedAt: null },
        select: { id: true, name: true }
      });
      if (!assignee) {
        res.status(404).json({ message: 'New assignee not found' });
        return;
      }

      await prisma.task.update({
        where: { id: sourceTask.id },
        data: { assignedToUserId: newAssigneeId, status: 'Assigned' }
      });

      // Dual write: SYSTEM_EVENT on the task feed + AuditLog.
      await prisma.feedPost.create({
        data: {
          type: 'SYSTEM_EVENT',
          scope: 'TASK',
          scopeId: sourceTask.id,
          authorId: null,
          content: `Task reassigned to ${assignee.name} via escalation flag. Reason: ${reason}`,
          metadata: { fromStatus: sourceTask.status, toStatus: 'Assigned', newAssigneeId } as any
        }
      });
      await prisma.auditLog.create({
        data: {
          actionType: 'TASK_REASSIGNED',
          entityType: 'Task',
          entityId: String(sourceTask.id),
          performedByUserId: userId,
          comment: reason,
          details: { fromStatus: sourceTask.status, toStatus: 'Assigned', newAssigneeId, viaFlagId: flag.id } as any
        }
      });

      linkedEntityId = String(sourceTask.id);

      await prisma.escalationFlag.update({
        where: { id: flag.id },
        data: {
          status: 'ACTIONED',
          action: 'REASSIGNED',
          reviewedByUserId: userId,
          actionedAt: new Date(),
          linkedEntityId
        }
      });

      // ─── DISSEMINATED ────────────────────────────────────────────────────────
    } else if (action === 'DISSEMINATED') {
      await prisma.feedPost.create({
        data: {
          type: 'ESCALATION_CARD',
          scope: 'ORG',
          scopeId: null,
          authorId: null,
          content: sourcePost.sourceExcerpt ?? sourcePost.content,
          sourcePostId: sourcePost.id,
          sourceExcerpt: sourcePost.sourceExcerpt,
          sourceTaskId: sourcePost.sourceTaskId,
          sourceWpId: sourcePost.sourceWpId,
          flagId: flag.id,
          taggedDivisionIds: taggedDivisionIds ?? Prisma.DbNull
        }
      });

      await prisma.escalationFlag.update({
        where: { id: flag.id },
        data: {
          status: 'ACTIONED',
          action: 'DISSEMINATED',
          reviewedByUserId: userId,
          actionedAt: new Date()
        }
      });
    }

    // Compliance audit — written after every action.
    try {
      await prisma.auditLog.create({
        data: {
          actionType: 'ESCALATION_FLAG_ACTIONED',
          entityType: 'EscalationFlag',
          entityId: String(flag.id),
          performedByUserId: userId,
          details: { action, linkedEntityId: linkedEntityId ?? null } as any
        }
      });
    } catch (err) {
      console.error('AuditLog write failed for flag action:', err);
    }

    const updatedFlag = await prisma.escalationFlag.findUnique({ where: { id: flag.id } });
    res.status(200).json({ flag: updatedFlag });
  } catch (error) {
    console.error('Error acting on flag:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
