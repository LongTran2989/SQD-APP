import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { logFindingAuditAndActivity } from '../services/findingService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Constants ──────────────────────────────────────────────────────────────

const SEVERITIES = ['Observation', 'Level 1', 'Level 2'];
const FINDING_STATUSES = ['Open', 'In Progress', 'Pending Verification', 'Closed'];
// Manager (any division) or Director may review / generate tasks / sign off.
const FINDING_REVIEWER_ROLES = ['Manager', 'Director'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates the next sequential human-readable taskId for a division code.
 * Mirrors task.controller.generateTaskId — replicated to avoid a controller
 * import cycle. Must run inside a $transaction (division row locked by caller).
 */
async function generateTaskId(divisionCode: string, tx: Prisma.TransactionClient): Promise<string> {
  const lastTask = await tx.task.findFirst({
    where: { taskId: { startsWith: `${divisionCode}-` }, deletedAt: null },
    orderBy: { id: 'desc' },
    select: { taskId: true }
  });
  let nextSeq = 1;
  if (lastTask?.taskId) {
    const parts = lastTask.taskId.split('-');
    const seqPart = parts[parts.length - 1];
    if (seqPart) nextSeq = parseInt(seqPart, 10) + 1;
  }
  return `${divisionCode}-${String(nextSeq).padStart(6, '0')}`;
}

/** Generates the next sequential wpId for a division code. */
async function generateWpId(divisionCode: string, tx: Prisma.TransactionClient): Promise<string> {
  const lastWp = await tx.workPackage.findFirst({
    where: { wpId: { startsWith: `${divisionCode}-WP-` } },
    orderBy: { id: 'desc' },
    select: { wpId: true }
  });
  let nextSeq = 1;
  if (lastWp?.wpId) {
    const parts = lastWp.wpId.split('-');
    const seqPart = parts[parts.length - 1];
    if (seqPart) nextSeq = parseInt(seqPart, 10) + 1;
  }
  return `${divisionCode}-WP-${String(nextSeq).padStart(6, '0')}`;
}

/** Builds the Prisma WHERE clause that scopes a Finding query to a user's RBAC visibility. */
function buildFindingScope(user: { userId: number; role: string; divisionId: number }): Prisma.FindingWhereInput {
  const { userId, role, divisionId } = user;
  if (role === 'Director' || role === 'Admin') return {};
  if (role === 'Manager') return { targetDivisionId: divisionId };
  // Staff / Group Leader: own findings or findings whose follow-up Task they are assigned.
  return {
    OR: [
      { reportedByUserId: userId },
      { followUpTasks: { some: { assignedToUserId: userId, deletedAt: null } } }
    ]
  };
}

/** JS-side equivalent of buildFindingScope, for a single already-loaded Finding. */
function canViewFinding(
  user: { userId: number; role: string; divisionId: number },
  finding: { targetDivisionId: number | null; reportedByUserId: number; followUpTasks?: { assignedToUserId: number | null }[] }
): boolean {
  const { userId, role, divisionId } = user;
  if (role === 'Director' || role === 'Admin') return true;
  if (role === 'Manager') return finding.targetDivisionId === divisionId;
  if (finding.reportedByUserId === userId) return true;
  return finding.followUpTasks?.some((t) => t.assignedToUserId === userId) ?? false;
}

function computeDueDateBreached(finding: { dueDate: Date | null; status: string }): boolean {
  if (!finding.dueDate) return false;
  if (finding.status === 'Closed') return false;
  return new Date() > finding.dueDate;
}

/**
 * Writes a one-time DUE_DATE_BREACHED audit entry the first time a breach is
 * observed on a read. Returns whether the finding is currently breached.
 */
async function ensureDueDateBreachLogged(
  finding: { id: number; dueDate: Date | null; status: string },
  performedByUserId: number
): Promise<boolean> {
  const breached = computeDueDateBreached(finding);
  if (!breached) return false;
  try {
    const existing = await prisma.auditLog.findFirst({
      where: { entityType: 'Finding', entityId: String(finding.id), actionType: 'DUE_DATE_BREACHED' }
    });
    if (!existing) {
      await prisma.auditLog.create({
        data: {
          actionType: 'DUE_DATE_BREACHED',
          entityType: 'Finding',
          entityId: String(finding.id),
          performedByUserId,
          details: { dueDate: finding.dueDate } as any
        }
      });
    }
  } catch (err) {
    console.error(`[ensureDueDateBreachLogged] failed for finding=${finding.id}:`, err);
  }
  return true;
}

async function getUserName(userId: number): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? `User ${userId}`;
}

// ─── POST /api/findings ─────────────────────────────────────────────────────

export const createFinding = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { taskId, fieldId, eventType, departmentId, aircraftRegistration, regulatoryReference, description } = req.body;

    if (!taskId || !eventType || !departmentId || !description) {
      res.status(400).json({ message: 'taskId, eventType, departmentId, and description are required' });
      return;
    }

    // Source Task must exist and not be soft-deleted.
    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: {
        id: true,
        targetDivisionId: true,
        template: { select: { allowsFindings: true } }
      }
    });
    if (!task) {
      res.status(404).json({ message: 'Source task not found' });
      return;
    }
    if (!task.template?.allowsFindings) {
      res.status(400).json({ message: 'This task\'s template does not allow findings to be raised' });
      return;
    }

    // Department must exist.
    const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } });
    if (!department) {
      res.status(400).json({ message: 'Department not found' });
      return;
    }

    const reporterName = await getUserName(userId);

    const finding = await prisma.$transaction(async (tx) => {
      const created = await tx.finding.create({
        data: {
          eventType,
          description,
          departmentId,
          fieldId: fieldId ?? null,
          aircraftRegistration: aircraftRegistration ?? null,
          regulatoryReference: regulatoryReference ?? null,
          status: 'Open',
          sourceTaskId: task.id,
          reportedByUserId: userId,
          // Inherit the source task's division for RBAC division-scoping.
          targetDivisionId: task.targetDivisionId ?? null
        }
      });

      await logFindingAuditAndActivity(
        tx,
        created.id,
        task.id,
        'CREATED',
        userId,
        `Finding #${created.id} raised by ${reporterName}`,
        { findingId: created.id, eventType, sourceTaskId: task.id }
      );

      return created;
    });

    res.status(201).json(finding);
  } catch (error) {
    console.error('Error creating finding:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/findings ────────────────────────────────────────────────────────

export const listFindings = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { status, divisionId, severity, reportedBy, taskId } = req.query;
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) ?? '20', 10) || 20));

    const filters: Prisma.FindingWhereInput[] = [{ deletedAt: null }, buildFindingScope(user)];

    if (typeof status === 'string' && FINDING_STATUSES.includes(status)) filters.push({ status });
    if (typeof severity === 'string' && SEVERITIES.includes(severity)) filters.push({ severity });
    if (divisionId) filters.push({ targetDivisionId: parseInt(divisionId as string, 10) });
    if (reportedBy) filters.push({ reportedByUserId: parseInt(reportedBy as string, 10) });
    if (taskId) filters.push({ sourceTaskId: parseInt(taskId as string, 10) });

    const where: Prisma.FindingWhereInput = { AND: filters };

    const [total, findings] = await Promise.all([
      prisma.finding.count({ where }),
      prisma.finding.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sourceTask: { select: { id: true, taskId: true, title: true, status: true, template: { select: { title: true } } } },
          reportedByUser: { select: { id: true, name: true } },
          targetDivision: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true } }
        }
      })
    ]);

    // Flag (and one-time-log) due-date breaches, then shape the response.
    const data = await Promise.all(
      findings.map(async (f) => {
        const dueDateBreached = await ensureDueDateBreachLogged(f, user.userId);
        return {
          ...f,
          sourceTask: f.sourceTask
            ? { id: f.sourceTask.id, taskId: f.sourceTask.taskId, title: f.sourceTask.title ?? f.sourceTask.template?.title ?? null, status: f.sourceTask.status }
            : null,
          dueDateBreached
        };
      })
    );

    res.json({ findings: data, total, page, pageSize });
  } catch (error) {
    console.error('Error listing findings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/findings/:id ──────────────────────────────────────────────────

export const getFindingById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const user = req.user!;

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      include: {
        sourceTask: { select: { id: true, taskId: true, title: true, status: true, template: { select: { title: true } } } },
        reportedByUser: { select: { id: true, name: true, role: { select: { name: true } } } },
        closedByUser: { select: { id: true, name: true, role: { select: { name: true } } } },
        targetDivision: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true } },
        followUpTasks: {
          where: { deletedAt: null },
          select: {
            id: true,
            taskId: true,
            title: true,
            status: true,
            assignedToUserId: true,
            assignedToUser: { select: { id: true, name: true } },
            template: { select: { title: true } }
          }
        }
      }
    });

    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }

    if (!canViewFinding(user, finding)) {
      res.status(403).json({ message: 'You do not have access to this finding' });
      return;
    }

    const dueDateBreached = await ensureDueDateBreachLogged(finding, user.userId);

    res.json({
      ...finding,
      sourceTask: finding.sourceTask
        ? {
            id: finding.sourceTask.id,
            taskId: finding.sourceTask.taskId,
            title: finding.sourceTask.title ?? finding.sourceTask.template?.title ?? null,
            status: finding.sourceTask.status
          }
        : null,
      followUpTasks: finding.followUpTasks.map((t) => ({
        id: t.id,
        taskId: t.taskId,
        title: t.title ?? t.template?.title ?? null,
        status: t.status,
        assignedToUserId: t.assignedToUserId,
        assignedToUser: t.assignedToUser
      })),
      dueDateBreached
    });
  } catch (error) {
    console.error('Error fetching finding:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/review ─────────────────────────────────────────────

export const reviewFinding = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { severity, dueDate } = req.body;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can review findings' });
      return;
    }
    if (!severity || !SEVERITIES.includes(severity)) {
      res.status(400).json({ message: `severity is required and must be one of: ${SEVERITIES.join(', ')}` });
      return;
    }

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, status: true, sourceTaskId: true }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }

    const reviewerName = await getUserName(userId);
    const newStatus = finding.status === 'Open' ? 'In Progress' : finding.status;
    const parsedDueDate = dueDate ? new Date(dueDate) : null;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.finding.update({
        where: { id },
        data: {
          severity,
          dueDate: parsedDueDate ?? undefined,
          status: newStatus
        }
      });

      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        'REVIEWED',
        userId,
        `Finding #${finding.id} reviewed — severity set to ${severity} by ${reviewerName}`,
        { findingId: finding.id, severity, fromStatus: finding.status, toStatus: newStatus }
      );

      if (parsedDueDate) {
        await logFindingAuditAndActivity(
          tx,
          finding.id,
          finding.sourceTaskId,
          'DUE_DATE_SET',
          userId,
          `Due date set to ${parsedDueDate.toISOString().slice(0, 10)} by ${reviewerName}`,
          { findingId: finding.id, dueDate: parsedDueDate.toISOString() }
        );
      }

      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error reviewing finding:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/findings/:id/tasks ─────────────────────────────────────────────

export const generateFollowUpTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role, divisionId } = req.user!;
    const { tasks } = req.body;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can generate follow-up tasks' });
      return;
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
      res.status(400).json({ message: 'tasks must be a non-empty array' });
      return;
    }

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        sourceTaskId: true,
        targetDivisionId: true,
        sourceTask: { select: { targetDivisionId: true } }
      }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }

    // Resolve the division the follow-up tasks belong to (for taskId prefix + WP).
    const resolvedDivisionId =
      finding.sourceTask?.targetDivisionId ?? finding.targetDivisionId ?? divisionId;
    const division = await prisma.division.findUnique({
      where: { id: resolvedDivisionId },
      select: { id: true, code: true }
    });
    if (!division) {
      res.status(400).json({ message: 'Could not resolve a division for the follow-up tasks' });
      return;
    }

    // Pre-validate every task entry before any write.
    for (const entry of tasks) {
      if (!entry?.templateId || !entry?.title) {
        res.status(400).json({ message: 'Each task requires templateId and title' });
        return;
      }
      const template = await prisma.template.findUnique({
        where: { id: entry.templateId },
        select: { id: true, status: true }
      });
      if (!template) {
        res.status(404).json({ message: `Template ${entry.templateId} not found` });
        return;
      }
      if (template.status !== 'Published') {
        res.status(400).json({ message: `Template ${entry.templateId} is not Published` });
        return;
      }
      if (entry.createNewWp) {
        if (!entry.newWpName) {
          res.status(400).json({ message: 'newWpName is required when createNewWp is true' });
          return;
        }
      } else if (entry.wpId) {
        const wp = await prisma.workPackage.findUnique({
          where: { id: entry.wpId, deletedAt: null },
          select: { id: true, status: true }
        });
        if (!wp) {
          res.status(400).json({ message: `Work Package ${entry.wpId} not found` });
          return;
        }
        if (!['Open', 'In Progress'].includes(wp.status)) {
          res.status(400).json({ message: `Work Package ${entry.wpId} must be Open or In Progress (current: ${wp.status})` });
          return;
        }
      }
    }

    const actorName = await getUserName(userId);

    const createdTasks = await prisma.$transaction(async (tx) => {
      // Lock the division row so taskId / wpId sequences are race-free.
      await tx.$queryRaw`SELECT id FROM "Division" WHERE id = ${division.id} FOR UPDATE`;

      const results: { id: number; taskId: string }[] = [];

      for (const entry of tasks) {
        const template = await tx.template.findUnique({
          where: { id: entry.templateId },
          select: { formSchema: true, estimatedHours: true }
        });

        let resolvedWpId: number | null = null;
        if (entry.createNewWp) {
          const newWpId = await generateWpId(division.code, tx);
          // timeframe columns are non-nullable; default to a sensible window the
          // Manager can adjust later (from = now, to = finding due date or +30d).
          const from = new Date();
          const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
          const newWp = await tx.workPackage.create({
            data: {
              wpId: newWpId,
              name: entry.newWpName,
              type: 'INVESTIGATION',
              divisionId: division.id,
              timeframeFrom: from,
              timeframeTo: to,
              creatorId: userId,
              status: 'Open'
            }
          });
          resolvedWpId = newWp.id;
        } else if (entry.wpId) {
          resolvedWpId = entry.wpId;
        }

        const newTaskId = await generateTaskId(division.code, tx);
        const created = await tx.task.create({
          data: {
            taskId: newTaskId,
            title: entry.title,
            templateId: entry.templateId,
            issuerId: userId,
            wpId: resolvedWpId,
            targetDivisionId: division.id,
            parentFindingId: finding.id,
            status: 'Unassigned',
            schemaSnapshot: template!.formSchema as any,
            estimatedHours: template!.estimatedHours ?? null,
            assignmentType: 'INDIVIDUAL'
          },
          select: { id: true, taskId: true }
        });

        await logFindingAuditAndActivity(
          tx,
          finding.id,
          finding.sourceTaskId,
          'FOLLOWUP_TASK_CREATED',
          userId,
          `Follow-up Task ${created.taskId} created by ${actorName}`,
          { findingId: finding.id, taskId: created.taskId, taskDbId: created.id }
        );

        results.push(created);
      }

      // Advance the finding to In Progress once follow-ups exist.
      if (finding.status === 'Open') {
        await tx.finding.update({ where: { id: finding.id }, data: { status: 'In Progress' } });
      }

      return results;
    });

    res.status(201).json({ findingId: finding.id, createdTasks });
  } catch (error) {
    console.error('Error generating follow-up tasks:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/stage2 ─────────────────────────────────────────────

export const completeStage2 = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { errorCode, rootCause, correctiveAction, recurrence, violatorIds } = req.body;

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        sourceTaskId: true,
        reportedByUserId: true,
        followUpTasks: { where: { deletedAt: null }, select: { assignedToUserId: true } }
      }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }

    // Auth: reporter, any follow-up Task assignee, Manager, or Director.
    const isReporter = finding.reportedByUserId === userId;
    const isFollowUpAssignee = finding.followUpTasks.some((t) => t.assignedToUserId === userId);
    const isManagerOrDirector = role === 'Manager' || role === 'Director';
    if (!isReporter && !isFollowUpAssignee && !isManagerOrDirector) {
      res.status(403).json({ message: 'You do not have permission to complete Stage 2 for this finding' });
      return;
    }

    if (finding.status !== 'Pending Verification') {
      res.status(400).json({ message: 'Finding is not yet pending verification' });
      return;
    }

    const actorName = await getUserName(userId);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.finding.update({
        where: { id },
        data: {
          errorCode: errorCode ?? undefined,
          rootCause: rootCause ?? undefined,
          correctiveAction: correctiveAction ?? undefined,
          recurrence: typeof recurrence === 'boolean' ? recurrence : undefined,
          violatorIds: violatorIds !== undefined ? (violatorIds as any) : undefined
        }
      });

      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        'STAGE2_COMPLETED',
        userId,
        `Stage 2 analytical fields completed by ${actorName}`,
        { findingId: finding.id }
      );

      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error completing stage 2:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/close ──────────────────────────────────────────────

export const closeFinding = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can close findings' });
      return;
    }

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, status: true, sourceTaskId: true, rootCause: true, correctiveAction: true }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }

    if (finding.status !== 'Pending Verification') {
      res.status(400).json({ message: 'Finding must be in Pending Verification to be closed' });
      return;
    }
    if (!finding.rootCause || !finding.correctiveAction) {
      res.status(400).json({ message: 'Stage 2 fields (rootCause and correctiveAction) must be completed before closing' });
      return;
    }

    const actorName = await getUserName(userId);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.finding.update({
        where: { id },
        data: { status: 'Closed', closedByUserId: userId, closedAt: new Date() }
      });

      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        'CLOSED',
        userId,
        `Finding #${finding.id} closed by ${actorName}`,
        { findingId: finding.id, fromStatus: finding.status, toStatus: 'Closed' }
      );

      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error closing finding:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
