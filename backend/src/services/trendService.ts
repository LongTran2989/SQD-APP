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

export interface TrendSignature {
  findingId: number;
  departmentId: number | null;
  ataChapterId: number | null;
  causeCodeId: number | null;
  hazardTagIds: number[];
}

/**
 * Compute-on-read recurrence detection from an already-known signature. A finding
 * is "recurring" when at least TREND_THRESHOLD non-deleted findings (inclusive of
 * itself) share the SAME Department + ATA Chapter + Cause Code AND at least one
 * common Hazard Tag. The subject finding is always counted regardless of the
 * rolling window, so a long-lived finding still reflects a recurring pattern.
 *
 * Cause Code lives on the finding's RcaInvestigation, so a finding without a
 * determined cause never participates in cause-based grouping. Pure read.
 */
export async function computeTrendForSignature(sig: TrendSignature): Promise<TrendInfo> {
  const { findingId, departmentId, ataChapterId, causeCodeId, hazardTagIds } = sig;
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
      rca: { causeCodeId },
      hazardTags: { some: { hazardTagId: { in: hazardTagIds } } },
      // Count matches within the window, but always include the subject finding
      // itself even if it was raised before the window opened.
      OR: [{ createdAt: { gte: cutoff } }, { id: findingId }],
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

/**
 * Convenience wrapper that loads a finding's signature then computes its trend.
 * Prefer computeTrendForSignature when the caller has already loaded the finding
 * (e.g. getFindingById) to avoid the extra query.
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

  return computeTrendForSignature({
    findingId,
    departmentId: finding?.departmentId ?? null,
    ataChapterId: finding?.ataChapterId ?? null,
    causeCodeId: finding?.rca?.causeCodeId ?? null,
    hazardTagIds: finding?.hazardTags.map((h) => h.hazardTagId) ?? [],
  });
}
