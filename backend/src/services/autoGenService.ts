import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createTaskService } from '../controllers/task.controller';
import { createFeedPost } from './feedService';
import { createNotifications, resolveWpWatchers } from './notificationService';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

// Timezone that anchors BOTH the cron trigger (index.ts) and the "today" date
// math here, so a fire decision can never disagree with when the cron ran.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the calendar date of `instant` in `tz`, as a UTC-midnight Date. This
 * lets us compare against timeframe boundaries (stored as UTC-midnight of a
 * date-only input) and against autoGenFiredAt using whole-day arithmetic, all
 * anchored to the same timezone the cron fires in.
 */
export function calendarDateUtc(instant: Date, tz: string = APP_TIMEZONE): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** Adds whole days to a UTC-midnight date, returning a new UTC-midnight Date. */
export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// JSON payloads (autoGenInlineSet, req.body) may carry numerics as strings;
// coerce before validating so e.g. "7" is treated the same as 7.
function coerceInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isInteger(Number(value))) return Number(value);
  return null;
}

function coerceNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

// ─── Inline template set ────────────────────────────────────────────────────

export interface InlineTemplateSetItem {
  templateId: number;
  orderIndex: number;
  deadlineOffsetDays?: number | null;
  estimatedHours?: number | null;
  skillLevel?: number | null;
  requiresApproval?: boolean | null;
  defaultNote?: string | null;
}

/** Normalized item the spawner consumes, regardless of source (single/set/inline). */
interface ResolvedItem {
  templateId: number;
  orderIndex: number;
  deadlineOffsetDays: number | null;
  estimatedHours: number | null;
  skillLevel: number | null;
  requiresApproval: boolean | null;
  defaultNote: string | null;
}

/** Parses + shape-validates the inline JSON array. Returns items or an error string. */
export function parseInlineSet(raw: unknown): { items: InlineTemplateSetItem[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'autoGenInlineSet must be an array' };
  if (raw.length === 0) return { error: 'autoGenInlineSet must contain at least one item' };
  const items: InlineTemplateSetItem[] = [];
  const seenOrder = new Set<number>();
  for (const [i, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object') return { error: `autoGenInlineSet[${i}] must be an object` };
    const e = entry as Record<string, unknown>;
    const templateId = coerceInt(e.templateId);
    if (templateId === null) return { error: `autoGenInlineSet[${i}].templateId must be an integer` };
    const orderIndex = coerceInt(e.orderIndex) ?? i;
    if (seenOrder.has(orderIndex)) return { error: `autoGenInlineSet has a duplicate orderIndex ${orderIndex}` };
    seenOrder.add(orderIndex);
    items.push({
      templateId,
      orderIndex,
      deadlineOffsetDays: coerceNum(e.deadlineOffsetDays),
      estimatedHours: coerceNum(e.estimatedHours),
      skillLevel: coerceInt(e.skillLevel),
      requiresApproval: typeof e.requiresApproval === 'boolean' ? e.requiresApproval : null,
      defaultNote: typeof e.defaultNote === 'string' ? e.defaultNote : null,
    });
  }
  return { items };
}

// ─── Config validation (used by WP create/update; reusable for blueprint launch) ──

export interface AutoGenConfigInput {
  autoGenerate?: boolean;
  autoGenMode?: string | null;
  autoGenInterval?: number | null;
  autoGenTemplateId?: number | null;
  autoGenSetId?: number | null;
  autoGenInlineSet?: unknown;
}

// Plain column shape assignable to both Prisma create and update data.
export interface AutoGenColumns {
  autoGenerate: boolean;
  autoGenMode: string | null;
  autoGenInterval: number | null;
  autoGenTemplateId: number | null;
  autoGenSetId: number | null;
  autoGenInlineSet: Prisma.InputJsonValue | typeof Prisma.DbNull;
}

/**
 * Validates an auto-generate config (shape + referential existence) and returns
 * the exact columns to persist. On any violation returns `{ error }`; the caller
 * sends a 400. When autoGenerate is false, all autoGen* columns are nulled.
 *
 * Rules:
 *  - mode ∈ {SINGLE_SHOT, REPEAT}
 *  - exactly one source: autoGenTemplateId | autoGenSetId | autoGenInlineSet
 *  - REPEAT ⇒ single template only + positive integer interval
 *  - every referenced template must be Published; a saved set must be active
 */
export async function validateAutoGenConfig(
  client: PrismaLike,
  input: AutoGenConfigInput
): Promise<{ error: string } | { data: AutoGenColumns }> {
  if (!input.autoGenerate) {
    return {
      data: {
        autoGenerate: false,
        autoGenMode: null,
        autoGenInterval: null,
        autoGenTemplateId: null,
        autoGenSetId: null,
        autoGenInlineSet: Prisma.DbNull,
      },
    };
  }

  const mode = input.autoGenMode;
  if (mode !== 'SINGLE_SHOT' && mode !== 'REPEAT') {
    return { error: "autoGenMode must be 'SINGLE_SHOT' or 'REPEAT' when autoGenerate is enabled" };
  }

  const hasTemplate = input.autoGenTemplateId != null;
  const hasSet = input.autoGenSetId != null;
  const inlineProvided = input.autoGenInlineSet != null;
  const sourceCount = [hasTemplate, hasSet, inlineProvided].filter(Boolean).length;
  if (sourceCount !== 1) {
    return { error: 'Exactly one of autoGenTemplateId, autoGenSetId, or autoGenInlineSet must be set' };
  }

  let intervalNum: number | null = null;
  if (mode === 'REPEAT') {
    if (!hasTemplate) {
      return { error: 'REPEAT mode requires a single autoGenTemplateId (sets/inline lists are SINGLE_SHOT only)' };
    }
    intervalNum = coerceInt(input.autoGenInterval);
    if (intervalNum === null || intervalNum < 1) {
      return { error: 'REPEAT mode requires autoGenInterval to be a positive integer (days)' };
    }
  }

  // Referential checks.
  if (hasTemplate) {
    const t = await client.template.findUnique({ where: { id: input.autoGenTemplateId as number }, select: { status: true } });
    if (!t) return { error: 'autoGenTemplateId references a non-existent template' };
    if (t.status !== 'Published') return { error: 'autoGenTemplateId must reference a Published template' };
  }

  let inlineJson: Prisma.InputJsonValue | undefined;
  if (hasSet) {
    const set = await client.templateSet.findUnique({ where: { id: input.autoGenSetId as number }, select: { isActive: true } });
    if (!set) return { error: 'autoGenSetId references a non-existent template set' };
    if (!set.isActive) return { error: 'autoGenSetId references an inactive template set' };
  }
  if (inlineProvided) {
    const parsed = parseInlineSet(input.autoGenInlineSet);
    if ('error' in parsed) return { error: parsed.error };
    const ids = parsed.items.map((i) => i.templateId);
    const templates = await client.template.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
    const byId = new Map(templates.map((t) => [t.id, t.status]));
    for (const id of ids) {
      const status = byId.get(id);
      if (!status) return { error: `autoGenInlineSet references a non-existent template (id=${id})` };
      if (status !== 'Published') return { error: `autoGenInlineSet template id=${id} must be Published` };
    }
    inlineJson = parsed.items as unknown as Prisma.InputJsonValue;
  }

  return {
    data: {
      autoGenerate: true,
      autoGenMode: mode,
      autoGenInterval: mode === 'REPEAT' ? (intervalNum as number) : null,
      autoGenTemplateId: hasTemplate ? (input.autoGenTemplateId as number) : null,
      autoGenSetId: hasSet ? (input.autoGenSetId as number) : null,
      autoGenInlineSet: inlineJson ?? Prisma.DbNull,
    },
  };
}

// ─── Firing ─────────────────────────────────────────────────────────────────

export interface AutoGenResult {
  fired: boolean;
  spawned: number;
  spawnedTaskIds: number[];
  reason?: string;
  warnings?: string[];
}

// System actor for cron-initiated task creation. createTaskService gates on
// hasPrivilege(actor, 'task:create'), which honours actor.permissions first
// (privilegeAccess.ts), so granting the key here authorizes the spawn without a
// human request. Issuer = WP creator; tasks are created Unassigned.
function systemActor(creatorId: number, divisionId: number) {
  return { userId: creatorId, role: 'Director', divisionId, permissions: { 'task:create': true } as Record<string, boolean> };
}

function computeDeadline(timeframeTo: Date, offsetDays: number | null): Date {
  if (!offsetDays) return new Date(timeframeTo);
  return new Date(timeframeTo.getTime() - offsetDays * DAY_MS);
}

/**
 * Resolves a SINGLE_SHOT WP's source into an ordered item list (single template,
 * saved set, or inline JSON). REPEAT WPs always resolve to the single template.
 */
async function resolveItems(tx: Prisma.TransactionClient, wp: {
  autoGenMode: string | null;
  autoGenTemplateId: number | null;
  autoGenSetId: number | null;
  autoGenInlineSet: Prisma.JsonValue | null;
}): Promise<{ items: ResolvedItem[]; error?: string }> {
  const single = (templateId: number): ResolvedItem => ({
    templateId, orderIndex: 0, deadlineOffsetDays: null,
    estimatedHours: null, skillLevel: null, requiresApproval: null, defaultNote: null,
  });

  if (wp.autoGenTemplateId != null) return { items: [single(wp.autoGenTemplateId)] };

  if (wp.autoGenSetId != null) {
    const items = await tx.templateSetItem.findMany({ where: { setId: wp.autoGenSetId }, orderBy: { orderIndex: 'asc' } });
    return {
      items: items.map((i) => ({
        templateId: i.templateId,
        orderIndex: i.orderIndex,
        deadlineOffsetDays: i.deadlineOffsetDays,
        estimatedHours: i.estimatedHours,
        skillLevel: i.skillLevel,
        requiresApproval: i.requiresApproval,
        defaultNote: i.defaultNote,
      })),
    };
  }

  if (wp.autoGenInlineSet != null) {
    const parsed = parseInlineSet(wp.autoGenInlineSet);
    // Malformed inline JSON is reported to the caller (instead of silently
    // resolving to an empty list) so the WP doesn't go permanently quiet.
    if ('error' in parsed) return { items: [], error: parsed.error };
    return {
      items: parsed.items
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((i) => ({
          templateId: i.templateId,
          orderIndex: i.orderIndex,
          deadlineOffsetDays: i.deadlineOffsetDays ?? null,
          estimatedHours: i.estimatedHours ?? null,
          skillLevel: i.skillLevel ?? null,
          requiresApproval: i.requiresApproval ?? null,
          defaultNote: i.defaultNote ?? null,
        })),
    };
  }

  return { items: [] };
}

/**
 * Race-safe, idempotent auto-generate fire for a single WP. Used by both the
 * cron and the on-demand REPEAT catch-up. The whole decision (read state →
 * decide → spawn → stamp autoGenFiredAt) runs in one transaction that first
 * locks the WorkPackage row FOR UPDATE, so a concurrent cron + on-demand call
 * (or a second server instance) can never double-fire.
 */
export async function fireAutoGenForWp(wpId: number, client: PrismaClient = prisma): Promise<AutoGenResult> {
  const outcome = await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "WorkPackage" WHERE id = ${wpId} FOR UPDATE`;


    const wp = await tx.workPackage.findUnique({ where: { id: wpId, deletedAt: null } });
    if (!wp) return { fired: false, spawned: 0, spawnedTaskIds: [], reason: 'Work Package not found' } as AutoGenResult;
    if (!wp.autoGenerate) return { fired: false, spawned: 0, spawnedTaskIds: [], reason: 'Auto-generate disabled' };
    if (wp.status === 'Closed' || wp.status === 'Inactive') {
      return { fired: false, spawned: 0, spawnedTaskIds: [], reason: `Work Package is ${wp.status}` };
    }

    const today = calendarDateUtc(new Date());
    const fromDate = calendarDateUtc(wp.timeframeFrom);
    const toDate = calendarDateUtc(wp.timeframeTo);
    if (today < fromDate) return { fired: false, spawned: 0, spawnedTaskIds: [], reason: 'Work Package has not started' };
    if (today > toDate) return { fired: false, spawned: 0, spawnedTaskIds: [], reason: 'Work Package timeframe has ended' };

    // Mode-specific "should fire now?" gate (the single source of truth is autoGenFiredAt).
    if (wp.autoGenMode === 'REPEAT') {
      const interval = Math.max(1, wp.autoGenInterval ?? 1);
      if (wp.autoGenFiredAt != null) {
        const elapsed = daysBetween(calendarDateUtc(wp.autoGenFiredAt), today);
        if (elapsed < interval) {
          return { fired: false, spawned: 0, spawnedTaskIds: [], reason: 'Repeat interval has not elapsed' };
        }
      }
    } else if (wp.autoGenMode === 'SINGLE_SHOT') {
      if (wp.autoGenFiredAt != null) {
        return { fired: false, spawned: 0, spawnedTaskIds: [], reason: 'Single-shot already fired' };
      }
    } else {
      return { fired: false, spawned: 0, spawnedTaskIds: [], reason: `Unknown autoGenMode: ${wp.autoGenMode}` };
    }

    const resolved = await resolveItems(tx, wp);
    if (resolved.error) {
      // Malformed autoGenInlineSet: surface a visible WP-scope warning each run
      // instead of a silent permanent no-op (dual-write per Rule 3).
      const warnContent = `Auto-generate could not resolve a template source for Work Package ${wp.wpId}: ${resolved.error}`;
      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT',
        scope: 'WP',
        scopeId: wp.id,
        content: warnContent,
        metadata: { mode: wp.autoGenMode, error: resolved.error },
      });
      await tx.auditLog.create({
        data: {
          actionType: 'WP_AUTO_GEN_FAILED',
          entityType: 'WorkPackage',
          entityId: String(wp.id),
          performedByUserId: wp.creatorId,
          details: { wpId: wp.wpId, mode: wp.autoGenMode, error: resolved.error },
        },
      });
      return { fired: false, spawned: 0, spawnedTaskIds: [], reason: resolved.error, warnings: [resolved.error] };
    }
    const items = resolved.items;
    if (items.length === 0) {
      return { fired: false, spawned: 0, spawnedTaskIds: [], reason: 'No template source resolved' };
    }

    // Validate each template is still Published; skip-and-warn so one archived
    // template neither rolls back the batch nor wedges the WP into nightly retry.
    const statuses = await tx.template.findMany({
      where: { id: { in: items.map((i) => i.templateId) } },
      select: { id: true, status: true, templateId: true },
    });
    const statusById = new Map(statuses.map((s) => [s.id, s]));

    const actor = systemActor(wp.creatorId, wp.divisionId);
    const spawnedTaskIds: number[] = [];
    const warnings: string[] = [];

    for (const item of items) {
      const meta = statusById.get(item.templateId);
      if (!meta || meta.status !== 'Published') {
        warnings.push(`Skipped template id=${item.templateId} (${meta?.status ?? 'missing'})`);
        continue;
      }
      const task = await createTaskService(tx, actor, {
        templateId: item.templateId,
        targetDivisionId: wp.divisionId,
        wpId: wp.id,
        assignedToUserId: null,
        deadline: computeDeadline(wp.timeframeTo, item.deadlineOffsetDays),
        estimatedHours: item.estimatedHours,
        skillLevel: item.skillLevel,
        requiresApproval: item.requiresApproval,
        issuanceNote: item.defaultNote,
      });
      spawnedTaskIds.push(task.id);
    }

    // REPEAT with its only template archived: nothing spawned, do not stamp so it
    // can catch up once republished. SINGLE_SHOT always stamps (fired once).
    if (wp.autoGenMode === 'REPEAT' && spawnedTaskIds.length === 0) {
      return { fired: false, spawned: 0, spawnedTaskIds: [], reason: 'Repeat template not Published', warnings };
    }

    await tx.workPackage.update({ where: { id: wp.id }, data: { autoGenFiredAt: new Date() } });

    // WP-scope dual-write summary (per-task dual-write is done by createTaskService).
    const content = `Auto-generated ${spawnedTaskIds.length} task(s) for Work Package ${wp.wpId} (${wp.autoGenMode}).`;
    await createFeedPost(tx, {
      type: 'SYSTEM_EVENT',
      scope: 'WP',
      scopeId: wp.id,
      content,
      metadata: { mode: wp.autoGenMode, spawned: spawnedTaskIds.length, warnings },
    });
    await tx.auditLog.create({
      data: {
        actionType: 'WP_AUTO_GEN_FIRED',
        entityType: 'WorkPackage',
        entityId: String(wp.id),
        performedByUserId: wp.creatorId,
        details: { wpId: wp.wpId, mode: wp.autoGenMode, spawned: spawnedTaskIds.length, warnings },
      },
    });

    return { fired: true, spawned: spawnedTaskIds.length, spawnedTaskIds, warnings };
  // SINGLE_SHOT can loop createTaskService over a saved set with many items;
  // the default 5s interactive-transaction timeout is too tight for that.
  }, { timeout: 30000 });

  // Post-commit: notify WP watchers (best-effort, base client — mirrors task creation).
  // resolveWpWatchers reads the LIVE assignment list, so any member assigned to this
  // WP before the spawn (including those added after WP creation) is covered.
  if (outcome.fired && outcome.spawned > 0) {
    try {
      const watchers = await resolveWpWatchers(prisma, wpId);
      if (watchers.length > 0) {
        await createNotifications(
          prisma,
          watchers.map((userId) => ({
            userId,
            type: 'TASKS_GENERATED' as const,
            title: 'New tasks generated',
            body: `${outcome.spawned} task(s) were auto-generated.`,
            linkScope: 'WP' as const,
            linkId: wpId,
          }))
        );
      }
    } catch (err) {
      console.error(`[fireAutoGenForWp] notification failed for wpId=${wpId}`, err);
    }
  }

  return outcome;
}

/**
 * Nightly sweep: fires auto-generate for every eligible WP. Coarse DB filter;
 * fireAutoGenForWp does the authoritative (locked) timeframe + idempotency
 * checks. One WP's failure never aborts the batch.
 */
export async function runAutoGenCron(client: PrismaClient = prisma): Promise<{ processed: number; fired: number }> {
  let candidates: { id: number }[];
  try {
    candidates = await client.workPackage.findMany({
      where: {
        autoGenerate: true,
        deletedAt: null,
        status: { notIn: ['Closed', 'Inactive'] },
      },
      select: { id: true },
    });
  } catch (err) {
    console.error('[autoGenCron] failed to load candidate Work Packages:', err);
    return { processed: 0, fired: 0 };
  }

  let fired = 0;
  for (const wp of candidates) {
    try {
      const result = await fireAutoGenForWp(wp.id, client);
      if (result.fired) {
        fired++;
        if (result.warnings && result.warnings.length > 0) {
          console.warn(`[autoGenCron] wpId=${wp.id} fired with warnings:`, result.warnings);
        }
      }
    } catch (err) {
      console.error(`[autoGenCron] wpId=${wp.id} failed:`, err);
    }
  }
  console.log(`[autoGenCron] processed ${candidates.length} WP(s), fired ${fired}.`);
  return { processed: candidates.length, fired };
}
