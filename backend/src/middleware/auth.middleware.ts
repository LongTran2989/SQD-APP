import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { JWT_SECRET } from '../config/env';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// The only route a forced-password-change user may reach (relative to the
// /api/auth router mount). Kept as a named constant rather than a bare string
// compare scattered in the gate.
const UPDATE_PASSWORD_PATH = '/update-password';

export interface AuthPayload {
  userId: number;
  role: string;
  divisionId: number;
  forcePasswordChange?: boolean;
  sessionId?: string;
  // Phase 7 — live role permission map from PrivilegeConfig (resolved per request,
  // never carried in the JWT so it can't go stale). Undefined falls back to defaults.
  permissions?: Record<string, boolean> | null | undefined;
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

  // Prefer the Authorization header (API/header clients, test suite); fall back
  // to the httpOnly auth cookie (browser clients). The header value, once
  // present, must be well-formed.
  let token: string | undefined;
  if (authHeader) {
    token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ message: 'Unauthorized: Malformed token' });
      return;
    }
  } else {
    token = (req as Request & { cookies?: Record<string, string> }).cookies?.token;
  }

  if (token) {
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        res.status(401).json({ message: 'Unauthorized: Invalid token' });
        return;
      }
      const authPayload = decoded as AuthPayload;

      // Enforce password change policy
      if (authPayload.forcePasswordChange && req.path !== UPDATE_PASSWORD_PATH) {
        res.status(403).json({ message: 'Forbidden: Password change required' });
        return;
      }

      try {
        const enforceSetting = await prisma.systemSetting.findUnique({
          where: { key: 'ENFORCE_SINGLE_SESSION' }
        });

        // Default to ON if setting is missing or true
        const isEnforced = !enforceSetting || enforceSetting.value === 'true';

        // Always revalidate the account against the DB — independent of the
        // single-session toggle — so a soft-deleted / disabled user cannot keep
        // riding a still-valid token, and so authorization claims are never
        // trusted from a (up-to-1-day-stale) token. Single-session comparison
        // stays behind the toggle so test JWTs without a session still work.
        const user = await prisma.user.findUnique({
          where: { id: authPayload.userId, deletedAt: null },
          select: {
            activeSessionId: true,
            divisionId: true,
            role: {
              select: {
                name: true,
                privilegeConfig: { select: { permissions: true } }
              }
            }
          }
        });

        if (!user) {
          res.status(401).json({ message: 'Unauthorized: account is no longer active' });
          return;
        }

        if (isEnforced && user.activeSessionId !== authPayload.sessionId) {
          res.status(401).json({ message: 'Session expired. You logged in from another location.' });
          return;
        }

        // DB is the source of truth for authorization claims (role/division/permissions).
        authPayload.role = user.role.name;
        authPayload.divisionId = user.divisionId;
        authPayload.permissions =
          (user.role.privilegeConfig?.permissions as Record<string, boolean> | undefined) ?? null;
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
