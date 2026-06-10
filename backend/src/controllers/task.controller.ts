import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { checkAndTriggerPendingVerification } from '../services/findingService';
import { createFeedPost } from '../services/feedService';
import { HttpError, isHttpError } from '../utils/httpError';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type PrismaLike = PrismaClient | Prisma.TransactionClient;

// ─── Constants ────────────────────────────────────────────────────────────────

const FINAL_TASK_STATUSES = ['Closed', 'Rejected', 'Terminated'];

// Roles that can CREATE tasks (configurable in Phase 7 via PrivilegeConfig)
const TASK_CREATOR_ROLES = ['Manager', 'Director', 'Admin'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates the next sequential human-readable taskId for a given division code.
 * Format: [DivisionCode]-[000001]
 * Must be called inside a $transaction to avoid race conditions.
 */
async function generateTaskId(divisionCode: string, tx: Prisma.TransactionClient): Promise<string> {
  const lastTask = await tx.task.findFirst({
    where: { taskId: { startsWith: `${divisionCode}-` }, deletedAt: null },
    orderBy: { id: 'desc' },
    select: { taskId: true }
  });

  let nextSeq = 1;
  if (lastTask?.taskId) {
    // taskId format: CODE-000001 (may have multiple segments if code has hyphens)
    const parts = lastTask.taskId.split('-');
    const seqPart = parts[parts.length - 1];
    if (seqPart) {
      nextSeq = parseInt(seqPart, 10) + 1;
    }
  }

  return `${divisionCode}-${String(nextSeq).padStart(6, '0')}`;
}

/**
 * Logs a SYSTEM_EVENT or COMMENT entry to the Task feed (FeedPost, scope 'TASK').
 * Never throws — errors are logged with taskId + context for debugging.
 */
async function logTaskActivity(
  taskId: number,
  type: 'SYSTEM_EVENT' | 'COMMENT',
  content: string,
  metadata?: Record<string, unknown>,
  authorId?: number,
  client: PrismaLike = prisma
): Promise<void> {
  try {
    await createFeedPost(client, {
      type,
      scope: 'TASK',
      scopeId: taskId,
      content,
      metadata,
      authorId: authorId ?? null
    });
  } catch (err) {
    console.error(
      `[logTaskActivity] Failed to log ${type} for taskId=${taskId}. Content: "${content}". Error:`,
      err
    );
  }
}

/**
 * Writes to BOTH AuditLog (system-wide compliance) AND TaskActivity (per-task feed).
 * Errors in activity log are non-fatal.
 */
async function logAuditAndActivity(
  taskId: number,
  taskEntityId: string,
  actionType: string,
  performedByUserId: number,
  activityContent: string,
  activityMetadata?: Record<string, unknown>,
  auditComment?: string,
  client: PrismaLike = prisma
): Promise<void> {
  await client.auditLog.create({
    data: {
      actionType,
      entityType: 'Task',
      entityId: taskEntityId,
      performedByUserId,
      comment: auditComment ?? null,
      details: (activityMetadata as any) ?? Prisma.DbNull
    }
  });

  await logTaskActivity(taskId, 'SYSTEM_EVENT', activityContent, activityMetadata, undefined, client);
}

/**
 * Returns true if the requesting user has reviewer rights on this Task.
 * Reviewer set: Issuer + Director + Managers of same Division.
 * Admin is intentionally excluded — Admin handles system/user management, not task operations.
 *
 * Note on Issuer Transfer: after transfer, the new issuerId holder gains these rights;
 * the old issuer loses them from this path. However, if the old issuer is a Manager or
 * Director by system role, they retain reviewer access via the role check below.
 */
function isReviewer(
  userId: number,
  userRole: string,
  userDivisionId: number,
  task: { issuerId: number; targetDivisionId: number | null }
): boolean {
  if (userId === task.issuerId) return true;
  if (userRole === 'Director') return true;
  if (userRole === 'Manager' && userDivisionId === task.targetDivisionId) return true;
  return false;
}

/**
 * Returns true if the task's deadline has passed and it is not in a final or inactive state.
 * Overdue is computed on-the-fly — never stored in the database.
 */
function computeIsOverdue(task: { deadline: Date | null; status: string }): boolean {
  if (!task.deadline) return false;
  if (FINAL_TASK_STATUSES.includes(task.status)) return false;
  if (task.status === 'Inactive') return false;
  return new Date() > task.deadline;
}

export type DeadlineStatus = 'Due Soon' | 'Due Today' | 'Overdue' | null;

// Window (hours) before the deadline at which a task is flagged "Due Soon".
const DUE_SOON_WINDOW_HOURS = 72;

/**
 * Tiered deadline signal, computed on-the-fly (never stored). Returns null when
 * there is no deadline or the task is final/inactive. "Due Today" means the
 * deadline falls on the current calendar day (server timezone); "Overdue" means
 * the deadline has passed; "Due Soon" means within DUE_SOON_WINDOW_HOURS.
 */
function computeDeadlineStatus(task: { deadline: Date | null; status: string }): DeadlineStatus {
  if (!task.deadline) return null;
  if (FINAL_TASK_STATUSES.includes(task.status)) return null;
  if (task.status === 'Inactive') return null;

  const now = new Date();
  const deadline = new Date(task.deadline);

  // "Due Today" takes precedence for the current calendar day: a date-only deadline
  // is stored at midnight, so a same-day deadline would otherwise read as Overdue by
  // the afternoon. Only a deadline on an earlier calendar day is truly Overdue.
  const sameDay =
    now.getFullYear() === deadline.getFullYear() &&
    now.getMonth() === deadline.getMonth() &&
    now.getDate() === deadline.getDate();
  if (sameDay) return 'Due Today';

  if (now > deadline) return 'Overdue';

  const hoursUntil = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntil <= DUE_SOON_WINDOW_HOURS) return 'Due Soon';

  return null;
}

/**
 * Batched "last activity" lookup: most-recent FeedPost timestamp per task.
 * FeedPost is the single source for the activity feed (never merged with AuditLog).
 * Returns a Map<taskId, Date>; tasks with no feed posts are simply absent.
 */
async function getLastActivityMap(taskIds: number[]): Promise<Map<number, Date>> {
  const map = new Map<number, Date>();
  if (taskIds.length === 0) return map;

  const grouped = await prisma.feedPost.groupBy({
    by: ['scopeId'],
    where: { scope: 'TASK', scopeId: { in: taskIds } },
    _max: { createdAt: true }
  });
  for (const g of grouped) {
    if (g.scopeId != null && g._max.createdAt) map.set(g.scopeId, g._max.createdAt);
  }
  return map;
}

/**
 * Returns the standard task include object for consistent response shapes.
 * All scalar fields (incl. responseActionType, requiresDirectorApproval) are
 * returned automatically by Prisma when using `include`; only relations need
 * to be listed here.
 */
function taskInclude() {
  return {
    template: { select: { id: true, templateId: true, title: true, allowsFindings: true } },
    issuer: { select: { id: true, name: true } },
    assignedToUser: { select: { id: true, name: true, role: { select: { name: true } } } },
    targetDivision: { select: { id: true, name: true, code: true } },
    wp: { select: { id: true, wpId: true, name: true } },
    timeBooking: true,
    parentFinding: { select: { id: true } }
  };
}

// ─── GET /api/tasks ───────────────────────────────────────────────────────────

export const getTasks = async (req: Request, res: Response): Promise<void> => {
  // TODO (Phase 5.4): Add divisionId query param and showAll filter when the frontend
  // filter bar is built. For now, scope is enforced by role only.
  try {
    const { userId, role, divisionId } = req.user!;

    let where: any = { deletedAt: null };

    if (role === 'Director' || role === 'Admin') {
      // System-wide visibility
    } else if (role === 'Manager') {
      // All tasks in their division + all tasks they issued anywhere
      where = {
        deletedAt: null,
        OR: [
          { targetDivisionId: divisionId },
          { issuerId: userId }
        ]
      };
    } else {
      // Staff / Group Leader: tasks they are assignee or issuer of,
      // plus all Unassigned tasks targeted at their division (so they can see & claim them),
      // plus all tasks belonging to WPs they are assigned to
      const wpAssignments = await prisma.workPackageAssignment.findMany({
        where: { userId },
        select: { wpId: true }
      });
      const memberWpIds = wpAssignments.map((a) => a.wpId);

      where = {
        deletedAt: null,
        OR: [
          { assignedToUserId: userId },
          { issuerId: userId },
          { status: 'Unassigned', targetDivisionId: divisionId },
          ...(memberWpIds.length > 0 ? [{ wpId: { in: memberWpIds } }] : [])
        ]
      };
    }

    // ── Optional filters (combined with the RBAC scope via AND) ────────────────
    const filters: any[] = [];

    // statuses[] — accept ?statuses=A&statuses=B or ?statuses=A
    const rawStatuses = req.query.statuses;
    if (rawStatuses) {
      const statuses = Array.isArray(rawStatuses) ? rawStatuses.map(String) : [String(rawStatuses)];
      if (statuses.length > 0) filters.push({ status: { in: statuses } });
    }

    const issuerId = req.query.issuerId ? parseInt(String(req.query.issuerId), 10) : null;
    if (issuerId && !Number.isNaN(issuerId)) filters.push({ issuerId });

    const assignedToUserId = req.query.assignedToUserId ? parseInt(String(req.query.assignedToUserId), 10) : null;
    if (assignedToUserId && !Number.isNaN(assignedToUserId)) filters.push({ assignedToUserId });

    // Date range filters the task creation date (createdAt).
    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (req.query.startDate) {
      const d = new Date(String(req.query.startDate));
      if (!Number.isNaN(d.getTime())) createdAtFilter.gte = d;
    }
    if (req.query.endDate) {
      const d = new Date(String(req.query.endDate));
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999); // inclusive end-of-day
        createdAtFilter.lte = d;
      }
    }
    if (createdAtFilter.gte || createdAtFilter.lte) filters.push({ createdAt: createdAtFilter });

    const finalWhere = filters.length > 0 ? { AND: [where, ...filters] } : where;

    const tasks = await prisma.task.findMany({
      where: finalWhere,
      orderBy: { updatedAt: 'desc' },
      include: taskInclude()
    });

    const lastActivityMap = await getLastActivityMap(tasks.map(t => t.id));

    const result = tasks.map(t => ({
      ...t,
      isOverdue: computeIsOverdue(t),
      deadlineStatus: computeDeadlineStatus(t),
      lastActivityAt: lastActivityMap.get(t.id) ?? t.updatedAt
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/tasks/my-tasks ──────────────────────────────────────────────────

export const getMyTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.user!;

    const tasks = await prisma.task.findMany({
      where: {
        deletedAt: null,
        OR: [
          { assignedToUserId: userId },
          { issuerId: userId }
        ]
      },
      orderBy: { updatedAt: 'desc' },
      include: taskInclude()
    });

    const result = tasks.map(t => ({
      ...t,
      isOverdue: computeIsOverdue(t),
      deadlineStatus: computeDeadlineStatus(t)
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching my tasks:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/tasks/unassigned ────────────────────────────────────────────────

export const getUnassignedTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, divisionId } = req.user!;

    let where: any = { deletedAt: null, status: 'Unassigned' };

    if (role === 'Director' || role === 'Admin') {
      // All unassigned tasks system-wide
    } else {
      // Staff, Group Leader, Manager: unassigned tasks in their division
      where.targetDivisionId = divisionId;
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: taskInclude()
    });

    const result = tasks.map(t => ({
      ...t,
      isOverdue: computeIsOverdue(t),
      deadlineStatus: computeDeadlineStatus(t)
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching unassigned tasks:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/tasks/:id ───────────────────────────────────────────────────────

export const getTaskById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      include: {
        ...taskInclude(),
        taskData: true
      }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Access control: Transparent viewing model
    // All authenticated users can view the task details.
    // Action endpoints (PUT/POST) remain strictly controlled.

    res.json({ ...task, isOverdue: computeIsOverdue(task), deadlineStatus: computeDeadlineStatus(task) });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/tasks ──────────────────────────────────────────────────────────

export interface CreateTaskParams {
  templateId: number;
  targetDivisionId: number;
  wpId?: number | null;
  assignedToUserId?: number | null;
  deadline?: string | Date | null;
  estimatedHours?: number | null;
  skillLevel?: number | null;
  requiresApproval?: boolean | null;
  issuanceNote?: string | null;
}

/**
 * Core "create a task" logic, callable from the HTTP handler OR another flow
 * (e.g. the escalation CREATE_TASK action) that wants to reuse this validation
 * verbatim. Every write runs on the supplied `client`; pass a transaction client
 * (the taskId generation needs a `FOR UPDATE` row lock, so the caller MUST wrap
 * this in a $transaction). Throws HttpError on validation failure.
 */
export async function createTaskService(
  client: PrismaLike,
  actor: { userId: number; role: string; divisionId: number },
  params: CreateTaskParams
) {
  const { userId, role, divisionId } = actor;
  const { templateId, targetDivisionId, wpId, assignedToUserId, deadline, estimatedHours, skillLevel, requiresApproval, issuanceNote } = params;

  // RBAC: Manager, Director, Admin can create tasks.
  // Regular users assigned to a WP can create tasks inside that WP for their own division.
  let isAllowed = TASK_CREATOR_ROLES.includes(role);
  if (!isAllowed && wpId) {
    const wpAssignment = await client.workPackageAssignment.findFirst({ where: { wpId, userId } });
    if (wpAssignment && targetDivisionId === divisionId) {
      isAllowed = true;
    }
  }
  if (!isAllowed) throw new HttpError(403, 'Insufficient permissions to create tasks');

  if (!templateId || !targetDivisionId) {
    throw new HttpError(400, 'templateId and targetDivisionId are required');
  }
  if (issuanceNote != null && (typeof issuanceNote !== 'string' || issuanceNote.length > 2000)) {
    throw new HttpError(400, 'issuanceNote must be a string of at most 2000 characters');
  }

  // Validate template — must exist, Published, not soft-deleted
  const template = await client.template.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      templateId: true,
      status: true,
      formSchema: true,
      requiresApproval: true,
      estimatedHours: true,
      skillLevel: true,
      division: { select: { id: true, code: true } }
    }
  });
  if (!template) throw new HttpError(404, 'Template not found');
  if (template.status !== 'Published') {
    throw new HttpError(400, 'Tasks can only be created from Published templates');
  }

  // Validate assignedToUserId if provided
  if (assignedToUserId) {
    const assignee = await client.user.findUnique({
      where: { id: assignedToUserId, deletedAt: null },
      select: { id: true, divisionId: true }
    });
    if (!assignee) throw new HttpError(404, 'Assignee user not found');
    // Director can assign anyone; Manager can only assign users in same division
    if (role === 'Manager' && assignee.divisionId !== divisionId) {
      throw new HttpError(403, 'Managers can only assign tasks to users in their own division');
    }
  }

  // Validate wpId if provided
  if (wpId) {
    const wp = await client.workPackage.findUnique({
      where: { id: wpId, deletedAt: null },
      select: { id: true, status: true }
    });
    if (!wp) throw new HttpError(404, 'Work Package not found');
    if (wp.status === 'Closed') throw new HttpError(400, 'Cannot link a task to a Closed Work Package');
  }

  // Get target division code for taskId generation
  const targetDiv = await client.division.findUnique({
    where: { id: targetDivisionId },
    select: { id: true, code: true }
  });
  if (!targetDiv) throw new HttpError(400, 'Target division not found');

  const initialStatus = assignedToUserId ? 'Assigned' : 'Unassigned';

  // Lock division row to prevent concurrent taskId collisions (requires a tx).
  await client.$queryRaw`SELECT id FROM "Division" WHERE id = ${targetDivisionId} FOR UPDATE`;
  const newTaskId = await generateTaskId(targetDiv.code, client as Prisma.TransactionClient);

  const task = await client.task.create({
    data: {
      taskId: newTaskId,
      templateId,
      issuerId: userId,
      assignedToUserId: assignedToUserId ?? null,
      wpId: wpId ?? null,
      targetDivisionId,
      status: initialStatus,
      schemaSnapshot: template.formSchema as any,
      deadline: deadline ? new Date(deadline) : null,
      estimatedHours: estimatedHours ?? template.estimatedHours ?? null,
      // Seed per-task overrides from the template; caller may override either.
      skillLevel: skillLevel ?? template.skillLevel ?? 0,
      requiresApproval: requiresApproval ?? template.requiresApproval ?? true,
      issuanceNote: issuanceNote ?? null,
      assignmentType: 'INDIVIDUAL'
    },
    include: taskInclude()
  });

  // Dual-write (Rule 3) — runs on the same client/tx so it is atomic with the create.
  const activityContent = assignedToUserId
    ? `Task created and assigned to ${(task as any).assignedToUser?.name ?? 'user'}`
    : 'Task created (unassigned)';

  await logAuditAndActivity(
    task.id,
    String(task.id),
    'TASK_CREATED',
    userId,
    activityContent,
    { taskId: task.taskId, templateId, status: initialStatus },
    undefined,
    client
  );

  if (assignedToUserId) {
    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_ASSIGNED',
      userId,
      `Task assigned to ${(task as any).assignedToUser?.name ?? 'user'}`,
      { fromStatus: 'Unassigned', toStatus: 'Assigned', assignedToUserId },
      undefined,
      client
    );
  }

  return task;
}

export const createTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;
    const { templateId, targetDivisionId, wpId, assignedToUserId, deadline, estimatedHours, skillLevel, requiresApproval, issuanceNote } = req.body;

    const task = await prisma.$transaction((tx) =>
      createTaskService(tx, { userId, role, divisionId }, { templateId, targetDivisionId, wpId, assignedToUserId, deadline, estimatedHours, skillLevel, requiresApproval, issuanceNote })
    );

    res.status(201).json({ ...task, isOverdue: computeIsOverdue(task), deadlineStatus: computeDeadlineStatus(task) });
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Error creating task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PATCH /api/tasks/:id/wp ───────────────────────────────────────────────────
// Link an existing task to a Work Package, or clear its link (wpId: null).
export const updateTaskWp = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { wpId } = req.body as { wpId: number | null };

    const task = await prisma.task.findUnique({ where: { id, deletedAt: null } });
    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Only the issuer or an elevated role may re-link a task.
    if (task.issuerId !== userId && !TASK_CREATOR_ROLES.includes(role)) {
      res.status(403).json({ message: 'Insufficient permissions to change the work package of this task' });
      return;
    }

    if (FINAL_TASK_STATUSES.includes(task.status) || task.status === 'Inactive') {
      res.status(400).json({ message: `Cannot re-link a task in status: ${task.status}` });
      return;
    }

    let newWpId: number | null = null;
    if (wpId !== null && wpId !== undefined) {
      const wp = await prisma.workPackage.findUnique({
        where: { id: wpId, deletedAt: null },
        select: { id: true, status: true }
      });
      if (!wp) {
        res.status(404).json({ message: 'Work Package not found' });
        return;
      }
      if (wp.status === 'Closed') {
        res.status(400).json({ message: 'Cannot link a task to a Closed Work Package' });
        return;
      }
      newWpId = wp.id;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { wpId: newWpId },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_WP_LINK_CHANGED',
      userId,
      newWpId ? `Task linked to Work Package #${newWpId}` : 'Task unlinked from its Work Package',
      { fromWpId: task.wpId, toWpId: newWpId }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error updating task work package:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PATCH /api/tasks/:id/reopen ───────────────────────────────────────────────
// Admin/Director re-opens a Closed task. Returns it to Assigned (or Unassigned if it
// has no assignee), clears completedAt, and leaves all TaskData/schemaSnapshot intact.
export const reopenTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId } = req.user!;
    const { reason } = req.body as { reason?: string };

    if (!reason || !reason.trim()) {
      res.status(400).json({ message: 'A reason is required to re-open a task' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      include: { wp: { select: { status: true } } }
    });
    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Only 'Closed' tasks are reopenable; Rejected/Terminated keep their own paths.
    if (task.status !== 'Closed') {
      res.status(400).json({ message: `Only Closed tasks can be re-opened. Current status: ${task.status}` });
      return;
    }

    if (task.wp && task.wp.status === 'Closed') {
      res.status(400).json({ message: 'Cannot re-open a task that belongs to a Closed Work Package' });
      return;
    }

    const newStatus = task.assignedToUserId ? 'Assigned' : 'Unassigned';

    const updated = await prisma.task.update({
      where: { id },
      // NOTE: TaskData and schemaSnapshot are intentionally left untouched.
      data: { status: newStatus, completedAt: null },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_REOPENED',
      userId,
      `Task re-opened by Admin. Reason: ${reason.trim()}. Status: Closed → ${newStatus}`,
      { fromStatus: 'Closed', toStatus: newStatus, reason: reason.trim() },
      reason.trim()
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error re-opening task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/assign ────────────────────────────────────────────────

export const assignTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;
    const { assignedToUserId } = req.body;

    if (!assignedToUserId) {
      res.status(400).json({ message: 'assignedToUserId is required' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (task.status !== 'Unassigned') {
      res.status(400).json({ message: 'Task must be Unassigned to use this endpoint. Use /reassign to change an existing assignee.' });
      return;
    }

    // RBAC: Director can assign anyone; Manager can assign same-division users;
    // Regular user assigned to a WP can assign tasks linked to that WP in the same division.
    let isAllowed = ['Director', 'Admin', 'Manager'].includes(role);
    if (!isAllowed && task.wpId) {
      const wpAssignment = await prisma.workPackageAssignment.findFirst({
        where: { wpId: task.wpId, userId }
      });
      if (wpAssignment) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      res.status(403).json({ message: 'Insufficient permissions to assign tasks' });
      return;
    }

    const assignee = await prisma.user.findUnique({
      where: { id: assignedToUserId, deletedAt: null },
      select: { id: true, name: true, divisionId: true }
    });

    if (!assignee) {
      res.status(404).json({ message: 'Assignee user not found' });
      return;
    }

    // Division lock: non-Director/Admin can only assign to users in their own division
    if (!['Director', 'Admin'].includes(role) && assignee.divisionId !== divisionId) {
      res.status(403).json({ message: 'You can only assign tasks to users in your own division' });
      return;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { assignedToUserId, status: 'Assigned' },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_ASSIGNED',
      userId,
      `Task assigned to ${assignee.name}`,
      { fromStatus: 'Unassigned', toStatus: 'Assigned', assignedToUserId }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error assigning task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/self-assign ───────────────────────────────────────────

export const selfAssignTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (task.status !== 'Unassigned') {
      res.status(400).json({ message: 'Task is no longer available for self-assignment' });
      return;
    }

    // Self-assign visibility: Division-scoped for non-Admin/Director
    if (
      role !== 'Director' &&
      role !== 'Admin' &&
      task.targetDivisionId !== divisionId
    ) {
      res.status(403).json({ message: 'You can only self-assign tasks in your own division' });
      return;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { assignedToUserId: userId, status: 'Assigned' },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_SELF_ASSIGNED',
      userId,
      `Task self-assigned by ${req.user!.userId} (PERFORM THIS TASK)`,
      { fromStatus: 'Unassigned', toStatus: 'Assigned', assignedToUserId: userId }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error self-assigning task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/data ──────────────────────────────────────────────────

export const saveTaskData = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId } = req.user!;
    const { data } = req.body;

    if (!data) {
      res.status(400).json({ message: 'data is required' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, assignedToUserId: true, status: true }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (task.assignedToUserId !== userId) {
      res.status(403).json({ message: 'Only the assigned user can save task data' });
      return;
    }

    if (!['Assigned', 'In Progress', 'Follow-up Required'].includes(task.status)) {
      res.status(400).json({ message: `Cannot save data on a task with status: ${task.status}` });
      return;
    }

    const isFirstSave = task.status === 'Assigned' || task.status === 'Follow-up Required';
    const newStatus = isFirstSave && task.status === 'Assigned' ? 'In Progress' : task.status;

    // Upsert TaskData
    await prisma.taskData.upsert({
      where: { taskId: id },
      update: { data },
      create: { taskId: id, data }
    });

    if (newStatus !== task.status) {
      await prisma.task.update({
        where: { id },
        data: { status: newStatus }
      });

      await logAuditAndActivity(
        task.id,
        String(task.id),
        'TASK_IN_PROGRESS',
        userId,
        'Task progress saved. Status: Assigned → In Progress',
        { fromStatus: 'Assigned', toStatus: 'In Progress' }
      );
    }

    res.json({ message: 'Task data saved', status: newStatus });
  } catch (error) {
    console.error('Error saving task data:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/submit ────────────────────────────────────────────────

export const submitTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId } = req.user!;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (task.assignedToUserId !== userId) {
      res.status(403).json({ message: 'Only the assigned user can submit this task' });
      return;
    }

    if (!['Assigned', 'In Progress', 'Follow-up Required'].includes(task.status)) {
      res.status(400).json({ message: `Task cannot be submitted from status: ${task.status}` });
      return;
    }

    // Per-task gate, seeded from the template at creation (PR3). A task that
    // requires Director approval ALWAYS needs review — requiresApproval=false must
    // never short-circuit (close) a task whose requiresDirectorApproval gate is on.
    const requiresApproval = (task.requiresApproval ?? true) || task.requiresDirectorApproval;
    // OQ-3: No grace window — when requiresApproval = false, task closes immediately on submit.
    // TODO (future): Implement a TASK_APPROVAL_GRACE_MINUTES SystemSetting if grace window is required.
    const newStatus = requiresApproval ? 'In Review' : 'Closed';

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: newStatus,
        completedAt: newStatus === 'Closed' ? new Date() : null
      },
      include: taskInclude()
    });

    const actionType = newStatus === 'Closed' ? 'TASK_APPROVED' : 'TASK_SUBMITTED';
    const content = newStatus === 'Closed'
      ? `Task submitted and auto-closed (requiresApproval = false). Status: ${task.status} → Closed`
      : `Task submitted for review. Status: ${task.status} → In Review`;

    await logAuditAndActivity(
      task.id,
      String(task.id),
      actionType,
      userId,
      content,
      { fromStatus: task.status, toStatus: newStatus }
    );

    // Finding Pending-Verification hook: auto-close may finalise a follow-up task.
    if (newStatus === 'Closed') {
      await checkAndTriggerPendingVerification(task.id, userId);
    }

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error submitting task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/review ────────────────────────────────────────────────

export const reviewTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;
    const { action, comment } = req.body; // action: 'approve' | 'reject' | 'follow-up'

    if (!action || !['approve', 'reject', 'follow-up'].includes(action)) {
      res.status(400).json({ message: 'action must be one of: approve, reject, follow-up' });
      return;
    }

    if ((action === 'reject' || action === 'follow-up') && !comment) {
      res.status(400).json({ message: 'A comment is required when rejecting or requesting follow-up' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        issuerId: true,
        assignedToUserId: true,
        targetDivisionId: true,
        status: true,
        responseActionType: true,
        requiresDirectorApproval: true
      }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (task.status !== 'In Review') {
      res.status(400).json({ message: `Task must be In Review to perform a review action. Current status: ${task.status}` });
      return;
    }

    // Director-only gate: QN tasks may only be reviewed/approved by a Director.
    // This intentionally blocks Managers (including the Issuer) — the Issuer
    // exception does NOT apply when requiresDirectorApproval is true.
    if (task.requiresDirectorApproval && role !== 'Director') {
      res.status(403).json({
        message: 'This task requires Director approval. Only a Director may review or approve it.'
      });
      return;
    }

    // Amendment 3 (T74): Issuer who is also Assignee cannot self-approve
    if (task.issuerId === userId && task.assignedToUserId === userId) {
      res.status(403).json({ message: 'The same person cannot perform a task and approve it. Aviation QA integrity requirement.' });
      return;
    }

    if (!isReviewer(userId, role, divisionId, task)) {
      res.status(403).json({ message: 'You do not have reviewer rights on this task' });
      return;
    }

    const statusMap: Record<string, string> = {
      'approve': 'Closed',
      'reject': 'Rejected',
      'follow-up': 'Follow-up Required'
    };

    const actionTypeMap: Record<string, string> = {
      'approve': 'TASK_APPROVED',
      'reject': 'TASK_REJECTED',
      'follow-up': 'TASK_FOLLOW_UP_REQUESTED'
    };

    const newStatus = statusMap[action]!;

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: newStatus,
        rejectionReason: action === 'reject' ? (comment ?? null) : undefined,
        completedAt: newStatus === 'Closed' ? new Date() : null
      },
      include: taskInclude()
    });

    const contentMap: Record<string, string> = {
      'approve': `Task approved. Status: In Review → Closed`,
      'reject': `Task rejected. Reason: ${comment}. Status: In Review → Rejected`,
      'follow-up': `Follow-up requested: ${comment}. Status: In Review → Follow-up Required`
    };

    await logAuditAndActivity(
      task.id,
      String(task.id),
      actionTypeMap[action]!,
      userId,
      contentMap[action]!,
      { fromStatus: 'In Review', toStatus: newStatus, comment },
      comment
    );

    // Finding Pending-Verification hook: approve/reject can finalise a follow-up task.
    if (FINAL_TASK_STATUSES.includes(newStatus)) {
      await checkAndTriggerPendingVerification(task.id, userId);
    }

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error reviewing task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/post-rejection ────────────────────────────────────────

export const postRejectionAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;
    const { action, newAssigneeId, reason } = req.body; // action: 'terminate' | 'reassign'

    if (!action || !['terminate', 'reassign'].includes(action)) {
      res.status(400).json({ message: 'action must be one of: terminate, reassign' });
      return;
    }

    if (action === 'reassign' && !newAssigneeId) {
      res.status(400).json({ message: 'newAssigneeId is required when reassigning' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        issuerId: true,
        assignedToUserId: true,
        targetDivisionId: true,
        status: true
      }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (task.status !== 'Rejected') {
      res.status(400).json({ message: `Post-rejection actions require task status to be Rejected. Current: ${task.status}` });
      return;
    }

    if (!isReviewer(userId, role, divisionId, task)) {
      res.status(403).json({ message: 'You do not have reviewer rights on this task' });
      return;
    }

    let updateData: any = {};
    let actionType: string;
    let content: string;

    if (action === 'terminate') {
      updateData = { status: 'Terminated' };
      actionType = 'TASK_TERMINATED';
      content = 'Task terminated after rejection. Status: Rejected → Terminated';
    } else {
      // Reassign — validate new assignee
      const newAssignee = await prisma.user.findUnique({
        where: { id: newAssigneeId, deletedAt: null },
        select: { id: true, name: true }
      });

      if (!newAssignee) {
        res.status(404).json({ message: 'New assignee not found' });
        return;
      }

      updateData = {
        status: 'Assigned',
        assignedToUserId: newAssigneeId,
        rejectionReason: null
      };
      actionType = 'TASK_REASSIGNED';
      content = `Task reassigned to ${newAssignee.name} after rejection. Status: Rejected → Assigned`;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: updateData,
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      actionType,
      userId,
      content,
      { fromStatus: 'Rejected', toStatus: updateData.status, reason },
      reason
    );

    // Finding Pending-Verification hook: termination finalises a follow-up task.
    if (FINAL_TASK_STATUSES.includes(updateData.status)) {
      await checkAndTriggerPendingVerification(task.id, userId);
    }

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error performing post-rejection action:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/reassign ──────────────────────────────────────────────

export interface ReassignTaskParams {
  taskId: number;
  newAssigneeId: number;
  reason: string;
}

/**
 * Core "reassign a task" logic, callable from the HTTP handler OR another flow
 * (e.g. the escalation REASSIGN_TASK action). Reuses the same validation
 * verbatim: required fields, final-state / Inactive block, reviewer RBAC,
 * assignee existence. Every write runs on the supplied `client`. Throws HttpError.
 */
export async function reassignTaskService(
  client: PrismaLike,
  actor: { userId: number; role: string; divisionId: number },
  params: ReassignTaskParams
) {
  const { userId, role, divisionId } = actor;
  const { taskId: id, newAssigneeId, reason } = params;

  if (!newAssigneeId) throw new HttpError(400, 'newAssigneeId is required');
  if (!reason?.trim()) throw new HttpError(400, 'A reason is required when reassigning a task');

  const task = await client.task.findUnique({
    where: { id, deletedAt: null },
    select: { id: true, issuerId: true, assignedToUserId: true, targetDivisionId: true, status: true }
  });
  if (!task) throw new HttpError(404, 'Task not found');

  // Block reassignment on final states
  if (FINAL_TASK_STATUSES.includes(task.status)) {
    throw new HttpError(400, `Cannot reassign a task in a final state (${task.status}). Create a new task or raise a Finding instead.`);
  }
  if (task.status === 'Inactive') {
    throw new HttpError(400, 'Cannot reassign an Inactive task. Reactivate it first.');
  }

  if (!isReviewer(userId, role, divisionId, task)) {
    throw new HttpError(403, 'You do not have permission to reassign this task');
  }

  const newAssignee = await client.user.findUnique({
    where: { id: newAssigneeId, deletedAt: null },
    select: { id: true, name: true }
  });
  if (!newAssignee) throw new HttpError(404, 'New assignee not found');

  const previousAssigneeId = task.assignedToUserId;

  const updated = await client.task.update({
    where: { id },
    data: {
      assignedToUserId: newAssigneeId,
      status: 'Assigned'
      // TaskData is preserved — not cleared
    },
    include: taskInclude()
  });

  await logAuditAndActivity(
    task.id,
    String(task.id),
    'TASK_REASSIGNED',
    userId,
    `Task reassigned to ${newAssignee.name}. Reason: ${reason}. Status: ${task.status} → Assigned`,
    { fromStatus: task.status, toStatus: 'Assigned', previousAssigneeId, newAssigneeId },
    reason,
    client
  );

  return updated;
}

export const reassignTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;
    const { newAssigneeId, reason } = req.body;

    const updated = await prisma.$transaction((tx) =>
      reassignTaskService(tx, { userId, role, divisionId }, { taskId: id, newAssigneeId, reason })
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Error reassigning task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/transfer-issuer ───────────────────────────────────────

export const transferIssuerRights = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId } = req.user!;
    const { newIssuerId } = req.body;

    if (!newIssuerId) {
      res.status(400).json({ message: 'newIssuerId is required' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, issuerId: true, status: true }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Only the current issuer can transfer rights
    if (task.issuerId !== userId) {
      res.status(403).json({ message: 'Only the current issuer can transfer issuer rights' });
      return;
    }

    if (FINAL_TASK_STATUSES.includes(task.status)) {
      res.status(400).json({ message: 'Cannot transfer issuer rights on a completed task' });
      return;
    }

    const newIssuer = await prisma.user.findUnique({
      where: { id: newIssuerId, deletedAt: null },
      select: { id: true, name: true }
    });

    if (!newIssuer) {
      res.status(404).json({ message: 'New issuer not found' });
      return;
    }

    const previousIssuerId = task.issuerId;

    const updated = await prisma.task.update({
      where: { id },
      data: { issuerId: newIssuerId },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_ISSUER_TRANSFERRED',
      userId,
      `Issuer rights transferred to ${newIssuer.name}. Previous issuer (id: ${previousIssuerId}) loses issuer rights. Note: system role-based reviewer rights (Manager/Director) are unaffected.`,
      { previousIssuerId, newIssuerId }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error transferring issuer rights:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/inactive ──────────────────────────────────────────────

export const inactivateTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role } = req.user!;
    const { reason } = req.body;

    if (!reason) {
      res.status(400).json({ message: 'A reason is required when inactivating a task' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, issuerId: true, status: true }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Only Issuer or Admin can inactivate
    if (task.issuerId !== userId && role !== 'Admin') {
      res.status(403).json({ message: 'Only the task issuer or an Admin can inactivate a task' });
      return;
    }

    if (task.status === 'Inactive') {
      res.status(400).json({ message: 'Task is already Inactive' });
      return;
    }

    if (FINAL_TASK_STATUSES.includes(task.status)) {
      res.status(400).json({ message: `Cannot inactivate a task in a final state: ${task.status}` });
      return;
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: 'Inactive',
        inactivationLog: {
          reason,
          inactivatedBy: userId,
          inactivatedAt: new Date().toISOString(),
          previousStatus: task.status
        }
      },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_INACTIVATED',
      userId,
      `Task inactivated. Reason: ${reason}. Status: ${task.status} → Inactive`,
      { fromStatus: task.status, toStatus: 'Inactive', reason },
      reason
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error inactivating task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/reactivate ────────────────────────────────────────────

export const reactivateTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role } = req.user!;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, issuerId: true, status: true, inactivationLog: true }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (task.status !== 'Inactive') {
      res.status(400).json({ message: `Task is not Inactive. Current status: ${task.status}` });
      return;
    }

    // Only Issuer or Admin can reactivate
    if (task.issuerId !== userId && role !== 'Admin') {
      res.status(403).json({ message: 'Only the task issuer or an Admin can reactivate a task' });
      return;
    }

    const log = task.inactivationLog as any;
    const previousStatus = log?.previousStatus ?? 'Assigned';

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: previousStatus,
        inactivationLog: Prisma.DbNull
      },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_REACTIVATED',
      userId,
      `Task reactivated. Status: Inactive → ${previousStatus}`,
      { fromStatus: 'Inactive', toStatus: previousStatus }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error reactivating task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/deadline ──────────────────────────────────────────────

export const setDeadline = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;
    const { deadline } = req.body;

    if (!deadline) {
      res.status(400).json({ message: 'deadline is required' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, issuerId: true, targetDivisionId: true, status: true }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (FINAL_TASK_STATUSES.includes(task.status)) {
      res.status(400).json({ message: 'Cannot set deadline on a completed task' });
      return;
    }

    // Reviewer rights required to set deadline (Issuer + Director + Manager same div)
    if (!isReviewer(userId, role, divisionId, task)) {
      res.status(403).json({ message: 'Insufficient permissions to set deadline on this task' });
      return;
    }

    const newDeadline = new Date(deadline);

    const updated = await prisma.task.update({
      where: { id },
      data: { deadline: newDeadline },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_DEADLINE_SET',
      userId,
      `Deadline set to ${newDeadline.toISOString()}`,
      { deadline: newDeadline.toISOString() }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error setting deadline:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/deadline/request ─────────────────────────────────────

export const requestDeadlineExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId } = req.user!;
    const { reason, proposedDeadline } = req.body;

    if (!reason) {
      res.status(400).json({ message: 'A reason is required for deadline extension requests' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        issuerId: true,
        assignedToUserId: true,
        status: true,
        deadlineExtensions: true
      }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    if (FINAL_TASK_STATUSES.includes(task.status) || task.status === 'Inactive') {
      res.status(400).json({ message: 'Cannot request deadline extension on a completed or inactive task' });
      return;
    }

    // Only Assignee or Issuer can request an extension
    if (task.assignedToUserId !== userId && task.issuerId !== userId) {
      res.status(403).json({ message: 'Only the assignee or issuer can request a deadline extension' });
      return;
    }

    const existingExtensions = (task.deadlineExtensions as any[]) ?? [];
    const newExtension = {
      requestedBy: userId,
      reason,
      proposedDeadline: proposedDeadline ?? null,
      requestedAt: new Date().toISOString(),
      decision: null,
      decidedAt: null
    };

    const updatedExtensions = [...existingExtensions, newExtension];

    const updated = await prisma.task.update({
      where: { id },
      data: { deadlineExtensions: updatedExtensions },
      include: taskInclude()
    });

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_DEADLINE_EXTENSION_REQUESTED',
      userId,
      `Deadline extension requested. Reason: ${reason}${proposedDeadline ? `. Proposed: ${proposedDeadline}` : ''}`,
      { reason, proposedDeadline: proposedDeadline ?? null }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error requesting deadline extension:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/deadline/decide ──────────────────────────────────────

export const decideDeadlineExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;
    const { extensionIndex, decision, newDeadline } = req.body;

    if (extensionIndex === undefined || extensionIndex === null) {
      res.status(400).json({ message: 'extensionIndex is required' });
      return;
    }

    if (!decision || !['approve', 'deny'].includes(decision)) {
      res.status(400).json({ message: 'decision must be approve or deny' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        issuerId: true,
        targetDivisionId: true,
        status: true,
        deadline: true,
        deadlineExtensions: true
      }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // OQ-2: Reviewer = Issuer + Director + Managers of same Division
    if (!isReviewer(userId, role, divisionId, task)) {
      res.status(403).json({ message: 'You do not have permission to decide on deadline extensions' });
      return;
    }

    const extensions = (task.deadlineExtensions as any[]) ?? [];
    if (extensionIndex < 0 || extensionIndex >= extensions.length) {
      res.status(400).json({ message: 'Invalid extensionIndex' });
      return;
    }

    const extension = extensions[extensionIndex];
    if (extension.decision !== null) {
      res.status(400).json({ message: 'This extension request has already been decided' });
      return;
    }

    extensions[extensionIndex] = {
      ...extension,
      decision,
      decidedAt: new Date().toISOString()
    };

    let deadlineUpdate: Date | undefined;
    if (decision === 'approve') {
      const resolvedDeadline = newDeadline ?? extension.proposedDeadline;
      if (!resolvedDeadline) {
        res.status(400).json({ message: 'newDeadline is required when approving an extension (or proposedDeadline must have been set in the request)' });
        return;
      }
      deadlineUpdate = new Date(resolvedDeadline);
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        deadlineExtensions: extensions,
        ...(deadlineUpdate ? { deadline: deadlineUpdate } : {})
      },
      include: taskInclude()
    });

    const actionType = decision === 'approve' ? 'TASK_DEADLINE_EXTENSION_APPROVED' : 'TASK_DEADLINE_EXTENSION_DENIED';
    const content = decision === 'approve'
      ? `Deadline extension approved. New deadline: ${deadlineUpdate!.toISOString()}`
      : 'Deadline extension denied. Original deadline stands.';

    await logAuditAndActivity(
      task.id,
      String(task.id),
      actionType,
      userId,
      content,
      { decision, newDeadline: deadlineUpdate?.toISOString() ?? null, extensionIndex }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error deciding deadline extension:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/tasks/:id/rate ──────────────────────────────────────────────────

export const rateTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;
    const { rating } = req.body;

    if (rating === undefined || rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ message: 'rating must be an integer between 1 and 5' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        assignedToUserId: true,
        rating: true,
        timeBooking: { select: { id: true } }
      }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Task must be in final state
    if (!FINAL_TASK_STATUSES.includes(task.status)) {
      res.status(400).json({ message: `Task must be in a final state to be rated. Current status: ${task.status}` });
      return;
    }

    if (!task.assignedToUserId) {
      res.status(400).json({ message: 'Cannot rate an unassigned task' });
      return;
    }

    if (task.status === 'Closed' && !task.timeBooking) {
      res.status(400).json({
        message: 'A time booking must be submitted before this task can be rated.'
      });
      return;
    }

    // Fetch assignee's role from DB (not from JWT — JWT has requester's role only)
    const assignee = await prisma.user.findUnique({
      where: { id: task.assignedToUserId, deletedAt: null },
      select: { id: true, name: true, role: { select: { name: true } }, divisionId: true }
    });

    if (!assignee) {
      res.status(404).json({ message: 'Assignee not found' });
      return;
    }

    const assigneeRole = assignee.role.name;

    // Director can rate Manager assignees; Manager can rate same-Division assignees
    if (role === 'Director') {
      if (assigneeRole !== 'Manager') {
        res.status(403).json({ message: 'Directors can only rate tasks where the assignee is a Manager' });
        return;
      }
    } else if (role === 'Manager') {
      if (assignee.divisionId !== divisionId) {
        res.status(403).json({ message: 'Managers can only rate tasks where the assignee is in their own division' });
        return;
      }
    } else {
      res.status(403).json({ message: 'Only Directors and Managers can rate tasks' });
      return;
    }

    const previousRating = task.rating;
    const isRevision = previousRating !== null;

    const updated = await prisma.task.update({
      where: { id },
      data: { rating },
      include: taskInclude()
    });

    const content = isRevision
      ? `Task re-rated from ${previousRating}/5 to ${rating}/5`
      : `Task rated ${rating}/5`;

    await logAuditAndActivity(
      task.id,
      String(task.id),
      'TASK_RATED',
      userId,
      content,
      { previousRating, newRating: rating, isRevision }
    );

    res.json({ ...updated, isOverdue: computeIsOverdue(updated), deadlineStatus: computeDeadlineStatus(updated) });
  } catch (error) {
    console.error('Error rating task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/tasks/:id/activity ─────────────────────────────────────────────

export const getTaskActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, issuerId: true, assignedToUserId: true, targetDivisionId: true, wpId: true }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Access control: Transparent viewing model
    // All authenticated users can view the task activity feed.

    const activities = await prisma.feedPost.findMany({
      where: { scope: 'TASK', scopeId: id },
      orderBy: { createdAt: 'asc' }
    });

    // Enrich with author name where authorId is present
    const authorIds = [...new Set(activities.map(a => a.authorId).filter(Boolean))] as number[];
    const authors = authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true }
        })
      : [];

    const authorMap = new Map(authors.map(a => [a.id, a.name]));

    const enriched = activities.map(a => ({
      ...a,
      author: a.authorId ? { id: a.authorId, name: authorMap.get(a.authorId) ?? null } : null
    }));

    res.json(enriched);
  } catch (error) {
    console.error('Error fetching task activity:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/tasks/:id/activity ────────────────────────────────────────────

export const postTaskComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { userId, role, divisionId } = req.user!;
    const { content } = req.body;

    if (!content || !content.trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, issuerId: true, assignedToUserId: true, targetDivisionId: true, status: true, wpId: true }
    });

    if (!task) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    // Access control: Anyone can comment on tasks (Transparent commenting model)

    const activity = await createFeedPost(prisma, {
      type: 'COMMENT',
      scope: 'TASK',
      scopeId: id,
      content: content.trim(),
      authorId: userId
    });

    // Enrich with author name
    const author = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true }
    });

    res.status(201).json({
      ...activity,
      author: author ? { id: author.id, name: author.name } : null
    });
  } catch (error) {
    console.error('Error posting task comment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
