import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { hasPrivilege } from '../utils/privilegeAccess';
import { prisma } from '../lib/prisma';

const DEFAULT_PASSWORD = 'Abc@123';
const BCRYPT_ROUNDS = 10;

// Fields returned in all user list/detail responses — never expose passwordHash.
const USER_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  email: true,
  phone: true,
  forcePasswordChange: true,
  divisionId: true,
  division: { select: { id: true, name: true, code: true } },
  roleId: true,
  role: { select: { id: true, name: true } },
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─── GET /api/users ────────────────────────────────────────────────────────────
export const listUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!hasPrivilege(req.user!, 'user:create') && !hasPrivilege(req.user!, 'user:manage_roles')) {
      res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const q = (req.query.q as string | undefined)?.trim() || '';
    const roleFilter = req.query.role as string | undefined;
    const divisionFilter = req.query.divisionId ? parseInt(req.query.divisionId as string, 10) : undefined;
    const includeDeleted = req.query.includeDeleted === 'true';

    const where: Record<string, unknown> = {};

    if (!includeDeleted) {
      where.deletedAt = null;
    }

    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { employeeId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (roleFilter) {
      where.role = { name: roleFilter };
    }

    if (divisionFilter && !isNaN(divisionFilter)) {
      where.divisionId = divisionFilter;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [{ deletedAt: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── POST /api/users ───────────────────────────────────────────────────────────
export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employeeId, name, email, phone, roleName, divisionId } = req.body;

    if (typeof name !== 'string' || !name.trim() || !roleName || !divisionId) {
      res.status(400).json({ message: 'name, roleName, and divisionId are required' });
      return;
    }

    const divId = parseInt(divisionId, 10);
    if (isNaN(divId)) {
      res.status(400).json({ message: 'divisionId must be a number' });
      return;
    }

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      res.status(400).json({ message: `Invalid role: ${roleName}` });
      return;
    }

    const division = await prisma.division.findUnique({ where: { id: divId } });
    if (!division) {
      res.status(400).json({ message: 'Invalid division' });
      return;
    }

    // Uniqueness guards for optional identifiers.
    if (employeeId) {
      const existing = await prisma.user.findUnique({ where: { employeeId } });
      if (existing) {
        res.status(400).json({ message: `Employee ID "${employeeId}" is already in use` });
        return;
      }
    }

    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        res.status(400).json({ message: `Email "${email}" is already in use` });
        return;
      }
    }

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        employeeId: employeeId || null,
        name: name.trim(),
        email: email || null,
        phone: phone || null,
        passwordHash,
        forcePasswordChange: true,
        divisionId: divId,
        roleId: role.id,
      },
      select: USER_SELECT,
    });

    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/users/:id ────────────────────────────────────────────────────────
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) {
      res.status(400).json({ message: 'Invalid user ID' });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!target) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const { name, employeeId, email, phone, roleName, divisionId } = req.body;

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ message: 'name must be a non-empty string' });
        return;
      }
      updateData.name = name.trim();
    }
    if (phone !== undefined) updateData.phone = phone || null;

    if (employeeId !== undefined) {
      if (employeeId && employeeId !== target.employeeId) {
        const conflict = await prisma.user.findUnique({ where: { employeeId } });
        if (conflict) {
          res.status(400).json({ message: `Employee ID "${employeeId}" is already in use` });
          return;
        }
      }
      updateData.employeeId = employeeId || null;
    }

    if (email !== undefined) {
      if (email && email !== target.email) {
        const conflict = await prisma.user.findUnique({ where: { email } });
        if (conflict) {
          res.status(400).json({ message: `Email "${email}" is already in use` });
          return;
        }
      }
      updateData.email = email || null;
    }

    if (roleName !== undefined) {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) {
        res.status(400).json({ message: `Invalid role: ${roleName}` });
        return;
      }
      updateData.roleId = role.id;
    }

    if (divisionId !== undefined) {
      const divId = parseInt(divisionId, 10);
      if (isNaN(divId)) {
        res.status(400).json({ message: 'divisionId must be a number' });
        return;
      }
      const division = await prisma.division.findUnique({ where: { id: divId } });
      if (!division) {
        res.status(400).json({ message: 'Invalid division' });
        return;
      }
      updateData.divisionId = divId;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: USER_SELECT,
    });

    res.json({ message: 'User updated successfully', user: updated });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── DELETE /api/users/:id ─────────────────────────────────────────────────────
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) {
      res.status(400).json({ message: 'Invalid user ID' });
      return;
    }

    if (userId === req.user!.userId) {
      res.status(400).json({ message: 'You cannot delete your own account' });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!target) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PATCH /api/users/me/password ─────────────────────────────────────────────
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ message: 'currentPassword and newPassword are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ message: 'New password must be at least 6 characters' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { passwordHash: true },
    });
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatch) {
      res.status(400).json({ message: 'Current password is incorrect' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Revoke any active server-side session so tokens issued before the password
    // change can no longer be used. The caller must re-authenticate.
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, forcePasswordChange: false, activeSessionId: null },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PATCH /api/users/:id/reset-password ──────────────────────────────────────
export const adminResetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) {
      res.status(400).json({ message: 'Invalid user ID' });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
    if (!target) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

    // Revoke the target user's active session so any token they currently hold
    // is invalidated alongside the password reset.
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, forcePasswordChange: true, activeSessionId: null },
    });

    res.json({ message: 'Password reset to default successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    const { roleName } = req.body;

    if (isNaN(userId) || !roleName) {
      res.status(400).json({ message: 'User ID and roleName are required' });
      return;
    }

    // Guard: ensure the target user exists and is not soft-deleted
    const targetUser = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null }
    });
    if (!targetUser) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      res.status(400).json({ message: 'Invalid role provided' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { roleId: role.id },
      select: {
        id: true,
        name: true,
        employeeId: true,
        role: true,
        divisionId: true
      }
    });

    res.json({ message: 'User privileges updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Error updating user privileges:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PATCH /api/users/me/profile ──────────────────────────────────────────────
export const updateMyProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { email, phone } = req.body;

    const updateData: Record<string, unknown> = {};

    if (email !== undefined) {
      if (email !== null && email !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          res.status(400).json({ message: 'Invalid email format' });
          return;
        }
        const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (email !== current?.email) {
          const conflict = await prisma.user.findUnique({ where: { email } });
          if (conflict) {
            res.status(400).json({ message: `Email "${email}" is already in use` });
            return;
          }
        }
        updateData.email = email;
      } else {
        updateData.email = null;
      }
    }

    if (phone !== undefined) {
      if (phone !== null && phone !== '') {
        if (!/^\d{1,12}$/.test(phone)) {
          res.status(400).json({ message: 'Phone must contain digits only and be at most 12 digits' });
          return;
        }
        updateData.phone = phone;
      } else {
        updateData.phone = null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ message: 'No fields to update' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId, deletedAt: null },
      data: updateData,
      select: { id: true, email: true, phone: true },
    });

    res.json({ message: 'Profile updated successfully', user: updated });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Top-level keys the client is allowed to persist in User.preferences.
const ALLOWED_PREFERENCE_KEYS = ['taskColumns', 'taskFilters'] as const;
// Hard cap on the serialized preferences blob (defensive — it is user-controlled).
const MAX_PREFERENCES_BYTES = 16 * 1024;

// ─── PATCH /api/users/me/preferences ──────────────────────────────────────────
// Deep-merges an allowlisted subset of UI state into the caller's own preferences.
export const updateMyPreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const incoming = req.body?.preferences;

    if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
      res.status(400).json({ message: 'preferences must be an object' });
      return;
    }

    // Reject any key outside the allowlist — never store arbitrary client JSON.
    const unknownKeys = Object.keys(incoming).filter((k) => !(ALLOWED_PREFERENCE_KEYS as readonly string[]).includes(k));
    if (unknownKeys.length > 0) {
      res.status(400).json({ message: `Unsupported preference keys: ${unknownKeys.join(', ')}` });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { preferences: true }
    });
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Shallow merge at the top allowlisted level (each key is replaced wholesale,
    // so saving one device's column prefs never clobbers another key's value).
    const current = (user.preferences && typeof user.preferences === 'object' && !Array.isArray(user.preferences))
      ? (user.preferences as Record<string, unknown>)
      : {};
    const merged = { ...current, ...incoming };

    if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > MAX_PREFERENCES_BYTES) {
      res.status(413).json({ message: 'preferences payload too large' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { preferences: merged },
      select: { preferences: true }
    });

    res.json({ preferences: updated.preferences });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
