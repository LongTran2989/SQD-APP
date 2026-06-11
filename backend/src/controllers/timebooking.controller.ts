import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { createFeedPost } from '../services/feedService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Constants ────────────────────────────────────────────────────────────────

// Statuses at which a task is eligible for time booking. Deliberately BROADER
// than the authoritative FINAL_TASK_STATUSES (constants/taskStatus) — booking
// opens once a task reaches review, so 'In Review' is included here. Do not
// conflate this with the "task is final/done" set.
const TIME_BOOKING_ELIGIBLE_STATUSES = ['In Review', 'Closed', 'Rejected', 'Terminated'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface BookingEntry {
  userId: number;
  hoursLogged: number;
  notes: string;
}

function validateEntry(entry: unknown): entry is BookingEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.userId === 'number' &&
    typeof e.hoursLogged === 'number' &&
    e.hoursLogged >= 0 &&
    typeof e.notes === 'string'
  );
}

function validateCollaborators(list: unknown): list is BookingEntry[] {
  return Array.isArray(list) && list.every(validateEntry);
}

async function logActivityAndAudit(
  taskId: number,
  taskEntityId: string,
  actionType: string,
  performedByUserId: number,
  content: string,
  metadata: Record<string, unknown>
): Promise<void> {
  // The two writes are independent — run them in parallel. The feed post is
  // best-effort (non-fatal), so swallow its error without failing the audit write.
  await Promise.all([
    prisma.auditLog.create({
      data: {
        actionType,
        entityType: 'TimeBooking',
        entityId: taskEntityId,
        performedByUserId,
        comment: null,
        details: metadata as any
      }
    }),
    createFeedPost(prisma, {
      type: 'SYSTEM_EVENT',
      scope: 'TASK',
      scopeId: taskId,
      content,
      metadata,
      authorId: null
    }).catch((err) => {
      console.error(`[TimeBooking] logActivity failed for taskId=${taskId}:`, err);
    })
  ]);
}

// ─── POST /api/tasks/:id/time-booking ────────────────────────────────────────

export const createTimeBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;

    // Load task
    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null }
    });
    if (!task) {
      res.status(404).json({ message: 'Task not found.' });
      return;
    }

    // Must be In Review or a final state
    if (!TIME_BOOKING_ELIGIBLE_STATUSES.includes(task.status)) {
      res.status(400).json({
        message: `Time booking is only available when a task is In Review, Closed, Rejected, or Terminated. Current status: ${task.status}.`
      });
      return;
    }

    // Only the assignee may create the booking
    if (task.assignedToUserId !== userId) {
      res.status(403).json({ message: 'Only the task assignee can create a time booking.' });
      return;
    }

    // Check for duplicate
    const existing = await prisma.timeBooking.findUnique({ where: { taskId: id } });
    if (existing) {
      res.status(409).json({ message: 'A time booking already exists for this task.' });
      return;
    }

    // Validate payload
    const { assigneeEntry, collaborators } = req.body;

    if (!validateEntry(assigneeEntry)) {
      res.status(400).json({
        message: 'assigneeEntry must be an object with userId (number), hoursLogged (number >= 0), and notes (string).'
      });
      return;
    }
    if (assigneeEntry.userId !== userId) {
      res.status(400).json({ message: 'assigneeEntry.userId must match the authenticated user.' });
      return;
    }
    if (!validateCollaborators(collaborators)) {
      res.status(400).json({
        message: 'collaborators must be an array where each item has userId (number), hoursLogged (number >= 0), and notes (string).'
      });
      return;
    }
    const duplicateCollaborator = collaborators.find((c) => c.userId === userId);
    if (duplicateCollaborator) {
      res.status(400).json({ message: 'The assignee cannot also appear as a collaborator.' });
      return;
    }

    const totalHours =
      assigneeEntry.hoursLogged +
      collaborators.reduce((sum: number, c: BookingEntry) => sum + c.hoursLogged, 0);

    const booking = await prisma.timeBooking.create({
      data: {
        taskId: id,
        assigneeEntry: assigneeEntry as any,
        collaborators: collaborators as any,
        totalHours,
        estimatedHours: task.estimatedHours  // explicit snapshot
      }
    });

    const collaboratorCount = collaborators.length;
    const content =
      collaboratorCount > 0
        ? `Time logged: ${totalHours.toFixed(1)} hrs (${collaboratorCount} collaborator${collaboratorCount !== 1 ? 's' : ''}).`
        : `Time logged: ${totalHours.toFixed(1)} hrs.`;

    await logActivityAndAudit(
      id,
      task.taskId,
      'TIME_BOOKING_CREATE',
      userId,
      content,
      { totalHours, estimatedHours: task.estimatedHours, collaboratorCount }
    );

    res.status(201).json(booking);
  } catch (error) {
    console.error('[createTimeBooking]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

// ─── PUT /api/tasks/:id/time-booking ─────────────────────────────────────────

export const updateTimeBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;

    // Load task
    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null }
    });
    if (!task) {
      res.status(404).json({ message: 'Task not found.' });
      return;
    }

    // Booking must already exist
    const existing = await prisma.timeBooking.findUnique({ where: { taskId: id } });
    if (!existing) {
      res.status(404).json({ message: 'No time booking exists for this task. Use POST to create one.' });
      return;
    }

    // Assignee, Admin, or Director may update
    const canEdit =
      task.assignedToUserId === userId ||
      role === 'Admin' ||
      role === 'Director';
    if (!canEdit) {
      res.status(403).json({ message: 'Only the task assignee, an Admin, or a Director can update a time booking.' });
      return;
    }

    // Validate payload
    const { assigneeEntry, collaborators } = req.body;

    if (!validateEntry(assigneeEntry)) {
      res.status(400).json({
        message: 'assigneeEntry must be an object with userId (number), hoursLogged (number >= 0), and notes (string).'
      });
      return;
    }

    // For Admin/Director overrides, the assigneeEntry.userId should still match the original assignee
    const expectedAssigneeUserId = task.assignedToUserId;
    if (assigneeEntry.userId !== expectedAssigneeUserId) {
      res.status(400).json({
        message: 'assigneeEntry.userId must match the task assignee.'
      });
      return;
    }

    if (!validateCollaborators(collaborators)) {
      res.status(400).json({
        message: 'collaborators must be an array where each item has userId (number), hoursLogged (number >= 0), and notes (string).'
      });
      return;
    }
    const duplicateCollaborator = collaborators.find(
      (c: BookingEntry) => c.userId === expectedAssigneeUserId
    );
    if (duplicateCollaborator) {
      res.status(400).json({ message: 'The assignee cannot also appear as a collaborator.' });
      return;
    }

    const totalHours =
      assigneeEntry.hoursLogged +
      collaborators.reduce((sum: number, c: BookingEntry) => sum + c.hoursLogged, 0);

    const booking = await prisma.timeBooking.update({
      where: { taskId: id },
      data: {
        assigneeEntry: assigneeEntry as any,
        collaborators: collaborators as any,
        totalHours
        // estimatedHours intentionally not updated — it is a snapshot of the original expectation
      }
    });

    const collaboratorCount = collaborators.length;
    const content =
      collaboratorCount > 0
        ? `Time booking updated: ${totalHours.toFixed(1)} hrs (${collaboratorCount} collaborator${collaboratorCount !== 1 ? 's' : ''}).`
        : `Time booking updated: ${totalHours.toFixed(1)} hrs.`;

    await logActivityAndAudit(
      id,
      task.taskId,
      'TIME_BOOKING_UPDATE',
      userId,
      content,
      { totalHours, collaboratorCount }
    );

    res.status(200).json(booking);
  } catch (error) {
    console.error('[updateTimeBooking]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

// ─── POST /api/tasks/:id/time-entries ────────────────────────────────────────

export const createTimeEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId } = req.user!;

    const task = await prisma.task.findUnique({ where: { id, deletedAt: null } });
    if (!task) {
      res.status(404).json({ message: 'Task not found.' });
      return;
    }

    // Incremental session entries are only for active tasks — once a task reaches
    // the booking/closeout phase (In Review or final) or is not yet active, block.
    if (TIME_BOOKING_ELIGIBLE_STATUSES.includes(task.status) || task.status === 'Unassigned' || task.status === 'Inactive') {
      res.status(400).json({ message: 'Time entries can only be logged on active tasks.' });
      return;
    }

    if (task.assignedToUserId !== userId) {
      res.status(403).json({ message: 'Only the task assignee can log time entries.' });
      return;
    }

    const { sessionHours, sessionNotes, collaboratorEntries = [], overBudgetReason, overBudgetNote } = req.body;

    if (typeof sessionHours !== 'number' || sessionHours < 0) {
      res.status(400).json({ message: 'sessionHours must be a number >= 0.' });
      return;
    }

    if (typeof sessionNotes !== 'string' || sessionNotes.trim() === '') {
      res.status(400).json({ message: 'sessionNotes must be a non-empty string.' });
      return;
    }

    if (!validateCollaborators(collaboratorEntries)) {
      res.status(400).json({
        message: 'collaboratorEntries must be an array where each item has userId (number), hoursLogged (number >= 0), and notes (string).'
      });
      return;
    }

    if (collaboratorEntries.find((c: BookingEntry) => c.userId === task.assignedToUserId)) {
      res.status(400).json({ message: 'The assignee cannot also appear as a collaborator.' });
      return;
    }

    // No duplicate userIds within the collaborator list
    const seenCollaboratorIds = new Set<number>();
    for (const c of collaboratorEntries as BookingEntry[]) {
      if (seenCollaboratorIds.has(c.userId)) {
        res.status(400).json({ message: 'Duplicate userId in collaboratorEntries.' });
        return;
      }
      seenCollaboratorIds.add(c.userId);
    }

    // All collaborator userIds must correspond to real, non-deleted users
    if (seenCollaboratorIds.size > 0) {
      const validUsers = await prisma.user.findMany({
        where: { id: { in: Array.from(seenCollaboratorIds) }, deletedAt: null },
        select: { id: true }
      });
      if (validUsers.length !== seenCollaboratorIds.size) {
        res.status(400).json({ message: 'One or more collaborator userIds do not exist.' });
        return;
      }
    }

    // Fetch existing entries to compute running total (needed for feed message and over-budget check)
    const existingEntries = await prisma.timeEntry.findMany({
      where: { taskId: id, loggedByUserId: userId }
    });

    const existingAssigneeHours = existingEntries.reduce((sum, e) => sum + e.sessionHours, 0);
    const existingCollabHours = existingEntries.reduce((sum, e) => {
      const collabs = Array.isArray(e.collaboratorEntries) ? (e.collaboratorEntries as unknown as BookingEntry[]) : [];
      return sum + collabs.reduce((s, c) => s + c.hoursLogged, 0);
    }, 0);
    const newCollabHours = (collaboratorEntries as BookingEntry[]).reduce((sum, c) => sum + c.hoursLogged, 0);
    const runningTotal = existingAssigneeHours + existingCollabHours + sessionHours + newCollabHours;

    // Validate overBudgetReason format whenever it is supplied — regardless of budget status.
    // This prevents arbitrary strings from being persisted even on under-budget entries.
    const VALID_OVER_BUDGET_REASONS = ['COMPLEX_TASK', 'WAIT_TIME', 'ADDITIONAL_WORK', 'OTHER'];
    if (overBudgetReason !== undefined && overBudgetReason !== null) {
      if (!VALID_OVER_BUDGET_REASONS.includes(overBudgetReason as string)) {
        res.status(400).json({ message: 'Invalid overBudgetReason value.' });
        return;
      }
      if (overBudgetReason === 'OTHER') {
        if (typeof overBudgetNote !== 'string' || overBudgetNote.trim() === '') {
          res.status(400).json({ message: 'Please describe the reason in the notes field.' });
          return;
        }
      }
    }

    // Require a reason when total logged hours exceed 120% of the estimate
    if (task.estimatedHours !== null && runningTotal > task.estimatedHours * 1.2) {
      if (!overBudgetReason) {
        res.status(400).json({
          message: 'An over-budget reason is required when total logged hours exceed 120% of the estimate.'
        });
        return;
      }
    }

    const entry = await prisma.timeEntry.create({
      data: {
        taskId: id,
        loggedByUserId: userId,
        sessionHours,
        sessionNotes,
        collaboratorEntries: collaboratorEntries as any,
        overBudgetReason: overBudgetReason ?? null,
        overBudgetNote: overBudgetNote ?? null
      }
    });

    await prisma.auditLog.create({
      data: {
        actionType: 'TIME_ENTRY_CREATE',
        entityType: 'TimeEntry',
        entityId: String(entry.id),
        performedByUserId: userId,
        comment: null,
        details: {
          sessionHours,
          collaboratorCount: (collaboratorEntries as BookingEntry[]).length,
          runningTotal
        } as any
      }
    });

    const collabCount = (collaboratorEntries as BookingEntry[]).length;
    const feedContent =
      `Session logged: ${sessionHours.toFixed(1)}h` +
      (collabCount > 0 ? ` (+ ${collabCount} collaborator${collabCount !== 1 ? 's' : ''})` : '') +
      `. Running total: ${runningTotal.toFixed(1)}h.`;

    try {
      await createFeedPost(prisma, {
        type: 'SYSTEM_EVENT',
        scope: 'TASK',
        scopeId: id,
        content: feedContent,
        metadata: { sessionHours, collaboratorCount: collabCount, runningTotal },
        authorId: null
      });
    } catch (err) {
      console.error(`[createTimeEntry] feed post failed for taskId=${id}:`, err);
    }

    res.status(201).json(entry);
  } catch (error) {
    console.error('[createTimeEntry]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

// ─── GET /api/tasks/:id/time-entries ─────────────────────────────────────────

export const getTimeEntries = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);

    const task = await prisma.task.findUnique({ where: { id, deletedAt: null } });
    if (!task) {
      res.status(404).json({ message: 'Task not found.' });
      return;
    }

    const entries = await prisma.timeEntry.findMany({
      where: { taskId: id },
      include: { loggedBy: { select: { id: true, name: true } } },
      orderBy: { loggedAt: 'asc' }
    });

    res.status(200).json(entries);
  } catch (error) {
    console.error('[getTimeEntries]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

// ─── GET /api/tasks/:id/time-entries/summary ─────────────────────────────────

export const getTimeEntrySummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);

    const task = await prisma.task.findUnique({ where: { id, deletedAt: null } });
    if (!task) {
      res.status(404).json({ message: 'Task not found.' });
      return;
    }

    if (task.assignedToUserId === null) {
      res.status(200).json({
        assigneeEntry: { userId: null, hoursLogged: 0, notes: '' },
        collaborators: [],
        entryCount: 0,
        runningTotal: 0
      });
      return;
    }

    const entries = await prisma.timeEntry.findMany({
      where: { taskId: id, loggedByUserId: task.assignedToUserId }
    });

    const assigneeHours = entries.reduce((sum, e) => sum + e.sessionHours, 0);

    const collaboratorsMap = new Map<number, number>();
    for (const entry of entries) {
      const collabs = Array.isArray(entry.collaboratorEntries)
        ? (entry.collaboratorEntries as unknown as BookingEntry[])
        : [];
      for (const c of collabs) {
        collaboratorsMap.set(c.userId, (collaboratorsMap.get(c.userId) ?? 0) + c.hoursLogged);
      }
    }

    const collaborators = Array.from(collaboratorsMap.entries()).map(([userId, hoursLogged]) => ({
      userId,
      hoursLogged,
      notes: ''
    }));

    const runningTotal = assigneeHours + collaborators.reduce((sum, c) => sum + c.hoursLogged, 0);

    res.status(200).json({
      assigneeEntry: { userId: task.assignedToUserId, hoursLogged: assigneeHours, notes: '' },
      collaborators,
      entryCount: entries.length,
      runningTotal
    });
  } catch (error) {
    console.error('[getTimeEntrySummary]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};
