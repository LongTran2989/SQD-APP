import { Request, Response } from 'express';
import { FINAL_TASK_STATUSES } from '../constants/taskStatus';
import { hasPrivilege } from '../utils/privilegeAccess';
import { aggregateStaffEfficiency, RatedTaskInput } from '../utils/staffEfficiencyAggregation';
import { prisma } from '../lib/prisma';

// ─── Constants ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DEFAULT_DEADLINE_WINDOW_DAYS = 7;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// A date-only `to` (YYYY-MM-DD) is treated as inclusive of the whole day — same
// convention as analytics.controller's completedAt/createdAt range parsing.
function parseDateRange(fromRaw: unknown, toRaw: unknown): { gte?: Date; lte?: Date; lt?: Date } | undefined {
  const from = fromRaw ? String(fromRaw) : undefined;
  const to = toRaw ? String(toRaw) : undefined;
  const filter: { gte?: Date; lte?: Date; lt?: Date } = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) filter.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(to.trim())) filter.lt = new Date(d.getTime() + MS_PER_DAY);
      else filter.lte = d;
    }
  }
  return filter.gte !== undefined || filter.lte !== undefined || filter.lt !== undefined ? filter : undefined;
}

// Intersects "deadline/timeframeTo already passed `now`" with an optional
// caller-supplied date range, so "Overdue" stays correct even when the range's
// own upper bound would otherwise be later than `now`.
function pastDueFilter(now: Date, range?: { gte?: Date; lte?: Date; lt?: Date }): { gte?: Date; lt?: Date; lte?: Date } {
  const filter: { gte?: Date; lt?: Date; lte?: Date } = { lt: now };
  if (!range) return filter;
  if (range.gte) filter.gte = range.gte;
  if (range.lt !== undefined && range.lt < now) filter.lt = range.lt;
  if (range.lte !== undefined && range.lte < now) {
    delete filter.lt;
    filter.lte = range.lte;
  }
  return filter;
}

// Resolve the caller's visible scope: Managers are always pinned to their own
// division; Director/Admin may optionally narrow with ?divisionId. Mirrors the
// scoping rule in analytics.controller.
function resolveDivisionScope(req: Request): number | undefined {
  const { role, divisionId } = req.user!;
  if (role === 'Manager') return divisionId;
  const raw = req.query.divisionId ? parseInt(req.query.divisionId as string, 10) : undefined;
  return raw !== undefined && !Number.isNaN(raw) ? raw : undefined;
}

// ─── GET /api/workload/personnel ─────────────────────────────────────────────

export const getPersonnelWorkload = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'analytics:view')) {
      res.status(403).json({ message: 'You do not have permission to view workload data.' });
      return;
    }

    const targetDivisionId = resolveDivisionScope(req);
    const dateRange = parseDateRange(req.query.from, req.query.to);

    const windowRaw = req.query.deadlineWindowDays ? parseInt(req.query.deadlineWindowDays as string, 10) : undefined;
    const deadlineWindowDays = windowRaw !== undefined && !Number.isNaN(windowRaw) && windowRaw > 0
      ? windowRaw
      : DEFAULT_DEADLINE_WINDOW_DAYS;

    const users = await prisma.user.findMany({
      where: { deletedAt: null, ...(targetDivisionId !== undefined && { divisionId: targetDivisionId }) },
      select: { id: true, name: true, divisionId: true },
      orderBy: { name: 'asc' },
    });

    if (users.length === 0) {
      res.status(200).json({ deadlineWindowDays, personnel: [] });
      return;
    }

    const userIds = users.map((u) => u.id);
    const now = new Date();
    const deadlineHorizon = new Date(now.getTime() + deadlineWindowDays * MS_PER_DAY);

    // ── Workload (capacity, not date-filtered) ──

    const activeTasksRaw = await prisma.task.groupBy({
      by: ['assignedToUserId'],
      where: { deletedAt: null, assignedToUserId: { in: userIds }, status: { notIn: FINAL_TASK_STATUSES } },
      _count: { _all: true },
      _sum: { estimatedHours: true },
    });

    const upcomingDeadlinesRaw = await prisma.task.groupBy({
      by: ['assignedToUserId'],
      where: {
        deletedAt: null,
        assignedToUserId: { in: userIds },
        status: { notIn: FINAL_TASK_STATUSES },
        deadline: { gte: now, lte: deadlineHorizon },
      },
      _count: { _all: true },
    });

    const wpsManagedRaw = await prisma.workPackageAssignment.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, wp: { deletedAt: null, status: { notIn: ['Closed', 'Inactive'] } } },
      _count: { _all: true },
    });

    const openCapasRaw = await prisma.capaAction.groupBy({
      by: ['ownerUserId'],
      where: { ownerUserId: { in: userIds }, deletedAt: null, status: { in: ['Open', 'In Progress'] } },
      _count: { _all: true },
    });

    const activeRcasRaw = await prisma.rcaInvestigation.groupBy({
      by: ['conductedByUserId'],
      where: { conductedByUserId: { in: userIds }, status: 'Draft' },
      _count: { _all: true },
    });

    // ── Performance (historical, date-range filtered) ──

    const hoursLoggedRaw = await prisma.timeEntry.groupBy({
      by: ['loggedByUserId'],
      where: {
        loggedByUserId: { in: userIds },
        task: { deletedAt: null },
        ...(dateRange && { loggedAt: dateRange }),
      },
      _sum: { sessionHours: true },
    });

    const finalTasksForEfficiency = await prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { in: FINAL_TASK_STATUSES },
        assignedToUserId: { in: userIds },
        ...(dateRange && { completedAt: dateRange }),
      },
      select: {
        rating: true,
        assignedToUser: { select: { id: true, name: true } },
        timeBooking: { select: { totalHours: true, estimatedHours: true } },
      },
    });
    const efficiencyByUser = new Map(
      aggregateStaffEfficiency(finalTasksForEfficiency as RatedTaskInput[]).map((r) => [r.userId, r.avgEfficiencyRatio])
    );

    const finalTaskCountsRaw = await prisma.task.groupBy({
      by: ['assignedToUserId'],
      where: {
        deletedAt: null,
        status: { in: FINAL_TASK_STATUSES },
        assignedToUserId: { in: userIds },
        ...(dateRange && { completedAt: dateRange }),
      },
      _count: { _all: true },
    });

    const rejectedTaskCountsRaw = await prisma.task.groupBy({
      by: ['assignedToUserId'],
      where: {
        deletedAt: null,
        status: 'Rejected',
        assignedToUserId: { in: userIds },
        ...(dateRange && { completedAt: dateRange }),
      },
      _count: { _all: true },
    });


    // On-Time fetch is done as findMany (not groupBy) because Prisma can't compare
    // two columns (completedAt <= deadline) in a single WHERE clause.
    // We pull the raw rows and aggregate in JS.
    const onTimeClosedRaw = await prisma.task.findMany({
      where: {
        deletedAt: null,
        status: 'Closed',
        assignedToUserId: { in: userIds },
        deadline: { not: null },
        ...(dateRange && { completedAt: dateRange }),
      },
      select: { assignedToUserId: true, completedAt: true, deadline: true },
    });

    const findingsReportedRaw = await prisma.finding.groupBy({
      by: ['reportedByUserId'],
      where: { reportedByUserId: { in: userIds }, deletedAt: null, ...(dateRange && { createdAt: dateRange }) },
      _count: { _all: true },
    });

    const findingsClosedRaw = await prisma.finding.groupBy({
      by: ['closedByUserId'],
      where: { closedByUserId: { in: userIds }, deletedAt: null, ...(dateRange && { closedAt: dateRange }) },
      _count: { _all: true },
    });

    const capasVerifiedRaw = await prisma.capaAction.groupBy({
      by: ['verifiedByUserId'],
      where: { verifiedByUserId: { in: userIds }, deletedAt: null, ...(dateRange && { verifiedAt: dateRange }) },
      _count: { _all: true },
    });

    // Overdue tasks: non-final, deadline already passed. Counted alongside
    // Rejected tasks and Overdue WPs as a single combined "Overdue/Rejected" figure.
    const overdueTasksRaw = await prisma.task.groupBy({
      by: ['assignedToUserId'],
      where: {
        deletedAt: null,
        assignedToUserId: { in: userIds },
        status: { notIn: FINAL_TASK_STATUSES },
        deadline: pastDueFilter(now, dateRange),
      },
      _count: { _all: true },
    });

    // Overdue WPs (simple approximation — timeframeTo passed, not Closed/Inactive;
    // does not re-check for remaining incomplete tasks like computeWpStatus does).
    const overdueWpsRaw = await prisma.workPackageAssignment.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        wp: {
          deletedAt: null,
          status: { notIn: ['Closed', 'Inactive'] },
          timeframeTo: pastDueFilter(now, dateRange),
        },
      },
      _count: { _all: true },
    });

    // ── Maps for O(1) lookup while assembling rows ──

    const activeTaskCountMap = new Map(activeTasksRaw.map((r) => [r.assignedToUserId as number, r._count._all]));
    const estimatedHoursMap = new Map(activeTasksRaw.map((r) => [r.assignedToUserId as number, r._sum.estimatedHours ?? 0]));
    const upcomingDeadlinesMap = new Map(upcomingDeadlinesRaw.map((r) => [r.assignedToUserId as number, r._count._all]));
    const wpsManagedMap = new Map(wpsManagedRaw.map((r) => [r.userId, r._count._all]));
    const openCapasMap = new Map(openCapasRaw.map((r) => [r.ownerUserId as number, r._count._all]));
    const activeRcasMap = new Map(activeRcasRaw.map((r) => [r.conductedByUserId as number, r._count._all]));

    const hoursLoggedMap = new Map(hoursLoggedRaw.map((r) => [r.loggedByUserId, round2(r._sum.sessionHours ?? 0)]));
    const finalTaskCountMap = new Map(finalTaskCountsRaw.map((r) => [r.assignedToUserId as number, r._count._all]));
    const rejectedTaskCountMap = new Map(rejectedTaskCountsRaw.map((r) => [r.assignedToUserId as number, r._count._all]));
    const findingsReportedMap = new Map(findingsReportedRaw.map((r) => [r.reportedByUserId, r._count._all]));
    const findingsClosedMap = new Map(findingsClosedRaw.map((r) => [r.closedByUserId as number, r._count._all]));
    const capasVerifiedMap = new Map(capasVerifiedRaw.map((r) => [r.verifiedByUserId as number, r._count._all]));
    const overdueTaskCountMap = new Map(overdueTasksRaw.map((r) => [r.assignedToUserId as number, r._count._all]));
    const overdueWpCountMap = new Map(overdueWpsRaw.map((r) => [r.userId, r._count._all]));

    // Build on-time maps from the findMany result: tally on-time + total closed per user
    const onTimeCountMap = new Map<number, number>();
    const closedWithDeadlineMap = new Map<number, number>();
    for (const t of onTimeClosedRaw) {
      const uid = t.assignedToUserId as number;
      closedWithDeadlineMap.set(uid, (closedWithDeadlineMap.get(uid) ?? 0) + 1);
      if (t.completedAt && t.deadline && t.completedAt <= t.deadline) {
        onTimeCountMap.set(uid, (onTimeCountMap.get(uid) ?? 0) + 1);
      }
    }

    const personnel = users.map((u) => {
      const finalTaskCount = finalTaskCountMap.get(u.id) ?? 0;
      const rejectedCount = rejectedTaskCountMap.get(u.id) ?? 0;
      const findingsReported = findingsReportedMap.get(u.id) ?? 0;
      const tasksCompleted = finalTaskCountMap.get(u.id) ?? 0;
      const closedWithDeadline = closedWithDeadlineMap.get(u.id) ?? 0;
      const onTimeCount = onTimeCountMap.get(u.id) ?? 0;
      const onTimeRate = closedWithDeadline > 0 ? round2(onTimeCount / closedWithDeadline) : null;

      return {
        userId: u.id,
        name: u.name,
        divisionId: u.divisionId,
        workload: {
          activeTasks: activeTaskCountMap.get(u.id) ?? 0,
          estimatedHours: round2(estimatedHoursMap.get(u.id) ?? 0),
          wpsManaged: wpsManagedMap.get(u.id) ?? 0,
          openCapas: openCapasMap.get(u.id) ?? 0,
          activeRcas: activeRcasMap.get(u.id) ?? 0,
          upcomingDeadlines: upcomingDeadlinesMap.get(u.id) ?? 0,
        },
        performance: {
          tasksCompleted,
          hoursLogged: hoursLoggedMap.get(u.id) ?? 0,
          taskEfficiency: efficiencyByUser.get(u.id) ?? null,
          onTimeRate,
          findingsReported,
          proactivityRatio: finalTaskCount > 0 ? round2(findingsReported / finalTaskCount) : null,
          findingsClosed: findingsClosedMap.get(u.id) ?? 0,
          capasVerified: capasVerifiedMap.get(u.id) ?? 0,
          rejectedCount,
          rejectionRate: finalTaskCount > 0 ? round2(rejectedCount / finalTaskCount) : null,
          overdueCount: (overdueTaskCountMap.get(u.id) ?? 0) + (overdueWpCountMap.get(u.id) ?? 0),
        },
      };
    });

    res.status(200).json({ deadlineWindowDays, personnel });
  } catch (error) {
    console.error('[getPersonnelWorkload]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

// ─── GET /api/workload/personnel/:userId ─────────────────────────────────────

export const getPersonnelDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'analytics:view')) {
      res.status(403).json({ message: 'You do not have permission to view workload data.' });
      return;
    }

    const userIdRaw = req.params.userId;
    const userId = userIdRaw && !Array.isArray(userIdRaw) ? parseInt(userIdRaw, 10) : NaN;
    if (Number.isNaN(userId)) {
      res.status(400).json({ message: 'Invalid user id.' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true, divisionId: true },
    });
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    // RBAC: Manager may only view personnel in their own division.
    const { role, divisionId } = req.user!;
    if (role === 'Manager' && user.divisionId !== divisionId) {
      res.status(403).json({ message: 'You do not have permission to view this user.' });
      return;
    }

    const windowRaw = req.query.deadlineWindowDays ? parseInt(req.query.deadlineWindowDays as string, 10) : undefined;
    const deadlineWindowDays = windowRaw !== undefined && !Number.isNaN(windowRaw) && windowRaw > 0
      ? windowRaw
      : DEFAULT_DEADLINE_WINDOW_DAYS;

    const now = new Date();
    const deadlineHorizon = new Date(now.getTime() + deadlineWindowDays * MS_PER_DAY);

    // Hours-logged trend follows the same From/To range as the rest of
    // Performance; with no range selected it falls back to the last 12 months.
    const dateRange = parseDateRange(req.query.from, req.query.to);
    const loggedAtFilter = dateRange ?? { gte: new Date(now.getTime() - 365 * MS_PER_DAY) };

    const [upcomingTasks, activeTasks, activeWps, openCapas, activeRcas, timeEntries, finalTasksForEfficiency, onTimeClosedForDetail] = await Promise.all([
      prisma.task.findMany({
        where: {
          deletedAt: null,
          assignedToUserId: userId,
          status: { notIn: FINAL_TASK_STATUSES },
          deadline: { gte: now, lte: deadlineHorizon },
        },
        select: { id: true, taskId: true, title: true, deadline: true, status: true, template: { select: { title: true } } },
        orderBy: { deadline: 'asc' },
      }),
      // All active (non-final) tasks the user is currently working on, not just
      // those nearing their deadline.
      prisma.task.findMany({
        where: { deletedAt: null, assignedToUserId: userId, status: { notIn: FINAL_TASK_STATUSES } },
        select: { id: true, taskId: true, title: true, deadline: true, status: true, template: { select: { title: true } } },
        orderBy: { deadline: 'asc' },
      }),
      // Currently-active WPs the user is assigned to (matches the WPs Managed metric scope).
      prisma.workPackageAssignment.findMany({
        where: { userId, wp: { deletedAt: null, status: { notIn: ['Closed', 'Inactive'] } } },
        select: { wp: { select: { id: true, wpId: true, name: true, type: true, status: true, timeframeTo: true } } },
        orderBy: { wp: { timeframeTo: 'asc' } },
      }),
      // CAPAs/RCAs panels are currently hidden in the UI (kept here so they can
      // be re-deployed without backend changes).
      prisma.capaAction.findMany({
        where: { ownerUserId: userId, deletedAt: null, status: { in: ['Open', 'In Progress'] } },
        select: { id: true, description: true, type: true, status: true, deadline: true, finding: { select: { id: true, description: true } } },
        orderBy: { deadline: 'asc' },
      }),
      prisma.rcaInvestigation.findMany({
        where: { conductedByUserId: userId, status: 'Draft' },
        select: { id: true, method: true, finding: { select: { id: true, description: true } } },
      }),
      prisma.timeEntry.findMany({
        where: {
          loggedByUserId: userId,
          task: { deletedAt: null },
          loggedAt: loggedAtFilter,
        },
        select: { sessionHours: true, loggedAt: true },
      }),
      prisma.task.findMany({
        where: {
          deletedAt: null,
          status: { in: FINAL_TASK_STATUSES },
          assignedToUserId: userId,
          // FIX: apply the date range so the detail panel efficiency matches the selected period
          ...(dateRange && { completedAt: dateRange }),
        },
        select: {
          rating: true,
          assignedToUser: { select: { id: true, name: true } },
          timeBooking: { select: { totalHours: true, estimatedHours: true } },
        },
      }),
      // On-time data for detail: closed tasks with deadline, scoped by date range
      prisma.task.findMany({
        where: {
          deletedAt: null,
          status: 'Closed',
          assignedToUserId: userId,
          deadline: { not: null },
          ...(dateRange && { completedAt: dateRange }),
        },
        select: { completedAt: true, deadline: true },
      }),
    ]);

    const monthMap = new Map<string, number>();
    for (const e of timeEntries) {
      const month = e.loggedAt.toISOString().slice(0, 7);
      monthMap.set(month, round2((monthMap.get(month) ?? 0) + e.sessionHours));
    }
    const hoursLoggedByMonth = Array.from(monthMap.entries())
      .map(([month, hours]) => ({ month, hours }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const efficiency = aggregateStaffEfficiency(finalTasksForEfficiency as RatedTaskInput[])[0] ?? null;

    // On-time rate for detail
    let onTimeDetailCount = 0;
    let closedWithDeadlineDetail = 0;
    for (const t of onTimeClosedForDetail) {
      if (t.deadline) {
        closedWithDeadlineDetail += 1;
        if (t.completedAt && t.completedAt <= t.deadline) onTimeDetailCount += 1;
      }
    }
    const onTimeRate = closedWithDeadlineDetail > 0 ? round2(onTimeDetailCount / closedWithDeadlineDetail) : null;
    const tasksCompleted = finalTasksForEfficiency.length;

    res.status(200).json({
      userId: user.id,
      name: user.name,
      deadlineWindowDays,
      taskEfficiency: efficiency?.avgEfficiencyRatio ?? null,
      avgRating: efficiency?.avgRating ?? null,
      tasksCompleted,
      onTimeRate,
      hoursLoggedByMonth,
      upcomingDeadlines: upcomingTasks.map((t) => ({
        id: t.id,
        taskId: t.taskId,
        title: t.title ?? t.template.title,
        deadline: t.deadline,
        status: t.status,
      })),
      activeTasks: activeTasks.map((t) => ({
        id: t.id,
        taskId: t.taskId,
        title: t.title ?? t.template.title,
        deadline: t.deadline,
        status: t.status,
      })),
      activeWps: activeWps.map(({ wp }) => ({
        id: wp.id,
        wpId: wp.wpId,
        name: wp.name,
        type: wp.type,
        status: wp.status,
        timeframeTo: wp.timeframeTo,
      })),
      openCapas: openCapas.map((c) => ({
        id: c.id,
        description: c.description,
        type: c.type,
        status: c.status,
        deadline: c.deadline,
        findingId: c.finding.id,
        findingDescription: c.finding.description,
      })),
      activeRcas: activeRcas.map((r) => ({
        id: r.id,
        method: r.method,
        findingId: r.finding.id,
        findingDescription: r.finding.description,
      })),
    });
  } catch (error) {
    console.error('[getPersonnelDetail]', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};
