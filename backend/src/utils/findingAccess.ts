// Shared Finding RBAC helpers for the expansion-pack controllers (RCA / CAPA /
// links). Mirrors buildFindingScope / canViewFinding in finding.controller.ts.

export interface Actor {
  userId: number;
  role: string;
  divisionId: number;
}

export interface FindingAccessShape {
  targetDivisionId: number | null;
  reportedByUserId: number;
  followUpTasks?: { assignedToUserId: number | null }[];
}

/** Can the user SEE this finding? Mirrors finding.controller.canViewFinding. */
export function canViewFinding(user: Actor, finding: FindingAccessShape): boolean {
  const { userId, role, divisionId } = user;
  if (role === 'Director' || role === 'Admin') return true;
  if (role === 'Manager') return finding.targetDivisionId === divisionId;
  if (finding.reportedByUserId === userId) return true;
  return finding.followUpTasks?.some((t) => t.assignedToUserId === userId) ?? false;
}

/**
 * Can the user edit analytical data (RCA, CAPA create/edit, Stage 2)?
 * Reporter, any follow-up Task assignee, Manager, or Director.
 */
export function canEditAnalysis(user: Actor, finding: FindingAccessShape): boolean {
  const { userId, role } = user;
  if (role === 'Manager' || role === 'Director') return true;
  if (finding.reportedByUserId === userId) return true;
  return finding.followUpTasks?.some((t) => t.assignedToUserId === userId) ?? false;
}

export const FINDING_REVIEWER_ROLES = ['Manager', 'Director'];
