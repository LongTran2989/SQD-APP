import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { logFindingAuditAndActivity } from '../services/findingService';
import { canAccessFinding, FINDING_REVIEWER_ROLES } from '../utils/findingAccess';
import { LINK_TYPES, FINDING_EXPANSION_ACTIONS } from '../constants/findingExpansion';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── GET /api/findings/:id/links ──────────────────────────────────────────────

export const getFindingLinks = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const exists = await prisma.finding.findUnique({ where: { id, deletedAt: null }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    // Visibility is open to all authenticated users — no scope check needed.

    const relatedSelect = {
      id: true,
      description: true,
      status: true,
      severity: true,
      eventType: true,
    };
    const [outgoing, incoming] = await Promise.all([
      prisma.findingLink.findMany({
        where: { fromFindingId: id },
        include: { relatedFinding: { select: relatedSelect }, createdByUser: { select: { id: true, name: true } } },
        orderBy: { id: 'desc' },
      }),
      prisma.findingLink.findMany({
        where: { relatedFindingId: id },
        include: { fromFinding: { select: relatedSelect }, createdByUser: { select: { id: true, name: true } } },
        orderBy: { id: 'desc' },
      }),
    ]);

    res.json({ outgoing, incoming });
  } catch (error) {
    console.error('Error fetching finding links:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/findings/:id/links ─────────────────────────────────────────────

export const createFindingLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId, role } = req.user!;
    const { relatedFindingId, linkType, note } = req.body;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can link findings' });
      return;
    }
    if (!linkType || !LINK_TYPES.includes(linkType)) {
      res.status(400).json({ message: `linkType is required and must be one of: ${LINK_TYPES.join(', ')}` });
      return;
    }
    if (!relatedFindingId || relatedFindingId === id) {
      res.status(400).json({ message: 'relatedFindingId is required and must differ from the source finding' });
      return;
    }

    const finding = await prisma.finding.findUnique({ where: { id, deletedAt: null }, select: { id: true } });
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    // Director is global; Manager is division-scoped for link mutations.
    if (role === 'Manager') {
      const inScope = await prisma.finding.findFirst({
        where: {
          id,
          deletedAt: null,
          OR: [
            { targetDivisionId: req.user!.divisionId },
            { followUpTasks: { some: { deletedAt: null, targetDivisionId: req.user!.divisionId } } },
            { followUpTasks: { some: { deletedAt: null, assignedToUser: { is: { divisionId: req.user!.divisionId } } } } },
          ],
        },
        select: { id: true },
      });
      if (!inScope) {
        res.status(403).json({ message: 'You do not have access to this finding' });
        return;
      }
    }

    const related = await prisma.finding.findUnique({ where: { id: relatedFindingId, deletedAt: null }, select: { id: true } });
    if (!related) {
      res.status(404).json({ message: 'Related finding not found' });
      return;
    }

    const existing = await prisma.findingLink.findFirst({
      where: { fromFindingId: id, relatedFindingId, linkType },
    });
    if (existing) {
      res.status(400).json({ message: 'This link already exists' });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const result = await tx.findingLink.create({
        data: { fromFindingId: id, relatedFindingId, linkType, note: note ?? null, createdByUserId: userId },
      });
      await logFindingAuditAndActivity(
        tx,
        id,
        null,
        FINDING_EXPANSION_ACTIONS.FINDING_LINKED,
        userId,
        `Finding #${id} linked to Finding #${relatedFindingId} (${linkType})`,
        { findingId: id, relatedFindingId, linkType }
      );
      return result;
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating finding link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/findings/:id/links/:linkId ───────────────────────────────────

export const deleteFindingLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const linkId = parseInt(req.params.linkId as string, 10);
    const { userId, role } = req.user!;

    if (!FINDING_REVIEWER_ROLES.includes(role)) {
      res.status(403).json({ message: 'Only a Manager or Director can remove a finding link' });
      return;
    }
    if (role === 'Manager') {
      const inScope = await prisma.finding.findFirst({
        where: {
          id,
          deletedAt: null,
          OR: [
            { targetDivisionId: req.user!.divisionId },
            { followUpTasks: { some: { deletedAt: null, targetDivisionId: req.user!.divisionId } } },
            { followUpTasks: { some: { deletedAt: null, assignedToUser: { is: { divisionId: req.user!.divisionId } } } } },
          ],
        },
        select: { id: true },
      });
      if (!inScope) {
        res.status(403).json({ message: 'You do not have access to this finding' });
        return;
      }
    }
    const link = await prisma.findingLink.findFirst({ where: { id: linkId, fromFindingId: id } });
    if (!link) {
      res.status(404).json({ message: 'Finding link not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.findingLink.delete({ where: { id: linkId } });
      await logFindingAuditAndActivity(
        tx,
        id,
        null,
        FINDING_EXPANSION_ACTIONS.FINDING_UNLINKED,
        userId,
        `Finding link #${linkId} removed from Finding #${id}`,
        { findingId: id, linkId, relatedFindingId: link.relatedFindingId }
      );
    });

    res.json({ message: 'Finding link removed' });
  } catch (error) {
    console.error('Error deleting finding link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
