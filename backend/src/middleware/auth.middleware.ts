import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { JWT_SECRET } from '../config/env';

import { prisma } from '../lib/prisma';

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

      // Multi-tab identity guard. Browser clients stamp each request with the
      // user id the tab believes it is acting as (X-Acting-User-Id). Because the
      // JWT cookie is shared browser-wide, a login in another tab can leave this
      // tab rendering one user while its cookie carries another's token. If the
      // claimed identity does not match the token, reject so the stale tab is
      // forced to re-authenticate instead of silently acting as the other user.
      // Header-only clients (API/tests) omit the header and are unaffected.
      const actingUserId = req.headers['x-acting-user-id'];
      if (typeof actingUserId === 'string' && actingUserId !== String(authPayload.userId)) {
        res.status(401).json({ message: 'Session changed in another tab. Please log in again.' });
        return;
      }

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
