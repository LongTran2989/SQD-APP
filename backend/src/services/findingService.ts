import { PrismaClient, Prisma } from '@prisma/client';
import { createFeedPost } from './feedService';
import { FINAL_TASK_STATUSES } from '../constants/taskStatus';
import {
  FINDING_WORKFLOW_CONFIG_KEY,
  DEFAULT_FINDING_WORKFLOW_CONFIG,
  parseFindingWorkflowConfig,
  closureGateForSeverity,
  type FindingWorkflowConfig,
} from '../constants/findingWorkflowConfig';

import { prisma } from '../lib/prisma';

// Re-exported for back-compat with any module importing it from here; the
// authoritative definition now lives in constants/taskStatus.
export { FINAL_TASK_STATUSES };

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Reads the Admin-configurable finding-workflow policy from SystemSetting,
 * falling back to DEFAULT_FINDING_WORKFLOW_CONFIG when the row is absent or
 * invalid. Mirrors loadFileUploadConfig (attachmentService.ts).
 */
export async function getFindingWorkflowConfig(
  client: PrismaLike = prisma
): Promise<FindingWorkflowConfig> {
  const row = await client.systemSetting.findUnique({ where: { key: FINDING_WORKFLOW_CONFIG_KEY } });
  if (!row) return DEFAULT_FINDING_WORKFLOW_CONFIG;
  try {
    return parseFindingWorkflowConfig(JSON.parse(row.value)) ?? DEFAULT_FINDING_WORKFLOW_CONFIG;
  } catch {
    return DEFAULT_FINDING_WORKFLOW_CONFIG;
  }
}

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
      details: (details as Prisma.InputJsonValue) ?? Prisma.DbNull
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

export async function evaluateCloseGate(
  findingId: number
): Promise<{ ok: boolean; reason?: string }> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId, deletedAt: null },
    select: {
      severity: true,
      rca: { select: { status: true } },
      capaActions: {
        where: { deletedAt: null },
        select: { id: true, type: true, status: true },
      },
    },
  });
  if (!finding) return { ok: false, reason: 'Finding not found' };

  // Severity-configurable closed-loop policy (Admin-managed; default makes RCA +
  // a verified corrective CAPA mandatory for Level 1/Level 2, Observations free).
  const config = await getFindingWorkflowConfig();
  const gate = closureGateForSeverity(config, finding.severity);

  // Gate 1 (presence): a graded finding must have a Complete RCA recorded.
  if (gate.requireRca && !finding.rca) {
    return { ok: false, reason: 'A completed Root Cause Analysis is required before closing this finding' };
  }
  // Gate 1 (completeness): an RCA that exists must be Complete — always enforced.
  if (finding.rca && finding.rca.status !== 'Complete') {
    return { ok: false, reason: 'RCA must be marked Complete before closing' };
  }

  // Gate 2 (presence): a graded finding must have at least one corrective CAPA.
  const corrective = finding.capaActions.filter((c) => c.type === 'CORRECTIVE');
  if (gate.requireCorrectiveCapa && corrective.length === 0) {
    return { ok: false, reason: 'At least one verified corrective action is required before closing this finding' };
  }
  // Gate 2 (completeness): every CORRECTIVE CAPA must be Verified — always enforced.
  // PREVENTIVE CAPAs do NOT block closure — long-term effectiveness is monitored
  // post-closure.
  for (const capa of corrective) {
    if (capa.status !== 'Verified') {
      return {
        ok: false,
        reason: `Corrective action #${capa.id} must be Verified before closing`,
      };
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
        `All follow-up Tasks complete — Finding #${finding.id} is ready for verification and closure.`,
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
