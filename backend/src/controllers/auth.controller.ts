import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { JWT_SECRET } from '../config/env';

import { prisma } from '../lib/prisma';

// A constant, valid bcrypt hash used to perform a "dummy" comparison when a
// login is attempted for an unknown user. This keeps the found / not-found code
// paths roughly constant-time, defeating user enumeration via response timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-account-placeholder', 10);

// Reset tokens are persisted only as a SHA-256 hash so a database leak does not
// expose usable reset links. The raw token is sent to the user; we hash on the
// way in (store) and again on the way back (verify). See CLAUDE_HANDOVER.md §11, Fix 5.
const hashResetToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

// The JWT is delivered as an httpOnly cookie so it is not readable by JS (an XSS
// cannot exfiltrate it). SameSite=Strict mitigates CSRF for same-site
// deployments. The token is also still returned in the JSON body for API/header
// clients (and the test suite). See plan Phase 6.
const AUTH_COOKIE_NAME = 'token';
const AUTH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day — matches token TTL

const authCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // SameSite=None is required when the frontend and backend are on different
  // domains (e.g. Railway subdomains). SameSite=Strict is used locally where
  // both run on localhost and cross-site cookies are not needed.
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'strict') as 'none' | 'strict',
  path: '/'
});

const setAuthCookie = (res: Response, token: string): void => {
  res.cookie(AUTH_COOKIE_NAME, token, { ...authCookieOptions(), maxAge: AUTH_COOKIE_MAX_AGE_MS });
};

const clearAuthCookie = (res: Response): void => {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employeeId, password } = req.body;

    if (!employeeId || !password) {
      res.status(400).json({ message: 'Staff ID and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { employeeId, deletedAt: null },
      include: { role: true }
    });

    if (!user) {
      // Perform a dummy comparison so the unknown-user path costs roughly the
      // same as the wrong-password path (prevents timing-based user enumeration).
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    const sessionId = crypto.randomUUID();

    await prisma.user.update({
      where: { id: user.id },
      data: { activeSessionId: sessionId }
    });

    const payload = {
      userId: user.id,
      role: user.role.name,
      divisionId: user.divisionId,
      forcePasswordChange: user.forcePasswordChange,
      sessionId
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: '1d'
    });

    // Set the httpOnly cookie in both flows: the forced-change session is gated
    // to /update-password by the middleware, so the cookie alone carries the
    // forced session (no JS-readable temp token needed).
    setAuthCookie(res, token);

    if (user.forcePasswordChange) {
      res.status(202).json({
        message: 'Password change required',
        requirePasswordChange: true,
        token
      });
      return;
    }

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        employeeId: user.employeeId,
        name: user.name,
        role: user.role.name,
        divisionId: user.divisionId,
        preferences: user.preferences ?? null
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    // Revoke the server-side session so the bearer token can no longer be used
    // (single-session check will now fail). Without this, logout is client-only
    // and a captured token stays valid until expiry.
    await prisma.user.update({
      where: { id: userId },
      data: { activeSessionId: null }
    });

    await prisma.auditLog.create({
      data: {
        actionType: 'LOGOUT',
        entityType: 'User',
        entityId: String(userId),
        performedByUserId: userId
      }
    });

    clearAuthCookie(res);

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { employeeId, email, password, name, roleName, divisionId } = req.body;

    // employeeId is the login identifier (login authenticates by employeeId), so
    // it is required for a usable account. email is optional (used for reset).
    if (!employeeId || !password || !name || !roleName || !divisionId) {
      res.status(400).json({ message: 'employeeId, password, name, roleName and divisionId are required' });
      return;
    }

    const existingById = await prisma.user.findUnique({ where: { employeeId, deletedAt: null } });
    if (existingById) {
      res.status(400).json({ message: 'User already exists' });
      return;
    }

    if (email) {
      const existingByEmail = await prisma.user.findUnique({ where: { email, deletedAt: null } });
      if (existingByEmail) {
        res.status(400).json({ message: 'User already exists' });
        return;
      }
    }

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      res.status(400).json({ message: 'Invalid role' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // forcePasswordChange defaults to true in the schema, so a newly registered
    // user is required to change the temporary password on first login.
    const newUser = await prisma.user.create({
      data: {
        employeeId,
        name,
        email: email ?? null,
        passwordHash,
        divisionId,
        roleId: role.id
      }
    });

    res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updatePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = (req as any).user?.userId;

    if (!newPassword || !userId) {
      res.status(400).json({ message: 'New password is required' });
      return;
    }

    if (!oldPassword) {
      res.status(400).json({ message: 'Current password is required' });
      return;
    }

    // Verify the current password before allowing a change. This applies even
    // to the forced-first-login flow: the user typed the temporary password at
    // login, so proving possession of it (not merely holding a token) is
    // required. Prevents account takeover from a borrowed/stolen session.
    const existingUser = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null }
    });

    if (!existingUser) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const isValidCurrentPassword = await bcrypt.compare(oldPassword, existingUser.passwordHash);
    if (!isValidCurrentPassword) {
      res.status(403).json({ message: 'Current password is incorrect' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const sessionId = crypto.randomUUID();

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        forcePasswordChange: false,
        activeSessionId: sessionId
      },
      include: { role: true }
    });

    const payload = {
      userId: updatedUser.id,
      role: updatedUser.role.name,
      divisionId: updatedUser.divisionId,
      forcePasswordChange: updatedUser.forcePasswordChange,
      sessionId
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: '1d'
    });

    // Refresh the cookie with the new session (forcePasswordChange now false).
    setAuthCookie(res, token);

    res.json({
      message: 'Password updated successfully',
      token,
      user: {
        id: updatedUser.id,
        employeeId: updatedUser.employeeId,
        name: updatedUser.name,
        role: updatedUser.role.name,
        divisionId: updatedUser.divisionId
      }
    });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ message: 'Email is required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email, deletedAt: null } });

    // Only act if the account exists and has an email address configured.
    // Intentionally no early return on missing user — prevents email enumeration.
    if (user && user.email) {
      // The raw token goes to the user; only its hash is persisted so a DB leak
      // does not expose usable reset links.
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: hashResetToken(resetToken),
          resetPasswordExpires
        }
      });

      // Simulated email sending by printing to console
      console.log(`\n========================================`);
      console.log(`[EMAIL MOCK] Password Reset Requested`);
      console.log(`To: ${email}`);
      console.log(`Link: http://localhost:3000/reset-password?token=${resetToken}`);
      console.log(`========================================\n`);
    }

    // Always return the same generic response regardless of whether the user exists
    res.status(200).json({ message: 'If an account exists, a reset link has been generated.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      res.status(400).json({ message: 'Token and new password are required' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: hashResetToken(token),
        resetPasswordExpires: { gt: new Date() }, // Ensures token is not expired
        deletedAt: null
      }
    });

    if (!user) {
      res.status(400).json({ message: 'Invalid or expired reset token' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        forcePasswordChange: false,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        // Evict any live session so a reset (e.g. after a compromise) actually
        // kicks out an attacker holding a still-valid token.
        activeSessionId: null
      }
    });

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
