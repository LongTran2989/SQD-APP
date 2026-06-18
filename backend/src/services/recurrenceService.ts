import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createWorkPackageService } from '../controllers/wp.controller';
import { validateAutoGenConfig, calendarDateUtc, addDaysUtc } from './autoGenService';
import { createNotifications, resolvePrivilegedUserIds, NotificationInput } from './notificationService';

// P7 — Recurrence automation. A WpBlueprint with recurrenceType set auto-launches
// a routine WorkPackage every recurrenceInterval days. Two modes:
//   CALENDAR  — fires on a fixed cadence (nextRunAt advances by interval each fire,
//               independent of whether the prior instance finished).
//   LAST_DONE — fires interval days after the *previous instance was closed*; while
//               an instance is open, nextRunAt is null (no scheduled run). The WP
//               close path re-arms nextRunAt via rearmLastDoneRecurrence.
//
// Mirrors autoGenService's race-safe pattern: a single transaction that first locks
// the WpBlueprint row FOR UPDATE, re-checks eligibility under the lock (so a
// concurrent cron / second instance can never double-fire), creates the WP via the
// shared createWorkPackageService (the sole WP-minting path), then advances nextRunAt.

export const CALENDAR = 'CALENDAR';
export const LAST_DONE = 'LAST_DONE';

export interface RecurrenceFireResult {
  fired: boolean;
  reason?: string;
  workPackageId?: number;
}

/**
 * Race-safe, idempotent recurrence fire for a single blueprint. Locks the
 * blueprint row, re-checks (isActive + recurrenceType + nextRunAt due) under the
 * lock, launches one routine WP, and advances nextRunAt.
 */
export async function fireRecurrenceForBlueprint(
  blueprintId: number,
  client: PrismaClient = prisma
): Promise<RecurrenceFireResult> {
  // Notify-context captured inside the transaction and emitted only after commit,
  // so a notification failure can never roll back the launch (best-effort THIRD
  // write — mirrors autoGenService's post-commit notify).
  let launched: LaunchSuccessContext | null = null;
  let failed: LaunchFailureContext | null = null;

  const result = await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "WpBlueprint" WHERE id = ${blueprintId} FOR UPDATE`;

    const bp = await tx.wpBlueprint.findUnique({ where: { id: blueprintId } });
    if (!bp) return { fired: false, reason: 'Blueprint not found' };
    if (!bp.isActive) return { fired: false, reason: 'Blueprint is disabled' };
    if (!bp.recurrenceType || !bp.recurrenceInterval || bp.recurrenceInterval < 1) {
      return { fired: false, reason: 'Blueprint has no active recurrence' };
    }
    if (bp.nextRunAt == null) return { fired: false, reason: 'No run scheduled' };

    const today = calendarDateUtc(new Date());
    if (calendarDateUtc(bp.nextRunAt) > today) {
      return { fired: false, reason: 'Next run is in the future' };
    }

    // Re-validate the autogen defaults at fire time — a referenced template/set may
    // have been archived since the blueprint was saved (same caution as launch).
    const autoGen = await validateAutoGenConfig(tx, {
      autoGenerate: bp.defaultAutoGenerate,
      autoGenMode: bp.defaultAutoGenMode,
      autoGenInterval: bp.defaultAutoGenInterval,
      autoGenTemplateId: bp.defaultAutoGenTemplateId,
      autoGenSetId: bp.defaultAutoGenSetId,
      autoGenInlineSet: bp.defaultAutoGenInlineSet ?? undefined,
    });
    if ('error' in autoGen) {
      // Do not advance nextRunAt — the schedule retries next night once the
      // referenced template/set is republished. Surface via AuditLog.
      await tx.auditLog.create({
        data: {
          actionType: 'BLUEPRINT_AUTO_LAUNCH_FAILED',
          entityType: 'WpBlueprint',
          entityId: String(bp.id),
          performedByUserId: bp.ownerId,
          details: { blueprintId: bp.id, blueprintName: bp.name, error: autoGen.error },
        },
      });
      failed = {
        blueprintId: bp.id,
        blueprintName: bp.name,
        divisionId: bp.divisionId,
        ownerId: bp.ownerId,
        error: autoGen.error,
      };
      return { fired: false, reason: autoGen.error };
    }

    const fromDate = today;
    const toDate = addDaysUtc(today, bp.defaultDuration);

    const wp = await createWorkPackageService(tx, { userId: bp.ownerId }, {
      name: bp.name,
      type: bp.type,
      divisionId: bp.divisionId,
      timeframeFrom: fromDate,
      timeframeTo: toDate,
      typeFields: {
        acRegistration: bp.acRegistration,
        customer: bp.customer,
        authority: bp.authority,
        targetDepartmentId: bp.targetDepartmentId,
      },
      autoGenData: autoGen.data,
      blueprintId: bp.id,
      isRoutine: true,
      auditActionType: 'BLUEPRINT_AUTO_LAUNCHED',
      auditDetails: { blueprintId: bp.id, blueprintName: bp.name, recurrenceType: bp.recurrenceType },
      systemEventContent: `Routine Work Package "${bp.name}" auto-launched from blueprint (${bp.recurrenceType}).`,
    });

    // Advance the schedule.
    let nextRunAt: Date | null;
    if (bp.recurrenceType === CALENDAR) {
      // Chain off the scheduled date (not "today") so the cadence never drifts;
      // skip any cycles missed by a late/paused cron so we never burst-fire.
      let next = addDaysUtc(calendarDateUtc(bp.nextRunAt), bp.recurrenceInterval);
      while (next <= today) next = addDaysUtc(next, bp.recurrenceInterval);
      nextRunAt = next;
    } else {
      // LAST_DONE: nothing scheduled until this instance is closed (re-armed then).
      nextRunAt = null;
    }
    await tx.wpBlueprint.update({ where: { id: bp.id }, data: { nextRunAt } });

    launched = {
      wpId: wp.id,
      wpCode: wp.wpId,
      blueprintId: bp.id,
      blueprintName: bp.name,
      divisionId: bp.divisionId,
      ownerId: bp.ownerId,
    };
    return { fired: true, workPackageId: wp.id };
  }, { timeout: 30000 });

  // Post-commit notifications (best-effort; never affect the returned fire result).
  if (launched) {
    await notifyLaunchSuccess(launched).catch((err) =>
      console.error(`[recurrence] launch notification failed for blueprintId=${blueprintId}`, err)
    );
  } else if (failed) {
    await notifyLaunchFailure(failed).catch((err) =>
      console.error(`[recurrence] failure notification failed for blueprintId=${blueprintId}`, err)
    );
  }

  return result;
}

// ─── Launch notifications (Part A) ───────────────────────────────────────────
// Recipients = blueprint owner + the division's WP managers. resolvePrivilegedUserIds
// also pulls in Director/Admin cross-division — the oversight set for routine work.

interface LaunchSuccessContext {
  wpId: number;
  wpCode: string;
  blueprintId: number;
  blueprintName: string;
  divisionId: number;
  ownerId: number;
}

interface LaunchFailureContext {
  blueprintId: number;
  blueprintName: string;
  divisionId: number;
  ownerId: number;
  error: string;
}

async function resolveLaunchRecipients(ownerId: number, divisionId: number): Promise<number[]> {
  const managers = await resolvePrivilegedUserIds(prisma, 'wp:create', divisionId);
  return Array.from(new Set([ownerId, ...managers]));
}

async function notifyLaunchSuccess(ctx: LaunchSuccessContext): Promise<void> {
  const recipients = await resolveLaunchRecipients(ctx.ownerId, ctx.divisionId);
  await createNotifications(
    prisma,
    recipients.map((userId) => ({
      userId,
      type: 'BLUEPRINT_LAUNCHED' as const,
      title: 'Routine work package launched',
      body: `"${ctx.blueprintName}" (${ctx.wpCode}) was auto-created from a recurring blueprint.`,
      linkScope: 'WP' as const,
      linkId: ctx.wpId,
      metadata: { outcome: 'launched', blueprintId: ctx.blueprintId },
    }))
  );
}

async function notifyLaunchFailure(ctx: LaunchFailureContext): Promise<void> {
  const recipients = await resolveLaunchRecipients(ctx.ownerId, ctx.divisionId);

  // Anti-spam: a failed launch retries every night (nextRunAt is not advanced on
  // failure), so skip any recipient who still has an UNREAD failure notice for this
  // blueprint — they are reminded once, not once per night until they fix it.
  const inputs: NotificationInput[] = [];
  for (const userId of recipients) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: 'BLUEPRINT_LAUNCHED',
        readAt: null,
        AND: [
          { metadata: { path: ['outcome'], equals: 'failed' } },
          { metadata: { path: ['blueprintId'], equals: ctx.blueprintId } },
        ],
      },
      select: { id: true },
    });
    if (existing) continue;
    inputs.push({
      userId,
      type: 'BLUEPRINT_LAUNCHED',
      title: 'Blueprint auto-launch failed',
      body: `"${ctx.blueprintName}" could not auto-launch: ${ctx.error}. The schedule will retry.`,
      linkScope: null,
      linkId: null,
      metadata: { outcome: 'failed', blueprintId: ctx.blueprintId, error: ctx.error },
    });
  }
  if (inputs.length > 0) await createNotifications(prisma, inputs);
}

/**
 * Re-arms a LAST_DONE blueprint after one of its instances is closed: sets
 * nextRunAt = closedAt + recurrenceInterval days. No-op for CALENDAR blueprints
 * or WPs with no blueprint origin. Call inside the WP close transaction.
 */
export async function rearmLastDoneRecurrence(
  tx: Prisma.TransactionClient,
  wp: { blueprintId: number | null; closedAt: Date | null }
): Promise<void> {
  if (wp.blueprintId == null || wp.closedAt == null) return;

  await tx.$queryRaw`SELECT id FROM "WpBlueprint" WHERE id = ${wp.blueprintId} FOR UPDATE`;
  const bp = await tx.wpBlueprint.findUnique({ where: { id: wp.blueprintId } });
  if (!bp || bp.recurrenceType !== LAST_DONE || !bp.recurrenceInterval || bp.recurrenceInterval < 1) return;

  const nextRunAt = addDaysUtc(calendarDateUtc(wp.closedAt), bp.recurrenceInterval);
  await tx.wpBlueprint.update({ where: { id: bp.id }, data: { nextRunAt } });
}

/**
 * Nightly sweep: fires recurrence for every blueprint whose nextRunAt is due.
 * Coarse DB filter; fireRecurrenceForBlueprint does the authoritative (locked)
 * eligibility check. One blueprint's failure never aborts the batch.
 */
export async function runRecurrenceCron(
  client: PrismaClient = prisma
): Promise<{ processed: number; fired: number }> {
  const today = calendarDateUtc(new Date());
  let candidates: { id: number }[];
  try {
    candidates = await client.wpBlueprint.findMany({
      where: {
        isActive: true,
        recurrenceType: { not: null },
        nextRunAt: { not: null, lte: today },
      },
      select: { id: true },
    });
  } catch (err) {
    console.error('[recurrenceCron] failed to load candidate blueprints:', err);
    return { processed: 0, fired: 0 };
  }

  let fired = 0;
  for (const bp of candidates) {
    try {
      const result = await fireRecurrenceForBlueprint(bp.id, client);
      if (result.fired) fired++;
    } catch (err) {
      console.error(`[recurrenceCron] blueprintId=${bp.id} failed:`, err);
    }
  }
  console.log(`[recurrenceCron] processed ${candidates.length} blueprint(s), fired ${fired}.`);
  return { processed: candidates.length, fired };
}
