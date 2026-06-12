import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  PRIVILEGE_CATALOG,
  PRIVILEGE_KEYS,
  PRIVILEGE_ADMIN_FLOOR,
  ROLE_NAMES,
  DEFAULT_PRIVILEGES,
  PrivilegeKey,
  PrivilegeMap,
  RoleName,
} from '../constants/privileges';

import { prisma } from '../lib/prisma';

// Build the effective permission map for a role: stored config (if any) layered
// over the role defaults, with the Admin floor forced on. This is what the UI
// renders and what callers resolve against.
function effectiveMap(roleName: string, stored: PrivilegeMap | null | undefined): Record<PrivilegeKey, boolean> {
  const defaults = DEFAULT_PRIVILEGES[roleName as RoleName] ?? {};
  const result = {} as Record<PrivilegeKey, boolean>;
  for (const key of PRIVILEGE_KEYS) {
    const live = stored?.[key];
    result[key] = typeof live === 'boolean' ? live : (defaults[key] ?? false);
  }
  if (roleName === 'Admin') {
    for (const key of PRIVILEGE_ADMIN_FLOOR) result[key] = true;
  }
  return result;
}

// ─── GET /api/settings/privileges ─────────────────────────────────────────────
// Returns the catalog plus each role's effective permission map.
export const getPrivileges = async (_req: Request, res: Response): Promise<void> => {
  try {
    const roles = await prisma.role.findMany({
      where: { name: { in: ROLE_NAMES } },
      select: { id: true, name: true, privilegeConfig: { select: { permissions: true } } },
    });
    const byName = new Map(roles.map((r) => [r.name, r]));

    const result = ROLE_NAMES.map((name) => {
      const stored = byName.get(name)?.privilegeConfig?.permissions as PrivilegeMap | undefined;
      return { roleName: name, permissions: effectiveMap(name, stored) };
    });

    res.json({ catalog: PRIVILEGE_CATALOG, roles: result });
  } catch (error) {
    console.error('Error fetching privileges:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/settings/privileges ─────────────────────────────────────────────
// Atomically replaces the privilege matrix. Admin-only (route-guarded).
// Body: { roles: [{ roleName, permissions: { <key>: boolean, ... } }, ...] }
export const updatePrivileges = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.user!;
    const body = req.body as { roles?: Array<{ roleName?: string; permissions?: Record<string, unknown> }> };

    if (!body || !Array.isArray(body.roles) || body.roles.length === 0) {
      res.status(400).json({ message: 'Request body must include a non-empty "roles" array.' });
      return;
    }

    // Validate every entry up-front so the write is all-or-nothing.
    const sanitized: Array<{ roleName: RoleName; permissions: Record<PrivilegeKey, boolean> }> = [];
    for (const entry of body.roles) {
      const roleName = entry.roleName;
      if (!roleName || !ROLE_NAMES.includes(roleName as RoleName)) {
        res.status(400).json({ message: `Invalid or unknown role: ${roleName}` });
        return;
      }
      if (!entry.permissions || typeof entry.permissions !== 'object') {
        res.status(400).json({ message: `Missing permissions map for role ${roleName}` });
        return;
      }
      const perms = {} as Record<PrivilegeKey, boolean>;
      for (const [key, value] of Object.entries(entry.permissions)) {
        if (!PRIVILEGE_KEYS.includes(key as PrivilegeKey)) {
          res.status(400).json({ message: `Unknown privilege key: ${key}` });
          return;
        }
        if (typeof value !== 'boolean') {
          res.status(400).json({ message: `Privilege "${key}" for role ${roleName} must be a boolean` });
          return;
        }
        perms[key as PrivilegeKey] = value;
      }
      // Fill any unspecified keys from the role's current default so a partial
      // payload never silently drops a privilege to false.
      const defaults = DEFAULT_PRIVILEGES[roleName as RoleName] ?? {};
      for (const key of PRIVILEGE_KEYS) {
        if (!(key in perms)) perms[key] = defaults[key] ?? false;
      }
      // Admin floor — these can never be revoked from Admin.
      if (roleName === 'Admin') {
        for (const key of PRIVILEGE_ADMIN_FLOOR) perms[key] = true;
      }
      sanitized.push({ roleName: roleName as RoleName, permissions: perms });
    }

    // Lockout protection is provided by the Admin floor (settings:privileges is
    // always forced on for Admin above), so the panel can never be orphaned —
    // no additional "at least one role" guard is needed.

    // Resolve role ids and capture the prior state for the audit diff.
    const roles = await prisma.role.findMany({
      where: { name: { in: sanitized.map((s) => s.roleName) } },
      select: { id: true, name: true, privilegeConfig: { select: { permissions: true } } },
    });
    const roleByName = new Map(roles.map((r) => [r.name, r]));

    for (const s of sanitized) {
      if (!roleByName.has(s.roleName)) {
        res.status(400).json({ message: `Role not found in database: ${s.roleName}` });
        return;
      }
    }

    // Build a compact diff of what actually changed (effective before vs after).
    const before: Record<string, Record<PrivilegeKey, boolean>> = {};
    const after: Record<string, Record<PrivilegeKey, boolean>> = {};
    const changedKeys: Array<{ role: string; key: PrivilegeKey; from: boolean; to: boolean }> = [];
    for (const s of sanitized) {
      const stored = roleByName.get(s.roleName)?.privilegeConfig?.permissions as PrivilegeMap | undefined;
      const prevEffective = effectiveMap(s.roleName, stored);
      before[s.roleName] = prevEffective;
      after[s.roleName] = s.permissions;
      for (const key of PRIVILEGE_KEYS) {
        if (prevEffective[key] !== s.permissions[key]) {
          changedKeys.push({ role: s.roleName, key, from: prevEffective[key], to: s.permissions[key] });
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const s of sanitized) {
        const roleId = roleByName.get(s.roleName)!.id;
        await tx.privilegeConfig.upsert({
          where: { roleId },
          update: { permissions: s.permissions },
          create: { roleId, permissions: s.permissions },
        });
      }
      // Compliance trail (Rule 3 — AuditLog only; privilege changes are not
      // task-scoped, so no FeedPost dual-write applies).
      await tx.auditLog.create({
        data: {
          actionType: 'PRIVILEGE_CONFIG_UPDATED',
          entityType: 'PrivilegeConfig',
          entityId: 'ALL',
          performedByUserId: userId,
          details: { changedKeys, before, after } as any,
        },
      });
    });

    res.json({
      message: 'Privileges updated successfully',
      changedCount: changedKeys.length,
      roles: sanitized.map((s) => ({ roleName: s.roleName, permissions: s.permissions })),
    });
  } catch (error) {
    console.error('Error updating privileges:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
