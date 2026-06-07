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
  signatureStrength: 'strong' | 'partial' | 'none';
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
 * Computes whether a finding is part of a recurring pattern. Two-tier signature:
 *   strong  — dept + ATA + causeCode + hazardTags all match (hazardTagIds non-empty)
 *   partial — dept + ATA + causeCode match, no hazardTags supplied
 *   none    — any core dimension (dept / ATA / causeCode) is null; returns immediately
 *
 * The subject finding is always counted regardless of the rolling window.
 * Cause code lives on the RcaInvestigation, so a finding without a determined
 * cause never participates in cause-based grouping. Pure read.
 */
export async function computeTrendForSignature(sig: TrendSignature): Promise<TrendInfo> {
  const { findingId, departmentId, ataChapterId, causeCodeId, hazardTagIds } = sig;
  const signature = { departmentId, ataChapterId, causeCodeId, hazardTagIds };
  const empty: TrendInfo = {
    isRecurring: false,
    matchCount: 0,
    threshold: TREND_THRESHOLD,
    windowDays: TREND_WINDOW_DAYS,
    signatureStrength: 'none',
    signature,
  };

  // Core dimensions must all be resolved for any trend comparison.
  if (departmentId === null || ataChapterId === null || causeCodeId === null) {
    return empty;
  }

  const cutoff = new Date(Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const baseWhere = {
    deletedAt: null,
    departmentId,
    ataChapterId,
    rca: { causeCodeId },
    // Count matches within the window, but always include the subject finding
    // itself even if it was raised before the window opened.
    OR: [{ createdAt: { gte: cutoff } }, { id: findingId }],
  };

  let matchCount: number;
  let signatureStrength: TrendInfo['signatureStrength'];

  if (hazardTagIds.length > 0) {
    // Strong signature: all four dimensions match.
    matchCount = await prisma.finding.count({
      where: { ...baseWhere, hazardTags: { some: { hazardTagId: { in: hazardTagIds } } } },
    });
    signatureStrength = 'strong';
  } else {
    // Partial signature: department + ATA + cause code only (no hazard tags to narrow).
    matchCount = await prisma.finding.count({ where: baseWhere });
    signatureStrength = 'partial';
  }

  return {
    isRecurring: matchCount >= TREND_THRESHOLD,
    matchCount,
    threshold: TREND_THRESHOLD,
    windowDays: TREND_WINDOW_DAYS,
    signatureStrength,
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
