import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logFindingAuditAndActivity } from '../services/findingService';
import { canEditAnalysis, extractCapaLinkedUserIds } from '../utils/findingAccess';
import { RCA_METHODS, RCA_STATUSES, RCA_MEDA_CATEGORIES, FINDING_EXPANSION_ACTIONS } from '../constants/findingExpansion';

import { prisma } from '../lib/prisma';

// Loads a finding with the fields needed for RBAC + the existing RCA (if any).
async function loadFindingForRca(id: number) {
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
      rca: {
        include: {
          causeCode: true,
          whySteps: { orderBy: { orderIndex: 'asc' } },
          factors: { orderBy: { id: 'asc' } },
        },
      },
    },
  });
}

// ─── GET /api/findings/:id/rca ────────────────────────────────────────────────

export const getRca = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const finding = await loadFindingForRca(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    // Visibility is open to all authenticated users — no scope check needed.
    res.json(finding.rca ?? null);
  } catch (error) {
    console.error('Error fetching RCA:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/rca ────────────────────────────────────────────────
// Upsert the investigation header (method / summary / status / causeCode).

export const upsertRca = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId } = req.user!;
    const { method, summary, status, causeCodeId } = req.body;

    const finding = await loadFindingForRca(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    const capaLinkedUserIds = extractCapaLinkedUserIds(finding.capaActions);
    if (!canEditAnalysis(req.user!, finding, true, capaLinkedUserIds)) {
      res.status(403).json({ message: 'You do not have permission to edit this RCA' });
      return;
    }

    if (!method || !RCA_METHODS.includes(method)) {
      res.status(400).json({ message: `method is required and must be one of: ${RCA_METHODS.join(', ')}` });
      return;
    }
    if (status !== undefined && !RCA_STATUSES.includes(status)) {
      res.status(400).json({ message: `status must be one of: ${RCA_STATUSES.join(', ')}` });
      return;
    }

    // Validate cause code if provided.
    if (causeCodeId !== undefined && causeCodeId !== null) {
      const cc = await prisma.causeCode.findUnique({ where: { id: causeCodeId }, select: { id: true } });
      if (!cc) {
        res.status(400).json({ message: 'Cause code not found' });
        return;
      }
    }

    // A Complete RCA must have a determined cause — the cause code is the conclusion.
    const effectiveCauseCodeId =
      causeCodeId !== undefined ? causeCodeId : finding.rca?.causeCodeId ?? null;
    if (status === 'Complete' && !effectiveCauseCodeId) {
      res.status(400).json({ message: 'A cause code is required before an RCA can be marked Complete' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.rcaInvestigation.upsert({
        where: { findingId: id },
        create: {
          findingId: id,
          method,
          summary: summary ?? null,
          status: status ?? 'Draft',
          causeCodeId: causeCodeId ?? null,
          conductedByUserId: userId,
        },
        update: {
          method,
          ...(summary !== undefined ? { summary } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(causeCodeId !== undefined ? { causeCodeId } : {}),
          conductedByUserId: userId,
        },
        include: { causeCode: true, whySteps: { orderBy: { orderIndex: 'asc' } }, factors: true },
      });

      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.RCA_UPDATED,
        userId,
        `RCA (${method}) updated for Finding #${finding.id}`,
        { findingId: finding.id, method, status: result.status, causeCodeId: result.causeCodeId }
      );

      return result;
    });

    res.json(updated);
  } catch (error) {
    console.error('Error upserting RCA:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/rca/why-steps ──────────────────────────────────────
// Replace the ordered 5-Whys ladder. Only valid when method = FIVE_WHYS.

export const saveWhySteps = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId } = req.user!;
    const { steps } = req.body;

    const finding = await loadFindingForRca(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    const capaLinkedUserIds = extractCapaLinkedUserIds(finding.capaActions);
    if (!canEditAnalysis(req.user!, finding, true, capaLinkedUserIds)) {
      res.status(403).json({ message: 'You do not have permission to edit this RCA' });
      return;
    }
    if (!finding.rca) {
      res.status(400).json({ message: 'Create the RCA (set its method) before adding why-steps' });
      return;
    }
    if (finding.rca.method !== 'FIVE_WHYS') {
      res.status(400).json({ message: 'Why-steps are only valid for a 5-Whys RCA' });
      return;
    }
    if (!Array.isArray(steps)) {
      res.status(400).json({ message: 'steps must be an array' });
      return;
    }
    for (const s of steps) {
      if (!s?.question || typeof s.question !== 'string') {
        res.status(400).json({ message: 'Each step requires a question' });
        return;
      }
    }

    const rcaId = finding.rca.id;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.rcaWhyStep.deleteMany({ where: { rcaId } });
      if (steps.length > 0) {
        await tx.rcaWhyStep.createMany({
          data: steps.map((s: { question: string; answer?: string | null }, i: number) => ({
            rcaId,
            orderIndex: i,
            question: s.question,
            answer: s.answer ?? null,
          })),
        });
      }
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.RCA_UPDATED,
        userId,
        `5-Whys ladder updated (${steps.length} steps) for Finding #${finding.id}`,
        { findingId: finding.id, stepCount: steps.length }
      );
      return tx.rcaWhyStep.findMany({ where: { rcaId }, orderBy: { orderIndex: 'asc' } });
    });

    res.json(updated);
  } catch (error) {
    console.error('Error saving why-steps:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/findings/:id/rca/factors ────────────────────────────────────────
// Replace the MEDA contributing-factor set. Only valid when method = MEDA.

export const saveFactors = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { userId } = req.user!;
    const { factors } = req.body;

    const finding = await loadFindingForRca(id);
    if (!finding) {
      res.status(404).json({ message: 'Finding not found' });
      return;
    }
    const capaLinkedUserIds = extractCapaLinkedUserIds(finding.capaActions);
    if (!canEditAnalysis(req.user!, finding, true, capaLinkedUserIds)) {
      res.status(403).json({ message: 'You do not have permission to edit this RCA' });
      return;
    }
    if (!finding.rca) {
      res.status(400).json({ message: 'Create the RCA (set its method) before adding factors' });
      return;
    }
    if (finding.rca.method !== 'MEDA') {
      res.status(400).json({ message: 'Contributing factors are only valid for a MEDA RCA' });
      return;
    }
    if (!Array.isArray(factors)) {
      res.status(400).json({ message: 'factors must be an array' });
      return;
    }
    for (const f of factors) {
      if (!f?.category || !RCA_MEDA_CATEGORIES.includes(f.category)) {
        res.status(400).json({ message: `Each factor requires a valid category (one of: ${RCA_MEDA_CATEGORIES.join(', ')})` });
        return;
      }
    }

    const rcaId = finding.rca.id;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.rcaContributingFactor.deleteMany({ where: { rcaId } });
      if (factors.length > 0) {
        await tx.rcaContributingFactor.createMany({
          data: factors.map((f: { category: string; detail?: string | null; isPrimary?: boolean }) => ({
            rcaId,
            category: f.category,
            detail: f.detail ?? null,
            isPrimary: !!f.isPrimary,
          })),
        });
      }
      await logFindingAuditAndActivity(
        tx,
        finding.id,
        finding.sourceTaskId,
        FINDING_EXPANSION_ACTIONS.RCA_UPDATED,
        userId,
        `MEDA contributing factors updated (${factors.length}) for Finding #${finding.id}`,
        { findingId: finding.id, factorCount: factors.length }
      );
      return tx.rcaContributingFactor.findMany({ where: { rcaId }, orderBy: { id: 'asc' } });
    });

    res.json(updated);
  } catch (error) {
    console.error('Error saving factors:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
