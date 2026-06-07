import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { logFindingAuditAndActivity } from '../services/findingService';
import { canAccessFinding, canEditAnalysis, FINDING_REVIEWER_ROLES } from '../utils/findingAccess';
import { CAPA_TYPES, CAPA_STATUSES, FINDING_EXPANSION_ACTIONS } from '../constants/findingExpansion';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// A linked effectiveness Task must be in one of these states for its CAPA to be
// verifiable — i.e. the verification work is genuinely done.
const EFFECTIVENESS_DONE_STATUSES = ['Closed'];

async function loadFindingForCapa(id: number) {
  return prisma.finding.findUnique({
    where: { id, deletedAt: null },
    select: {
      id: true,
      sourceTaskId: true,
      reportedByUserId: true,
      targetDivisionId: true,
      followUpTasks: { where: { deletedAt: null }, select: { assignedToUserId: true } },
    },
  });
}

// Validates that a referenced task is a non-deleted follow-up of this finding.
async function validateLinkedTask(taskId: number, findingId: number): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId, deletedAt: null },
    select: { id: true, parentFindingId: true },
  });
  if (!task) return `Task ${taskId} not found`;
  if (task.parentFindingId !== findingId) return `Task ${taskId} is not a follow-up of this finding`;
  return null;
}

// ─── GET /api/findings/:id/capa ───────────────────────────────────────────────

export const listCapa = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const finding = await loadFindingForCapa(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (!(await canAccessFinding(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have access to this finding' });
      return;
    }
    const actions = await prisma.capaAction.findMany({
      where: { findingId: id, deletedAt: null },
      orderBy: [{ type: 'asc' }, { id: 'asc' }],
      include: {
        ownerUser: { select: { id: true, name: true } },
        verifiedByUser: { select: { id: true, name: true } },
        executionTask: { select: { id: true, taskId: true, status: true } },
        effectivenessTask: { select: { id: true, taskId: true, status: true } },
      },
    });
    res.json(actions);
  } catch (error) {
    console.error('Error listing CAPA actions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/findings/:id/capa ──────────────────────────────────────────────

export const createCapa = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId } = req.user!;
    const { type, description, ownerUserId, deadline, executionTaskId, effectivenessTaskId } = req.body;

    const finding = await loadFindingForCapa(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (!canEditAnalysis(req.user!, finding, await canAccessFinding(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have permission to add CAPA actions to this finding' });
      return;
    }
    if (!type || !CAPA_TYPES.includes(type)) {
      res.status(400).json({ message: `type is required and must be one of: ${CAPA_TYPES.join(', ')}` });
      return;
    }
    if (!description || typeof description !== 'string') {
      res.status(400).json({ message: 'description is required' });
      return;
    }
    for (const [field, taskId] of [['executionTaskId', executionTaskId], ['effectivenessTaskId', effectivenessTaskId]] as const) {
      if (taskId != null) {
        const err = await validateLinkedTask(taskId, id);
        if (err) {
          res.status(400).json({ message: `${field}: ${err}` });
          return;
        }
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const result = await tx.capaAction.create({
        data: {
          findingId: id,
          type,
          description,
          ownerUserId: ownerUserId ?? null,
          deadline: deadline ? new Date(deadline) : null,
          executionTaskId: executionTaskId ?? null,
          effectivenessTaskId: effectivenessTaskId ?? null,
          createdByUserId: userId,
        },
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.CAPA_CREATED,
        userId,
        `${type} CAPA action created for Finding #${finding.id}`,
        { findingId: finding.id, capaId: result.id, type }
      );
      return result;
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating CAPA action:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/capa/:capaId ───────────────────────────────────────

export const updateCapa = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const capaId = parseInt(req.params.capaId as string, 10);
    const { userId } = req.user!;
    const { description, ownerUserId, deadline, status, executionTaskId, effectivenessTaskId } = req.body;

    const finding = await loadFindingForCapa(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (!canEditAnalysis(req.user!, finding, await canAccessFinding(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have permission to edit CAPA actions on this finding' });
      return;
    }
    const capa = await prisma.capaAction.findFirst({ where: { id: capaId, findingId: id, deletedAt: null } });
    if (!capa) {
      res.status(404).json({ message: 'CAPA action not found' });
      return;
    }
    // Verify / waive are dedicated endpoints — block those transitions here.
    if (status !== undefined && !CAPA_STATUSES.includes(status)) {
      res.status(400).json({ message: `status must be one of: ${CAPA_STATUSES.join(', ')}` });
      return;
    }
    if (status === 'Verified' || status === 'Waived') {
      res.status(400).json({ message: `Use the dedicated ${status === 'Verified' ? 'verify' : 'waive'} endpoint for this transition` });
      return;
    }
    for (const [field, taskId] of [['executionTaskId', executionTaskId], ['effectivenessTaskId', effectivenessTaskId]] as const) {
      if (taskId != null) {
        const err = await validateLinkedTask(taskId, id);
        if (err) {
          res.status(400).json({ message: `${field}: ${err}` });
          return;
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.capaAction.update({
        where: { id: capaId },
        data: {
          ...(description !== undefined ? { description } : {}),
          ...(ownerUserId !== undefined ? { ownerUserId } : {}),
          ...(deadline !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(executionTaskId !== undefined ? { executionTaskId } : {}),
          ...(effectivenessTaskId !== undefined ? { effectivenessTaskId } : {}),
        },
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.CAPA_UPDATED,
        userId,
        `CAPA action #${capaId} updated for Finding #${finding.id}`,
        { findingId: finding.id, capaId }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating CAPA action:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/capa/:capaId/verify ────────────────────────────────

export const verifyCapa = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const capaId = parseInt(req.params.capaId as string, 10);
    const { userId, role } = req.user!;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can verify CAPA effectiveness' });
      return;
    }
    const finding = await loadFindingForCapa(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (!(await canAccessFinding(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have access to this finding' });
      return;
    }
    const capa = await prisma.capaAction.findFirst({
      where: { id: capaId, findingId: id, deletedAt: null },
      include: { effectivenessTask: { select: { id: true, status: true } } },
    });
    if (!capa) {
      res.status(404).json({ message: 'CAPA action not found' });
      return;
    }
    // Effectiveness must be evidenced by a completed verification task.
    if (!capa.effectivenessTaskId) {
      res.status(400).json({ message: 'Link an effectiveness verification task before verifying this CAPA action' });
      return;
    }
    if (!EFFECTIVENESS_DONE_STATUSES.includes(capa.effectivenessTask!.status)) {
      res.status(400).json({ message: `Effectiveness task must be ${EFFECTIVENESS_DONE_STATUSES.join(' or ')} before verifying (current: ${capa.effectivenessTask!.status})` });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.capaAction.update({
        where: { id: capaId },
        data: { status: 'Verified', verifiedByUserId: userId, verifiedAt: new Date() },
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.CAPA_VERIFIED,
        userId,
        `CAPA action #${capaId} verified effective for Finding #${finding.id}`,
        { findingId: finding.id, capaId }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error verifying CAPA action:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/capa/:capaId/waive ─────────────────────────────────

export const waiveCapa = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const capaId = parseInt(req.params.capaId as string, 10);
    const { userId, role } = req.user!;
    const { waivedReason } = req.body;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can waive a CAPA action' });
      return;
    }
    const finding = await loadFindingForCapa(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (!(await canAccessFinding(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have access to this finding' });
      return;
    }
    const capa = await prisma.capaAction.findFirst({ where: { id: capaId, findingId: id, deletedAt: null } });
    if (!capa) {
      res.status(404).json({ message: 'CAPA action not found' });
      return;
    }
    if (capa.type !== 'PREVENTIVE') {
      res.status(400).json({ message: 'Only PREVENTIVE actions can be waived; corrective actions must be verified' });
      return;
    }
    if (!waivedReason || typeof waivedReason !== 'string') {
      res.status(400).json({ message: 'waivedReason is required to waive a preventive action' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.capaAction.update({
        where: { id: capaId },
        data: { status: 'Waived', waivedReason },
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.CAPA_WAIVED,
        userId,
        `Preventive CAPA action #${capaId} waived for Finding #${finding.id}`,
        { findingId: finding.id, capaId, waivedReason }
      );
      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error waiving CAPA action:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/findings/:id/capa/:capaId ────────────────────────────────────

export const deleteCapa = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const capaId = parseInt(req.params.capaId as string, 10);
    const { userId, role } = req.user!;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can delete a CAPA action' });
      return;
    }
    const finding = await loadFindingForCapa(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    if (!(await canAccessFinding(prisma, req.user!, id))) {
      res.status(403).json({ message: 'You do not have access to this finding' });
      return;
    }
    const capa = await prisma.capaAction.findFirst({ where: { id: capaId, findingId: id, deletedAt: null } });
    if (!capa) {
      res.status(404).json({ message: 'CAPA action not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.capaAction.update({ where: { id: capaId }, data: { deletedAt: new Date() } });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.CAPA_DELETED,
        userId,
        `CAPA action #${capaId} deleted from Finding #${finding.id}`,
        { findingId: finding.id, capaId }
      );
    });

    res.json({ message: 'CAPA action deleted' });
  } catch (error) {
    console.error('Error deleting CAPA action:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
