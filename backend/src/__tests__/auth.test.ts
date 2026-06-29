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
        .send({ token: 'valid-token-123', newPassword: 'evennewerpass123' });
      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/invalid/i);
    });
  });

  describe('Registration', () => {
    // Protects against: registering a user without an employeeId, who could then
    // never log in (login authenticates by employeeId).
    it('should register a user with an employeeId who can then log in (forced change)', async () => {
      const admin = await prisma.user.create({
        data: {
          employeeId: 'TST-ADMIN',
          name: 'Reg Admin',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });
      const adminToken = jwt.sign({ userId: admin.id, role: 'Admin', divisionId }, process.env.JWT_SECRET as string);
      // Register a non-elevated role: Admin may create Staff, but only a Director
      // may create another Admin/Director (code-review #2).
      await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

      const regRes = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: 'TST-NEWBIE', password: 'temppass123', name: 'New Bie', roleName: 'Staff', divisionId });
      expect(regRes.status).toBe(201);

      // The new user is forced to change the temporary password on first login (202).
      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-NEWBIE', password: 'temppass123' });
      expect(loginRes.status).toBe(202);
      expect(loginRes.body.requirePasswordChange).toBe(true);
    });

    it('should reject registration without an employeeId', async () => {
      const admin = await prisma.user.create({
        data: {
          employeeId: 'TST-ADMIN2',
          name: 'Reg Admin 2',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });
      const adminToken = jwt.sign({ userId: admin.id, role: 'Admin', divisionId }, process.env.JWT_SECRET as string);

      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: 'temppass123', name: 'No Id', roleName: 'Admin', divisionId });
      expect(res.status).toBe(400);
    });
  });

  describe('Cookie-based auth', () => {
    // The JWT is delivered as an httpOnly cookie and accepted on subsequent
    // requests without an Authorization header.
    it('sets an httpOnly auth cookie on login and accepts it for authenticated requests', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-COOKIE',
          name: 'Cookie User',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });

      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-COOKIE', password: 'password123' });
      expect(loginRes.status).toBe(200);

      const setCookie = loginRes.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieHeaders = Array.isArray(setCookie) ? setCookie : [setCookie as unknown as string];
      const tokenCookie = cookieHeaders.find((c) => c.startsWith('token='));
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie!.toLowerCase()).toContain('httponly');

      // The cookie alone (no Authorization header) authenticates a request.
      const cookieValue = tokenCookie!.split(';')[0];
      const res = await request(app).get('/api/templates').set('Cookie', cookieValue);
      expect(res.status).not.toBe(401);

      // Logout clears the cookie.
      const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookieValue);
      expect(logoutRes.status).toBe(200);
      const clearCookie = logoutRes.headers['set-cookie'];
      expect(clearCookie).toBeDefined();
    });

    // Multi-tab identity guard: the JWT cookie is shared browser-wide, so a
    // login in a second tab can leave a first tab rendering one user while its
    // requests carry another user's cookie. Browser clients stamp requests with
    // the user id the tab believes it is acting as; a mismatch against the token
    // must be rejected so the stale tab is forced to re-authenticate rather than
    // silently acting with the other user's privileges.
    it('rejects a request whose X-Acting-User-Id does not match the cookie token', async () => {
      const user = await prisma.user.create({
        data: {
          employeeId: 'TST-TAB',
          name: 'Tab User',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });

      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-TAB', password: 'password123' });
      const setCookie = loginRes.headers['set-cookie'];
      const cookieHeaders = Array.isArray(setCookie) ? setCookie : [setCookie as unknown as string];
      const cookieValue = cookieHeaders.find((c) => c.startsWith('token='))!.split(';')[0];

      // Same tab claiming its own id is accepted.
      const matched = await request(app)
        .get('/api/templates')
        .set('Cookie', cookieValue)
        .set('X-Acting-User-Id', String(user.id));
      expect(matched.status).not.toBe(401);

      // A stale tab claiming a different user id (its cookie was overwritten by
      // another tab's login) is rejected.
      const mismatched = await request(app)
        .get('/api/templates')
        .set('Cookie', cookieValue)
        .set('X-Acting-User-Id', String(user.id + 9999));
      expect(mismatched.status).toBe(401);
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

  // ---------------------------------------------------------------------------
  // Auth audit hardening (audit findings H1, H2, H3, L1, M1, M4)
  // ---------------------------------------------------------------------------
  describe('Password policy (H1)', () => {
    const makeAdminToken = async (empId: string) => {
      const admin = await prisma.user.create({
        data: {
          employeeId: empId,
          name: 'Policy Admin',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });
      return jwt.sign({ userId: admin.id, role: 'Admin', divisionId }, process.env.JWT_SECRET as string);
    };

    it('rejects registration with a password that is too short', async () => {
      const adminToken = await makeAdminToken('TST-POL-1');
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: 'TST-SHORT', password: 'ab1', name: 'Short', roleName: 'Admin', divisionId });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least 8/i);
    });

    it('rejects registration with a password lacking a digit', async () => {
      const adminToken = await makeAdminToken('TST-POL-2');
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: 'TST-NODIGIT', password: 'onlyletters', name: 'NoDigit', roleName: 'Admin', divisionId });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/letters and numbers/i);
    });

    it('rejects reset-password with a weak new password', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-RESETWEAK',
          name: 'Reset Weak',
          passwordHash: 'hash',
          resetPasswordToken: hashResetToken('weak-reset-token'),
          resetPasswordExpires: new Date(Date.now() + 3600000),
          divisionId,
          roleId: adminRoleId
        }
      });
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'weak-reset-token', newPassword: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least 8/i);
    });

    it('rejects update-password where the new password is weak', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-UPDWEAK',
          name: 'Update Weak',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });
      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-UPDWEAK', password: 'password123' });
      const res = await request(app)
        .post('/api/auth/update-password')
        .set('Authorization', `Bearer ${loginRes.body.token}`)
        .send({ oldPassword: 'password123', newPassword: 'nodigits' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/letters and numbers/i);
    });

    it('rejects update-password where the new password equals the current one', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-SAMEPW',
          name: 'Same Password',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });
      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-SAMEPW', password: 'password123' });
      const res = await request(app)
        .post('/api/auth/update-password')
        .set('Authorization', `Bearer ${loginRes.body.token}`)
        .send({ oldPassword: 'password123', newPassword: 'password123' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/different from the current/i);
    });
  });

  describe('Register scope & validation (H3, L1)', () => {
    let directorRoleId: number;
    let managerRoleId: number;
    let otherDivisionId: number;

    beforeAll(async () => {
      const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
      directorRoleId = directorRole.id;
      const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
      managerRoleId = managerRole.id;
      await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
      // Grant Manager `user:create` so a Manager token passes requirePrivilege and
      // actually REACHES the division-scope guard inside register — otherwise the
      // 403 would come from requirePrivilege and the guard would be untested
      // (code-review #1).
      await prisma.privilegeConfig.upsert({
        where: { roleId: managerRoleId },
        update: { permissions: { 'user:create': true } },
        create: { roleId: managerRoleId, permissions: { 'user:create': true } }
      });
      const department = await prisma.department.upsert({ where: { name: 'Auth Test Dept' }, update: {}, create: { name: 'Auth Test Dept' } });
      const other = await prisma.division.upsert({ where: { code: 'OTH' }, update: {}, create: { name: 'Other Div', code: 'OTH', departmentId: department.id } });
      otherDivisionId = other.id;
    });

    afterAll(async () => {
      // Don't leak the Manager privilege grant into other suites sharing the DB.
      await prisma.privilegeConfig.deleteMany({});
    });

    const tokenFor = async (empId: string, roleId: number, roleName: string, divId: number) => {
      const u = await prisma.user.create({
        data: {
          employeeId: empId,
          name: empId,
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId: divId,
          roleId
        }
      });
      return jwt.sign({ userId: u.id, role: roleName, divisionId: divId }, process.env.JWT_SECRET as string);
    };

    it('forbids an Admin from creating a Director', async () => {
      const adminToken = await tokenFor('TST-ADMIN-ESC', adminRoleId, 'Admin', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: 'TST-WANNABE-DIR', password: 'temppass123', name: 'Wannabe', roleName: 'Director', divisionId });
      expect(res.status).toBe(403);
    });

    it('forbids an Admin from creating another Admin (only a Director may, code-review #2)', async () => {
      const adminToken = await tokenFor('TST-ADMIN-ESC2', adminRoleId, 'Admin', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: 'TST-WANNABE-ADMIN', password: 'temppass123', name: 'Wannabe Admin', roleName: 'Admin', divisionId });
      expect(res.status).toBe(403);
    });

    it('allows a Director to create a Director', async () => {
      const dirToken = await tokenFor('TST-DIR', directorRoleId, 'Director', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${dirToken}`)
        .send({ employeeId: 'TST-NEW-DIR', password: 'temppass123', name: 'New Dir', roleName: 'Director', divisionId });
      expect(res.status).toBe(201);
    });

    it('allows a Director to create an Admin', async () => {
      const dirToken = await tokenFor('TST-DIR2', directorRoleId, 'Director', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${dirToken}`)
        .send({ employeeId: 'TST-NEW-ADMIN', password: 'temppass123', name: 'New Admin', roleName: 'Admin', divisionId });
      expect(res.status).toBe(201);
    });

    it('forbids a Manager (with user:create) from creating a user in another division', async () => {
      const mgrToken = await tokenFor('TST-MGR', managerRoleId, 'Manager', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({ employeeId: 'TST-CROSS-DIV', password: 'temppass123', name: 'Cross', roleName: 'Staff', divisionId: otherDivisionId });
      // 403 must come from the division-scope guard, not requirePrivilege — assert
      // the guard's message to prove it was actually reached (code-review #1).
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/own division/i);
    });

    it('allows a Manager (with user:create) to create a user in their own division', async () => {
      const mgrToken = await tokenFor('TST-MGR-OK', managerRoleId, 'Manager', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({ employeeId: 'TST-SAME-DIV', password: 'temppass123', name: 'Same Div', roleName: 'Staff', divisionId });
      expect(res.status).toBe(201);
    });

    it('coerces a string divisionId from the request body (code-review #3)', async () => {
      const adminToken = await tokenFor('TST-ADMIN-STR', adminRoleId, 'Admin', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: 'TST-STRDIV', password: 'temppass123', name: 'Str Div', roleName: 'Staff', divisionId: String(divisionId) });
      expect(res.status).toBe(201);
    });

    it('rejects registration into a non-existent division', async () => {
      const adminToken = await tokenFor('TST-ADMIN-DIV', adminRoleId, 'Admin', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: 'TST-BADDIV', password: 'temppass123', name: 'BadDiv', roleName: 'Staff', divisionId: 999999 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/division/i);
    });

    it('rejects registration with a malformed email', async () => {
      const adminToken = await tokenFor('TST-ADMIN-EMAIL', adminRoleId, 'Admin', divisionId);
      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: 'TST-BADEMAIL', password: 'temppass123', name: 'BadEmail', roleName: 'Admin', divisionId, email: 'not-an-email' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/email/i);
    });
  });

  describe('Authentication audit logging (H2)', () => {
    it('writes a LOGIN_SUCCESS audit entry on successful login', async () => {
      const user = await prisma.user.create({
        data: {
          employeeId: 'TST-AUD-OK',
          name: 'Audit Ok',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });
      await request(app).post('/api/auth/login').send({ employeeId: 'TST-AUD-OK', password: 'password123' });
      const logs = await prisma.auditLog.findMany({
        where: { performedByUserId: user.id, actionType: 'LOGIN_SUCCESS' }
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('writes a LOGIN_FAILED audit entry for a wrong password on a known account', async () => {
      const user = await prisma.user.create({
        data: {
          employeeId: 'TST-AUD-FAIL',
          name: 'Audit Fail',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: false,
          divisionId,
          roleId: adminRoleId
        }
      });
      await request(app).post('/api/auth/login').send({ employeeId: 'TST-AUD-FAIL', password: 'wrongpassword' });
      const logs = await prisma.auditLog.findMany({
        where: { performedByUserId: user.id, actionType: 'LOGIN_FAILED' }
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Forced password change can log out (M4)', () => {
    it('allows a forced-password-change user to reach /logout', async () => {
      await prisma.user.create({
        data: {
          employeeId: 'TST-FORCE-LOGOUT',
          name: 'Force Logout',
          passwordHash: await bcrypt.hash('password123', 10),
          forcePasswordChange: true,
          divisionId,
          roleId: adminRoleId
        }
      });
      const loginRes = await request(app).post('/api/auth/login').send({ employeeId: 'TST-FORCE-LOGOUT', password: 'password123' });
      expect(loginRes.status).toBe(202);
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${loginRes.body.token}`);
      expect(res.status).toBe(200);
    });
  });

  describe('JWT algorithm is pinned (M1)', () => {
    it('rejects a token signed with the "none" algorithm', async () => {
      // An unsigned (alg:none) token must never be accepted now that verify pins HS256.
      // Built by hand (header.payload. with an empty signature) to avoid jwt.sign's
      // guard rails around the 'none' algorithm.
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({ userId: 1, role: 'Admin', divisionId })).toString('base64url');
      const noneToken = `${header}.${body}.`;
      const res = await request(app)
        .get('/api/templates')
        .set('Authorization', `Bearer ${noneToken}`);
      expect(res.status).toBe(401);
    });
  });
});
