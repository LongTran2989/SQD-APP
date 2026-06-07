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
 * All authenticated users may view all findings — read access is open.
 * Mutation access is enforced separately per endpoint.
 */
export function buildFindingScope(_user: Actor): Prisma.FindingWhereInput {
  return {};
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
 * Can the user edit analytical data (RCA / CAPA create-edit)?
 * Director, the reporter, any follow-up assignee, any user whose task or WP
 * is linked via CapaTaskLink, or a Manager (globally, since visibility is open).
 * Admin views but does not edit.
 *
 * capaLinkedUserIds — optional list of assignedToUserIds drawn from this
 * finding's CapaTaskLink-linked tasks; callers that already load CAPA data
 * derive and pass this to avoid an extra round-trip.
 */
export function canEditAnalysis(
  user: Actor,
  finding: AnalysisFindingShape,
  hasAccess: boolean,
  capaLinkedUserIds?: number[]
): boolean {
  const { userId, role } = user;
  if (role === 'Director') return true;
  if (finding.reportedByUserId === userId) return true;
  if (finding.followUpTasks?.some((t) => t.assignedToUserId === userId)) return true;
  if (capaLinkedUserIds?.includes(userId)) return true;
  if (role === 'Manager') return hasAccess;
  return false;
}
