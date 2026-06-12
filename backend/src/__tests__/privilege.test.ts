import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Privilege Management (Phase 7)', () => {
  let adminToken: string;
  let staffToken: string;
  let managerToken: string;
  let divisionId: number;
  const ADMIN_EMAIL = 'admin_priv@sqd.com';
  const STAFF_EMAIL = 'staff_priv@sqd.com';
  const MANAGER_EMAIL = 'manager_priv@sqd.com';
  const emails = [ADMIN_EMAIL, STAFF_EMAIL, MANAGER_EMAIL];

  beforeAll(async () => {
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });

    const dept = await prisma.department.upsert({ where: { name: 'Priv Dept' }, update: {}, create: { name: 'Priv Dept' } });
    const division = await prisma.division.upsert({
      where: { code: 'PRV' }, update: {}, create: { name: 'Priv Div', code: 'PRV', departmentId: dept.id }
    });
    divisionId = division.id;

    const adminUser = await prisma.user.create({
      data: { name: 'Admin Priv', email: ADMIN_EMAIL, passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: adminRole.id }
    });
    const staffUser = await prisma.user.create({
      data: { name: 'Staff Priv', email: STAFF_EMAIL, passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id }
    });
    const managerUser = await prisma.user.create({
      data: { name: 'Manager Priv', email: MANAGER_EMAIL, passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id }
    });

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    adminToken = jwt.sign({ userId: adminUser.id, role: 'Admin', divisionId }, secret);
    staffToken = jwt.sign({ userId: staffUser.id, role: 'Staff', divisionId }, secret);
    managerToken = jwt.sign({ userId: managerUser.id, role: 'Manager', divisionId }, secret);
  });

  beforeEach(async () => {
    // Each test starts from defaults (no stored config).
    await prisma.privilegeConfig.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { actionType: 'PRIVILEGE_CONFIG_UPDATED' } });
    await prisma.template.deleteMany({});
  });

  afterAll(async () => {
    // CRITICAL: leaving stored configs behind would change defaults for other
    // suites — wipe them so the DB returns to "defaults only".
    await prisma.privilegeConfig.deleteMany({});
    await prisma.template.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  describe('GET /api/settings/privileges', () => {
    it('returns the catalog and effective per-role maps for an Admin', async () => {
      const res = await request(app).get('/api/settings/privileges').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.catalog)).toBe(true);
      expect(res.body.catalog.length).toBeGreaterThan(0);
      const admin = res.body.roles.find((r: any) => r.roleName === 'Admin');
      const staff = res.body.roles.find((r: any) => r.roleName === 'Staff');
      // Defaults: Admin owns the panel; Staff owns nothing.
      expect(admin.permissions['settings:privileges']).toBe(true);
      expect(staff.permissions['task:create']).toBe(false);
    });

    it('blocks a non-Admin (Manager) with 403', async () => {
      const res = await request(app).get('/api/settings/privileges').set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(403);
    });

    it('blocks a non-Admin (Staff) with 403', async () => {
      const res = await request(app).get('/api/settings/privileges').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/settings/privileges', () => {
    it('persists changes and writes a PRIVILEGE_CONFIG_UPDATED audit row with a diff', async () => {
      const res = await request(app)
        .put('/api/settings/privileges')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: [{ roleName: 'Staff', permissions: { 'task:create': true } }] });
      expect(res.status).toBe(200);
      expect(res.body.changedCount).toBeGreaterThanOrEqual(1);

      const stored = await prisma.privilegeConfig.findFirst({ where: { role: { name: 'Staff' } } });
      expect((stored!.permissions as any)['task:create']).toBe(true);

      const audit = await prisma.auditLog.findFirst({ where: { actionType: 'PRIVILEGE_CONFIG_UPDATED' } });
      expect(audit).not.toBeNull();
      const details = audit!.details as any;
      expect(details.changedKeys.some((c: any) => c.role === 'Staff' && c.key === 'task:create' && c.to === true)).toBe(true);
    });

    it('rejects a non-Admin with 403 and writes nothing', async () => {
      const res = await request(app)
        .put('/api/settings/privileges')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ roles: [{ roleName: 'Staff', permissions: { 'task:create': true } }] });
      expect(res.status).toBe(403);
      const stored = await prisma.privilegeConfig.findFirst({ where: { role: { name: 'Staff' } } });
      expect(stored).toBeNull();
    });

    it('enforces the Admin floor: settings:privileges cannot be revoked from Admin', async () => {
      const res = await request(app)
        .put('/api/settings/privileges')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: [{ roleName: 'Admin', permissions: { 'settings:privileges': false } }] });
      expect(res.status).toBe(200);
      const adminPerms = res.body.roles.find((r: any) => r.roleName === 'Admin').permissions;
      expect(adminPerms['settings:privileges']).toBe(true);
    });

    it('rejects an unknown privilege key with 400', async () => {
      const res = await request(app)
        .put('/api/settings/privileges')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: [{ roleName: 'Staff', permissions: { 'task:fly_plane': true } }] });
      expect(res.status).toBe(400);
    });

    it('rejects a non-boolean value with 400', async () => {
      const res = await request(app)
        .put('/api/settings/privileges')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: [{ roleName: 'Staff', permissions: { 'task:create': 'yes' } }] });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown role with 400', async () => {
      const res = await request(app)
        .put('/api/settings/privileges')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: [{ roleName: 'Overlord', permissions: { 'task:create': true } }] });
      expect(res.status).toBe(400);
    });
  });

  describe('Behavioural effect on a guarded endpoint', () => {
    it('grants then revokes Staff template:create and the route follows', async () => {
      // Baseline: Staff cannot create templates.
      const denied = await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ title: 'Staff T', formSchema: { fields: [] } });
      expect(denied.status).toBe(403);

      // Grant template:create to Staff.
      await request(app)
        .put('/api/settings/privileges')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: [{ roleName: 'Staff', permissions: { 'template:create': true } }] });

      const allowed = await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ title: 'Staff T2', formSchema: { fields: [] } });
      expect(allowed.status).toBe(201);

      // Revoke it again.
      await request(app)
        .put('/api/settings/privileges')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: [{ roleName: 'Staff', permissions: { 'template:create': false } }] });

      const deniedAgain = await request(app)
        .post('/api/templates')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ title: 'Staff T3', formSchema: { fields: [] } });
      expect(deniedAgain.status).toBe(403);
    });
  });

  describe('Default fallback (no stored config)', () => {
    it('still enforces defaults when PrivilegeConfig is empty', async () => {
      // beforeEach wiped configs — Manager should still be a finding reviewer by default.
      const res = await request(app).get('/api/settings/privileges').set('Authorization', `Bearer ${adminToken}`);
      const manager = res.body.roles.find((r: any) => r.roleName === 'Manager');
      expect(manager.permissions['finding:review']).toBe(true);
      expect(manager.permissions['settings:privileges']).toBe(false);
    });
  });
});
