import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import crypto from 'crypto';
import { JWT_SECRET } from '../config/env';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// A constant, valid bcrypt hash used to perform a "dummy" comparison when a
// login is attempted for an unknown user. This keeps the found / not-found code
// paths roughly constant-time, defeating user enumeration via response timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-account-placeholder', 10);

// Reset tokens are persisted only as a SHA-256 hash so a database leak does not
// expose usable reset links. The raw token is sent to the user; we hash on the
// way in (store) and again on the way back (verify). See CLAUDE_HANDOVER.md §11, Fix 5.
const hashResetToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

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

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, roleName, divisionId } = req.body;

    if (!email || !password || !name || !roleName || !divisionId) {
      res.status(400).json({ message: 'All fields are required' });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email, deletedAt: null } });
    if (existingUser) {
      res.status(400).json({ message: 'User already exists' });
      return;
    }

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      res.status(400).json({ message: 'Invalid role' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
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
        resetPasswordExpires: null
      }
    });

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
