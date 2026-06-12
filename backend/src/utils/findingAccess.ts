import { PrismaClient, Prisma } from '@prisma/client';
import { hasPrivilege } from './privilegeAccess';

// Single source of truth for Finding RBAC, shared by finding.controller and the
// expansion-pack controllers (RCA / CAPA / links).

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface Actor {
  userId: number;
  role: string;
  divisionId: number;
  permissions?: Record<string, boolean> | null | undefined;
}

/**
 * Is this actor a finding reviewer? Privilege-driven (Phase 7); default grants
 * Manager + Director (Admin excluded, as before).
 */
export function isFindingReviewer(actor: { role: string; permissions?: Record<string, boolean> | null | undefined }): boolean {
  return hasPrivilege(actor, 'finding:review');
}

/**
 * Prisma WHERE fragment scoping a Finding *read* query to a user's visibility.
 *
 * INTENTIONALLY returns `{}` (no filter): read access to findings is open to
 * every authenticated user by deliberate policy — see CLAUDE_HANDOVER.md
 * (Finding Response Actions) and FINDING_WORKFLOW.md §RBAC. This is NOT a stub.
 * Do NOT assume this enforces role/division scoping — it does not. Mutation
 * access is gated per endpoint via `assertManagerDivisionScope`. If a future
 * policy narrows read visibility, encode the rule here so list and detail
 * endpoints stay in lockstep.
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
 * managerMayEdit — pass `true` to grant Managers edit access (the current
 * default since all findings are globally visible). Pass `false` only if a
 * future policy restricts Manager editing to a specific scope.
 *
 * capaLinkedUserIds — optional list of assignedToUserIds drawn from this
 * finding's CapaTaskLink-linked tasks; callers that already load CAPA data
 * derive and pass this to avoid an extra round-trip.
 */
export function canEditAnalysis(
  user: Actor,
  finding: AnalysisFindingShape,
  managerMayEdit: boolean,
  capaLinkedUserIds?: number[]
): boolean {
  const { userId, role } = user;
  // Relationship grants — always allowed regardless of role privileges.
  if (finding.reportedByUserId === userId) return true;
  if (finding.followUpTasks?.some((t) => t.assignedToUserId === userId)) return true;
  if (capaLinkedUserIds?.includes(userId)) return true;
  // Role dimension — privilege-driven (Phase 7). Managers are additionally
  // gated by the caller-supplied managerMayEdit scope flag.
  if (hasPrivilege(user, 'finding:manage_analysis')) {
    if (role === 'Manager') return managerMayEdit;
    return true;
  }
  return false;
}

/**
 * Division-scope gate for Manager mutations (dismiss, severity, taxonomy,
 * finding links). Returns true immediately for Directors (global access).
 * Managers pass only when the finding is associated with their division via
 * targetDivisionId, a follow-up task's division, or a follow-up assignee's division.
 */
export async function assertManagerDivisionScope(
  client: PrismaLike,
  user: Actor,
  findingId: number,
): Promise<boolean> {
  if (user.role !== 'Manager') return true;
  const found = await client.finding.findFirst({
    where: {
      id: findingId,
      deletedAt: null,
      OR: [
        { targetDivisionId: user.divisionId },
        { followUpTasks: { some: { deletedAt: null, targetDivisionId: user.divisionId } } },
        { followUpTasks: { some: { deletedAt: null, assignedToUser: { is: { divisionId: user.divisionId } } } } },
      ],
    },
    select: { id: true },
  });
  return !!found;
}

/**
 * Extracts the assignedToUserIds of all Tasks linked to a finding's CAPA
 * actions via CapaTaskLink. Used to grant edit rights to task assignees.
 */
export function extractCapaLinkedUserIds(
  capaActions: {
    linkedItems: { task: { assignedToUserId: number | null } | null }[];
  }[]
): number[] {
  return capaActions
    .flatMap((c) => c.linkedItems)
    .map((l) => l.task?.assignedToUserId)
    .filter((id): id is number => id != null);
}
