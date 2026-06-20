// Shared per-staff rating/efficiency aggregation, used by both
// GET /api/analytics/time-booking and GET /api/workload/personnel so the two
// surfaces compute "task efficiency" over the exact same population
// (rated tasks with a known assignee) and the same ratio formula.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface RatedTaskInput {
  rating: number | null;
  assignedToUser: { id: number; name: string } | null;
  timeBooking: { totalHours: number; estimatedHours: number | null } | null;
}

export interface StaffEfficiencyRow {
  userId: number;
  name: string;
  avgRating: number | null;
  ratedTaskCount: number;
  avgEfficiencyRatio: number | null;
}

export function aggregateStaffEfficiency(tasks: RatedTaskInput[]): StaffEfficiencyRow[] {
  interface StaffAgg {
    userId: number;
    name: string;
    ratingSum: number;
    ratedTaskCount: number;
    ratioSum: number;
    ratioCount: number;
  }

  const staffMap = new Map<number, StaffAgg>();

  for (const t of tasks) {
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
    // Guard > 0 mirrors the template over-budget guard in analytics.controller.
    if (tb && tb.estimatedHours !== null && tb.estimatedHours > 0) {
      agg.ratioSum += tb.totalHours / tb.estimatedHours;
      agg.ratioCount += 1;
    }
  }

  return Array.from(staffMap.values()).map((agg) => ({
    userId: agg.userId,
    name: agg.name,
    avgRating: agg.ratedTaskCount > 0 ? round2(agg.ratingSum / agg.ratedTaskCount) : null,
    ratedTaskCount: agg.ratedTaskCount,
    avgEfficiencyRatio: agg.ratioCount > 0 ? round2(agg.ratioSum / agg.ratioCount) : null,
  }));
}
