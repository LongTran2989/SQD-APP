import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hasPrivilege } from '../utils/privilegeAccess';
import { createFeedPost } from '../services/feedService';

const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Non-final task statuses shown in workload preview
const OPEN_STATUSES = ['Unassigned', 'Assigned', 'InProgress', 'InReview', 'Review', 'FollowupRequired'];

// Convert Excel time fraction to "HH:MM" string
function fractionToTime(frac: number): string {
  const totalMinutes = Math.round(frac * 24 * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
void fractionToTime; // used in seed only

// ── helpers ───────────────────────────────────────────────────────────────────

function canEdit(req: Request, divisionId: number): boolean {
  if (!req.user) return false;
  if (!hasPrivilege(req.user, 'schedule:edit')) return false;
  // Director / Admin may edit any division
  if (req.user.role === 'Director' || req.user.role === 'Admin') return true;
  return req.user.divisionId === divisionId;
}

function canPublish(req: Request, divisionId: number): boolean {
  if (!req.user) return false;
  if (!hasPrivilege(req.user, 'schedule:publish')) return false;
  if (req.user.role === 'Director' || req.user.role === 'Admin') return true;
  return req.user.divisionId === divisionId;
}

// For a given (userId, date) return the effective ScheduleEntry.
// Draft (publishedAt IS NULL) overrides published for the same slotIndex.
async function effectiveEntries(userId: number, date: Date) {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const rows = await prisma.scheduleEntry.findMany({
    where: { userId, date: { gte: dayStart, lt: dayEnd }, deletedAt: null },
    include: { shiftType: true },
    orderBy: [{ slotIndex: 'asc' }, { publishedAt: 'asc' }],
  });

  // Group by slotIndex; draft wins over published for the same slot
  const bySlot = new Map<number, typeof rows[number]>();
  for (const row of rows) {
    const existing = bySlot.get(row.slotIndex);
    if (!existing || existing.publishedAt !== null) {
      bySlot.set(row.slotIndex, row);
    }
  }
  return [...bySlot.values()].sort((a, b) => a.slotIndex - b.slotIndex);
}

// ── GET /api/schedules/:divisionId ───────────────────────────────────────────

export const getSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'schedule:view')) {
      res.status(403).json({ message: 'Insufficient permissions to view schedules' });
      return;
    }
    const divisionId = parseInt(String(req.params.divisionId), 10);
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

    if (!dateFrom || !dateTo) {
      res.status(400).json({ message: 'dateFrom and dateTo are required' });
      return;
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);

    const isManager = canEdit(req, divisionId);

    // Schedule entries: managers see draft+published; others see published only
    const entries = await prisma.scheduleEntry.findMany({
      where: {
        divisionId,
        date: { gte: from, lte: to },
        deletedAt: null,
        ...(isManager ? {} : { publishedAt: { not: null } }),
      },
      include: { shiftType: true },
      orderBy: [{ userId: 'asc' }, { date: 'asc' }, { slotIndex: 'asc' }],
    });

    // Tasks with schedule bar data (assignedAt/startDate → deadline)
    const tasks = await prisma.task.findMany({
      where: {
        deletedAt: null,
        assignedToUser: { divisionId, deletedAt: null },
        OR: [
          { deadline: { gte: from, lte: to } },
          { assignedAt: { gte: from, lte: to } },
          { startDate: { gte: from, lte: to } },
          // tasks spanning the window
          { assignedAt: { lt: from }, deadline: { gte: from } },
        ],
      },
      select: {
        id: true, taskId: true, title: true, status: true,
        assignedToUserId: true, deadline: true, assignedAt: true, startDate: true,
        wpId: true, wp: { select: { wpId: true, name: true } },
      },
    });

    // WP memberships active in the date window
    const wpAssignments = await prisma.workPackageAssignment.findMany({
      where: {
        user: { divisionId, deletedAt: null },
        wp: {
          deletedAt: null,
          timeframeFrom: { lte: to },
          timeframeTo: { gte: from },
        },
      },
      include: {
        wp: { select: { id: true, wpId: true, name: true, timeframeFrom: true, timeframeTo: true } },
      },
    });

    // Lock state (managers only)
    let lock = null;
    if (isManager) {
      const lockRow = await prisma.scheduleEditLock.findUnique({ where: { divisionId } });
      if (lockRow) {
        const expired = lockRow.lockExpiresAt < new Date();
        lock = {
          lockedByUserId: lockRow.lockedByUserId,
          lockExpiresAt: lockRow.lockExpiresAt,
          isExpired: expired,
          heldByMe: lockRow.lockedByUserId === req.user!.userId,
        };
      }
    }

    res.json({ entries, tasks, wpAssignments, lock });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── PUT /api/schedules/:divisionId/entries (bulk upsert draft) ───────────────

export const upsertEntries = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    if (!canEdit(req, divisionId)) {
      res.status(403).json({ message: 'Insufficient permissions to edit this schedule' });
      return;
    }

    const entries: Array<{
      userId: number;
      date: string;
      slotIndex?: number;
      shiftTypeId: number;
      note?: string;
    }> = req.body.entries;

    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ message: 'entries array is required' });
      return;
    }

    // Validate shiftTypeIds exist
    const shiftTypeIds = [...new Set(entries.map((e) => e.shiftTypeId))];
    const validShiftTypes = await prisma.shiftType.findMany({
      where: { id: { in: shiftTypeIds }, isActive: true },
      select: { id: true },
    });
    const validIds = new Set(validShiftTypes.map((s) => s.id));
    const invalid = shiftTypeIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      res.status(400).json({ message: `Invalid or inactive shiftTypeIds: ${invalid.join(', ')}` });
      return;
    }

    // Upsert each entry as a draft (publishedAt = null).
    // Strategy: soft-delete any existing draft for the same (userId, date, slotIndex),
    // then create a fresh draft row. This preserves audit history.
    const results = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const e of entries) {
        const date = new Date(e.date);
        date.setUTCHours(0, 0, 0, 0);
        const slotIndex = e.slotIndex ?? 0;

        // Soft-delete previous draft for this slot (not published rows — those stay until publish)
        await tx.scheduleEntry.updateMany({
          where: {
            userId: e.userId,
            divisionId,
            date,
            slotIndex,
            publishedAt: null,
            deletedAt: null,
          },
          data: { deletedAt: new Date() },
        });

        const row = await tx.scheduleEntry.create({
          data: {
            userId: e.userId,
            divisionId,
            date,
            slotIndex,
            shiftTypeId: e.shiftTypeId,
            note: e.note ?? null,
            publishedAt: null,
          },
          include: { shiftType: true },
        });
        created.push(row);
      }
      return created;
    });

    res.json({ created: results.length, entries: results });
  } catch (error) {
    console.error('Error upserting schedule entries:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── DELETE /api/schedules/:divisionId/entries/:entryId ───────────────────────

export const deleteEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    if (!canEdit(req, divisionId)) {
      res.status(403).json({ message: 'Insufficient permissions to edit this schedule' });
      return;
    }
    const entryId = parseInt(String(req.params.entryId), 10);
    const entry = await prisma.scheduleEntry.findFirst({
      where: { id: entryId, divisionId, deletedAt: null },
    });
    if (!entry) {
      res.status(404).json({ message: 'Entry not found' });
      return;
    }
    await prisma.scheduleEntry.update({
      where: { id: entryId },
      data: { deletedAt: new Date() },
    });
    res.json({ message: 'Entry deleted' });
  } catch (error) {
    console.error('Error deleting schedule entry:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── POST /api/schedules/:divisionId/publish ───────────────────────────────────

export const publishSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    if (!canPublish(req, divisionId)) {
      res.status(403).json({ message: 'Insufficient permissions to publish this schedule' });
      return;
    }

    const division = await prisma.division.findUnique({ where: { id: divisionId } });
    if (!division) {
      res.status(404).json({ message: 'Division not found' });
      return;
    }

    const actor = req.user!;
    const note: string | undefined = req.body.note;
    const now = new Date();

    // Fetch actor name for feed content (not stored on AuthPayload)
    const actorUser = await prisma.user.findUnique({
      where: { id: actor.userId, deletedAt: null },
      select: { name: true },
    });
    const actorName = actorUser?.name ?? `User #${actor.userId}`;

    const result = await prisma.$transaction(async (tx) => {
      // All active drafts for this division
      const drafts = await tx.scheduleEntry.findMany({
        where: { divisionId, publishedAt: null, deletedAt: null },
      });

      if (drafts.length === 0) {
        return { published: 0, dateFrom: null, dateTo: null };
      }

      const dates = drafts.map((d) => d.date.getTime());
      const dateFrom = new Date(Math.min(...dates));
      const dateTo = new Date(Math.max(...dates));

      // For each draft, soft-delete the existing published entry for the same slot
      for (const draft of drafts) {
        await tx.scheduleEntry.updateMany({
          where: {
            userId: draft.userId,
            divisionId,
            date: draft.date,
            slotIndex: draft.slotIndex,
            publishedAt: { not: null },
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
      }

      // Stamp publishedAt on all drafts
      await tx.scheduleEntry.updateMany({
        where: { id: { in: drafts.map((d) => d.id) } },
        data: { publishedAt: now, publishedBy: actor.userId },
      });

      // Conflict count: tasks due on non-work days
      const conflicts = await tx.scheduleEntry.count({
        where: {
          divisionId,
          publishedAt: now,
          deletedAt: null,
          shiftType: { isWorkDay: false },
          user: {
            assignedTasks: {
              some: {
                deadline: { gte: dateFrom, lte: dateTo },
                deletedAt: null,
                status: { notIn: ['Closed', 'Terminated', 'Rejected'] },
              },
            },
          },
        },
      });

      const content = `Schedule published by ${actorName} — ${dateFrom.toISOString().slice(0, 10)} to ${dateTo.toISOString().slice(0, 10)}${note ? `: ${note}` : ''}`;

      // Dual write: AuditLog + FeedPost (Rule 3)
      await tx.auditLog.create({
        data: {
          actionType: 'SCHEDULE_PUBLISH',
          entityType: 'SCHEDULE',
          entityId: String(divisionId),
          performedByUserId: actor.userId,
          comment: note ?? null,
          details: { dateFrom, dateTo, entryCount: drafts.length, conflicts } as unknown as Prisma.InputJsonValue,
        },
      });

      await createFeedPost(tx, {
        type: 'SYSTEM_EVENT',
        scope: 'DIVISION',
        scopeId: divisionId,
        authorId: actor.userId,
        content,
        metadata: { dateFrom, dateTo, entryCount: drafts.length, conflicts },
      });

      return { published: drafts.length, dateFrom, dateTo, conflicts };
    });

    res.json(result);
  } catch (error) {
    console.error('Error publishing schedule:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── Lock management ──────────────────────────────────────────────────────────

export const getLock = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    if (!hasPrivilege(req.user!, 'schedule:edit')) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    const lock = await prisma.scheduleEditLock.findUnique({ where: { divisionId } });
    if (!lock) { res.json({ locked: false }); return; }
    res.json({
      locked: true,
      lockedByUserId: lock.lockedByUserId,
      lockExpiresAt: lock.lockExpiresAt,
      isExpired: lock.lockExpiresAt < new Date(),
      heldByMe: lock.lockedByUserId === req.user!.userId,
    });
  } catch (error) {
    console.error('Error getting schedule lock:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const acquireLock = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    if (!canEdit(req, divisionId)) {
      res.status(403).json({ message: 'Insufficient permissions to edit this schedule' });
      return;
    }
    const actor = req.user!;
    const expiry = new Date(Date.now() + LOCK_TTL_MS);

    const existing = await prisma.scheduleEditLock.findUnique({ where: { divisionId } });
    if (existing && existing.lockExpiresAt > new Date() && existing.lockedByUserId !== actor.userId) {
      res.status(409).json({
        message: 'Schedule is being edited by another manager',
        lockedByUserId: existing.lockedByUserId,
        lockExpiresAt: existing.lockExpiresAt,
      });
      return;
    }

    const lock = await prisma.scheduleEditLock.upsert({
      where: { divisionId },
      create: { divisionId, lockedByUserId: actor.userId, lockExpiresAt: expiry },
      update: { lockedByUserId: actor.userId, lockExpiresAt: expiry },
    });
    res.json({ locked: true, lockExpiresAt: lock.lockExpiresAt });
  } catch (error) {
    console.error('Error acquiring schedule lock:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const releaseLock = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    const existing = await prisma.scheduleEditLock.findUnique({ where: { divisionId } });
    if (existing && existing.lockedByUserId === req.user!.userId) {
      await prisma.scheduleEditLock.delete({ where: { divisionId } });
    }
    res.json({ message: 'Lock released' });
  } catch (error) {
    console.error('Error releasing schedule lock:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const takeoverLock = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    if (!canEdit(req, divisionId)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    const existing = await prisma.scheduleEditLock.findUnique({ where: { divisionId } });
    if (existing && existing.lockExpiresAt > new Date()) {
      res.status(409).json({ message: 'Lock is still active — cannot take over' });
      return;
    }
    const expiry = new Date(Date.now() + LOCK_TTL_MS);
    const lock = await prisma.scheduleEditLock.upsert({
      where: { divisionId },
      create: { divisionId, lockedByUserId: req.user!.userId, lockExpiresAt: expiry },
      update: { lockedByUserId: req.user!.userId, lockExpiresAt: expiry },
    });
    res.json({ locked: true, lockExpiresAt: lock.lockExpiresAt });
  } catch (error) {
    console.error('Error taking over schedule lock:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── GET /api/schedules/conflict-check ────────────────────────────────────────

export const conflictCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ message: 'Unauthorized' }); return; }
    const userId = parseInt(String(req.query.userId), 10);
    const date = req.query.date ? new Date(String(req.query.date)) : null;

    if (!userId || !date || isNaN(date.getTime())) {
      res.status(400).json({ message: 'userId and date are required' });
      return;
    }

    const entries = await effectiveEntries(userId, date);
    if (entries.length === 0) {
      res.json({ entry: null });
      return;
    }

    // Return first slot's effective entry for the conflict check
    const entry = entries[0] ?? null;
    if (!entry) { res.json({ entry: null }); return; }
    res.json({
      entry: {
        shiftTypeCode: entry.shiftType.code,
        shiftTypeName: entry.shiftType.name,
        isWorkDay: entry.shiftType.isWorkDay,
        isDraft: entry.publishedAt === null,
      },
    });
  } catch (error) {
    console.error('Error checking schedule conflict:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── Copy week ─────────────────────────────────────────────────────────────────

export const copyWeek = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    if (!canEdit(req, divisionId)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    const { sourceFrom, sourceTo } = req.body as { sourceFrom: string; sourceTo: string };
    if (!sourceFrom || !sourceTo) {
      res.status(400).json({ message: 'sourceFrom and sourceTo are required' });
      return;
    }

    const from = new Date(sourceFrom);
    const to = new Date(sourceTo);
    from.setUTCHours(0, 0, 0, 0);
    to.setUTCHours(23, 59, 59, 999);

    // Effective entries (draft overrides published) for the source window
    const sourceEntries = await prisma.scheduleEntry.findMany({
      where: { divisionId, date: { gte: from, lte: to }, deletedAt: null },
      orderBy: [{ date: 'asc' }, { slotIndex: 'asc' }, { publishedAt: 'asc' }],
    });

    // Deduplicate: draft wins per (userId, date, slotIndex)
    const effectiveMap = new Map<string, typeof sourceEntries[number]>();
    for (const e of sourceEntries) {
      const key = `${e.userId}|${e.date.toISOString().slice(0, 10)}|${e.slotIndex}`;
      const existing = effectiveMap.get(key);
      if (!existing || existing.publishedAt !== null) effectiveMap.set(key, e);
    }

    const offsetDays = 7;
    const created = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const e of effectiveMap.values()) {
        const targetDate = new Date(e.date);
        targetDate.setUTCDate(targetDate.getUTCDate() + offsetDays);

        // Soft-delete existing draft for target slot
        await tx.scheduleEntry.updateMany({
          where: { userId: e.userId, divisionId, date: targetDate, slotIndex: e.slotIndex, publishedAt: null, deletedAt: null },
          data: { deletedAt: new Date() },
        });

        const row = await tx.scheduleEntry.create({
          data: {
            userId: e.userId,
            divisionId,
            date: targetDate,
            slotIndex: e.slotIndex,
            shiftTypeId: e.shiftTypeId,
            note: e.note,
            publishedAt: null,
          },
        });
        rows.push(row);
      }
      return rows;
    });

    res.json({ copied: created.length });
  } catch (error) {
    console.error('Error copying week:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── Rotation patterns ─────────────────────────────────────────────────────────

export const listPatterns = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'schedule:edit')) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    const divisionId = req.user!.divisionId;
    const patterns = await prisma.schedulePattern.findMany({
      where: {
        isActive: true,
        OR: [{ divisionId: null }, { divisionId }],
      },
      orderBy: { name: 'asc' },
    });
    res.json(patterns);
  } catch (error) {
    console.error('Error listing patterns:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createPattern = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'schedule:edit')) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    const { name, weekTemplate, isGlobal } = req.body;
    if (!name || !weekTemplate) {
      res.status(400).json({ message: 'name and weekTemplate are required' });
      return;
    }
    // Only Director/Admin can create global patterns
    const divisionId = isGlobal && (req.user!.role === 'Director' || req.user!.role === 'Admin')
      ? null
      : req.user!.divisionId;

    const pattern = await prisma.schedulePattern.create({
      data: {
        name,
        divisionId,
        weekTemplate: weekTemplate as Prisma.InputJsonValue,
        createdByUserId: req.user!.userId,
      },
    });
    res.status(201).json(pattern);
  } catch (error) {
    console.error('Error creating pattern:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const applyPattern = async (req: Request, res: Response): Promise<void> => {
  try {
    const divisionId = parseInt(String(req.params.divisionId), 10);
    if (!canEdit(req, divisionId)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }

    const patternId = parseInt(String(req.params.patternId), 10);
    const { userIds, dateFrom, dateTo } = req.body as {
      userIds: number[];
      dateFrom: string;
      dateTo: string;
    };

    if (!Array.isArray(userIds) || !dateFrom || !dateTo) {
      res.status(400).json({ message: 'userIds, dateFrom and dateTo are required' });
      return;
    }

    const pattern = await prisma.schedulePattern.findFirst({
      where: { id: patternId, isActive: true, OR: [{ divisionId: null }, { divisionId }] },
    });
    if (!pattern) { res.status(404).json({ message: 'Pattern not found' }); return; }

    const template = pattern.weekTemplate as Record<string, number>;
    const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    const from = new Date(dateFrom);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);

    const created = await prisma.$transaction(async (tx) => {
      const rows = [];
      const cursor = new Date(from);
      while (cursor <= to) {
        const dayKey = DAYS[cursor.getUTCDay()] ?? '';
        const shiftTypeId = template[dayKey];
        if (shiftTypeId) {
          for (const userId of userIds) {
            const date = new Date(cursor);
            await tx.scheduleEntry.updateMany({
              where: { userId, divisionId, date, slotIndex: 0, publishedAt: null, deletedAt: null },
              data: { deletedAt: new Date() },
            });
            const row = await tx.scheduleEntry.create({
              data: { userId, divisionId, date, slotIndex: 0, shiftTypeId, publishedAt: null },
            });
            rows.push(row);
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return rows;
    });

    res.json({ applied: created.length });
  } catch (error) {
    console.error('Error applying pattern:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── GET /api/tasks/workload/:userId ──────────────────────────────────────────
// Separated here for proximity with schedule logic; mounted on /api/tasks in routes

export const getWorkload = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ message: 'Unauthorized' }); return; }
    const userId = parseInt(String(req.params.userId), 10);
    const tasks = await prisma.task.findMany({
      where: { assignedToUserId: userId, status: { in: OPEN_STATUSES }, deletedAt: null },
      select: { id: true, taskId: true, title: true, status: true, deadline: true, assignedAt: true, startDate: true },
      orderBy: { deadline: 'asc' },
    });
    res.json({ tasks, openCount: tasks.length });
  } catch (error) {
    console.error('Error fetching workload:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
