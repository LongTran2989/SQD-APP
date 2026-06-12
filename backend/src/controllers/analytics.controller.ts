import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { FINAL_TASK_STATUSES } from '../constants/taskStatus';
import { hasPrivilege } from '../utils/privilegeAccess';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Constants ────────────────────────────────────────────────────────────────



// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Per-template running accumulator.
// estimatedHours comes from the template's current canonical value — not averaged per-booking
// snapshots — so it reflects what the template currently says, not a mix of historical overrides.
interface TemplateAgg {
  templateId: number;
  templateCode: string;
  title: string;
  estimatedHours: number | null;
  taskCount: number;
  actualSum: number;
  actualCount: number;
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
    if (!hasPrivilege(req.user!, 'analytics:view')) {
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

    // completedAt range — both bounds collapse into one filter object
    const completedAtFilter: { gte?: Date; lte?: Date } = {};
    if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) completedAtFilter.gte = d; }
    if (to)   { const d = new Date(to);   if (!Number.isNaN(d.getTime())) completedAtFilter.lte = d; }
    const hasDateFilter = completedAtFilter.gte !== undefined || completedAtFilter.lte !== undefined;

    // RBAC division scoping — pushed into the DB WHERE clause so the query never fetches rows
    // outside the caller's scope. Managers are always constrained to their own division.
    // Directors/Admins may optionally narrow with the ?divisionId query param.
    const targetDivisionId: number | undefined =
      role === 'Manager'
        ? divisionId
        : divisionFilter !== undefined
        ? divisionFilter
        : undefined;

    // ── STEP 1a: Incomplete bookings — division-scoped, NOT filtered by templateId ──
    // This is a compliance metric over the whole division; it must not be narrowed by a
    // per-template filter the caller supplies for efficiency trend analysis.
    const incompleteBookingsWhere: Prisma.TaskWhereInput = {
      deletedAt: null,
      status: 'Closed',
      timeBooking: null,
      ...(targetDivisionId !== undefined && { targetDivisionId }),
    };
    const incompleteBookings = await prisma.task.count({ where: incompleteBookingsWhere });

    // ── STEP 1b: Final-state tasks for aggregation (templateId filter applies here) ──
    const where: Prisma.TaskWhereInput = {
      deletedAt: null,
      status: { in: FINAL_TASK_STATUSES },
      ...(targetDivisionId !== undefined && { targetDivisionId }),
      ...(templateId !== undefined && { templateId }),
      ...(hasDateFilter && { completedAt: completedAtFilter }),
    };

    // select (not include) to avoid loading schemaSnapshot, deadlineExtensions, inactivationLog,
    // and other large JSON columns that the aggregation does not read.
    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        templateId: true,
        status: true,
        rating: true,
        targetDivisionId: true,
        template: { select: { id: true, templateId: true, title: true, estimatedHours: true } },
        timeBooking: { select: { totalHours: true, estimatedHours: true, overBudgetReason: true } },
        assignedToUser: { select: { id: true, name: true } },
      },
    });

    // ── STEP 2: Single-pass aggregation for both template efficiency and staff performance ──
    const templateMap = new Map<number, TemplateAgg>();
    const staffMap = new Map<number, StaffAgg>();

    for (const t of tasks) {
      // — Template bucket —
      let tAgg = templateMap.get(t.templateId);
      if (!tAgg) {
        tAgg = {
          templateId: t.templateId,
          templateCode: t.template.templateId,
          title: t.template.title,
          // Canonical estimate from the live template — not an average of historical booking snapshots.
          estimatedHours: t.template.estimatedHours ?? null,
          taskCount: 0,
          actualSum: 0,
          actualCount: 0,
          overBudgetCount: 0,
          reasonCounts: new Map<string, number>(),
        };
        templateMap.set(t.templateId, tAgg);
      }
      tAgg.taskCount += 1;

      const tb = t.timeBooking;
      if (tb) {
        tAgg.actualSum += tb.totalHours;
        tAgg.actualCount += 1;
        // Use the booking-time snapshot for over-budget determination (reflects what was agreed
        // when the task closed). Guard > 0 prevents zero-estimated tasks from always firing.
        if (tb.estimatedHours !== null && tb.estimatedHours > 0) {
          if (tb.totalHours > tb.estimatedHours * 1.2) tAgg.overBudgetCount += 1;
        }
        if (tb.overBudgetReason) {
          tAgg.reasonCounts.set(
            tb.overBudgetReason,
            (tAgg.reasonCounts.get(tb.overBudgetReason) ?? 0) + 1
          );
        }
      }

      // — Staff bucket (rated tasks with a known assignee only) —
      if (t.rating !== null && t.assignedToUser !== null) {
        const uid = t.assignedToUser.id;
        let sAgg = staffMap.get(uid);
        if (!sAgg) {
          sAgg = {
            userId: uid,
            name: t.assignedToUser.name,
            ratingSum: 0,
            ratedTaskCount: 0,
            ratioSum: 0,
            ratioCount: 0,
          };
          staffMap.set(uid, sAgg);
        }
        sAgg.ratingSum += t.rating;
        sAgg.ratedTaskCount += 1;
        // Guard > 0 is consistent with the template over-budget guard above.
        if (tb && tb.estimatedHours !== null && tb.estimatedHours > 0) {
          sAgg.ratioSum += tb.totalHours / tb.estimatedHours;
          sAgg.ratioCount += 1;
        }
      }
    }

    // ── STEP 3: Finalise template rows ──
    const templates = Array.from(templateMap.values()).map((agg) => {
      const avgActualHours = agg.actualCount > 0 ? round2(agg.actualSum / agg.actualCount) : null;
      const estimatedHours = agg.estimatedHours;
      const efficiencyRatio =
        avgActualHours !== null && estimatedHours !== null && estimatedHours > 0
          ? round2(avgActualHours / estimatedHours)
          : null;

      // Most frequent over-budget reason; first-encountered wins on ties (insertion-order Map).
      let topOverBudgetReason: string | null = null;
      let topCount = 0;
      for (const [reason, count] of agg.reasonCounts) {
        if (count > topCount) { topCount = count; topOverBudgetReason = reason; }
      }

      return {
        templateId: agg.templateId,
        templateCode: agg.templateCode,
        title: agg.title,
        taskCount: agg.taskCount,
        avgActualHours,
        estimatedHours,   // canonical template estimate; null when template has no estimate set
        efficiencyRatio,
        overBudgetCount: agg.overBudgetCount,
        topOverBudgetReason,
      };
    });

    // ── STEP 4: Finalise staff rows ──
    const staff = Array.from(staffMap.values()).map((agg) => ({
      userId: agg.userId,
      name: agg.name,
      avgRating: agg.ratedTaskCount > 0 ? round2(agg.ratingSum / agg.ratedTaskCount) : null,
      ratedTaskCount: agg.ratedTaskCount,
      avgEfficiencyRatio: agg.ratioCount > 0 ? round2(agg.ratioSum / agg.ratioCount) : null,
    }));

    res.status(200).json({ templates, staff, incompleteBookings });
  } catch (error) {
    console.error('[getTimeBookingAnalytics]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};
