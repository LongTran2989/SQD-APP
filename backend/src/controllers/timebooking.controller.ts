import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { createFeedPost } from '../services/feedService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Constants ────────────────────────────────────────────────────────────────

const FINAL_TASK_STATUSES = ['Closed', 'Rejected', 'Terminated'];

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
  await prisma.auditLog.create({
    data: {
      actionType,
      entityType: 'TimeBooking',
      entityId: taskEntityId,
      performedByUserId,
      comment: null,
      details: metadata as any
    }
  });

  try {
    await createFeedPost(prisma, {
      type: 'SYSTEM_EVENT',
      scope: 'TASK',
      scopeId: taskId,
      content,
      metadata,
      authorId: null
    });
  } catch (err) {
    console.error(`[TimeBooking] logActivity failed for taskId=${taskId}:`, err);
  }
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

    // Must be in a final state
    if (!FINAL_TASK_STATUSES.includes(task.status)) {
      res.status(400).json({
        message: `Time booking is only available when a task is Closed, Rejected, or Terminated. Current status: ${task.status}.`
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
