import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logFindingAuditAndActivity } from '../services/findingService';
import { canEditAnalysis, extractCapaLinkedUserIds, isFindingReviewer } from '../utils/findingAccess';
import { CAPA_TYPES, CAPA_STATUSES, FINDING_EXPANSION_ACTIONS } from '../constants/findingExpansion';

import { prisma } from '../lib/prisma';

// A linked effectiveness Task must be in one of these states for its CAPA to be
// verifiable — i.e. the verification work is genuinely done.
const EFFECTIVENESS_DONE_STATUSES = ['Closed'];

// Roles a linked Task/WP can play relative to a CAPA item.
const CAPA_LINK_ROLES = ['EXECUTION', 'EFFECTIVENESS', 'SUPPORTING'] as const;

async function loadFindingForCapa(id: number) {
  return prisma.finding.findUnique({
    where: { id, deletedAt: null },
    select: {
      id: true,
      sourceTaskId: true,
      reportedByUserId: true,
      targetDivisionId: true,
      followUpTasks: { where: { deletedAt: null }, select: { assignedToUserId: true } },
      capaActions: {
        where: { deletedAt: null },
        select: {
          linkedItems: {
            select: { task: { select: { assignedToUserId: true } } },
          },
        },
      },
    },
  });
}

type FindingForCapa = NonNullable<Awaited<ReturnType<typeof loadFindingForCapa>>>;

/**
 * Loads the finding and asserts the actor may edit its CAPA analysis. On failure
 * writes the 404/403 response and returns null (caller should early-return); on
 * success returns the loaded finding. `action` is folded into the 403 message
 * (e.g. 'add CAPA actions to this finding').
 */
async function loadFindingAndAssertCapaEdit(
  req: Request,
  res: Response,
  findingId: number,
  action: string
): Promise<FindingForCapa | null> {
  const finding = await loadFindingForCapa(findingId);
  if (!finding) {
    res.status(404).json({ message: 'Finding not found' });
    return null;
  }
  const capaLinkedUserIds = extractCapaLinkedUserIds(finding.capaActions);
  if (!canEditAnalysis(req.user!, finding, true, capaLinkedUserIds)) {
    res.status(403).json({ message: `You do not have permission to ${action}` });
    return null;
  }
  return finding;
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
    // Visibility is open to all authenticated users — no scope check needed.
    const actions = await prisma.capaAction.findMany({
      where: { findingId: id, deletedAt: null },
      orderBy: [{ type: 'asc' }, { id: 'asc' }],
      include: {
        ownerUser: { select: { id: true, name: true } },
        verifiedByUser: { select: { id: true, name: true } },
        linkedItems: {
          include: {
            task: { select: { id: true, taskId: true, title: true, status: true, template: { select: { title: true } } } },
            wp: { select: { id: true, wpId: true, name: true, status: true } },
          },
        },
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
    const { type, description, ownerUserId, deadline } = req.body;

    const finding = await loadFindingAndAssertCapaEdit(req, res, id, 'add CAPA actions to this finding');
    if (!finding) return;
    if (!type || !CAPA_TYPES.includes(type)) {
      res.status(400).json({ message: `type is required and must be one of: ${CAPA_TYPES.join(', ')}` });
      return;
    }
    if (!description || typeof description !== 'string') {
      res.status(400).json({ message: 'description is required' });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const result = await tx.capaAction.create({
        data: {
          findingId: id,
          type,
          description,
          ownerUserId: ownerUserId ?? null,
          deadline: deadline ? new Date(deadline) : null,
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
    const { description, ownerUserId, deadline, status } = req.body;

    const finding = await loadFindingAndAssertCapaEdit(req, res, id, 'edit CAPA actions on this finding');
    if (!finding) return;
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

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.capaAction.update({
        where: { id: capaId },
        data: {
          ...(description !== undefined ? { description } : {}),
          ...(ownerUserId !== undefined ? { ownerUserId } : {}),
          ...(deadline !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}),
          ...(status !== undefined ? { status } : {}),
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

    if (!isFindingReviewer(req.user!)) {
      res.status(403).json({ message: 'Only a Manager or Director can verify CAPA effectiveness' });
      return;
    }
    const finding = await loadFindingAndAssertCapaEdit(req, res, id, 'verify this CAPA action');
    if (!finding) return;
    const capa = await prisma.capaAction.findFirst({
      where: { id: capaId, findingId: id, deletedAt: null },
      include: {
        linkedItems: {
          include: {
            task: { select: { id: true, status: true } },
            wp: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!capa) {
      res.status(404).json({ message: 'CAPA action not found' });
      return;
    }
    // Effectiveness must be evidenced by completed verification tasks/WPs.
    const effectivenessLinks = capa.linkedItems.filter((l) => l.role === 'EFFECTIVENESS');
    if (effectivenessLinks.length === 0) {
      res.status(400).json({ message: 'Link at least one effectiveness task or WP before verifying' });
      return;
    }
    const allDone = effectivenessLinks.every((l) => {
      if (l.task) return EFFECTIVENESS_DONE_STATUSES.includes(l.task.status);
      if (l.wp) return l.wp.status === 'Closed';
      return false;
    });
    if (!allDone) {
      res.status(400).json({ message: 'All linked effectiveness tasks/WPs must be Closed before verifying' });
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

    if (!isFindingReviewer(req.user!)) {
      res.status(403).json({ message: 'Only a Manager or Director can waive a CAPA action' });
      return;
    }
    const finding = await loadFindingAndAssertCapaEdit(req, res, id, 'waive this CAPA action');
    if (!finding) return;
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

    if (!isFindingReviewer(req.user!)) {
      res.status(403).json({ message: 'Only a Manager or Director can delete a CAPA action' });
      return;
    }
    const finding = await loadFindingAndAssertCapaEdit(req, res, id, 'delete this CAPA action');
    if (!finding) return;
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

// ─── POST /api/findings/:id/capa/:capaId/links ────────────────────────────────

export const addCapaLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const capaId = parseInt(req.params.capaId as string, 10);
    const { userId } = req.user!;
    const { role, taskId, wpId } = req.body;

    const finding = await loadFindingAndAssertCapaEdit(req, res, id, 'link items on this finding');
    if (!finding) return;
    const capa = await prisma.capaAction.findFirst({ where: { id: capaId, findingId: id, deletedAt: null } });
    if (!capa) {
      res.status(404).json({ message: 'CAPA action not found' });
      return;
    }
    if (!role || !CAPA_LINK_ROLES.includes(role)) {
      res.status(400).json({ message: `role is required and must be one of: ${CAPA_LINK_ROLES.join(', ')}` });
      return;
    }
    // Exactly one of taskId / wpId must be supplied.
    const hasTask = taskId != null;
    const hasWp = wpId != null;
    if (hasTask === hasWp) {
      res.status(400).json({ message: 'Provide exactly one of taskId or wpId' });
      return;
    }
    if (hasTask) {
      const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { id: true } });
      if (!task) {
        res.status(400).json({ message: `Task ${taskId} not found` });
        return;
      }
    } else {
      const wp = await prisma.workPackage.findFirst({ where: { id: wpId, deletedAt: null }, select: { id: true } });
      if (!wp) {
        res.status(400).json({ message: `Work Package ${wpId} not found` });
        return;
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const result = await tx.capaTaskLink.create({
        data: {
          capaId,
          role,
          taskId: hasTask ? taskId : null,
          wpId: hasWp ? wpId : null,
        },
      });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.CAPA_LINK_ADDED,
        userId,
        `${role} ${hasTask ? `Task ${taskId}` : `WP ${wpId}`} linked to CAPA action #${capaId} on Finding #${finding.id}`,
        { findingId: finding.id, capaId, linkId: result.id, role, taskId: result.taskId, wpId: result.wpId }
      );
      return result;
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Error adding CAPA link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/findings/:id/capa/:capaId/links/:linkId ──────────────────────

export const removeCapaLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const capaId = parseInt(req.params.capaId as string, 10);
    const linkId = parseInt(req.params.linkId as string, 10);
    const { userId, role } = req.user!;

    if (!isFindingReviewer(req.user!)) {
      res.status(403).json({ message: 'Only a Manager or Director can remove a CAPA link' });
      return;
    }
    const finding = await loadFindingAndAssertCapaEdit(req, res, id, 'remove this CAPA link');
    if (!finding) return;
    const link = await prisma.capaTaskLink.findFirst({ where: { id: linkId, capaId, capa: { findingId: id, deletedAt: null } } });
    if (!link) {
      res.status(404).json({ message: 'CAPA link not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Junction rows are not compliance records — hard delete.
      await tx.capaTaskLink.delete({ where: { id: linkId } });
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.CAPA_LINK_REMOVED,
        userId,
        `Link #${linkId} removed from CAPA action #${capaId} on Finding #${finding.id}`,
        { findingId: finding.id, capaId, linkId }
      );
    });

    res.json({ message: 'CAPA link removed' });
  } catch (error) {
    console.error('Error removing CAPA link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
