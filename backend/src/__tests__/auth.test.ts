import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Reset tokens are stored hashed (SHA-256) — seed the hash, send the raw value.
const hashResetToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

describe('Authentication & Session Management Endpoints', () => {
  let divisionId: number;
  let adminRoleId: number;

  beforeAll(async () => {
    // Setup base references
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    adminRoleId = adminRole.id;
    const department = await prisma.department.upsert({ where: { name: 'Auth Test Dept' }, update: {}, create: { name: 'Auth Test Dept' } });
    const division = await prisma.division.upsert({ where: { code: 'AUT' }, update: {}, create: { name: 'Auth Div', code: 'AUT', departmentId: department.id } });
    divisionId = division.id;
  });

  beforeEach(async () => {
    // Wipe test users
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Happy Paths', () => {
    it('should successfully login an existing user', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-HAPPY',
          name: 'Happy User',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });

      const res = await request(app).post('/api/auth/login').send({ employeeId: 'TST-HAPPY', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.employeeId).toBe('TST-HAPPY');
    });

    it('should generate a reset password token via forgot password', async () => {
      // This test keeps email because it exercises the email-based forgot-password flow
      await prisma.user.create({
        data: {
          employeeId: 'TST-FORGOT',
          name: 'Forgot User',
          email: 'forgot@sqd.com',
          passwordHash: 'hash',
          divisionId,
          roleId: adminRoleId
        }
      });

      const res = await request(app).post('/api/auth/forgot-password').send({ email: 'forgot@sqd.com' });
      expect(res.status).toBe(200);
      
      const user = await prisma.user.findUnique({ where: { email: 'forgot@sqd.com' } });
      expect(user?.resetPasswordToken).not.toBeNull();
      expect(user?.resetPasswordExpires).not.toBeNull();
      // Token must be persisted as a SHA-256 hash (64 hex chars), never plaintext.
      expect(user?.resetPasswordToken).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Auth Edge Cases & Boundaries', () => {
    // Protects against: user enumeration — unknown user and wrong password must
    // be indistinguishable (same status + same generic message).
    it('should return an identical generic 401 for unknown user and wrong password', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-ENUM',
          name: 'Enum User',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });

      const unknownRes = await request(app)
        .post('/api/auth/login')
        .send({ employeeId: 'NO-SUCH-USER', password: 'whatever' });
      const wrongPassRes = await request(app)
        .post('/api/auth/login')
        .send({ employeeId: 'TST-ENUM', password: 'wrongpassword' });

      expect(unknownRes.status).toBe(401);
      expect(wrongPassRes.status).toBe(401);
      expect(unknownRes.body.message).toBe(wrongPassRes.body.message);
    });

    // Protects against: Using old or modified JWTs to bypass authentication
    it('should return 401 for tampered JWT', async () => {
      const res = await request(app)
        .get('/api/templates')
        .set('Authorization', `Bearer eyoThisIsAFakeToken`);
      expect(res.status).toBe(401);
    });

    // Protects against: Users bypassing the forced password change policy
    it('should block access to standard routes if forcePasswordChange is true', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-FORCE1',
          name: 'Force Change User',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: true, // Must change!
          divisionId,
          roleId: adminRoleId
        }
      });

      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-FORCE1', password: 'password123' });
      const token = loginRes.body.token;

      // Try hitting templates list
      const res = await request(app)
        .get('/api/templates')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/password change required/i);
    });

    // Protects against: Users unable to change password because of the above lock
    it('should allow access to /update-password even if forcePasswordChange is true', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-FORCE2',
          name: 'Force Change User 2',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: true,
          divisionId,
          roleId: adminRoleId
        }
      });

      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-FORCE2', password: 'password123' });
      const token = loginRes.body.token;

      const res = await request(app)
        .post('/api/auth/update-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'password123', newPassword: 'newpassword456' });

      expect(res.status).toBe(200);

      // Verify flag is cleared
      const updatedUser = await prisma.user.findUnique({ where: { employeeId: 'TST-FORCE2' } });
      expect(updatedUser?.forcePasswordChange).toBe(false);
    });

    // Protects against: account takeover via a borrowed/stolen session changing
    // the password without knowing the current one.
    it('should reject update-password with a wrong current password (403)', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-OLDPW',
          name: 'Old Password User',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });

      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-OLDPW', password: 'password123' });
      const token = loginRes.body.token;

      // Wrong current password → 403
      const wrongRes = await request(app)
        .post('/api/auth/update-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'not-the-password', newPassword: 'brandnewpass789' });
      expect(wrongRes.status).toBe(403);

      // Missing current password → 400
      const missingRes = await request(app)
        .post('/api/auth/update-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: 'brandnewpass789' });
      expect(missingRes.status).toBe(400);

      // Correct current password → 200
      const okRes = await request(app)
        .post('/api/auth/update-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'password123', newPassword: 'brandnewpass789' });
      expect(okRes.status).toBe(200);
    });

    // Protects against: Infinite validity of reset tokens
    it('should enforce reset password token expiry', async () => {
      // Set token expiry to 1 hour in the past
      const pastDate = new Date(Date.now() - 3600000);
      await prisma.user.create({
        data: {
          employeeId: 'TST-EXPIRED',
          name: 'Expired Token User',
          passwordHash: 'hash',
          resetPasswordToken: hashResetToken('expired-token-123'),
          resetPasswordExpires: pastDate,
          divisionId,
          roleId: adminRoleId
        }
      });

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'expired-token-123', newPassword: 'newpassword123' });
      
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });

    // Protects against: Replay attacks using the same reset token
    it('should not allow reuse of a reset token after consumption', async () => {
      const futureDate = new Date(Date.now() + 3600000);
      await prisma.user.create({
        data: {
          employeeId: 'TST-REUSE',
          name: 'Reuse Token User',
          passwordHash: 'hash',
          resetPasswordToken: hashResetToken('valid-token-123'),
          resetPasswordExpires: futureDate,
          divisionId,
          roleId: adminRoleId
        }
      });

      // First attempt: should succeed
      const res1 = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'valid-token-123', newPassword: 'newpassword123' });
      expect(res1.status).toBe(200);

      // Second attempt with same token: should fail because it was cleared
      const res2 = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'valid-token-123', newPassword: 'evennewerpassword' });
      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/invalid/i);
    });
  });

  describe('Session lifecycle & revocation', () => {
    const setEnforceSingleSession = (value: 'true' | 'false') =>
      prisma.systemSetting.upsert({
        where: { key: 'ENFORCE_SINGLE_SESSION' },
        update: { value },
        create: { key: 'ENFORCE_SINGLE_SESSION', value }
      });

    // Protects against: a logged-out (or captured) token staying valid because
    // logout was only client-side. Logout must clear activeSessionId server-side.
    it('should revoke the server-side session on logout when single-session is enforced', async () => {
      await setEnforceSingleSession('true');
      try {
        await prisma.user.create({
          data: {
            employeeId: 'TST-LOGOUT',
            name: 'Logout User',
            passwordHash: await bcrypt.hash('password123', 10),
            forcePasswordChange: false,
            divisionId,
            roleId: adminRoleId
          }
        });

        const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-LOGOUT', password: 'password123' });
        expect(loginRes.status).toBe(200);
        const token = loginRes.body.token;

        // Token is valid → logout succeeds.
        const first = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
        expect(first.status).toBe(200);

        // activeSessionId is cleared in the DB.
        const user = await prisma.user.findUnique({ where: { employeeId: 'TST-LOGOUT' } });
        expect(user?.activeSessionId).toBeNull();

        // The same token is now rejected (session revoked).
        const second = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
        expect(second.status).toBe(401);
      } finally {
        await setEnforceSingleSession('false');
      }
    });

    // Protects against: a soft-deleted / disabled user riding a still-valid token
    // when single-session enforcement is OFF (the revocation must not depend on
    // the toggle).
    it('should reject a soft-deleted user\'s token even when single-session is off', async () => {
      // Global setup leaves the toggle at 'false'; assert that explicitly here.
      await setEnforceSingleSession('false');

      const user = await prisma.user.create({
        data: {
          employeeId: 'TST-SOFTDEL',
          name: 'Soft Deleted User',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });

      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-SOFTDEL', password: 'password123' });
      expect(loginRes.status).toBe(200);
      const token = loginRes.body.token;

      // Valid session works with the toggle off.
      const before = await request(app).get('/api/templates').set('Authorization', `Bearer ${token}`);
      expect(before.status).not.toBe(401);

      // Soft-delete the account.
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

      // The token is now rejected despite enforcement being off.
      const after = await request(app).get('/api/templates').set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(401);
    });

    // Protects against: a password reset failing to evict a live (possibly
    // attacker-held) session.
    it('should clear the active session on password reset', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-RESETSESS',
          name: 'Reset Session User',
          email: 'resetsess@sqd.com',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          activeSessionId: 'live-session-uuid',
          resetPasswordToken: hashResetToken('reset-token-xyz'),
          resetPasswordExpires: new Date(Date.now() + 3600000),
          divisionId,
          roleId: adminRoleId
        }
      });

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'reset-token-xyz', newPassword: 'freshpassword789' });
      expect(res.status).toBe(200);

      const user = await prisma.user.findUnique({ where: { employeeId: 'TST-RESETSESS' } });
      expect(user?.activeSessionId).toBeNull();
    });
  });
});
