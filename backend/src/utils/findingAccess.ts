import { PrismaClient, Prisma } from '@prisma/client';

// Single source of truth for Finding RBAC, shared by finding.controller and the
// expansion-pack controllers (RCA / CAPA / links).

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface Actor {
  userId: number;
  role: string;
  divisionId: number;
}

export const FINDING_REVIEWER_ROLES = ['Manager', 'Director'];

/**
 * Prisma WHERE fragment scoping a Finding query to a user's visibility.
 *
 * - Director / Admin: everything.
 * - Manager: findings targeted at their division, OR findings their division is
 *   involved in via a follow-up task (the task targets their division, or its
 *   assignee belongs to their division).
 * - Staff / Group Leader: findings they reported, or whose follow-up task they
 *   are individually assigned.
 */
export function buildFindingScope(user: Actor): Prisma.FindingWhereInput {
  const { userId, role, divisionId } = user;
  if (role === 'Director' || role === 'Admin') return {};
  if (role === 'Manager') {
    return {
      OR: [
        { targetDivisionId: divisionId },
        { followUpTasks: { some: { deletedAt: null, targetDivisionId: divisionId } } },
        { followUpTasks: { some: { deletedAt: null, assignedToUser: { is: { divisionId } } } } },
      ],
    };
  }
  return {
    OR: [
      { reportedByUserId: userId },
      { followUpTasks: { some: { assignedToUserId: userId, deletedAt: null } } },
    ],
  };
}

/**
 * Can the user SEE this finding? DB-backed so it uses the same scope fragment as
 * list filtering — no risk of view rules drifting from list rules.
 */
export async function canAccessFinding(client: PrismaLike, user: Actor, findingId: number): Promise<boolean> {
  const found = await client.finding.findFirst({
    where: { AND: [{ id: findingId, deletedAt: null }, buildFindingScope(user)] },
    select: { id: true },
  });
  return !!found;
}

export interface AnalysisFindingShape {
  reportedByUserId: number;
  followUpTasks?: { assignedToUserId: number | null }[];
}

/**
 * Can the user edit analytical data (RCA / CAPA create-edit / Stage 2)?
 * Director, the reporter, any follow-up assignee, or a Manager who has access to
 * the finding (`hasAccess` is the result of canAccessFinding — keeps managers
 * scoped rather than globally privileged). Admin views but does not edit.
 */
export function canEditAnalysis(user: Actor, finding: AnalysisFindingShape, hasAccess: boolean): boolean {
  const { userId, role } = user;
  if (role === 'Director') return true;
  if (finding.reportedByUserId === userId) return true;
  if (finding.followUpTasks?.some((t) => t.assignedToUserId === userId)) return true;
  if (role === 'Manager') return hasAccess;
  return false;
}
