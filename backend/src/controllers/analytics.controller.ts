import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { FINAL_TASK_STATUSES } from '../constants/taskStatus';
import { FINDING_SEVERITIES, FINDING_STATUSES } from '../constants/findingTaxonomy';
import { hasPrivilege } from '../utils/privilegeAccess';
import { aggregateStaffEfficiency, RatedTaskInput } from '../utils/staffEfficiencyAggregation';

import { prisma } from '../lib/prisma';

// ─── Constants ────────────────────────────────────────────────────────────────

// FINDING_SEVERITIES / FINDING_STATUSES are imported from the shared taxonomy so
// the analytics buckets and the ?severity validation stay in lockstep with the
// finding controller. They seed the severity/status buckets so the dashboard
// always renders a complete set of bars (count 0 included).
// Bucket label for findings not yet triaged (severity is nullable until reviewed).
const UNREVIEWED_SEVERITY = 'Unreviewed';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

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

    // completedAt range — both bounds collapse into one filter object.
    // A date-only `to` (YYYY-MM-DD) is treated as inclusive of the whole day:
    // `new Date('2026-02-28')` is UTC midnight, so `lte` would drop tasks
    // completed later that day. Use `lt` of the next midnight instead. A `to`
    // that already carries a time component keeps exact `lte` semantics.
    const completedAtFilter: { gte?: Date; lte?: Date; lt?: Date } = {};
    if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) completedAtFilter.gte = d; }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(to.trim())) completedAtFilter.lt = new Date(d.getTime() + MS_PER_DAY);
        else completedAtFilter.lte = d;
      }
    }
    const hasDateFilter =
      completedAtFilter.gte !== undefined || completedAtFilter.lte !== undefined || completedAtFilter.lt !== undefined;

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

    // ── STEP 2: Single-pass template aggregation ──
    const templateMap = new Map<number, TemplateAgg>();

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
    }

    // ── STEP 3: Finalise template rows ──
    const templates = Array.from(templateMap.values()).map((agg) => {
      const avgActualHours = agg.actualCount > 0 ? round2(agg.actualSum / agg.actualCount) : null;
      const estimatedHours = agg.estimatedHours;
      // Formula: est / avgActual so that ≥1.0 = on/under budget (good), <1.0 = over budget (bad).
      // Higher is always better, consistent with staffEfficiencyAggregation.
      const efficiencyRatio =
        avgActualHours !== null && avgActualHours > 0 && estimatedHours !== null && estimatedHours > 0
          ? round2(estimatedHours / avgActualHours)
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
    const staff = aggregateStaffEfficiency(tasks as RatedTaskInput[]);

    res.status(200).json({ templates, staff, incompleteBookings });
  } catch (error) {
    console.error('[getTimeBookingAnalytics]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

// ─── GET /api/analytics/findings ─────────────────────────────────────────────
//
// Aggregate analytics over the Finding model. Mirrors getTimeBookingAnalytics:
// privilege-gated, RBAC division-scoping pushed into the Prisma WHERE clause
// (never post-fetch), single findMany → single-pass JS aggregation.
//
// RBAC note: findings analytics is organisation-wide transparent, consistent with
// the open Findings list/detail (buildFindingScope → {}). Any role with
// analytics:view sees org-wide finding data; the optional ?divisionId param lets
// anyone narrow to a single division. See CLAUDE_HANDOVER.md.

export const getFindingsAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    // Only management roles may view analytics
    if (!hasPrivilege(req.user!, 'analytics:view')) {
      res.status(403).json({ message: 'You do not have permission to view analytics.' });
      return;
    }

    // ── Parse optional filters ──
    const divisionIdRaw = req.query.divisionId ? parseInt(req.query.divisionId as string, 10) : undefined;
    const divisionFilter = divisionIdRaw !== undefined && !Number.isNaN(divisionIdRaw) ? divisionIdRaw : undefined;

    const departmentIdRaw = req.query.departmentId ? parseInt(req.query.departmentId as string, 10) : undefined;
    const departmentFilter = departmentIdRaw !== undefined && !Number.isNaN(departmentIdRaw) ? departmentIdRaw : undefined;

    const severityRaw = req.query.severity ? String(req.query.severity) : undefined;
    const severityFilter = severityRaw && FINDING_SEVERITIES.includes(severityRaw) ? severityRaw : undefined;

    const eventTypeFilter = req.query.eventType ? String(req.query.eventType) : undefined;

    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;

    // createdAt range — both bounds collapse into one filter object.
    // A date-only `to` (YYYY-MM-DD) is treated as inclusive of the whole day:
    // `new Date('2026-02-28')` is UTC midnight, so `lte` would drop findings
    // created later that day. Use `lt` of the next midnight instead. A `to` that
    // already carries a time component keeps exact `lte` semantics.
    const createdAtFilter: { gte?: Date; lte?: Date; lt?: Date } = {};
    if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) createdAtFilter.gte = d; }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(to.trim())) createdAtFilter.lt = new Date(d.getTime() + MS_PER_DAY);
        else createdAtFilter.lte = d;
      }
    }
    const hasDateFilter =
      createdAtFilter.gte !== undefined || createdAtFilter.lte !== undefined || createdAtFilter.lt !== undefined;

    // Findings are organisation-wide transparent, so analytics defaults to all
    // divisions for every role. The optional ?divisionId param narrows to one
    // division (available to all roles), pushed into the DB WHERE clause.
    const targetDivisionId: number | undefined = divisionFilter;

    const where: Prisma.FindingWhereInput = {
      deletedAt: null,
      ...(targetDivisionId !== undefined && { targetDivisionId }),
      ...(departmentFilter !== undefined && { departmentId: departmentFilter }),
      ...(severityFilter !== undefined && { severity: severityFilter }),
      ...(eventTypeFilter !== undefined && { eventType: eventTypeFilter }),
      ...(hasDateFilter && { createdAt: createdAtFilter }),
    };

    // select (not include) — load only the columns the aggregation reads, skipping the
    // large optional JSON/expansion relations on Finding.
    const findings = await prisma.finding.findMany({
      where,
      select: {
        id: true,
        severity: true,
        status: true,
        eventType: true,
        departmentId: true,
        ataChapterId: true,
        createdAt: true,
        closedAt: true,
        department: { select: { id: true, name: true } },
        ataChapter: { select: { id: true, code: true, title: true } },
      },
    });

    // ── Single-pass aggregation ──
    // Seed severity & status maps so every canonical bucket renders (count 0 included).
    const severityMap = new Map<string, number>();
    for (const s of FINDING_SEVERITIES) severityMap.set(s, 0);
    severityMap.set(UNREVIEWED_SEVERITY, 0);

    const statusMap = new Map<string, number>();
    for (const s of FINDING_STATUSES) statusMap.set(s, 0);

    const eventTypeMap = new Map<string, number>();
    const departmentMap = new Map<number, { id: number; name: string; count: number }>();
    const ataMap = new Map<number, { id: number; code: string; title: string; count: number }>();
    const monthMap = new Map<string, number>();

    let openCount = 0;
    let closedCount = 0;
    let dismissedCount = 0;
    let closeDurationSum = 0; // ms
    let closeDurationCount = 0;

    for (const f of findings) {
      // — Severity (null → Unreviewed) —
      const sevKey = f.severity ?? UNREVIEWED_SEVERITY;
      severityMap.set(sevKey, (severityMap.get(sevKey) ?? 0) + 1);

      // — Status —
      statusMap.set(f.status, (statusMap.get(f.status) ?? 0) + 1);
      if (f.status === 'Closed') closedCount += 1;
      else if (f.status === 'Dismissed') dismissedCount += 1;
      else openCount += 1;

      // — Event type (dynamic taxonomy) —
      eventTypeMap.set(f.eventType, (eventTypeMap.get(f.eventType) ?? 0) + 1);

      // — Department —
      const dep = departmentMap.get(f.departmentId);
      if (dep) dep.count += 1;
      else departmentMap.set(f.departmentId, { id: f.departmentId, name: f.department.name, count: 1 });

      // — ATA chapter (optional — only count findings that have one) —
      if (f.ataChapterId !== null && f.ataChapter) {
        const ata = ataMap.get(f.ataChapterId);
        if (ata) ata.count += 1;
        else ataMap.set(f.ataChapterId, { id: f.ataChapter.id, code: f.ataChapter.code, title: f.ataChapter.title, count: 1 });
      }

      // — Recurrence/trend by created month (YYYY-MM, UTC) —
      const month = f.createdAt.toISOString().slice(0, 7);
      monthMap.set(month, (monthMap.get(month) ?? 0) + 1);

      // — Time-to-close (Closed findings with a closedAt) —
      if (f.status === 'Closed' && f.closedAt) {
        closeDurationSum += f.closedAt.getTime() - f.createdAt.getTime();
        closeDurationCount += 1;
      }
    }

    const bySeverity = Array.from(severityMap.entries()).map(([key, count]) => ({ key, count }));
    const byStatus = Array.from(statusMap.entries()).map(([key, count]) => ({ key, count }));
    const byEventType = Array.from(eventTypeMap.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
    const byDepartment = Array.from(departmentMap.values()).sort((a, b) => b.count - a.count);
    const byAtaChapter = Array.from(ataMap.values()).sort((a, b) => b.count - a.count);
    const byMonth = Array.from(monthMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const avgDaysToClose =
      closeDurationCount > 0 ? round2(closeDurationSum / closeDurationCount / MS_PER_DAY) : null;

    res.status(200).json({
      totalCount: findings.length,
      openCount,
      closedCount,
      dismissedCount,
      avgDaysToClose,
      bySeverity,
      byStatus,
      byEventType,
      byDepartment,
      byAtaChapter,
      byMonth,
    });
  } catch (error) {
    console.error('[getFindingsAnalytics]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};
