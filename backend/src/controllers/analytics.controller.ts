import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Constants ────────────────────────────────────────────────────────────────

const FINAL_TASK_STATUSES = ['Closed', 'Rejected', 'Terminated'];
const ANALYTICS_ROLES = ['Manager', 'Director', 'Admin'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Per-template running accumulator (all aggregation is done in JS, not raw SQL)
interface TemplateAgg {
  templateId: number;
  templateCode: string;
  title: string;
  taskCount: number;
  actualSum: number;
  actualCount: number;
  estSum: number;
  estCount: number;
  overBudgetCount: number;
  reasonCounts: Map<string, number>;
}

// Per-staff running accumulator
interface StaffAgg {
  userId: number;
  name: string;
  ratingSum: number;
  ratedTaskCount: number;
  ratioSum: number;
  ratioCount: number;
}

// ─── GET /api/analytics/time-booking ─────────────────────────────────────────

export const getTimeBookingAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, divisionId } = req.user!;

    // Only management roles may view analytics
    if (!ANALYTICS_ROLES.includes(role)) {
      res.status(403).json({ message: 'You do not have permission to view analytics.' });
      return;
    }

    // ── Parse optional filters ──
    const templateIdRaw = req.query.templateId ? parseInt(req.query.templateId as string, 10) : undefined;
    const templateId = templateIdRaw !== undefined && !Number.isNaN(templateIdRaw) ? templateIdRaw : undefined;

    const divisionIdRaw = req.query.divisionId ? parseInt(req.query.divisionId as string, 10) : undefined;
    const divisionFilter = divisionIdRaw !== undefined && !Number.isNaN(divisionIdRaw) ? divisionIdRaw : undefined;

    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;

    // completedAt range — both bounds collapse into a single filter object so that
    // supplying `from` and `to` together does not overwrite one another.
    const completedAtFilter: { gte?: Date; lte?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) completedAtFilter.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) completedAtFilter.lte = d;
    }
    const hasDateFilter = completedAtFilter.gte !== undefined || completedAtFilter.lte !== undefined;

    // ── STEP 1: Fetch final-state tasks with their TimeBookings ──
    const where: Prisma.TaskWhereInput = {
      deletedAt: null,
      status: { in: FINAL_TASK_STATUSES },
      ...(templateId !== undefined && { templateId }),
      ...(divisionFilter !== undefined && { targetDivisionId: divisionFilter }),
      ...(hasDateFilter && { completedAt: completedAtFilter }),
    };

    const tasks = await prisma.task.findMany({
      where,
      include: {
        template: { select: { id: true, templateId: true, title: true, estimatedHours: true } },
        timeBooking: { select: { totalHours: true, estimatedHours: true, overBudgetReason: true } },
        assignedToUser: { select: { id: true, name: true, divisionId: true } },
      },
    });

    // RBAC scoping — Managers see only their own division; Director/Admin see all.
    const scopedTasks =
      role === 'Manager' ? tasks.filter((t) => t.targetDivisionId === divisionId) : tasks;

    // ── STEP 2: Template efficiency ──
    const templateMap = new Map<number, TemplateAgg>();
    for (const t of scopedTasks) {
      let agg = templateMap.get(t.templateId);
      if (!agg) {
        agg = {
          templateId: t.templateId,
          templateCode: t.template.templateId,
          title: t.template.title,
          taskCount: 0,
          actualSum: 0,
          actualCount: 0,
          estSum: 0,
          estCount: 0,
          overBudgetCount: 0,
          reasonCounts: new Map<string, number>(),
        };
        templateMap.set(t.templateId, agg);
      }
      agg.taskCount += 1;

      const tb = t.timeBooking;
      if (tb) {
        agg.actualSum += tb.totalHours;
        agg.actualCount += 1;
        if (tb.estimatedHours !== null) {
          agg.estSum += tb.estimatedHours;
          agg.estCount += 1;
          if (tb.totalHours > tb.estimatedHours * 1.2) agg.overBudgetCount += 1;
        }
        if (tb.overBudgetReason) {
          agg.reasonCounts.set(tb.overBudgetReason, (agg.reasonCounts.get(tb.overBudgetReason) ?? 0) + 1);
        }
      }
    }

    const templates = Array.from(templateMap.values()).map((agg) => {
      const avgActualHours = agg.actualCount > 0 ? round2(agg.actualSum / agg.actualCount) : null;
      const avgEstimatedHours = agg.estCount > 0 ? round2(agg.estSum / agg.estCount) : null;
      const efficiencyRatio =
        avgActualHours !== null && avgEstimatedHours !== null && avgEstimatedHours > 0
          ? round2(avgActualHours / avgEstimatedHours)
          : null;

      // Most frequent non-null over-budget reason across the group
      let topOverBudgetReason: string | null = null;
      let topCount = 0;
      for (const [reason, count] of agg.reasonCounts) {
        if (count > topCount) {
          topCount = count;
          topOverBudgetReason = reason;
        }
      }

      return {
        templateId: agg.templateId,
        templateCode: agg.templateCode,
        title: agg.title,
        taskCount: agg.taskCount,
        avgActualHours,
        avgEstimatedHours,
        efficiencyRatio,
        overBudgetCount: agg.overBudgetCount,
        topOverBudgetReason,
      };
    });

    // ── STEP 3: Staff performance (rated tasks with a known assignee) ──
    const staffMap = new Map<number, StaffAgg>();
    for (const t of scopedTasks) {
      if (t.rating === null || t.assignedToUser === null) continue;
      const uid = t.assignedToUser.id;
      let agg = staffMap.get(uid);
      if (!agg) {
        agg = { userId: uid, name: t.assignedToUser.name, ratingSum: 0, ratedTaskCount: 0, ratioSum: 0, ratioCount: 0 };
        staffMap.set(uid, agg);
      }
      agg.ratingSum += t.rating;
      agg.ratedTaskCount += 1;

      const tb = t.timeBooking;
      if (tb && tb.estimatedHours !== null && tb.estimatedHours > 0) {
        agg.ratioSum += tb.totalHours / tb.estimatedHours;
        agg.ratioCount += 1;
      }
    }

    const staff = Array.from(staffMap.values()).map((agg) => ({
      userId: agg.userId,
      name: agg.name,
      avgRating: agg.ratedTaskCount > 0 ? round2(agg.ratingSum / agg.ratedTaskCount) : null,
      ratedTaskCount: agg.ratedTaskCount,
      avgEfficiencyRatio: agg.ratioCount > 0 ? round2(agg.ratioSum / agg.ratioCount) : null,
    }));

    // ── STEP 4: Incomplete bookings (Closed tasks missing a booking) ──
    const incompleteBookings = scopedTasks.filter(
      (t) => t.status === 'Closed' && t.timeBooking === null
    ).length;

    res.status(200).json({ templates, staff, incompleteBookings });
  } catch (error) {
    console.error('[getTimeBookingAnalytics]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};
