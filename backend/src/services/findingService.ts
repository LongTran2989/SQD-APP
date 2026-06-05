import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { createFeedPost } from './feedService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Shared with task.controller — kept here to avoid a circular import between
// task.controller and finding.controller.
export const FINAL_TASK_STATUSES = ['Closed', 'Rejected', 'Terminated'];

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Writes a Finding event to BOTH AuditLog (entityType 'Finding', system-wide
 * compliance) AND the source Task's feed (FeedPost, scope 'TASK', SYSTEM_EVENT).
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
    await createFeedPost(client, {
      type: 'SYSTEM_EVENT',
      scope: 'TASK',
      scopeId: sourceTaskId,
      content: activityContent,
      metadata: details,
      authorId: null
    });
  }
}

/**
 * Conditional close-gate for the expansion pack. Additive and backward-compatible:
 * the legacy rootCause/correctiveAction checks stay in the controller and ALWAYS
 * apply. This helper only adds constraints WHEN RCA / CAPA data exists, so legacy
 * findings (no RCA, no CAPA) close exactly as before.
 *
 *  - If an RcaInvestigation exists, it must be status 'Complete'.
 *  - If any CapaAction exists, every CORRECTIVE must be 'Verified' and every
 *    PREVENTIVE must be 'Verified' or 'Waived'.
 *
 * Returns { ok } or { ok:false, reason } for the caller to map to a 400.
 */
export async function evaluateCloseGate(
  findingId: number
): Promise<{ ok: boolean; reason?: string }> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId, deletedAt: null },
    select: {
      rca: { select: { status: true } },
      capaActions: { select: { type: true, status: true } },
    },
  });
  if (!finding) return { ok: false, reason: 'Finding not found' };

  if (finding.rca && finding.rca.status !== 'Complete') {
    return { ok: false, reason: 'The Root Cause Analysis must be marked Complete before closing' };
  }

  for (const capa of finding.capaActions) {
    if (capa.type === 'CORRECTIVE' && capa.status !== 'Verified') {
      return { ok: false, reason: 'All corrective actions must be verified effective before closing' };
    }
    if (capa.type === 'PREVENTIVE' && capa.status !== 'Verified' && capa.status !== 'Waived') {
      return { ok: false, reason: 'All preventive actions must be verified or waived before closing' };
    }
  }

  return { ok: true };
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
