import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateDailyCheckTasks } from '../services/wpCheckService';
import { createFeedPost } from '../services/feedService';

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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Helpers ─────────────────────────────────────────────────────────

const FINAL_TASK_STATUSES = ['Closed', 'Rejected', 'Terminated'];

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

    // On-demand CHECK task generation
    let checkTaskResult = undefined;
    if (wp.type === 'CHECK' && wp.checkTemplateId && computedStatus === 'In Progress') {
      checkTaskResult = await generateDailyCheckTasks(wp.id);
    }

    res.json({
      ...wp,
      computedStatus,
      checkTaskResult
    });
  } catch (error) {
    console.error('Error fetching work package:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/work-packages ─────────────────────────────────────────
export const createWorkPackage = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { name, type, divisionId, timeframeFrom, timeframeTo, checkTemplateId, acRegistration, customer, authority, targetDepartmentId } = req.body;

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

    // CHECK type requires checkTemplateId
    if (type === 'CHECK' && !checkTemplateId) {
      res.status(400).json({ message: 'CHECK type Work Packages require a checkTemplateId' });
      return;
    }

    // Validate checkTemplateId if provided
    if (checkTemplateId) {
      const template = await prisma.template.findUnique({ where: { id: checkTemplateId } });
      if (!template) {
        res.status(400).json({ message: 'checkTemplateId references a non-existent template' });
        return;
      }
      if (template.status !== 'Published') {
        res.status(400).json({ message: 'checkTemplateId must reference a Published template' });
        return;
      }
    }

    // Auto-generate wpId
    const wp = await prisma.$transaction(async (tx) => {
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
          timeframeFrom: fromDate,
          timeframeTo: toDate,
          creatorId: userId,
          checkTemplateId: checkTemplateId || null,
          ...typeFields,
          status: 'Open',
        },
        include: {
          division: { select: { id: true, name: true, code: true } },
          creator: { select: { id: true, name: true } },
        }
      });
    });

    // Log to AuditLog
    await prisma.auditLog.create({
      data: {
        actionType: 'WORK_PACKAGE_CREATED',
        entityType: 'WorkPackage',
        entityId: String(wp.id),
        performedByUserId: userId,
        details: { wpId: wp.wpId, type, divisionId }
      }
    });

    await logWpSystemEvent(wp.id, `Work Package "${wp.name}" created.`, { wpId: wp.wpId, type });

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
    const { name, timeframeFrom, timeframeTo, checkTemplateId, acRegistration, customer, authority, targetDepartmentId } = req.body;

    const wp = await prisma.workPackage.findUnique({ where: { id, deletedAt: null } });
    if (!wp) {
      res.status(404).json({ message: 'Work Package not found' });
      return;
    }

    if (wp.status === 'Closed') {
      res.status(403).json({ message: 'Cannot update a Closed Work Package' });
      return;
    }

    const isManager = wp.creatorId === userId || ['Admin', 'Director', 'Manager'].includes(userRole);
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
        name !== undefined || checkTemplateId !== undefined || acRegistration !== undefined ||
        customer !== undefined || authority !== undefined || targetDepartmentId !== undefined;
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
    if (checkTemplateId !== undefined) dataToUpdate.checkTemplateId = checkTemplateId;

    // Type-specific fields (managers only; resolved/validated against the WP type).
    if (isManager && (acRegistration !== undefined || customer !== undefined || authority !== undefined || targetDepartmentId !== undefined)) {
      const typeFields = await resolveWpTypeFields(wp.type, { acRegistration, customer, authority, targetDepartmentId }, res);
      if (typeFields === null) return;
      Object.assign(dataToUpdate, typeFields);
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

    // Only creator, Admin, or Director can change status
    if (wp.creatorId !== userId && !['Admin', 'Director'].includes(userRole)) {
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
    if (!['Manager', 'Director', 'Admin'].includes(userRole)) {
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
      select: { id: true, name: true, divisionId: true }
    });

    if (!targetUser) {
      res.status(404).json({ message: 'User not found' });
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
    if (!['Manager', 'Director', 'Admin'].includes(userRole)) {
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

// ─── GET /api/work-packages/types ────────────────────────────────────
export const getWpTypes = async (req: Request, res: Response): Promise<void> => {
  try {
    const types = await prisma.wpType.findMany({ orderBy: { code: 'asc' } });
    res.json(types);
  } catch (error) {
    console.error('Error fetching WP types:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/work-packages/types ───────────────────────────────────
export const createWpType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, description } = req.body;

    if (!code) {
      res.status(400).json({ message: 'code is required' });
      return;
    }

    const existing = await prisma.wpType.findUnique({ where: { code } });
    if (existing) {
      res.status(400).json({ message: `WP type "${code}" already exists` });
      return;
    }

    const wpType = await prisma.wpType.create({
      data: { code: code.toUpperCase(), description: description || null }
    });

    res.status(201).json(wpType);
  } catch (error) {
    console.error('Error creating WP type:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
