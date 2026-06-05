import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { TREND_THRESHOLD, TREND_WINDOW_DAYS } from '../constants/findingExpansion';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export interface TrendInfo {
  isRecurring: boolean;
  matchCount: number;       // includes the finding itself
  threshold: number;
  windowDays: number;
  signature: {
    departmentId: number | null;
    ataChapterId: number | null;
    causeCodeId: number | null;
    hazardTagIds: number[];
  };
}

/**
 * Compute-on-read recurrence detection. A finding is "recurring" when at least
 * TREND_THRESHOLD non-deleted findings (inclusive of itself) within the rolling
 * window share the SAME Department + ATA Chapter + Cause Code AND at least one
 * common Hazard Tag.
 *
 * Cause Code lives on the finding's RcaInvestigation (it is only known once the
 * RCA establishes the cause), so a finding without a completed cause code never
 * participates in cause-based trend grouping. Pure read — never writes.
 */
export async function computeTrend(findingId: number): Promise<TrendInfo> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId, deletedAt: null },
    select: {
      departmentId: true,
      ataChapterId: true,
      rca: { select: { causeCodeId: true } },
      hazardTags: { select: { hazardTagId: true } },
    },
  });

  const departmentId = finding?.departmentId ?? null;
  const ataChapterId = finding?.ataChapterId ?? null;
  const causeCodeId = finding?.rca?.causeCodeId ?? null;
  const hazardTagIds = finding?.hazardTags.map((h) => h.hazardTagId) ?? [];

  const signature = { departmentId, ataChapterId, causeCodeId, hazardTagIds };
  const empty: TrendInfo = {
    isRecurring: false,
    matchCount: 0,
    threshold: TREND_THRESHOLD,
    windowDays: TREND_WINDOW_DAYS,
    signature,
  };

  // Every signature dimension must be present for a meaningful comparison.
  if (departmentId === null || ataChapterId === null || causeCodeId === null || hazardTagIds.length === 0) {
    return empty;
  }

  const cutoff = new Date(Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const matchCount = await prisma.finding.count({
    where: {
      deletedAt: null,
      departmentId,
      ataChapterId,
      createdAt: { gte: cutoff },
      rca: { causeCodeId },
      hazardTags: { some: { hazardTagId: { in: hazardTagIds } } },
    },
  });

  return {
    isRecurring: matchCount >= TREND_THRESHOLD,
    matchCount,
    threshold: TREND_THRESHOLD,
    windowDays: TREND_WINDOW_DAYS,
    signature,
  };
}
