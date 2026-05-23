import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export interface AuthPayload {
  userId: number;
  role: string;
  divisionId: number;
  forcePasswordChange?: boolean;
  sessionId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const authenticateJWT = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ message: 'Unauthorized: Malformed token' });
      return;
    }

    const secret = (process.env.JWT_SECRET || 'fallback_secret') as string;
    
    jwt.verify(token, secret, async (err, decoded) => {
      if (err) {
        res.status(401).json({ message: 'Unauthorized: Invalid token' });
        return;
      }
      const authPayload = decoded as AuthPayload;
      
      // Enforce password change policy
      if (authPayload.forcePasswordChange && req.path !== '/update-password') {
        res.status(403).json({ message: 'Forbidden: Password change required' });
        return;
      }
      
      try {
        // Enforce Single Session Policy
        const enforceSetting = await prisma.systemSetting.findUnique({
          where: { key: 'ENFORCE_SINGLE_SESSION' }
        });

        // Default to ON if setting is missing or true
        const isEnforced = !enforceSetting || enforceSetting.value === 'true';

        if (isEnforced) {
          const user = await prisma.user.findUnique({
            where: { id: authPayload.userId, deletedAt: null },
            select: { activeSessionId: true }
          });

          if (!user || user.activeSessionId !== authPayload.sessionId) {
            res.status(401).json({ message: 'Session expired. You logged in from another location.' });
            return;
          }
        }
      } catch (dbErr) {
        console.error('Session validation error:', dbErr);
        res.status(500).json({ message: 'Internal server error during session validation' });
        return;
      }

      req.user = authPayload;
      next();
    });
  } else {
    res.status(401).json({ message: 'Unauthorized: No token provided' });
  }
};
