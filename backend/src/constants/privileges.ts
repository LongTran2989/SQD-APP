// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — Global Privilege Management
//
// Single source of truth for the DB-driven RBAC matrix. `DEFAULT_PRIVILEGES`
// encodes the *exact* hardcoded role behaviour that existed before Phase 7 —
// the seed writes it into `PrivilegeConfig`, and `hasPrivilege` falls back to it
// per-key when a role has no stored value. This guarantees zero behavioural
// change on rollout while making every listed action Admin-configurable.
//
// SCOPE: this matrix governs the *role* dimension of authorization only.
// Relationship grants (issuer / reporter / follow-up assignee / WP-assignment
// bypass), division-scope comparisons, feed transparency, list-query
// visibility, and the `requiresDirectorApproval` safety gate remain hardcoded
// by deliberate design (see CLAUDE_HANDOVER.md §3.4 and the Phase 7 plan).
// ─────────────────────────────────────────────────────────────────────────────

export type RoleName = 'Director' | 'Admin' | 'Manager' | 'Group Leader' | 'Staff';

export const ROLE_NAMES: RoleName[] = ['Director', 'Admin', 'Manager', 'Group Leader', 'Staff'];

export type PrivilegeKey =
  // Tasks
  | 'task:create'
  | 'task:relink_any'
  | 'task:assign_any'
  | 'task:assign_div'
  | 'task:review_any'
  | 'task:review_div'
  | 'task:reopen'
  | 'task:inactivate'
  // Templates
  | 'template:create'
  | 'template:edit'
  | 'template:publish'
  | 'template:delete'
  | 'template:archive'
  | 'template:unarchive'
  | 'template:transfer'
  // Work Packages
  | 'wp:create'
  | 'wp:edit'
  | 'wp:manage_status'
  | 'wp:assign'
  // Findings
  | 'finding:review'
  | 'finding:manage_analysis'
  | 'finding:admin'
  // Analytics
  | 'analytics:view'
  // Users
  | 'user:create'
  | 'user:manage_roles'
  // Escalation
  | 'escalation:review'
  // Time booking
  | 'timebooking:override'
  // Settings
  | 'settings:wptype'
  | 'settings:taxonomy'
  | 'settings:privileges'
  | 'settings:notifications';

export type PrivilegeMap = Partial<Record<PrivilegeKey, boolean>>;

export interface PrivilegeCatalogItem {
  key: PrivilegeKey;
  group: string;
  label: string;
}

// The Admin floor: this privilege can never be revoked from Admin, so the
// Privilege Management panel can never lock everyone out (decision 3).
export const PRIVILEGE_ADMIN_FLOOR: PrivilegeKey[] = ['settings:privileges'];

// Ordered catalog that drives the frontend matrix (rows grouped by domain).
export const PRIVILEGE_CATALOG: PrivilegeCatalogItem[] = [
  { key: 'task:create', group: 'Tasks', label: 'Create tasks' },
  { key: 'task:relink_any', group: 'Tasks', label: 'Re-link any task to a work package' },
  { key: 'task:assign_any', group: 'Tasks', label: 'Assign tasks across any division' },
  { key: 'task:assign_div', group: 'Tasks', label: 'Assign tasks within own division' },
  { key: 'task:review_any', group: 'Tasks', label: 'Review tasks in any division' },
  { key: 'task:review_div', group: 'Tasks', label: 'Review tasks in own division' },
  { key: 'task:reopen', group: 'Tasks', label: 'Re-open closed tasks' },
  { key: 'task:inactivate', group: 'Tasks', label: 'Inactivate / reactivate any task' },

  { key: 'template:create', group: 'Templates', label: 'Create templates' },
  { key: 'template:edit', group: 'Templates', label: 'Edit templates' },
  { key: 'template:publish', group: 'Templates', label: 'Publish templates' },
  { key: 'template:delete', group: 'Templates', label: 'Delete templates' },
  { key: 'template:archive', group: 'Templates', label: 'Archive templates' },
  { key: 'template:unarchive', group: 'Templates', label: 'Unarchive templates' },
  { key: 'template:transfer', group: 'Templates', label: 'Transfer template ownership' },

  { key: 'wp:create', group: 'Work Packages', label: 'Create work packages' },
  { key: 'wp:edit', group: 'Work Packages', label: 'Edit work packages' },
  { key: 'wp:manage_status', group: 'Work Packages', label: 'Change work package status (close/reopen)' },
  { key: 'wp:assign', group: 'Work Packages', label: 'Assign users to work packages' },

  { key: 'finding:review', group: 'Findings', label: 'Review findings (dismiss, severity, close, links)' },
  { key: 'finding:manage_analysis', group: 'Findings', label: 'Manage RCA / CAPA analysis' },
  { key: 'finding:admin', group: 'Findings', label: 'Admin finding ops (view stuck, force-advance)' },

  { key: 'analytics:view', group: 'Analytics', label: 'View analytics dashboards' },

  { key: 'user:create', group: 'Users', label: 'Register new users' },
  { key: 'user:manage_roles', group: 'Users', label: 'Change user roles' },

  { key: 'escalation:review', group: 'Escalation', label: 'Review and action escalations' },

  { key: 'timebooking:override', group: 'Time Booking', label: 'Override another user\'s time booking' },

  { key: 'settings:wptype', group: 'Settings', label: 'Manage work package types' },
  { key: 'settings:taxonomy', group: 'Settings', label: 'Manage reference taxonomies' },
  { key: 'settings:privileges', group: 'Settings', label: 'Manage the privilege matrix' },
  { key: 'settings:notifications', group: 'Settings', label: 'Manage notification event configuration' },
];

export const PRIVILEGE_KEYS: PrivilegeKey[] = PRIVILEGE_CATALOG.map((c) => c.key);

// Helper for building default maps from a list of granted keys.
const grant = (...keys: PrivilegeKey[]): PrivilegeMap => {
  const map: PrivilegeMap = {};
  for (const k of PRIVILEGE_KEYS) map[k] = keys.includes(k);
  return map;
};

// Defaults extracted faithfully from the pre-Phase-7 hardcoded checks.
// NOTE: Admin is NOT a task reviewer and NOT a finding reviewer in the current
// code — preserved exactly (decision 6).
export const DEFAULT_PRIVILEGES: Record<RoleName, PrivilegeMap> = {
  Director: grant(
    'task:create', 'task:relink_any', 'task:assign_any', 'task:review_any', 'task:reopen', 'task:inactivate',
    'template:create', 'template:edit', 'template:publish', 'template:delete', 'template:archive', 'template:unarchive', 'template:transfer',
    'wp:create', 'wp:edit', 'wp:manage_status', 'wp:assign',
    'finding:review', 'finding:manage_analysis', 'finding:admin',
    'analytics:view',
    'user:create',
    'escalation:review',
    'timebooking:override',
    'settings:taxonomy', 'settings:notifications'
  ),
  Admin: grant(
    'task:create', 'task:relink_any', 'task:assign_any', 'task:reopen', 'task:inactivate',
    'template:create', 'template:edit', 'template:publish', 'template:delete', 'template:archive', 'template:unarchive', 'template:transfer',
    'wp:create', 'wp:edit', 'wp:manage_status', 'wp:assign',
    'finding:admin',
    'analytics:view',
    'user:create', 'user:manage_roles',
    'escalation:review',
    'timebooking:override',
    'settings:wptype', 'settings:taxonomy', 'settings:privileges', 'settings:notifications'
  ),
  Manager: grant(
    'task:create', 'task:relink_any', 'task:assign_div', 'task:review_div',
    'template:create', 'template:edit', 'template:publish', 'template:delete', 'template:archive', 'template:unarchive', 'template:transfer',
    'wp:create', 'wp:edit', 'wp:assign',
    'finding:review', 'finding:manage_analysis',
    'analytics:view',
    'escalation:review'
  ),
  'Group Leader': grant(),
  Staff: grant(),
};
