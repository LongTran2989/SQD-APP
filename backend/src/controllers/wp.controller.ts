import { Request, Response } from 'express';
import { Prisma, PrismaClient, WorkPackage } from '@prisma/client';
import { fireAutoGenForWp, validateAutoGenConfig, AutoGenColumns } from '../services/autoGenService';
import { createFeedPost } from '../services/feedService';
import { FINAL_TASK_STATUSES } from '../constants/taskStatus';
import { hasPrivilege } from '../utils/privilegeAccess';

// Emits a WP-scope SYSTEM_EVENT alongside the existing AuditLog write. Mirrors
// the task feed's logTaskActivity: best-effort, never throws, authorId stays
// null (the actor is named in the content). Forward-only — no backfill.
async function logWpSystemEvent(wpId: number, content: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    await createFeedPost(prisma, { type: 'SYSTEM_EVENT', scope: 'WP', scopeId: wpId, content, metadata });
  } catch (err) {
    console.error(`[logWpSystemEvent] Failed to log WP feed event for wpId=${wpId}. Content: "${content}". Error:`, err);
  }
}

import { prisma } from '../lib/prisma';

// ─── Helpers ─────────────────────────────────────────────────────────

interface WpTypeFieldInput {
  acRegistration?: string | null;
  customer?: string | null;
  authority?: string | null;
  targetDepartmentId?: number | null;
}

/**
 * Returns the type-specific columns to persist for a WP, keeping only the fields
 * relevant to the type (CHECK → aircraft/customer/authority; AUDIT → department)
 * and clearing the rest. Validates targetDepartmentId for AUDIT. On validation
 * failure it writes the response and returns null so the caller can early-return.
 */
async function resolveWpTypeFields(
  type: string,
  input: WpTypeFieldInput,
  res: Response
): Promise<{ acRegistration: string | null; customer: string | null; authority: string | null; targetDepartmentId: number | null } | null> {
  const cleared = { acRegistration: null, customer: null, authority: null, targetDepartmentId: null };

  if (type === 'CHECK') {
    return {
      ...cleared,
      acRegistration: input.acRegistration ?? null,
      customer: input.customer ?? null,
      authority: input.authority ?? null,
    };
  }

  if (type === 'AUDIT') {
    let deptId: number | null = null;
    if (input.targetDepartmentId != null) {
      const dept = await prisma.department.findUnique({ where: { id: Number(input.targetDepartmentId) } });
      if (!dept) {
        res.status(400).json({ message: 'targetDepartmentId references a non-existent department' });
        return null;
      }
      deptId = dept.id;
    }
    return { ...cleared, targetDepartmentId: deptId };
  }

  // Other types (SURVEILLANCE, INVESTIGATION, OTHER): no type-specific fields.
  return cleared;
}

interface ComputeWpStatusInput {
  id: number;
  status: string;
  timeframeFrom: Date;
  timeframeTo: Date;
}

/**
 * Computes the effective WP status on-the-fly.
 * Only 'Closed' and 'Inactive' are stored in DB; the rest are derived.
 */
async function computeWpStatus(wp: ComputeWpStatusInput): Promise<string> {
  // Manual states are authoritative
  if (wp.status === 'Closed' || wp.status === 'Inactive') {
    return wp.status;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fromDate = new Date(wp.timeframeFrom.getFullYear(), wp.timeframeFrom.getMonth(), wp.timeframeFrom.getDate());
  const toDate = new Date(wp.timeframeTo.getFullYear(), wp.timeframeTo.getMonth(), wp.timeframeTo.getDate());

  if (today < fromDate) {
    return 'Open';
  }

  if (today > toDate) {
    // Check if there are incomplete tasks
    const incompleteTasks = await prisma.task.count({
      where: {
        wpId: wp.id,
        deletedAt: null,
        status: { notIn: FINAL_TASK_STATUSES }
      }
    });

    if (incompleteTasks > 0) {
      return 'Overdue';
    }
    // All tasks are in final state after timeframe ended
    return 'In Progress';
  }

  return 'In Progress';
}

// ─── GET /api/work-packages ──────────────────────────────────────────
export const getWorkPackages = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, role, divisionId } = req.user!;

    let where: any = { deletedAt: null };

    // Transparency model: all users can view system-wide WP list.
    // Filtering to prevent clutter will be handled on the frontend.

    const wps = await prisma.workPackage.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        division: { select: { id: true, name: true, code: true } },
        creator: { select: { id: true, name: true } },
        assignments: {
          include: { user: { select: { id: true, name: true } } }
        },
        _count: { select: { tasks: true } }
      }
    });

    const results = await Promise.all(wps.map(async (wp) => {
      const computedStatus = await computeWpStatus(wp);
      return {
        ...wp,
        computedStatus
      };
    }));

    res.json(results);
  } catch (error) {
    console.error('Error fetching work packages:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/work-packages/:id ──────────────────────────────────────
export const getWorkPackageById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);

    const wp = await prisma.workPackage.findUnique({
      where: { id, deletedAt: null },
      include: {
        division: { select: { id: true, name: true, code: true } },
        creator: { select: { id: true, name: true } },
        assignments: {
          include: { user: { select: { id: true, name: true, email: true } } }
        },
        tasks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, taskId: true, status: true,
            assignedToUser: { select: { id: true, name: true } },
            template: { select: { title: true, templateId: true } },
            createdAt: true, completedAt: true, deadline: true
          }
        }
      }
    });

    if (!wp) {
      res.status(404).json({ message: 'Work Package not found' });
      return;
    }

    // Access control: Transparent view model
    // Any authenticated user can view the WP details.
    // Modifications are restricted in action endpoints (PUT/POST/DELETE).

    const computedStatus = await computeWpStatus(wp);

    // On-demand catch-up: REPEAT mode only. A missed cron day is caught when
    // someone opens the WP. SINGLE_SHOT is NEVER triggered on-demand — it must
    // fire via cron so a Manager opening the WP early can't spawn it prematurely.
    // The Closed/Inactive check uses the stored status (not computedStatus's
    // server-local "today") so this gate never disagrees with autoGenService's
    // own APP_TIMEZONE-anchored timeframe check, which is the sole authority
    // on whether "today" is actually within the WP's window.
    let autoGenResult = undefined;
    if (wp.autoGenerate && wp.autoGenMode === 'REPEAT' && wp.status !== 'Closed' && wp.status !== 'Inactive') {
      autoGenResult = await fireAutoGenForWp(wp.id);
    }

    res.json({
      ...wp,
      computedStatus,
      autoGenResult
    });
  } catch (error) {
    console.error('Error fetching work package:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── WP creation core (shared by the HTTP handler + blueprint launch) ────────

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface CreateWorkPackageInput {
  name: string;
  type: string;
  divisionId: number;
  timeframeFrom: Date;
  timeframeTo: Date;
  typeFields: { acRegistration: string | null; customer: string | null; authority: string | null; targetDepartmentId: number | null };
  autoGenData: AutoGenColumns;
  blueprintId?: number | null;
  isRoutine?: boolean;
  auditActionType?: string;
  auditDetails?: Record<string, unknown>;
  systemEventContent?: string;
}

/**
 * Generates the next per-division wpId under a Division FOR UPDATE lock, creates
 * the WorkPackage, and dual-writes (AuditLog + WP SYSTEM_EVENT). Shared by the
 * create handler and the blueprint launch endpoint (mirrors how createTaskService
 * is reused by autoGenService). Throws 'Division not found' for the caller to map.
 */
export async function createWorkPackageService(
  client: PrismaLike,
  actor: { userId: number },
  input: CreateWorkPackageInput
): Promise<WorkPackage> {
  const { name, type, divisionId, timeframeFrom, timeframeTo, typeFields, autoGenData } = input;

  // Reuse the caller's transaction if given one; otherwise open our own so the
  // sequence lock + create stay atomic (preserves the handler's original behavior).
  const run = async (tx: Prisma.TransactionClient): Promise<WorkPackage> => {
    const divRaw = await tx.$queryRaw<{ id: number, code: string }[]>`SELECT id, code FROM "Division" WHERE id = ${divisionId} FOR UPDATE`;
    if (divRaw.length === 0) throw new Error('Division not found');
    const division = divRaw[0]!;

    const lastWp = await tx.workPackage.findFirst({
      where: { wpId: { startsWith: `${division.code}-WP-` } },
      orderBy: { id: 'desc' },
      select: { wpId: true }
    });

    let nextSeq = 1;
    if (lastWp?.wpId) {
      const parts = lastWp.wpId.split('-');
      const seqPart = parts[parts.length - 1];
      if (seqPart) {
        nextSeq = parseInt(seqPart) + 1;
      }
    }

    const generatedWpId = `${division.code}-WP-${String(nextSeq).padStart(6, '0')}`;

    return tx.workPackage.create({
      data: {
        wpId: generatedWpId,
        name,
        type,
        divisionId,
        timeframeFrom,
        timeframeTo,
        creatorId: actor.userId,
        ...autoGenData,
        ...typeFields,
        blueprintId: input.blueprintId ?? null,
        isRoutine: input.isRoutine ?? false,
        status: 'Open',
      },
      include: {
        division: { select: { id: true, name: true, code: true } },
        creator: { select: { id: true, name: true } },
      }
    });
  };

  const isTx = !(client as PrismaClient).$transaction;
  const wp = isTx
    ? await run(client as Prisma.TransactionClient)
    : await (client as PrismaClient).$transaction((tx) => run(tx));

  // Dual-write (parameterized): AuditLog + WP-scope SYSTEM_EVENT, after commit.
  await prisma.auditLog.create({
    data: {
      actionType: input.auditActionType ?? 'WORK_PACKAGE_CREATED',
      entityType: 'WorkPackage',
      entityId: String(wp.id),
      performedByUserId: actor.userId,
      details: (input.auditDetails ?? { wpId: wp.wpId, type, divisionId }) as Prisma.InputJsonValue,
    }
  });
  await logWpSystemEvent(wp.id, input.systemEventContent ?? `Work Package "${wp.name}" created.`, { wpId: wp.wpId, type });

  return wp;
}

// ─── POST /api/work-packages ─────────────────────────────────────────
export const createWorkPackage = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const {
      name, type, divisionId, timeframeFrom, timeframeTo,
      acRegistration, customer, authority, targetDepartmentId,
      autoGenerate, autoGenMode, autoGenInterval, autoGenTemplateId, autoGenSetId, autoGenInlineSet,
    } = req.body;

    if (!name || !type || !divisionId || !timeframeFrom || !timeframeTo) {
      res.status(400).json({ message: 'name, type, divisionId, timeframeFrom, and timeframeTo are required' });
      return;
    }

    // Validate type exists
    const wpType = await prisma.wpType.findUnique({ where: { code: type } });
    if (!wpType) {
      res.status(400).json({ message: `Invalid WP type: ${type}. Must match an existing WpType code.` });
      return;
    }

    // Resolve type-specific fields (only the ones relevant to the type are stored).
    const typeFields = await resolveWpTypeFields(type, { acRegistration, customer, authority, targetDepartmentId }, res);
    if (typeFields === null) return; // a validation error was already sent

    // Validate timeframe
    const fromDate = new Date(timeframeFrom);
    const toDate = new Date(timeframeTo);
    if (fromDate >= toDate) {
      res.status(400).json({ message: 'timeframeFrom must be before timeframeTo' });
      return;
    }

    // Validate + normalize the auto-generate config (any WP type may opt in).
    const autoGen = await validateAutoGenConfig(prisma, {
      autoGenerate, autoGenMode, autoGenInterval, autoGenTemplateId, autoGenSetId, autoGenInlineSet,
    });
    if ('error' in autoGen) {
      res.status(400).json({ message: autoGen.error });
      return;
    }

    const wp = await createWorkPackageService(prisma, { userId }, {
      name, type, divisionId,
      timeframeFrom: fromDate, timeframeTo: toDate,
      typeFields, autoGenData: autoGen.data,
    });

    res.status(201).json(wp);
  } catch (error: any) {
    if (error.message === 'Division not found') {
      res.status(400).json({ message: 'Division not found' });
      return;
    }
    console.error('Error creating work package:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/work-packages/:id ──────────────────────────────────────
export const updateWorkPackage = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const {
      name, timeframeFrom, timeframeTo, acRegistration, customer, authority, targetDepartmentId,
      autoGenerate, autoGenMode, autoGenInterval, autoGenTemplateId, autoGenSetId, autoGenInlineSet,
    } = req.body;

    const wp = await prisma.workPackage.findUnique({ where: { id, deletedAt: null } });
    if (!wp) {
      res.status(404).json({ message: 'Work Package not found' });
      return;
    }

    if (wp.status === 'Closed') {
      res.status(403).json({ message: 'Cannot update a Closed Work Package' });
      return;
    }

    const isManager = wp.creatorId === userId || hasPrivilege(req.user!, 'wp:edit');
    // PR8: an assigned user may edit ONLY the timeframe; managers/creator/global edit everything.
    let isAssignee = false;
    if (!isManager) {
      const assignment = await prisma.workPackageAssignment.findFirst({ where: { wpId: id, userId } });
      isAssignee = !!assignment;
    }

    if (!isManager && !isAssignee) {
      res.status(403).json({ message: 'Insufficient permissions to update this Work Package' });
      return;
    }

    // Assignees can only touch timeframe fields.
    if (!isManager) {
      const touchesNonTimeframe =
        name !== undefined || acRegistration !== undefined ||
        customer !== undefined || authority !== undefined || targetDepartmentId !== undefined ||
        autoGenerate !== undefined || autoGenMode !== undefined || autoGenInterval !== undefined ||
        autoGenTemplateId !== undefined || autoGenSetId !== undefined || autoGenInlineSet !== undefined;
      if (touchesNonTimeframe) {
        res.status(403).json({ message: 'Assigned users may only edit the timeframe of a Work Package' });
        return;
      }
    }

    // Timeframe edits are blocked once the WP is Overdue (its window has lapsed).
    const computedStatus = await computeWpStatus(wp);
    if ((timeframeFrom !== undefined || timeframeTo !== undefined) && computedStatus === 'Overdue') {
      res.status(400).json({ message: 'Cannot change the timeframe of an Overdue Work Package' });
      return;
    }

    const dataToUpdate: any = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (timeframeFrom !== undefined) dataToUpdate.timeframeFrom = new Date(timeframeFrom);
    if (timeframeTo !== undefined) dataToUpdate.timeframeTo = new Date(timeframeTo);

    // Type-specific fields (managers only; resolved/validated against the WP type).
    if (isManager && (acRegistration !== undefined || customer !== undefined || authority !== undefined || targetDepartmentId !== undefined)) {
      const typeFields = await resolveWpTypeFields(wp.type, { acRegistration, customer, authority, targetDepartmentId }, res);
      if (typeFields === null) return;
      Object.assign(dataToUpdate, typeFields);
    }

    // Auto-generate config (managers only). Replace-semantics: to change it, the
    // client sends the full block (autoGenerate present). autoGenFiredAt is left
    // untouched so an already-fired SINGLE_SHOT never silently re-spawns.
    if (isManager && autoGenerate !== undefined) {
      const autoGen = await validateAutoGenConfig(prisma, {
        autoGenerate, autoGenMode, autoGenInterval, autoGenTemplateId, autoGenSetId, autoGenInlineSet,
      });
      if ('error' in autoGen) {
        res.status(400).json({ message: autoGen.error });
        return;
      }
      Object.assign(dataToUpdate, autoGen.data);
    }

    // Validate the resulting timeframe ordering.
    const effFrom = dataToUpdate.timeframeFrom ?? wp.timeframeFrom;
    const effTo = dataToUpdate.timeframeTo ?? wp.timeframeTo;
    if (effFrom >= effTo) {
      res.status(400).json({ message: 'timeframeFrom must be before timeframeTo' });
      return;
    }

    const updated = await prisma.workPackage.update({
      where: { id },
      data: dataToUpdate,
      include: {
        division: { select: { id: true, name: true, code: true } },
        creator: { select: { id: true, name: true } },
      }
    });

    // Dual-write (Rule 3): audit + WP feed for a material change.
    await prisma.auditLog.create({
      data: {
        actionType: 'WORK_PACKAGE_UPDATED',
        entityType: 'WorkPackage',
        entityId: String(id),
        performedByUserId: userId,
        details: { fields: Object.keys(dataToUpdate) }
      }
    });
    await logWpSystemEvent(id, `Work Package "${updated.name}" updated.`, { fields: Object.keys(dataToUpdate) });

    res.json(updated);
  } catch (error) {
    console.error('Error updating work package:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/work-packages/:id/status ───────────────────────────────
export const updateWorkPackageStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const userId = req.user!.userId;
    const userRole = req.user!.role;
    const { status, reason } = req.body;

    const wp = await prisma.workPackage.findUnique({
      where: { id, deletedAt: null },
      include: { tasks: { where: { deletedAt: null }, select: { status: true } } }
    });

    if (!wp) {
      res.status(404).json({ message: 'Work Package not found' });
      return;
    }

    // Only the creator (relationship) or a privileged role can change status
    if (wp.creatorId !== userId && !hasPrivilege(req.user!, 'wp:manage_status')) {
      res.status(403).json({ message: 'Insufficient permissions to change Work Package status' });
      return;
    }

    if (status === 'Closed') {
      // All tasks must be in final state
      const nonFinalTasks = wp.tasks.filter(t => !FINAL_TASK_STATUSES.includes(t.status));
      if (nonFinalTasks.length > 0) {
        res.status(400).json({
          message: `Cannot close: ${nonFinalTasks.length} task(s) are not in a final state (Closed, Rejected, or Terminated)`
        });
        return;
      }
    }

    if (status === 'Inactive') {
      if (!reason) {
        res.status(400).json({ message: 'A reason is required when inactivating a Work Package' });
        return;
      }
    }

    const dataToUpdate: any = { status };

    if (status === 'Inactive') {
      dataToUpdate.inactivationLog = {
        reason,
        inactivatedBy: userId,
        inactivatedAt: new Date().toISOString()
      };
    }

    // Reactivation clears inactivation log  
    if (status === 'Open' && wp.status === 'Inactive') {
      dataToUpdate.inactivationLog = null;
    }

    const updated = await prisma.workPackage.update({
      where: { id },
      data: dataToUpdate,
      include: {
        division: { select: { id: true, name: true, code: true } },
        creator: { select: { id: true, name: true } },
      }
    });

    // Log to AuditLog
    await prisma.auditLog.create({
      data: {
        actionType: `WORK_PACKAGE_${status.toUpperCase().replace(' ', '_')}`,
        entityType: 'WorkPackage',
        entityId: String(wp.id),
        performedByUserId: userId,
        comment: reason || null,
        details: { fromStatus: wp.status, toStatus: status }
      }
    });

    const statusLabel = status === 'Open' && wp.status === 'Inactive' ? 'reactivated' : status.toLowerCase();
    await logWpSystemEvent(
      wp.id,
      `Work Package ${statusLabel}${reason ? `: ${reason}` : ''} (was ${wp.status}).`,
      { fromStatus: wp.status, toStatus: status }
    );

    res.json(updated);
  } catch (error) {
    console.error('Error updating work package status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/work-packages/:id/assign ──────────────────────────────
export const assignUserToWp = async (req: Request, res: Response): Promise<void> => {
  try {
    const wpId = parseInt(req.params.id as string);
    const userRole = req.user!.role;
    const userDivisionId = req.user!.divisionId;
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({ message: 'userId is required' });
      return;
    }

    // Only Manager or Director can assign users
    if (!hasPrivilege(req.user!, 'wp:assign')) {
      res.status(403).json({ message: 'Only Manager or Director can assign users to Work Packages' });
      return;
    }

    const wp = await prisma.workPackage.findUnique({ where: { id: wpId, deletedAt: null } });
    if (!wp) {
      res.status(404).json({ message: 'Work Package not found' });
      return;
    }

    if (wp.status === 'Closed') {
      res.status(403).json({ message: 'Cannot assign users to a Closed Work Package' });
      return;
    }

    // Managers can only assign users in the same division
    const targetUser = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true, divisionId: true, role: { select: { name: true } } }
    });

    if (!targetUser) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (targetUser.role.name === 'Admin') {
      res.status(400).json({ message: 'Admin users cannot be assigned to Work Packages' });
      return;
    }

    if (userRole === 'Manager' && targetUser.divisionId !== userDivisionId) {
      res.status(403).json({ message: 'Managers can only assign users from the same division' });
      return;
    }

    // Check for duplicate assignment
    const existing = await prisma.workPackageAssignment.findUnique({
      where: { wpId_userId: { wpId, userId } }
    });

    if (existing) {
      res.status(400).json({ message: 'User is already assigned to this Work Package' });
      return;
    }

    const assignment = await prisma.workPackageAssignment.create({
      data: { wpId, userId },
      include: { user: { select: { id: true, name: true, email: true } } }
    });

    await logWpSystemEvent(wpId, `${targetUser.name} was assigned to this Work Package.`, { assignedUserId: userId });

    res.status(201).json({ message: 'User assigned successfully', assignment });
  } catch (error) {
    console.error('Error assigning user to WP:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/work-packages/:id/assign/:userId ────────────────────
export const removeUserFromWp = async (req: Request, res: Response): Promise<void> => {
  try {
    const wpId = parseInt(req.params.id as string);
    const targetUserId = parseInt(req.params.userId as string);
    const userRole = req.user!.role;

    // Only Manager or Director can remove assignments
    if (!hasPrivilege(req.user!, 'wp:assign')) {
      res.status(403).json({ message: 'Only Manager or Director can remove user assignments' });
      return;
    }

    const wp = await prisma.workPackage.findUnique({ where: { id: wpId, deletedAt: null } });
    if (!wp) {
      res.status(404).json({ message: 'Work Package not found' });
      return;
    }

    if (wp.status === 'Closed') {
      res.status(403).json({ message: 'Cannot modify assignments on a Closed Work Package' });
      return;
    }

    const assignment = await prisma.workPackageAssignment.findUnique({
      where: { wpId_userId: { wpId, userId: targetUserId } }
    });

    if (!assignment) {
      res.status(404).json({ message: 'Assignment not found' });
      return;
    }

    await prisma.workPackageAssignment.delete({
      where: { id: assignment.id }
    });

    const removedUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { name: true } });
    await logWpSystemEvent(
      wpId,
      `${removedUser?.name ?? `User ${targetUserId}`} was removed from this Work Package.`,
      { removedUserId: targetUserId }
    );

    res.json({ message: 'User removed from Work Package successfully' });
  } catch (error) {
    console.error('Error removing user from WP:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

