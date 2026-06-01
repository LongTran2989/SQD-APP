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
