import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
