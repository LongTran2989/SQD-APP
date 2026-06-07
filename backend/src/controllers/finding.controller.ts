import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { logFindingAuditAndActivity, evaluateCloseGate } from '../services/findingService';
import { computeTrendForSignature } from '../services/trendService';
import { buildFindingScope, canAccessFinding } from '../utils/findingAccess';
import { FINDING_EXPANSION_ACTIONS } from '../constants/findingExpansion';
import { HttpError, isHttpError } from '../utils/httpError';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type PrismaLike = PrismaClient | Prisma.TransactionClient;

// ─── Constants ──────────────────────────────────────────────────────────────

const SEVERITIES = ['Observation', 'Level 1', 'Level 2'];
const FINDING_STATUSES = ['Open', 'In Progress', 'Pending Verification', 'Closed', 'Dismissed'];
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

export interface CreateFindingParams {
  taskId: number;
  eventType: string;
  departmentId: number;
  description: string;
  fieldId?: string | null;
  aircraftRegistration?: string | null;
  regulatoryReference?: string | null;
  ataChapterId?: number | null;
  hazardTagIds?: number[];
}

/**
 * Core "raise a finding" logic, callable from the HTTP handler OR another flow
 * (e.g. the escalation RAISE_FINDING action) that wants to reuse this validation
 * verbatim. Runs every write on the supplied `client` — pass a transaction
 * client to keep it atomic with the caller's own writes. Throws HttpError on
 * validation failure; the caller maps it to a response.
 */
export async function createFindingService(
  client: PrismaLike,
  actor: { userId: number },
  params: CreateFindingParams
) {
  const { taskId, fieldId, eventType, departmentId, aircraftRegistration, regulatoryReference, description, ataChapterId, hazardTagIds } = params;

  if (!taskId || !eventType || !departmentId || !description) {
    throw new HttpError(400, 'taskId, eventType, departmentId, and description are required');
  }

  // Source Task must exist and not be soft-deleted.
  const task = await client.task.findUnique({
    where: { id: taskId, deletedAt: null },
    select: { id: true, targetDivisionId: true, template: { select: { allowsFindings: true } } }
  });
  if (!task) throw new HttpError(404, 'Source task not found');
  if (!task.template?.allowsFindings) {
    throw new HttpError(400, 'This task\'s template does not allow findings to be raised');
  }

  // Department must exist.
  const department = await client.department.findUnique({ where: { id: departmentId }, select: { id: true } });
  if (!department) throw new HttpError(400, 'Department not found');

  // Optional taxonomy: ATA chapter + hazard tags must exist AND be active.
  if (ataChapterId != null) {
    const ata = await client.ataChapter.findFirst({ where: { id: ataChapterId, isActive: true }, select: { id: true } });
    if (!ata) throw new HttpError(400, 'ATA chapter not found or inactive');
  }
  const tagIds = Array.isArray(hazardTagIds) ? [...new Set(hazardTagIds)] : [];
  if (tagIds.length > 0) {
    const found = await client.hazardTag.count({ where: { id: { in: tagIds }, isActive: true } });
    if (found !== tagIds.length) throw new HttpError(400, 'One or more hazard tags not found or inactive');
  }

  const reporter = await client.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  const reporterName = reporter?.name ?? `User ${actor.userId}`;

  const created = await client.finding.create({
    data: {
      eventType,
      description,
      departmentId,
      fieldId: fieldId ?? null,
      aircraftRegistration: aircraftRegistration ?? null,
      regulatoryReference: regulatoryReference ?? null,
      status: 'Open',
      sourceTaskId: task.id,
      reportedByUserId: actor.userId,
      // Inherit the source task's division for RBAC division-scoping.
      targetDivisionId: task.targetDivisionId ?? null,
      ataChapterId: ataChapterId ?? null,
      ...(tagIds.length > 0
        ? { hazardTags: { create: tagIds.map((hazardTagId) => ({ hazardTagId })) } }
        : {})
    }
  });

  await logFindingAuditAndActivity(
    client,
    created.id,
    task.id,
    'CREATED',
    actor.userId,
    `Finding #${created.id} raised by ${reporterName}`,
    { findingId: created.id, eventType, sourceTaskId: task.id }
  );

  return created;
}

export const createFinding = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { taskId, fieldId, eventType, departmentId, aircraftRegistration, regulatoryReference, description, ataChapterId, hazardTagIds } = req.body;

    const finding = await prisma.$transaction((tx) =>
      createFindingService(tx, { userId }, { taskId, fieldId, eventType, departmentId, aircraftRegistration, regulatoryReference, description, ataChapterId, hazardTagIds })
    );

    res.status(201).json(finding);
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
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
        },
        ataChapter: true,
        hazardTags: { include: { hazardTag: true } },
        rca: {
          include: {
            causeCode: true,
            conductedByUser: { select: { id: true, name: true } },
            whySteps: { orderBy: { orderIndex: 'asc' } },
            factors: { orderBy: { id: 'asc' } }
          }
        },
        capaActions: {
          orderBy: [{ type: 'asc' }, { id: 'asc' }],
          include: {
            ownerUser: { select: { id: true, name: true } },
            verifiedByUser: { select: { id: true, name: true } },
            linkedItems: {
              include: {
                task: { select: { id: true, taskId: true, title: true, status: true, template: { select: { title: true } } } },
                wp: { select: { id: true, wpId: true, name: true, status: true } }
              }
            }
          }
        },
        linksFrom: { include: { relatedFinding: { select: { id: true, description: true, status: true, severity: true, eventType: true } } } },
        linksTo: { include: { fromFinding: { select: { id: true, description: true, status: true, severity: true, eventType: true } } } }
      }
    });

    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }

    if (!(await canAccessFinding(prisma, user, finding.id))) {
      res.status(403).json({ message: 'You do not have access to this finding' });
      return;
    }

    const dueDateBreached = await ensureDueDateBreachLogged(finding, user.userId);
    // Reuse the already-loaded signature (department + ATA + cause code + hazard
    // tags) instead of re-querying the finding inside the trend service.
    const trend = await computeTrendForSignature({
      findingId: finding.id,
      departmentId: finding.departmentId,
      ataChapterId: finding.ataChapterId,
      causeCodeId: finding.rca?.causeCodeId ?? null,
      hazardTagIds: finding.hazardTags.map((h) => h.hazardTagId)
    });

    res.json({
      ...finding,
      trend,
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
    const { severity, dueDate, ataChapterId, hazardTagIds } = req.body;

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
    if (finding.status !== 'Open') {
      res.status(400).json({ message: 'Finding has already been reviewed' });
      return;
    }

    // Optional taxonomy adjustments at review time (must exist AND be active).
    if (ataChapterId != null) {
      const ata = await prisma.ataChapter.findFirst({ where: { id: ataChapterId, isActive: true }, select: { id: true } });
      if (!ata) {
        res.status(400).json({ message: 'ATA chapter not found or inactive' });
        return;
      }
    }
    const tagIds = Array.isArray(hazardTagIds) ? [...new Set(hazardTagIds as number[])] : null;
    if (tagIds && tagIds.length > 0) {
      const found = await prisma.hazardTag.count({ where: { id: { in: tagIds }, isActive: true } });
      if (found !== tagIds.length) {
        res.status(400).json({ message: 'One or more hazard tags not found or inactive' });
        return;
      }
    }
    // Whether this review actually changes the finding's taxonomy (for audit).
    const taxonomyChanged = ataChapterId !== undefined || tagIds !== null;

    const reviewerName = await getUserName(userId);
    const newStatus = 'In Progress';
    const parsedDueDate = dueDate ? new Date(dueDate) : null;

    const updated = await prisma.$transaction(async (tx) => {
      // Replace hazard tags only when the caller explicitly provided the field.
      if (tagIds !== null) {
        await tx.findingHazardTag.deleteMany({ where: { findingId: id } });
        for (const hazardTagId of tagIds) {
          await tx.findingHazardTag.create({ data: { findingId: id, hazardTagId } });
        }
      }
      const result = await tx.finding.update({
        where: { id },
        data: {
          severity,
          dueDate: parsedDueDate,
          status: newStatus,
          ...(ataChapterId !== undefined ? { ataChapterId } : {})
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

      // Dual-write an audit entry whenever the review touches the taxonomy, so
      // ATA/hazard changes are not silently applied.
      if (taxonomyChanged) {
        await logFindingAuditAndActivity(
          tx,
          finding.id,
          finding.sourceTaskId,
          FINDING_EXPANSION_ACTIONS.TAXONOMY_SET,
          userId,
          `Taxonomy updated on Finding #${finding.id} by ${reviewerName}`,
          { findingId: finding.id, ataChapterId: ataChapterId ?? null, hazardTagIds: tagIds }
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
    const { errorCode, rootCause, correctiveAction, recurrence, violatorIds, category } = req.body;

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
          ...(errorCode !== undefined ? { errorCode } : {}),
          ...(rootCause !== undefined ? { rootCause } : {}),
          ...(correctiveAction !== undefined ? { correctiveAction } : {}),
          recurrence: typeof recurrence === 'boolean' ? recurrence : null,
          ...(violatorIds !== undefined ? { violatorIds: violatorIds as any } : {}),
          ...(category !== undefined ? { category } : {})
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

    // Conditional expansion-pack gate: only constrains findings that actually
    // carry RCA / CAPA data, so legacy findings close exactly as before.
    const gate = await evaluateCloseGate(finding.id);
    if (!gate.ok) {
      res.status(400).json({ message: gate.reason });
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

// ─── PUT /api/findings/:id/advance ────────────────────────────────────────────

export const advanceFinding = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can manually advance findings' });
      return;
    }

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        sourceTaskId: true,
        followUpTasks: { where: { deletedAt: null }, select: { id: true } }
      }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (finding.status !== 'In Progress') {
      res.status(400).json({ message: 'Finding must be In Progress to be manually advanced' });
      return;
    }
    if (finding.followUpTasks.length > 0) {
      res.status(400).json({ message: 'Cannot manually advance — this finding has active follow-up tasks.' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.finding.update({
        where: { id },
        data: { status: 'Pending Verification' }
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.NO_FOLLOWUP_REQUIRED,
        userId,
        `Finding #${id} manually advanced — no follow-up tasks required`,
        { findingId: finding.id, fromStatus: 'In Progress', toStatus: 'Pending Verification' }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error advancing finding:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── GET /api/findings/admin/stuck ────────────────────────────────────────────

const TASK_FINAL_STATES = ['Closed', 'Rejected', 'Terminated'];

export const getStuckFindings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role } = req.user!;

    if (role !== 'Admin' && role !== 'Director') {
      res.status(403).json({ message: 'Only an Admin or Director can view stuck findings' });
      return;
    }

    const candidates = await prisma.finding.findMany({
      where: {
        deletedAt: null,
        status: 'In Progress',
        followUpTasks: { some: { deletedAt: null } }
      },
      include: {
        followUpTasks: { where: { deletedAt: null }, select: { id: true, taskId: true, status: true } },
        reportedByUser: { select: { id: true, name: true } },
        targetDivision: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true } }
      }
    });

    const stuck = candidates.filter(
      (f) =>
        f.followUpTasks.length > 0 &&
        f.followUpTasks.every((t) => TASK_FINAL_STATES.includes(t.status))
    );

    res.json(stuck);
  } catch (error) {
    console.error('Error fetching stuck findings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/force-pending-verification ─────────────────────────

export const forcePendingVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;

    if (role !== 'Admin' && role !== 'Director') {
      res.status(403).json({ message: 'Only an Admin or Director can force-advance a finding' });
      return;
    }

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        sourceTaskId: true,
        followUpTasks: { where: { deletedAt: null }, select: { id: true, taskId: true, status: true } }
      }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (finding.status !== 'In Progress') {
      res.status(400).json({ message: 'Finding must be In Progress to be force-advanced' });
      return;
    }
    const nonFinal = finding.followUpTasks.filter((t) => !TASK_FINAL_STATES.includes(t.status));
    if (nonFinal.length > 0) {
      res.status(400).json({ message: 'Not all follow-up tasks are in a final state' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.finding.update({
        where: { id },
        data: { status: 'Pending Verification' }
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.MANUAL_ADVANCE,
        userId,
        `Finding #${id} force-advanced to Pending Verification by admin`,
        { findingId: finding.id, reason: 'Admin force-advance' }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error force-advancing finding:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/severity ───────────────────────────────────────────

export const updateSeverity = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { severity, reason } = req.body;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can update severity' });
      return;
    }

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, status: true, severity: true, sourceTaskId: true }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (finding.status === 'Closed' || finding.status === 'Dismissed') {
      res.status(400).json({ message: 'Cannot update severity on a Closed or Dismissed finding' });
      return;
    }
    if (!severity || !SEVERITIES.includes(severity)) {
      res.status(400).json({ message: `severity must be one of: ${SEVERITIES.join(', ')}` });
      return;
    }
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      res.status(400).json({ message: 'reason is required' });
      return;
    }

    const oldSeverity = finding.severity;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.finding.update({
        where: { id },
        data: { severity }
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.SEVERITY_UPDATED,
        userId,
        `Severity updated from ${oldSeverity} to ${severity}: ${reason}`,
        { findingId: finding.id, fromSeverity: oldSeverity, toSeverity: severity, reason }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating severity:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/dismiss ────────────────────────────────────────────

export const dismissFinding = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { reason } = req.body;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can dismiss findings' });
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
    if (finding.status !== 'Open') {
      res.status(400).json({ message: 'Only Open findings can be dismissed' });
      return;
    }
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      res.status(400).json({ message: 'reason is required' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.finding.update({
        where: { id },
        data: { status: 'Dismissed' }
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.DISMISSED,
        userId,
        `Finding #${id} dismissed: ${reason}`,
        { findingId: finding.id, reason }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error dismissing finding:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/taxonomy ───────────────────────────────────────────

export const updateTaxonomy = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { ataChapterId, hazardTagIds } = req.body;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can update taxonomy' });
      return;
    }

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, status: true, sourceTaskId: true, ataChapterId: true }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (finding.status === 'Closed' || finding.status === 'Dismissed') {
      res.status(400).json({ message: 'Cannot update taxonomy on a Closed or Dismissed finding' });
      return;
    }

    if (ataChapterId !== undefined && ataChapterId !== null) {
      const ata = await prisma.ataChapter.findFirst({ where: { id: ataChapterId, isActive: true }, select: { id: true } });
      if (!ata) {
        res.status(400).json({ message: 'ATA chapter not found or inactive' });
        return;
      }
    }

    const tagIds = Array.isArray(hazardTagIds) ? [...new Set(hazardTagIds as number[])] : null;
    if (tagIds && tagIds.length > 0) {
      const found = await prisma.hazardTag.count({ where: { id: { in: tagIds }, isActive: true } });
      if (found !== tagIds.length) {
        res.status(400).json({ message: 'One or more hazard tags not found or inactive' });
        return;
      }
    }

    const fromAtaChapterId = finding.ataChapterId;

    const updated = await prisma.$transaction(async (tx) => {
      if (tagIds !== null) {
        await tx.findingHazardTag.deleteMany({ where: { findingId: id } });
        for (const hazardTagId of tagIds) {
          await tx.findingHazardTag.create({ data: { findingId: id, hazardTagId } });
        }
      }
      const result = await tx.finding.update({
        where: { id },
        data: {
          ...(ataChapterId !== undefined ? { ataChapterId } : {})
        }
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.TAXONOMY_UPDATED,
        userId,
        `Taxonomy updated on Finding #${id}`,
        {
          findingId: finding.id,
          fromAtaChapterId,
          toAtaChapterId: ataChapterId !== undefined ? ataChapterId : fromAtaChapterId,
          hazardTagIds: tagIds
        }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating taxonomy:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
