import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Security Settings (ENFORCE_SINGLE_SESSION admin toggle)', () => {
  let adminToken: string;
  let staffToken: string;
  let divisionId: number;
  const ADMIN_EMAIL = 'admin_sec@sqd.com';
  const STAFF_EMAIL = 'staff_sec@sqd.com';
  const emails = [ADMIN_EMAIL, STAFF_EMAIL];

  beforeAll(async () => {
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
    const dept = await prisma.department.upsert({ where: { name: 'Sec Dept' }, update: {}, create: { name: 'Sec Dept' } });
    const division = await prisma.division.upsert({
      where: { code: 'SEC' }, update: {}, create: { name: 'Sec Div', code: 'SEC', departmentId: dept.id }
    });
    divisionId = division.id;

    // Give each user a fixed activeSessionId and sign tokens with a matching
    // sessionId, so the single-session check passes regardless of the
    // ENFORCE_SINGLE_SESSION value this suite is toggling under test.
    const adminUser = await prisma.user.create({
      data: { name: 'Admin Sec', email: ADMIN_EMAIL, passwordHash: 'hash', forcePasswordChange: false, activeSessionId: 'admin-sec-sess', divisionId, roleId: adminRole.id }
    });
    const staffUser = await prisma.user.create({
      data: { name: 'Staff Sec', email: STAFF_EMAIL, passwordHash: 'hash', forcePasswordChange: false, activeSessionId: 'staff-sec-sess', divisionId, roleId: staffRole.id }
    });

    const secret = process.env.JWT_SECRET as string;
    adminToken = jwt.sign({ userId: adminUser.id, role: 'Admin', divisionId, sessionId: 'admin-sec-sess' }, secret);
    staffToken = jwt.sign({ userId: staffUser.id, role: 'Staff', divisionId, sessionId: 'staff-sec-sess' }, secret);
  });

  beforeEach(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: 'ENFORCE_SINGLE_SESSION' } });
    await prisma.auditLog.deleteMany({ where: { actionType: 'SECURITY_SETTING_CHANGED' } });
  });

  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: 'ENFORCE_SINGLE_SESSION' } });
    await prisma.auditLog.deleteMany({ where: { actionType: 'SECURITY_SETTING_CHANGED' } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it('defaults to enabled when the setting is unset (Admin GET)', async () => {
    const res = await request(app).get('/api/settings/security').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.enforceSingleSession).toBe(true);
  });

  it('persists a toggle to false and reflects it on the next GET', async () => {
    const put = await request(app)
      .put('/api/settings/security')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enforceSingleSession: false });
    expect(put.status).toBe(200);
    expect(put.body.enforceSingleSession).toBe(false);

    const stored = await prisma.systemSetting.findUnique({ where: { key: 'ENFORCE_SINGLE_SESSION' } });
    expect(stored?.value).toBe('false');

    const get = await request(app).get('/api/settings/security').set('Authorization', `Bearer ${adminToken}`);
    expect(get.body.enforceSingleSession).toBe(false);
  });

  it('writes a SECURITY_SETTING_CHANGED audit entry', async () => {
    await request(app)
      .put('/api/settings/security')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enforceSingleSession: false });
    const logs = await prisma.auditLog.findMany({ where: { actionType: 'SECURITY_SETTING_CHANGED' } });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a non-boolean payload (400)', async () => {
    const res = await request(app)
      .put('/api/settings/security')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enforceSingleSession: 'nope' });
    expect(res.status).toBe(400);
  });

  it('forbids a non-Admin from reading or writing (403)', async () => {
    const get = await request(app).get('/api/settings/security').set('Authorization', `Bearer ${staffToken}`);
    expect(get.status).toBe(403);
    const put = await request(app)
      .put('/api/settings/security')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ enforceSingleSession: false });
    expect(put.status).toBe(403);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app).get('/api/settings/security');
    expect(res.status).toBe(401);
  });
});
