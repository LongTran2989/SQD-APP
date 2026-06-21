import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { logFindingAuditAndActivity, evaluateCloseGate, getFindingWorkflowConfig } from '../services/findingService';
import { slaForSeverity } from '../constants/findingWorkflowConfig';
import { computeTrendForSignature } from '../services/trendService';
import { buildFindingScope, assertManagerDivisionScope, isFindingReviewer } from '../utils/findingAccess';
import { hasPrivilege } from '../utils/privilegeAccess';
import {
  RESPONSE_ACTION_TYPES, MULTI_DEPT_SINGLE_TASK_TYPES,
  DIRECTOR_APPROVAL_TYPES, FINDING_EXPANSION_ACTIONS
} from '../constants/findingExpansion';
import { HttpError, isHttpError } from '../utils/httpError';
import { FINAL_TASK_STATUSES } from '../constants/taskStatus';
import { FINDING_SEVERITIES as SEVERITIES, FINDING_STATUSES } from '../constants/findingTaxonomy';
import { createNotifications, resolvePrivilegedUserIds } from '../services/notificationService';

import { prisma } from '../lib/prisma';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

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

// Findings still in flight — eligible as duplicate-merge canonicals and surfaced
// as raise-time duplicate candidates (Closed / Dismissed are terminal).
const FINDING_ACTIVE_STATUSES = ['Open', 'In Progress', 'Pending Verification'];

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
  finding: { id: number; dueDate: Date | null; status: string; targetDivisionId: number | null; description: string },
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
      // Proactively alert reviewers the first time the breach is observed, so an
      // overdue finding is not dependent on someone happening to read it again.
      await notifyFindingOverdue(finding, performedByUserId);
    }
  } catch (err) {
    console.error(`[ensureDueDateBreachLogged] failed for finding=${finding.id}:`, err);
  }
  return true;
}

/**
 * Best-effort overdue alert to the finding's reviewers (finding:review holders in
 * the target division + Director/Admin). Fired once, gated by the same one-time
 * guard as the DUE_DATE_BREACHED audit row. Never throws.
 *
 * Takes the already-loaded finding row (id + targetDivisionId + description) from
 * the caller's soft-delete-filtered read — it does NOT re-query, so it can never
 * resurrect a soft-deleted finding and adds no per-finding round-trip.
 */
async function notifyFindingOverdue(
  finding: { id: number; targetDivisionId: number | null; description: string },
  performedByUserId: number
): Promise<void> {
  try {
    const reviewerIds = await resolvePrivilegedUserIds(prisma, 'finding:review', finding.targetDivisionId);
    await createNotifications(
      prisma,
      reviewerIds.map((uid) => ({
        userId: uid,
        type: 'FINDING_OVERDUE' as const,
        title: 'Finding overdue',
        body: `Finding #${finding.id} has passed its due date: ${finding.description.slice(0, 120)}`,
        linkScope: 'FINDING' as const,
        linkId: finding.id,
      })),
      [performedByUserId]
    );
  } catch (err) {
    console.error(`[notifyFindingOverdue] failed for finding=${finding.id}:`, err);
  }
}

/**
 * Batched variant of ensureDueDateBreachLogged for list endpoints. Detects which
 * findings are breached, writes a one-time DUE_DATE_BREACHED audit row for any
 * that lack one (two queries total — one findMany + one createMany — instead of
 * up to 2 per finding), and returns the Set of currently-breached finding ids.
 */
async function ensureDueDateBreachesLogged(
  findings: { id: number; dueDate: Date | null; status: string; targetDivisionId: number | null; description: string }[],
  performedByUserId: number
): Promise<Set<number>> {
  const breached = findings.filter(computeDueDateBreached);
  const breachedIds = new Set(breached.map((f) => f.id));
  if (breachedIds.size === 0) return breachedIds;

  try {
    const existing = await prisma.auditLog.findMany({
      where: {
        entityType: 'Finding',
        actionType: 'DUE_DATE_BREACHED',
        entityId: { in: breached.map((f) => String(f.id)) }
      },
      select: { entityId: true }
    });
    const alreadyLogged = new Set(existing.map((e) => e.entityId));
    const toLog = breached.filter((f) => !alreadyLogged.has(String(f.id)));
    if (toLog.length > 0) {
      await prisma.auditLog.createMany({
        data: toLog.map((f) => ({
          actionType: 'DUE_DATE_BREACHED',
          entityType: 'Finding',
          entityId: String(f.id),
          performedByUserId,
          details: { dueDate: f.dueDate } as any
        }))
      });
      // Proactively alert reviewers for each finding whose breach was first seen now.
      for (const f of toLog) {
        await notifyFindingOverdue(f, performedByUserId);
      }
    }
  } catch (err) {
    console.error('[ensureDueDateBreachesLogged] batch breach-log failed:', err);
  }
  return breachedIds;
}

async function getUserName(userId: number): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? `User ${userId}`;
}

/**
 * Guards a reviewer-only endpoint. Writes a 403 and returns false when the
 * actor is not a Manager/Director; the caller should `return` immediately.
 * `action` is folded into the message so each endpoint keeps a specific error.
 */
function requireReviewerRole(
  res: Response,
  actor: { role: string; permissions?: Record<string, boolean> | null | undefined },
  action: string
): boolean {
  if (!isFindingReviewer(actor)) {
    res.status(403).json({ message: `Only a Manager or Director can ${action}` });
    return false;
  }
  return true;
}

/**
 * Validates optional taxonomy inputs (ATA chapter + hazard tags) against the
 * active taxonomy. Returns the de-duplicated tagIds, or `null` when the caller
 * did not supply the `hazardTagIds` field at all (caller should leave existing
 * tags untouched). Throws HttpError(400) when a referenced ATA chapter or
 * hazard tag is missing or inactive. Single source of truth for the three
 * endpoints that accept taxonomy input (create / review / updateTaxonomy).
 */
async function validateTaxonomyFields(
  client: PrismaLike,
  ataChapterId: number | null | undefined,
  hazardTagIds: unknown
): Promise<number[] | null> {
  if (ataChapterId != null) {
    const ata = await client.ataChapter.findFirst({ where: { id: ataChapterId, isActive: true }, select: { id: true } });
    if (!ata) throw new HttpError(400, 'ATA chapter not found or inactive');
  }
  const tagIds = Array.isArray(hazardTagIds) ? [...new Set(hazardTagIds as number[])] : null;
  if (tagIds && tagIds.length > 0) {
    const found = await client.hazardTag.count({ where: { id: { in: tagIds }, isActive: true } });
    if (found !== tagIds.length) throw new HttpError(400, 'One or more hazard tags not found or inactive');
  }
  return tagIds;
}

/** Replaces a finding's hazard-tag set wholesale inside an open transaction. */
async function replaceHazardTags(tx: Prisma.TransactionClient, findingId: number, tagIds: number[]): Promise<void> {
  await tx.findingHazardTag.deleteMany({ where: { findingId } });
  if (tagIds.length > 0) {
    await tx.findingHazardTag.createMany({ data: tagIds.map((hazardTagId) => ({ findingId, hazardTagId })) });
  }
}

/**
 * Validates a single follow-up task entry's optional response-action fields.
 * Returns the sanitized targetDepartmentIds (positive integers, de-duplicated),
 * or `null` when the entry carries no response action. Throws HttpError(400) on
 * an invalid type, malformed department list, missing department, or violation
 * of the single-dept-per-row rule for CAR/NCR/QR/IR.
 */
async function validateResponseActionEntry(
  client: PrismaLike,
  entry: { responseActionType?: unknown; targetDepartmentIds?: unknown }
): Promise<number[] | null> {
  if (entry.responseActionType == null) return null;
  if (!RESPONSE_ACTION_TYPES.includes(entry.responseActionType as any)) {
    throw new HttpError(400, `Invalid responseActionType: '${entry.responseActionType}'`);
  }
  const rawIds: unknown[] = Array.isArray(entry.targetDepartmentIds) ? entry.targetDepartmentIds : [];
  const deptIds = [...new Set(rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (deptIds.length === 0 || deptIds.length !== rawIds.length) {
    throw new HttpError(400, `responseActionType '${entry.responseActionType}' requires an array of positive integer department IDs`);
  }
  const deptCount = await client.department.count({ where: { id: { in: deptIds }, deletedAt: null } });
  if (deptCount !== deptIds.length) {
    throw new HttpError(400, 'One or more targetDepartmentIds not found');
  }
  const isSingleDeptType = !(MULTI_DEPT_SINGLE_TASK_TYPES as readonly string[]).includes(entry.responseActionType as string);
  if (isSingleDeptType && deptIds.length !== 1) {
    throw new HttpError(400, `'${entry.responseActionType}' requires exactly one targetDepartmentId per task row`);
  }
  return deptIds;
}

// ─── POST /api/findings ─────────────────────────────────────────────────────

export interface CreateFindingParams {
  taskId?: number | null;           // optional — absent = standalone finding
  targetDivisionId?: number | null; // required when taskId is absent
  eventType: string;
  departmentId: number;
  description: string;
  fieldId?: string | null;
  aircraftRegistrationCode?: string | null;
  regulatoryReference?: string | null;
  ataChapterId?: number | null;
  hazardTagIds?: number[];
  // When set, the new finding is recorded against the source task but immediately
  // parked as a DUPLICATE of this existing (active, same-division) finding —
  // closed-loop work happens on the canonical, not here.
  duplicateOfFindingId?: number | null;
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
  const { taskId, targetDivisionId, fieldId, eventType, departmentId, aircraftRegistrationCode, regulatoryReference, description, ataChapterId, hazardTagIds, duplicateOfFindingId } = params;

  if (!eventType || !departmentId || !description) {
    throw new HttpError(400, 'eventType, departmentId, and description are required');
  }

  // Resolve source and division. Task-originated path keeps the existing
  // behaviour; standalone path requires an explicit target division.
  let resolvedDivisionId: number | null = null;

  if (taskId) {
    // Source Task must exist and not be soft-deleted.
    const task = await client.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true, targetDivisionId: true, template: { select: { allowsFindings: true } } }
    });
    if (!task) throw new HttpError(404, 'Source task not found');
    if (!task.template?.allowsFindings) {
      throw new HttpError(400, 'This task\'s template does not allow findings to be raised');
    }
    resolvedDivisionId = task.targetDivisionId ?? null;
  } else {
    // Standalone path — targetDivisionId required.
    if (!targetDivisionId) {
      throw new HttpError(400, 'targetDivisionId is required when raising a finding without a source task');
    }
    const division = await client.division.findUnique({
      where: { id: targetDivisionId },
      select: { id: true }
    });
    if (!division) throw new HttpError(400, 'Division not found');
    resolvedDivisionId = targetDivisionId;
  }

  // Department must exist.
  const department = await client.department.findFirst({ where: { id: departmentId, deletedAt: null }, select: { id: true } });
  if (!department) throw new HttpError(400, 'Department not found');

  // Optional aircraft registration must reference an existing registration.
  if (aircraftRegistrationCode) {
    const reg = await client.aircraftRegistration.findUnique({
      where: { registration: aircraftRegistrationCode },
      select: { registration: true },
    });
    if (!reg) throw new HttpError(400, `Unknown aircraft registration: ${aircraftRegistrationCode}`);
  }

  // Optional taxonomy: ATA chapter + hazard tags must exist AND be active.
  const tagIds = (await validateTaxonomyFields(client, ataChapterId, hazardTagIds)) ?? [];

  const reporter = await client.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  const reporterName = reporter?.name ?? `User ${actor.userId}`;

  const created = await client.finding.create({
    data: {
      eventType,
      description,
      departmentId,
      fieldId: fieldId ?? null,
      aircraftRegistrationCode: aircraftRegistrationCode ?? null,
      regulatoryReference: regulatoryReference ?? null,
      status: 'Open',
      sourceTaskId: taskId ?? null,
      reportedByUserId: actor.userId,
      // Inherit the source task's division (task path) or use the explicit
      // target division (standalone path) for RBAC division-scoping.
      targetDivisionId: resolvedDivisionId,
      ataChapterId: ataChapterId ?? null,
      ...(tagIds.length > 0
        ? { hazardTags: { create: tagIds.map((hazardTagId) => ({ hazardTagId })) } }
        : {})
    }
  });

  await logFindingAuditAndActivity(
    client,
    created.id,
    taskId ?? null,
    'CREATED',
    actor.userId,
    `Finding #${created.id} raised by ${reporterName}`,
    { findingId: created.id, eventType, sourceTaskId: taskId ?? null }
  );

  // Raise-time duplicate merge: record this finding against the task but park it
  // as a DUPLICATE of an existing active finding in the same division, so the
  // canonical carries the RCA/CAPA/closure work and this one demands none.
  if (duplicateOfFindingId != null) {
    const canonical = await client.finding.findUnique({
      where: { id: duplicateOfFindingId, deletedAt: null },
      select: { id: true, status: true, targetDivisionId: true },
    });
    if (!canonical) throw new HttpError(404, 'The finding to mark as a duplicate of was not found');
    if (canonical.targetDivisionId !== resolvedDivisionId) {
      throw new HttpError(400, 'Can only mark as a duplicate of a finding in the same division');
    }
    if (!FINDING_ACTIVE_STATUSES.includes(canonical.status)) {
      throw new HttpError(400, 'Can only mark as a duplicate of an active (open) finding');
    }

    await client.findingLink.create({
      data: {
        fromFindingId: created.id,
        relatedFindingId: canonical.id,
        linkType: 'DUPLICATE',
        note: 'Marked as duplicate at raise time',
        createdByUserId: actor.userId,
      },
    });
    const dismissed = await client.finding.update({
      where: { id: created.id },
      data: { status: 'Dismissed' },
    });

    await logFindingAuditAndActivity(
      client,
      created.id,
      taskId ?? null,
      FINDING_EXPANSION_ACTIONS.FINDING_LINKED,
      actor.userId,
      `Finding #${created.id} linked to Finding #${canonical.id} (DUPLICATE)`,
      { findingId: created.id, relatedFindingId: canonical.id, linkType: 'DUPLICATE' }
    );
    await logFindingAuditAndActivity(
      client,
      created.id,
      taskId ?? null,
      FINDING_EXPANSION_ACTIONS.DISMISSED,
      actor.userId,
      `Finding #${created.id} dismissed: duplicate of Finding #${canonical.id} — managed there`,
      { findingId: created.id, reason: `Duplicate of #${canonical.id}`, duplicateOfFindingId: canonical.id }
    );

    return dismissed;
  }

  return created;
}

export const createFinding = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { taskId, targetDivisionId, fieldId, eventType, departmentId, aircraftRegistrationCode, regulatoryReference, description, ataChapterId, hazardTagIds, duplicateOfFindingId } = req.body;

    const finding = await prisma.$transaction((tx) =>
      createFindingService(tx, { userId }, { taskId, targetDivisionId, fieldId, eventType, departmentId, aircraftRegistrationCode, regulatoryReference, description, ataChapterId, hazardTagIds, duplicateOfFindingId })
    );

    // Notify the finding reviewers (finding:review holders in the target
    // division + Director/Admin cross-division), post-commit and best-effort.
    // The reporter (actor) is excluded — they just raised it. Skipped on the
    // duplicate path: the finding is already parked as managed elsewhere, so
    // there is no new investigation to alert reviewers about.
    if (duplicateOfFindingId == null) {
      const reviewerIds = await resolvePrivilegedUserIds(prisma, 'finding:review', finding.targetDivisionId);
      await createNotifications(
        prisma,
        reviewerIds.map((uid) => ({
          userId: uid,
          type: 'FINDING_CREATED' as const,
          title: 'New finding raised',
          body: `Finding #${finding.id}: ${finding.description.slice(0, 120)}`,
          linkScope: 'FINDING' as const,
          linkId: finding.id,
        })),
        [userId]
      );
    }

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

// ─── GET /api/findings/duplicate-candidates ──────────────────────────────────

/**
 * Raise-time duplicate detection. Returns active findings in the same division +
 * department that the raiser might be about to duplicate, so they can link to an
 * existing one instead of opening a redundant investigation. Auth-only (open
 * visibility, consistent with getFindingLinks).
 */
export const getDuplicateCandidates = async (req: Request, res: Response): Promise<void> => {
  try {
    const departmentId = parseInt(req.query.departmentId as string, 10);
    if (!departmentId || isNaN(departmentId)) {
      res.status(400).json({ message: 'departmentId is required' });
      return;
    }

    // Division scope: derive from the source task when raising from a task,
    // otherwise the explicit target division (standalone raise).
    let divisionId: number | null = null;
    const taskIdRaw = req.query.taskId as string | undefined;
    if (taskIdRaw) {
      const taskId = parseInt(taskIdRaw, 10);
      if (taskId && !isNaN(taskId)) {
        const task = await prisma.task.findUnique({
          where: { id: taskId, deletedAt: null },
          select: { targetDivisionId: true },
        });
        divisionId = task?.targetDivisionId ?? null;
      }
    } else if (req.query.targetDivisionId) {
      const d = parseInt(req.query.targetDivisionId as string, 10);
      if (d && !isNaN(d)) divisionId = d;
    }
    // Without a division we cannot scope candidates — return nothing rather than
    // leaking cross-division findings.
    if (divisionId == null) {
      res.json([]);
      return;
    }

    const excludeId = req.query.excludeId ? parseInt(req.query.excludeId as string, 10) : null;

    const candidates = await prisma.finding.findMany({
      where: {
        deletedAt: null,
        targetDivisionId: divisionId,
        departmentId,
        status: { in: FINDING_ACTIVE_STATUSES },
        ...(excludeId && !isNaN(excludeId) ? { id: { not: excludeId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        description: true,
        status: true,
        severity: true,
        eventType: true,
        createdAt: true,
      },
    });

    res.json(candidates);
  } catch (error) {
    console.error('Error fetching duplicate candidates:', error);
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
          department: { select: { id: true, name: true } },
          aircraftRegistration: { select: { registration: true, description: true, operatorCode: true } }
        }
      })
    ]);

    // Flag (and one-time-log) due-date breaches in a single batch, then shape the response.
    const breachedIds = await ensureDueDateBreachesLogged(findings, user.userId);
    const data = findings.map((f) => ({
      ...f,
      sourceTask: f.sourceTask
        ? { id: f.sourceTask.id, taskId: f.sourceTask.taskId, title: f.sourceTask.title ?? f.sourceTask.template?.title ?? null, status: f.sourceTask.status }
        : null,
      dueDateBreached: breachedIds.has(f.id)
    }));

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
        aircraftRegistration: { select: { registration: true, description: true, operatorCode: true } },
        followUpTasks: {
          where: { deletedAt: null },
          select: {
            id: true,
            taskId: true,
            title: true,
            status: true,
            assignedToUserId: true,
            assignedToUser: { select: { id: true, name: true } },
            template: { select: { title: true } },
            responseActionType: true,
            requiresDirectorApproval: true
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
        linksTo: { include: { fromFinding: { select: { id: true, description: true, status: true, severity: true, eventType: true } } } },
        responseActions: {
          orderBy: { createdAt: 'asc' },
          include: {
            task: { select: { id: true, taskId: true, status: true } },
            createdByUser: { select: { id: true, name: true } },
            targetDepartments: {
              select: { department: { select: { id: true, name: true } } }
            }
          }
        }
      }
    });

    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }

    // Visibility is open to all authenticated users — no scope check needed.

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

    // Department names come from the Prisma relation join — no separate query needed.
    const responseActions = (finding.responseActions ?? []).map((ra) => ({
      ...ra,
      targetDepartments: ra.targetDepartments.map((rtd) => rtd.department)
    }));

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
        assignedToUser: t.assignedToUser,
        responseActionType: t.responseActionType,
        requiresDirectorApproval: t.requiresDirectorApproval
      })),
      responseActions,
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

    if (!requireReviewerRole(res, req.user!, 'review findings')) return;
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
    if (!(await assertManagerDivisionScope(prisma, req.user!, id))) {
      res.status(403).json({ message: 'Managers may only review findings in their division' });
      return;
    }
    if (finding.status !== 'Open') {
      res.status(400).json({ message: 'Finding has already been reviewed' });
      return;
    }

    // Optional taxonomy adjustments at review time (must exist AND be active).
    const tagIds = await validateTaxonomyFields(prisma, ataChapterId, hazardTagIds);
    // Whether this review actually changes the finding's taxonomy (for audit).
    const taxonomyChanged = ataChapterId !== undefined || (tagIds !== null && tagIds.length > 0);

    // Classification-driven due date (SLA). When the chosen severity makes a due
    // date mandatory, reject a review that omits one — unless a per-severity
    // default timescale is configured, in which case we auto-fill it.
    const workflowConfig = await getFindingWorkflowConfig(prisma);
    const sla = slaForSeverity(workflowConfig, severity);
    let parsedDueDate = dueDate ? new Date(dueDate) : null;
    // A malformed date string yields a truthy "Invalid Date" that would slip past
    // the SLA checks below and then throw at .toISOString() — reject it as a 400.
    if (parsedDueDate && isNaN(parsedDueDate.getTime())) {
      res.status(400).json({ message: 'Invalid dueDate' });
      return;
    }
    if (!parsedDueDate && sla.days != null) {
      parsedDueDate = new Date(Date.now() + sla.days * 24 * 60 * 60 * 1000);
    }
    if (sla.mandatory && !parsedDueDate) {
      res.status(400).json({ message: `A due date is required when reviewing a ${severity} finding` });
      return;
    }

    const reviewerName = await getUserName(userId);
    const newStatus = 'In Progress';

    const updated = await prisma.$transaction(async (tx) => {
      // Replace hazard tags only when the caller explicitly provided the field.
      if (tagIds !== null) {
        await replaceHazardTags(tx, id, tagIds);
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
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
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

    if (!requireReviewerRole(res, req.user!, 'generate follow-up tasks')) return;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      res.status(400).json({ message: 'tasks must be a non-empty array' });
      return;
    }
    if (tasks.length > 20) {
      res.status(400).json({ message: 'A maximum of 20 follow-up tasks may be generated at once' });
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
    if (!(await assertManagerDivisionScope(prisma, req.user!, id))) {
      res.status(403).json({ message: 'Managers may only generate tasks for findings in their division' });
      return;
    }
    if (!['Open', 'In Progress'].includes(finding.status)) {
      res.status(400).json({ message: `Cannot generate follow-up tasks: finding is ${finding.status}` });
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

    // Pre-validate every task entry before any write, building a sanitized
    // `prepared` list. Nothing is read from the raw req.body during the
    // transaction — the template schema is fetched once here (not re-fetched
    // per row inside the tx), and all user input is normalized up front.
    interface PreparedTask {
      templateId: number;
      title: string;
      formSchema: Prisma.InputJsonValue;
      estimatedHours: number | null;
      requiresApproval: boolean;
      skillLevel: number;
      createNewWp: boolean;
      newWpName: string | null;
      wpId: number | null;
      responseActionType: string | null;
      targetDepartmentIds: number[] | null;
      note: string | null;
      procedureRef: string | null;
    }
    const prepared: PreparedTask[] = [];

    // Batch-fetch every referenced template once (instead of one findUnique per
    // row), keyed by id for O(1) lookup inside the validation loop below.
    const templateIds = [...new Set(
      tasks.map((e: { templateId?: unknown }) => e?.templateId).filter((tid: unknown): tid is number => typeof tid === 'number')
    )];
    const templateRows = await prisma.template.findMany({
      where: { id: { in: templateIds } },
      select: { id: true, status: true, formSchema: true, estimatedHours: true, requiresApproval: true, skillLevel: true }
    });
    const templateMap = new Map(templateRows.map((t) => [t.id, t]));

    for (const entry of tasks) {
      const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
      if (!entry?.templateId || !title) {
        res.status(400).json({ message: 'Each task requires templateId and a non-empty title' });
        return;
      }
      const template = templateMap.get(entry.templateId);
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

      // Optional response action + free-text fields.
      const targetDepartmentIds = await validateResponseActionEntry(prisma, entry);
      if (entry.note != null && (typeof entry.note !== 'string' || entry.note.length > 1000)) {
        res.status(400).json({ message: 'note must be a string of at most 1000 characters' });
        return;
      }
      if (entry.procedureRef != null && (typeof entry.procedureRef !== 'string' || entry.procedureRef.length > 200)) {
        res.status(400).json({ message: 'procedureRef must be a string of at most 200 characters' });
        return;
      }

      prepared.push({
        templateId: entry.templateId,
        title,
        formSchema: template.formSchema as Prisma.InputJsonValue,
        estimatedHours: template.estimatedHours ?? null,
        // PR3: seed the per-task approval gate + skill level from the template, so
        // submit (which now reads task.requiresApproval) behaves as the template intends.
        requiresApproval: template.requiresApproval,
        skillLevel: template.skillLevel,
        createNewWp: !!entry.createNewWp,
        newWpName: entry.createNewWp ? entry.newWpName : null,
        wpId: !entry.createNewWp && entry.wpId ? entry.wpId : null,
        responseActionType: entry.responseActionType ?? null,
        targetDepartmentIds,
        note: entry.note ?? null,
        procedureRef: entry.procedureRef ?? null
      });
    }

    const actorName = await getUserName(userId);

    const createdTasks = await prisma.$transaction(async (tx) => {
      // Lock the division row so taskId / wpId sequences are race-free.
      await tx.$queryRaw`SELECT id FROM "Division" WHERE id = ${division.id} FOR UPDATE`;

      const results: { id: number; taskId: string }[] = [];

      for (const entry of prepared) {
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
              name: entry.newWpName!,
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
            schemaSnapshot: entry.formSchema,
            estimatedHours: entry.estimatedHours,
            skillLevel: entry.skillLevel,
            requiresApproval: entry.requiresApproval,
            assignmentType: 'INDIVIDUAL',
            responseActionType: entry.responseActionType,
            // Derived server-side — never trusted from the client.
            requiresDirectorApproval: entry.responseActionType != null &&
              (DIRECTOR_APPROVAL_TYPES as readonly string[]).includes(entry.responseActionType)
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

        // Record the response action and link it to the generated task.
        if (entry.responseActionType != null && entry.targetDepartmentIds != null) {
          await tx.findingResponseAction.create({
            data: {
              findingId: finding.id,
              type: entry.responseActionType,
              taskId: created.id,
              targetDepartments: {
                create: entry.targetDepartmentIds.map((departmentId) => ({ departmentId }))
              },
              note: entry.note,
              procedureRef: entry.procedureRef,
              createdByUserId: userId
            }
          });

          await logFindingAuditAndActivity(
            tx,
            finding.id,
            finding.sourceTaskId,
            FINDING_EXPANSION_ACTIONS.RESPONSE_ACTION_CREATED,
            userId,
            `Response action ${entry.responseActionType} created → Task ${created.taskId} by ${actorName}`,
            {
              findingId: finding.id,
              responseActionType: entry.responseActionType,
              taskId: created.taskId,
              taskDbId: created.id,
              targetDepartmentIds: entry.targetDepartmentIds
            }
          );
        }

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
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Error generating follow-up tasks:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/close ──────────────────────────────────────────────

export const closeFinding = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { closureNote } = req.body ?? {};

    if (!requireReviewerRole(res, req.user!, 'close findings')) return;

    // Closure sign-off: an auditable close-out rationale is mandatory and bounded
    // (2000 chars, per the 2026-06-09 free-text hardening convention).
    if (!closureNote || typeof closureNote !== 'string' || !closureNote.trim()) {
      res.status(400).json({ message: 'A closure note is required to close a finding' });
      return;
    }
    if (closureNote.length > 2000) {
      res.status(400).json({ message: 'Closure note must be 2000 characters or fewer' });
      return;
    }
    const trimmedClosureNote = closureNote.trim();

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, status: true, sourceTaskId: true }
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (!(await assertManagerDivisionScope(prisma, req.user!, id))) {
      res.status(403).json({ message: 'Managers may only close findings in their division' });
      return;
    }

    if (finding.status !== 'Pending Verification') {
      res.status(400).json({ message: 'Finding must be in Pending Verification to be closed' });
      return;
    }

    // Close-gate: RCA must be Complete (if present); all CORRECTIVE CAPAs must be Verified.
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
        { findingId: finding.id, fromStatus: finding.status, toStatus: 'Closed', closureNote: trimmedClosureNote },
        trimmedClosureNote
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

    if (!requireReviewerRole(res, req.user!, 'manually advance findings')) return;

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
    if (!(await assertManagerDivisionScope(prisma, req.user!, id))) {
      res.status(403).json({ message: 'Managers may only advance findings in their division' });
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

    const actorName = await getUserName(userId);

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

export const getStuckFindings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role } = req.user!;

    if (!hasPrivilege(req.user!, 'finding:admin')) {
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
        f.followUpTasks.every((t) => FINAL_TASK_STATUSES.includes(t.status))
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

    if (!hasPrivilege(req.user!, 'finding:admin')) {
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
    const nonFinal = finding.followUpTasks.filter((t) => !FINAL_TASK_STATUSES.includes(t.status));
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

    if (!requireReviewerRole(res, req.user!, 'update severity')) return;

    // Director is global; Manager is division-scoped for classification changes.
    if (!(await assertManagerDivisionScope(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have access to this finding' });
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

    if (!requireReviewerRole(res, req.user!, 'dismiss findings')) return;

    // Director is global; Manager is division-scoped for irreversible mutations.
    if (!(await assertManagerDivisionScope(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have access to this finding' });
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

    const actorName = await getUserName(userId);

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

    if (!requireReviewerRole(res, req.user!, 'update taxonomy')) return;

    // Director is global; Manager is division-scoped for classification changes.
    if (!(await assertManagerDivisionScope(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have access to this finding' });
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

    const tagIds = await validateTaxonomyFields(prisma, ataChapterId, hazardTagIds);

    const fromAtaChapterId = finding.ataChapterId;

    const updated = await prisma.$transaction(async (tx) => {
      if (tagIds !== null) {
        await replaceHazardTags(tx, id, tagIds);
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
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Error updating taxonomy:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/details ────────────────────────────────────────────

/**
 * Enrich a finding's optional context AFTER it was raised — ATA chapter, hazard
 * tags, aircraft registration, regulatory reference, field reference. These feed
 * monitoring + the trend engine (Department + ATA + Cause Code + Hazard Tags).
 *
 * Editable by anyone working the finding — the reporter, a follow-up assignee, or
 * a reviewer (same-division Manager / Director) — while it is not Closed/Dismissed.
 * Severity and status are NOT touched here; those stay reviewer-only via review /
 * updateSeverity. Partial update: a field changes only when its key is present.
 */
export const updateFindingDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId } = req.user!;
    const { ataChapterId, hazardTagIds, aircraftRegistrationCode, regulatoryReference, fieldId } = req.body ?? {};

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        sourceTaskId: true,
        reportedByUserId: true,
        followUpTasks: { where: { deletedAt: null }, select: { assignedToUserId: true } },
      },
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (finding.status === 'Closed' || finding.status === 'Dismissed') {
      res.status(400).json({ message: 'Cannot update details on a Closed or Dismissed finding' });
      return;
    }

    // Auth: reporter OR follow-up assignee OR reviewer (same-division Mgr / Director).
    const isReporter = finding.reportedByUserId === userId;
    const isAssignee = finding.followUpTasks.some((t) => t.assignedToUserId === userId);
    const isReviewer = isFindingReviewer(req.user!) && (await assertManagerDivisionScope(prisma, req.user!, id));
    if (!isReporter && !isAssignee && !isReviewer) {
      res.status(403).json({ message: 'You do not have access to update this finding' });
      return;
    }

    // Validate taxonomy (ATA + hazard tags) and the optional aircraft registration.
    const tagIds = await validateTaxonomyFields(prisma, ataChapterId, hazardTagIds);
    if (aircraftRegistrationCode) {
      const reg = await prisma.aircraftRegistration.findUnique({
        where: { registration: aircraftRegistrationCode },
        select: { registration: true },
      });
      if (!reg) {
        res.status(400).json({ message: `Unknown aircraft registration: ${aircraftRegistrationCode}` });
        return;
      }
    }

    // Scalar FKs set directly (matching createFindingService) via the unchecked
    // update input. Only keys present in the body are touched.
    const data: Prisma.FindingUncheckedUpdateInput = {};
    if (ataChapterId !== undefined) data.ataChapterId = ataChapterId ?? null;
    if (aircraftRegistrationCode !== undefined) data.aircraftRegistrationCode = aircraftRegistrationCode || null;
    if (regulatoryReference !== undefined) data.regulatoryReference = regulatoryReference || null;
    if (fieldId !== undefined) data.fieldId = fieldId || null;

    const updated = await prisma.$transaction(async (tx) => {
      if (tagIds !== null) {
        await replaceHazardTags(tx, id, tagIds);
      }
      const result = await tx.finding.update({ where: { id }, data });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.DETAILS_UPDATED,
        userId,
        `Details updated on Finding #${id}`,
        {
          findingId: finding.id,
          ...(ataChapterId !== undefined ? { ataChapterId } : {}),
          ...(tagIds !== null ? { hazardTagIds: tagIds } : {}),
          ...(aircraftRegistrationCode !== undefined ? { aircraftRegistrationCode } : {}),
          ...(regulatoryReference !== undefined ? { regulatoryReference } : {}),
          ...(fieldId !== undefined ? { fieldId } : {}),
        }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Error updating finding details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/due-date ───────────────────────────────────────────
// Director-only: change a finding's review/SLA due date after it has been set,
// with a mandatory reason. Dual-writes a DUE_DATE_UPDATED event. The "overdue"
// status is derived on read (computeDueDateBreached) from the new date, so a
// future date clears the badge automatically — no stored flag to reset. The
// append-only DUE_DATE_BREACHED audit row is intentionally left untouched.
export const updateFindingDueDate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { dueDate, reason } = req.body ?? {};

    // Director-only by design — narrower than the finding-reviewer set.
    if (role !== 'Director') {
      res.status(403).json({ message: 'Only a Director may change a finding due date' });
      return;
    }

    if (!dueDate) {
      res.status(400).json({ message: 'dueDate is required' });
      return;
    }
    const parsedDueDate = new Date(dueDate);
    if (isNaN(parsedDueDate.getTime())) {
      res.status(400).json({ message: 'Invalid dueDate' });
      return;
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
      res.status(400).json({ message: 'A reason is required to change the due date' });
      return;
    }
    if (trimmedReason.length > 2000) {
      res.status(400).json({ message: 'Reason must be 2000 characters or fewer' });
      return;
    }

    const finding = await prisma.finding.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, status: true, sourceTaskId: true, dueDate: true },
    });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (finding.status === 'Closed' || finding.status === 'Dismissed') {
      res.status(400).json({ message: 'Cannot change the due date of a Closed or Dismissed finding' });
      return;
    }

    const directorName = await getUserName(userId);
    const prevDueStr = finding.dueDate ? finding.dueDate.toISOString().slice(0, 10) : 'none';
    const newDueStr = parsedDueDate.toISOString().slice(0, 10);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.finding.update({
        where: { id },
        data: { dueDate: parsedDueDate },
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.DUE_DATE_UPDATED,
        userId,
        `Due date changed from ${prevDueStr} to ${newDueStr} by ${directorName} — ${trimmedReason}`,
        {
          findingId: finding.id,
          previousDueDate: finding.dueDate?.toISOString() ?? null,
          dueDate: parsedDueDate.toISOString(),
          reason: trimmedReason,
        }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    console.error('Error updating finding due date:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
