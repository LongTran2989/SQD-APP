import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// The single security policy currently exposed to Admins. Stored as a string
// SystemSetting (the auth middleware reads the same key); default ON when unset.
const ENFORCE_SINGLE_SESSION_KEY = 'ENFORCE_SINGLE_SESSION';

export const getSecuritySettings = async (_req: Request, res: Response): Promise<void> => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: ENFORCE_SINGLE_SESSION_KEY } });
    // Default to ON when the row is missing or 'true' — matches auth.middleware.
    const enforceSingleSession = !setting || setting.value === 'true';
    res.json({ enforceSingleSession });
  } catch (error) {
    console.error('Get security settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updateSecuritySettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { enforceSingleSession } = req.body;
    if (typeof enforceSingleSession !== 'boolean') {
      res.status(400).json({ message: 'enforceSingleSession (boolean) is required' });
      return;
    }

    const value = enforceSingleSession ? 'true' : 'false';
    await prisma.systemSetting.upsert({
      where: { key: ENFORCE_SINGLE_SESSION_KEY },
      update: { value },
      create: {
        key: ENFORCE_SINGLE_SESSION_KEY,
        value,
        description: "When true, a new login revokes the user's other active session (single active session per user)."
      }
    });

    // Compliance: record who changed a security policy and to what value.
    await prisma.auditLog.create({
      data: {
        actionType: 'SECURITY_SETTING_CHANGED',
        entityType: 'SystemSetting',
        entityId: ENFORCE_SINGLE_SESSION_KEY,
        performedByUserId: req.user!.userId,
        details: { enforceSingleSession } as Prisma.InputJsonValue
      }
    });

    res.json({ enforceSingleSession });
  } catch (error) {
    console.error('Update security settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
