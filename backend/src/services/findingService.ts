import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Shared with task.controller — kept here to avoid a circular import between
// task.controller and finding.controller.
export const FINAL_TASK_STATUSES = ['Closed', 'Rejected', 'Terminated'];

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Writes a Finding event to BOTH AuditLog (entityType 'Finding', system-wide
 * compliance) AND the source Task's TaskActivity feed (SYSTEM_EVENT).
 *
 * Accepts a Prisma client OR a transaction client so callers that mutate the
 * Finding inside a $transaction keep the dual write atomic. When `sourceTaskId`
 * is null (Finding with no linked source Task) the TaskActivity write is skipped.
 */
export async function logFindingAuditAndActivity(
  client: PrismaLike,
  findingId: number,
  sourceTaskId: number | null,
  actionType: string,
  performedByUserId: number,
  activityContent: string,
  details?: Record<string, unknown>,
  auditComment?: string
): Promise<void> {
  await client.auditLog.create({
    data: {
      actionType,
      entityType: 'Finding',
      entityId: String(findingId),
      performedByUserId,
      comment: auditComment ?? null,
      details: (details as any) ?? Prisma.DbNull
    }
  });

  if (sourceTaskId) {
    await client.feedPost.create({
      data: {
        scope: 'TASK',
        scopeId: sourceTaskId,
        type: 'SYSTEM_EVENT',
        content: activityContent,
        metadata: (details as any) ?? Prisma.DbNull,
        authorId: null
      }
    });
  }
}

/**
 * Pending Verification hook. Call this after a Task reaches a final state
 * (Closed / Rejected / Terminated). If the Task is a follow-up to a Finding and
 * ALL of that Finding's follow-up Tasks are now final, the Finding transitions
 * to "Pending Verification" with a dual audit/activity write.
 *
 * Best-effort and self-contained: never throws, so it cannot break the Task
 * status-change flow that triggers it.
 */
export async function checkAndTriggerPendingVerification(
  finishedTaskId: number,
  performedByUserId: number
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: finishedTaskId },
      select: { parentFindingId: true }
    });
    if (!task?.parentFindingId) return;

    const finding = await prisma.finding.findUnique({
      where: { id: task.parentFindingId, deletedAt: null },
      select: {
        id: true,
        status: true,
        sourceTaskId: true,
        followUpTasks: {
          where: { deletedAt: null },
          select: { id: true, status: true }
        }
      }
    });
    if (!finding) return;

    // Only advance from a pre-verification state — never re-trigger.
    if (finding.status === 'Pending Verification' || finding.status === 'Closed') return;

    const followUps = finding.followUpTasks;
    if (followUps.length === 0) return;

    const allFinal = followUps.every((t) => FINAL_TASK_STATUSES.includes(t.status));
    if (!allFinal) return;

    await prisma.$transaction(async (tx) => {
      await tx.finding.update({
        where: { id: finding.id },
        data: { status: 'Pending Verification' }
      });

      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        'PENDING_VERIFICATION',
        performedByUserId,
        `All follow-up Tasks complete — Finding #${finding.id} is pending verification. Stage 2 fields required.`,
        { findingId: finding.id, fromStatus: finding.status, toStatus: 'Pending Verification' }
      );
    });
  } catch (err) {
    console.error(
      `[checkAndTriggerPendingVerification] Failed for finishedTaskId=${finishedTaskId}:`,
      err
    );
  }
}
