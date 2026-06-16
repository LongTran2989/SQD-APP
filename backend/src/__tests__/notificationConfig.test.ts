import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { clearNotificationConfigCache } from '../services/notificationConfigService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const secret = process.env.JWT_SECRET || 'fallback_secret';

// Exercises the Settings → Notifications event-config layer: enable/disable a
// class, CC division managers, fail-open defaults, and the route guard.
describe('Notification event configuration', () => {
  let directorId: number;
  let managerAId: number;
  let managerA2Id: number;
  let managerBId: number;
  let staffAId: number;

  let directorToken: string;
  let adminToken: string;
  let staffAToken: string;

  let divisionA: number;
  let divisionB: number;
  let templateId: number;

  let taskSeq = 0;
  const makeTask = (overrides: Record<string, unknown> = {}) => {
    taskSeq += 1;
    return prisma.task.create({
      data: {
        taskId: `NCFG-${String(taskSeq).padStart(6, '0')}`,
        templateId,
        issuerId: directorId,
        status: 'Unassigned',
        targetDivisionId: divisionA,
        schemaSnapshot: { fields: [] },
        ...overrides,
      },
    });
  };

  const inboxOf = (userId: number) =>
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });

  const setConfig = (eventKey: string, enabled: boolean, ccManagers: boolean) =>
    prisma.notificationEventConfig.upsert({
      where: { eventKey },
      update: { enabled, ccManagers },
      create: { eventKey, enabled, ccManagers },
    });

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'NCfg Dept' }, update: {}, create: { name: 'NCfg Dept' } });
    const divA = await prisma.division.upsert({ where: { code: 'NCFA' }, update: {}, create: { name: 'NCfg Div A', code: 'NCFA', departmentId: dept.id } });
    const divB = await prisma.division.upsert({ where: { code: 'NCFB' }, update: {}, create: { name: 'NCfg Div B', code: 'NCFB', departmentId: dept.id } });
    divisionA = divA.id;
    divisionB = divB.id;

    const mk = (name: string, email: string, roleId: number, divId: number) =>
      prisma.user.create({ data: { name, email, passwordHash: 'hash', forcePasswordChange: false, divisionId: divId, roleId } });

    const director = await mk('NCfg Director', 'ncfg_director@sqd.com', directorRole.id, divisionA);
    const admin = await mk('NCfg Admin', 'ncfg_admin@sqd.com', adminRole.id, divisionA);
    const managerA = await mk('NCfg Manager A', 'ncfg_managera@sqd.com', managerRole.id, divisionA);
    const managerA2 = await mk('NCfg Manager A2', 'ncfg_managera2@sqd.com', managerRole.id, divisionA);
    const managerB = await mk('NCfg Manager B', 'ncfg_managerb@sqd.com', managerRole.id, divisionB);
    const staffA = await mk('NCfg Staff A', 'ncfg_staffa@sqd.com', staffRole.id, divisionA);

    directorId = director.id;
    managerAId = managerA.id;
    managerA2Id = managerA2.id;
    managerBId = managerB.id;
    staffAId = staffA.id;

    directorToken = jwt.sign({ userId: director.id, role: 'Director', divisionId: divisionA }, secret);
    adminToken = jwt.sign({ userId: admin.id, role: 'Admin', divisionId: divisionA }, secret);
    staffAToken = jwt.sign({ userId: staffA.id, role: 'Staff', divisionId: divisionA }, secret);

    const template = await prisma.template.create({
      data: {
        templateId: 'NCFG-001', title: 'NCfg Template', status: 'Published',
        formSchema: { fields: [] }, divisionId: divisionA, ownerId: director.id,
        allowsFindings: true, requiresApproval: true,
      },
    });
    templateId = template.id;
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'NCFG-' } } });
    await prisma.notificationEventConfig.deleteMany({});
    clearNotificationConfigCache();
    taskSeq = 0;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'NCFG-' } } });
    await prisma.notificationEventConfig.deleteMany({});
    await prisma.template.deleteMany({ where: { templateId: 'NCFG-001' } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'ncfg_' } } });
    await prisma.$disconnect();
  });

  // ─── Enforcement at the createNotifications chokepoint ───────────────────────

  it('fails open: with no config rows, events still fire (defaults)', async () => {
    const task = await makeTask();
    const res = await request(app)
      .put(`/api/tasks/${task.id}/assign`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ assignedToUserId: staffAId });
    expect(res.status).toBe(200);
    expect((await inboxOf(staffAId)).some((n) => n.type === 'TASK_ASSIGNED')).toBe(true);
  });

  it('suppresses notifications for a disabled event class', async () => {
    await setConfig('TASK_ASSIGNED', false, false);
    clearNotificationConfigCache();

    const task = await makeTask();
    const res = await request(app)
      .put(`/api/tasks/${task.id}/assign`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ assignedToUserId: staffAId });
    expect(res.status).toBe(200);
    expect(await inboxOf(staffAId)).toHaveLength(0);
  });

  it('CCs all managers in the recipient division when ccManagers is on', async () => {
    await setConfig('TASK_ASSIGNED', true, true);
    clearNotificationConfigCache();

    const task = await makeTask();
    const res = await request(app)
      .put(`/api/tasks/${task.id}/assign`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ assignedToUserId: staffAId });
    expect(res.status).toBe(200);

    // Direct recipient still notified.
    expect((await inboxOf(staffAId)).some((n) => n.type === 'TASK_ASSIGNED')).toBe(true);
    // Both managers in the assignee's division (A) are CC'd.
    expect((await inboxOf(managerAId)).some((n) => n.type === 'TASK_ASSIGNED')).toBe(true);
    expect((await inboxOf(managerA2Id)).some((n) => n.type === 'TASK_ASSIGNED')).toBe(true);
    // A manager in another division is not.
    expect(await inboxOf(managerBId)).toHaveLength(0);
  });

  it('excludes the actor even when they are a CC-eligible manager', async () => {
    await setConfig('TASK_ASSIGNED', true, true);
    clearNotificationConfigCache();

    // managerA assigns to staffA (same division). managerA is the actor and a
    // division manager, so must be excluded from the CC fan-out.
    const managerAToken = jwt.sign({ userId: managerAId, role: 'Manager', divisionId: divisionA }, secret);
    const task = await makeTask();
    const res = await request(app)
      .put(`/api/tasks/${task.id}/assign`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .send({ assignedToUserId: staffAId });
    expect(res.status).toBe(200);

    expect(await inboxOf(managerAId)).toHaveLength(0);
    expect((await inboxOf(managerA2Id)).some((n) => n.type === 'TASK_ASSIGNED')).toBe(true);
  });

  // ─── REST endpoint + guard ──────────────────────────────────────────────────

  it('returns the catalog and current config to an authorised user', async () => {
    const res = await request(app)
      .get('/api/settings/notification-config')
      .set('Authorization', `Bearer ${directorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.catalog)).toBe(true);
    expect(res.body.configs).toHaveLength(7);
  });

  it('updates a config row and writes an audit log entry', async () => {
    const res = await request(app)
      .put('/api/settings/notification-config/TASK_REVIEWED')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false, ccManagers: true });
    expect(res.status).toBe(200);
    expect(res.body.config).toMatchObject({ eventKey: 'TASK_REVIEWED', enabled: false, ccManagers: true });

    const row = await prisma.notificationEventConfig.findUnique({ where: { eventKey: 'TASK_REVIEWED' } });
    expect(row).toMatchObject({ enabled: false, ccManagers: true });
    const audit = await prisma.auditLog.findFirst({ where: { actionType: 'NOTIFICATION_CONFIG_UPDATED', entityId: 'TASK_REVIEWED' } });
    expect(audit).not.toBeNull();
  });

  it('rejects an unknown event key', async () => {
    const res = await request(app)
      .put('/api/settings/notification-config/NOPE')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true, ccManagers: false });
    expect(res.status).toBe(400);
  });

  it('rejects a non-boolean body', async () => {
    const res = await request(app)
      .put('/api/settings/notification-config/TASK_ASSIGNED')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: 'yes', ccManagers: false });
    expect(res.status).toBe(400);
  });

  it('forbids users without settings:notifications (Staff)', async () => {
    const getRes = await request(app)
      .get('/api/settings/notification-config')
      .set('Authorization', `Bearer ${staffAToken}`);
    expect(getRes.status).toBe(403);

    const putRes = await request(app)
      .put('/api/settings/notification-config/TASK_ASSIGNED')
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ enabled: false, ccManagers: false });
    expect(putRes.status).toBe(403);
  });
});
