import {
  DEFAULT_PRIVILEGES,
  PRIVILEGE_ADMIN_FLOOR,
  PrivilegeKey,
  PrivilegeMap,
  RoleName,
} from '../constants/privileges';

// Minimal shape needed to resolve a privilege. `permissions` is the live map
// attached to req.user by the auth middleware (read from PrivilegeConfig).
// When absent (e.g. internal service actors that carry only role/division),
// resolution falls back to DEFAULT_PRIVILEGES so behaviour matches the
// pre-Phase-7 hardcoded rules.
export interface PrivilegeActor {
  role: string;
  permissions?: PrivilegeMap | null | undefined;
}

/**
 * Resolve a single privilege for an actor.
 *
 * Order of precedence:
 *  1. Admin floor — un-revokable privileges (e.g. settings:privileges) are
 *     always granted to Admin so the panel can never be locked out.
 *  2. Live `permissions` map (from PrivilegeConfig) if it defines the key.
 *  3. DEFAULT_PRIVILEGES for the role.
 *  4. Deny (fail closed).
 */
export function hasPrivilege(actor: PrivilegeActor | undefined | null, key: PrivilegeKey): boolean {
  if (!actor || !actor.role) return false;

  if (actor.role === 'Admin' && PRIVILEGE_ADMIN_FLOOR.includes(key)) {
    return true;
  }

  const live = actor.permissions?.[key];
  if (typeof live === 'boolean') return live;

  const defaults = DEFAULT_PRIVILEGES[actor.role as RoleName];
  return defaults?.[key] ?? false;
}

/**
 * Single "can act outside my own division" signal, shared by every division-scope
 * guard in the task AND work-package controllers (create / link / assign / status).
 * Global roles (Director, Admin) always have reach; any other role explicitly
 * granted `task:assign_any` does too — so a custom role's cross-division reach is
 * consistent across both domains instead of tasks honouring the privilege while
 * WPs only check the role string. Division-scope stays hardcoded by design
 * (Phase 7 keeps it out of the privilege matrix); this only centralises the check.
 */
export function hasCrossDivisionReach(actor: PrivilegeActor | undefined | null): boolean {
  if (!actor || !actor.role) return false;
  return actor.role === 'Director' || actor.role === 'Admin' || hasPrivilege(actor, 'task:assign_any');
}
