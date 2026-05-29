import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
    });
  });

  describe('Auth Edge Cases & Boundaries', () => {
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
        .send({ newPassword: 'newpassword456' });
      
      expect(res.status).toBe(200);

      // Verify flag is cleared
      const updatedUser = await prisma.user.findUnique({ where: { employeeId: 'TST-FORCE2' } });
      expect(updatedUser?.forcePasswordChange).toBe(false);
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
          resetPasswordToken: 'expired-token-123',
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
          resetPasswordToken: 'valid-token-123',
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
});
