import { PrismaClient, Prisma } from '@prisma/client';
import { createFeedPost, FeedScope } from './feedService';
import { hasPrivilege } from '../utils/privilegeAccess';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Scope hierarchy. A comment may only be escalated UPWARD: the ESCALATION_CARD
 * lands at the target scope, and an INFO_CARD lands at every level strictly
 * between the origin and the target. This single rule reproduces the whole
 * placement matrix:
 *   Task→WP, WP→Division, Task→Division (info@WP), WP→Org (info@Division),
 *   Task→Org (info@WP + info@Division), Division→Org.
 */
export const SCOPE_LEVEL: Record<FeedScope, number> = { TASK: 0, WP: 1, DIVISION: 2, ORG: 3 };

// A flag may target WP / DIVISION / ORG only — TASK is the floor, never a target.
export type EscalationTargetScope = 'WP' | 'DIVISION' | 'ORG';
export const ESCALATION_TARGET_SCOPES: EscalationTargetScope[] = ['WP', 'DIVISION', 'ORG'];

export function isEscalationTargetScope(value: string): value is EscalationTargetScope {
  return (ESCALATION_TARGET_SCOPES as string[]).includes(value);
}

export const EXCERPT_MAX = 160;

/** A short, link-friendly snippet of a flagged comment — NEVER the full text. */
export function buildExcerpt(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= EXCERPT_MAX) return trimmed;
  return trimmed.slice(0, EXCERPT_MAX).trimEnd() + '…';
}

// ─── Actionable-flag RBAC (one source of truth) ──────────────────────────────
// Shared by GET /api/escalations (the bell queue) and POST /escalations/:id/action.
// Director/Admin → any flag; Manager → all ORG flags + own-division WP/DIVISION
// flags; Group Leader / Staff → none (they still SEE cards via feed transparency).

// A flag's actionability depends on its division, which is denormalised on its
// ESCALATION_CARD: for a DIVISION target the card's scopeId IS the division; for
// a WP target the division is the WorkPackage's. Resolves to null for ORG.
export async function resolveFlagDivision(
  client: PrismaLike,
  flag: { targetScope: string; cards: { scope: string; scopeId: number | null }[] }
): Promise<number | null> {
  if (flag.targetScope === 'ORG') return null;
  // Callers pass the flag's single ESCALATION_CARD (one per flag, at the target).
  const card = flag.cards[0];
  if (!card || card.scopeId == null) return null;
  if (flag.targetScope === 'DIVISION') return card.scopeId;
  if (flag.targetScope === 'WP') {
    const wp = await client.workPackage.findUnique({
      where: { id: card.scopeId, deletedAt: null },
      select: { divisionId: true },
    });
    return wp?.divisionId ?? null;
  }
  return null;
}

// Pure predicate: can this user action a flag, given the flag's resolved division?
export function canActionFlag(
  user: { role: string; divisionId: number; permissions?: Record<string, boolean> | null | undefined },
  flag: { targetScope: string; divisionId: number | null }
): boolean {
  if (user.role === 'Director' || user.role === 'Admin') return true; // cross-division reach (scope, hardcoded)
  // Role eligibility is privilege-driven (Phase 7); default grants Manager.
  if (!hasPrivilege(user, 'escalation:review')) return false;
  if (flag.targetScope === 'ORG') return true; // any reviewer may action Org flags
  return flag.divisionId != null && flag.divisionId === user.divisionId;
}

// Resolved placement context for a flagged comment's origin feed.
export interface EscalationOrigin {
  originScope: FeedScope;    // TASK | WP | DIVISION (ORG can't escalate)
  taskId: number | null;     // denormalised deep-link (TASK origin only)
  wpId: number | null;       // WP context: task.wpId, or the WP origin's own id
  divisionId: number | null; // division context: task.targetDivisionId / wp.divisionId / the division origin id
}

const SCOPE_LABEL: Record<FeedScope, string> = {
  TASK: 'a task',
  WP: 'a work package',
  DIVISION: 'a division',
  ORG: 'the organisation',
};

const TARGET_LABEL: Record<EscalationTargetScope, string> = {
  WP: 'the Work Package',
  DIVISION: 'the Division Board',
  ORG: 'the Org Feed',
};

/**
 * Resolves the placement context for a flagged comment from its source feed.
 * scopeId is polymorphic (taskId / wpId / divisionId); the referenced entity is
 * looked up (soft-delete aware for Task / WP). Returns an error when the origin
 * is missing or cannot escalate.
 */
export async function resolveEscalationOrigin(
  client: PrismaLike,
  sourcePost: { scope: string; scopeId: number | null }
): Promise<{ ok: true; origin: EscalationOrigin } | { ok: false; status: number; message: string }> {
  const scope = sourcePost.scope as FeedScope;

  if (scope === 'TASK') {
    if (sourcePost.scopeId == null) return { ok: false, status: 400, message: 'Source task is missing.' };
    const task = await client.task.findUnique({
      where: { id: sourcePost.scopeId, deletedAt: null },
      select: { id: true, wpId: true, targetDivisionId: true },
    });
    if (!task) return { ok: false, status: 404, message: 'Source task not found.' };
    return { ok: true, origin: { originScope: 'TASK', taskId: task.id, wpId: task.wpId, divisionId: task.targetDivisionId } };
  }

  if (scope === 'WP') {
    if (sourcePost.scopeId == null) return { ok: false, status: 400, message: 'Source work package is missing.' };
    const wp = await client.workPackage.findUnique({
      where: { id: sourcePost.scopeId, deletedAt: null },
      select: { id: true, divisionId: true },
    });
    if (!wp) return { ok: false, status: 404, message: 'Source work package not found.' };
    return { ok: true, origin: { originScope: 'WP', taskId: null, wpId: wp.id, divisionId: wp.divisionId } };
  }

  if (scope === 'DIVISION') {
    if (sourcePost.scopeId == null) return { ok: false, status: 400, message: 'Source division is missing.' };
    const division = await client.division.findUnique({ where: { id: sourcePost.scopeId }, select: { id: true } });
    if (!division) return { ok: false, status: 404, message: 'Source division not found.' };
    return { ok: true, origin: { originScope: 'DIVISION', taskId: null, wpId: null, divisionId: division.id } };
  }

  return { ok: false, status: 400, message: 'Org-level comments cannot be escalated further.' };
}

// Maps a hierarchy level to its concrete feed scope + scopeId for this origin.
// Returns null when there is no feed at that level (e.g. a task with no WP) so
// the corresponding info-card is skipped gracefully.
function placementForLevel(level: number, origin: EscalationOrigin): { scope: FeedScope; scopeId: number | null } | null {
  switch (level) {
    case SCOPE_LEVEL.WP:
      return origin.wpId == null ? null : { scope: 'WP', scopeId: origin.wpId };
    case SCOPE_LEVEL.DIVISION:
      return origin.divisionId == null ? null : { scope: 'DIVISION', scopeId: origin.divisionId };
    case SCOPE_LEVEL.ORG:
      return { scope: 'ORG', scopeId: null };
    default:
      return null; // TASK level is never a card target
  }
}

/**
 * Encodes the ENTIRE escalation placement matrix in one place. Writes an
 * ESCALATION_CARD at the target scope and an INFO_CARD at every skipped level
 * between the origin and the target. Every card carries only an excerpt +
 * denormalised deep-link fields (sourceTaskId / sourceWpId / flagId) — never a
 * copy of the full source text (spec non-negotiable #3).
 */
export async function placeEscalationCards(
  client: PrismaLike,
  args: {
    flag: { id: number; targetScope: string };
    sourcePost: { id: number; content: string };
    origin: EscalationOrigin;
    flaggedByName: string;
  }
) {
  const { flag, sourcePost, origin, flaggedByName } = args;
  const targetScope = flag.targetScope as EscalationTargetScope;
  const originLevel = SCOPE_LEVEL[origin.originScope];
  const targetLevel = SCOPE_LEVEL[targetScope];
  const excerpt = buildExcerpt(sourcePost.content);
  const originLabel = SCOPE_LABEL[origin.originScope];
  const targetLabel = TARGET_LABEL[targetScope];

  const cards = [];
  for (let level = originLevel + 1; level <= targetLevel; level++) {
    const placement = placementForLevel(level, origin);
    if (!placement) continue; // no feed at this level (e.g. task with no WP) — skip
    const isTarget = level === targetLevel;
    const content = isTarget
      ? `Escalation from ${originLabel}, raised by ${flaggedByName}.`
      : `For awareness: an escalation from ${originLabel} was raised to ${targetLabel} by ${flaggedByName}.`;
    const card = await createFeedPost(client, {
      type: isTarget ? 'ESCALATION_CARD' : 'INFO_CARD',
      scope: placement.scope,
      scopeId: placement.scopeId,
      content,
      authorId: null,
      sourcePostId: sourcePost.id,
      sourceExcerpt: excerpt,
      sourceTaskId: origin.taskId,
      sourceWpId: origin.wpId,
      flagId: flag.id,
    });
    cards.push(card);
  }
  return cards;
}
