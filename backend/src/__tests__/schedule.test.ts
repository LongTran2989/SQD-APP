import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Test fixtures ────────────────────────────────────────────────────────────

async function createRole(name: string) {
  return prisma.role.upsert({ where: { name }, update: {}, create: { name } });
}

async function createUser(
  employeeId: string,
  roleId: number,
  divisionId: number,
  opts: { name?: string } = {}
) {
  return prisma.user.create({
    data: {
      employeeId,
      name: opts.name ?? employeeId,
      passwordHash: await bcrypt.hash('password123', 10),
      forcePasswordChange: false,
      divisionId,
      roleId,
    },
  });
}

async function login(employeeId: string) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ employeeId, password: 'password123' });
  return res.headers['set-cookie'] as string[];
}

async function createShiftType(overrides: Partial<{
  code: string; name: string; isWorkDay: boolean; groupCode: string; color: string;
}> = {}) {
  return prisma.shiftType.create({
    data: {
      code: overrides.code ?? `ST_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: overrides.name ?? 'Test Shift',
      groupCode: overrides.groupCode ?? 'TEST',
      color: overrides.color ?? '#4CAF50',
      isWorkDay: overrides.isWorkDay ?? true,
    },
  });
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

describe('Staff Work Schedules', () => {
  let divisionId: number;
  let otherDivisionId: number;
  let managerRoleId: number;
  let staffRoleId: number;
  let directorRoleId: number;
  let managerId: number;
  let staffId: number;
  let otherManagerId: number;
  let directorId: number;
  let workingShift: { id: number; code: string };
  let offShift: { id: number; code: string };

  beforeAll(async () => {
    const dept = await prisma.department.upsert({
      where: { name: 'Sched Test Dept' }, update: {}, create: { name: 'Sched Test Dept' },
    });
    const div = await prisma.division.upsert({
      where: { code: 'SCH' }, update: {},
      create: { name: 'Sched Division', code: 'SCH', departmentId: dept.id },
    });
    const otherDiv = await prisma.division.upsert({
      where: { code: 'SCH2' }, update: {},
      create: { name: 'Other Division', code: 'SCH2', departmentId: dept.id },
    });
    divisionId = div.id;
    otherDivisionId = otherDiv.id;

    const managerRole = await createRole('Manager');
    const staffRole = await createRole('Staff');
    const directorRole = await createRole('Director');
    managerRoleId = managerRole.id;
    staffRoleId = staffRole.id;
    directorRoleId = directorRole.id;

    await prisma.shiftType.deleteMany({ where: { code: { in: ['C1_TEST', 'OFF_TEST', 'NEW_SHIFT', 'BLOCKED'] } } });
    workingShift = await createShiftType({ code: 'C1_TEST', name: 'Morning Shift', isWorkDay: true });
    offShift = await createShiftType({ code: 'OFF_TEST', name: 'Sick Leave', isWorkDay: false });
  });

  beforeEach(async () => {
    await prisma.scheduleEntry.deleteMany({});
    await prisma.scheduleEditLock.deleteMany({});
    await prisma.schedulePattern.deleteMany({});
    await prisma.user.deleteMany({});

    const manager = await createUser('MGR001', managerRoleId, divisionId, { name: 'Test Manager' });
    managerId = manager.id;
    const staff = await createUser('STF001', staffRoleId, divisionId, { name: 'Test Staff' });
    staffId = staff.id;
    const otherManager = await createUser('MGR002', managerRoleId, otherDivisionId, { name: 'Other Manager' });
    otherManagerId = otherManager.id;
    const director = await createUser('DIR001', directorRoleId, divisionId, { name: 'Test Director' });
    directorId = director.id;
  });

  afterAll(async () => {
    await prisma.scheduleEntry.deleteMany({});
    await prisma.scheduleEditLock.deleteMany({});
    await prisma.schedulePattern.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.shiftType.deleteMany({ where: { code: { in: ['C1_TEST', 'OFF_TEST', 'NEW_SHIFT', 'BLOCKED'] } } });
    await prisma.$disconnect();
    await pool.end();
  });

  // ─── ShiftType taxonomy ──────────────────────────────────────────────────────

  describe('ShiftType Taxonomy', () => {
    it('lists shift types (all roles)', async () => {
      const cookies = await login('STF001');
      const res = await request(app)
        .get('/api/taxonomy/shift-types')
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // At minimum our test fixtures are present
      const codes = res.body.map((s: { code: string }) => s.code);
      expect(codes).toContain('C1_TEST');
    });

    it('filters activeOnly', async () => {
      const cookies = await login('STF001');
      const res = await request(app)
        .get('/api/taxonomy/shift-types?activeOnly=true')
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      expect(res.body.every((s: { isActive: boolean }) => s.isActive)).toBe(true);
    });

    it('creates shift type (Director/Admin only)', async () => {
      const cookies = await login('DIR001');
      const res = await request(app)
        .post('/api/taxonomy/shift-types')
        .set('Cookie', cookies)
        .send({ code: 'NEW_SHIFT', name: 'New Shift', color: '#FF0000', isWorkDay: true });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe('NEW_SHIFT');
    });

    it('blocks staff from creating shift types', async () => {
      const cookies = await login('STF001');
      const res = await request(app)
        .post('/api/taxonomy/shift-types')
        .set('Cookie', cookies)
        .send({ code: 'BLOCKED', name: 'Blocked', color: '#000', isWorkDay: true });
      expect(res.status).toBe(403);
    });
  });

  // ─── Schedule entries: upsert (draft) ────────────────────────────────────────

  describe('Upsert Draft Entries', () => {
    it('manager can upsert draft entries for own division', async () => {
      const cookies = await login('MGR001');
      const res = await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({
          entries: [
            { userId: staffId, date: '2026-07-01', slotIndex: 0, shiftTypeId: workingShift.id },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(1);
    });

    it('stores entry as draft (publishedAt = null)', async () => {
      const cookies = await login('MGR001');
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-01', shiftTypeId: workingShift.id }] });

      const entry = await prisma.scheduleEntry.findFirst({
        where: { userId: staffId, divisionId, deletedAt: null },
      });
      expect(entry).not.toBeNull();
      expect(entry!.publishedAt).toBeNull();
    });

    it('soft-deletes previous draft for same slot on re-upsert', async () => {
      const cookies = await login('MGR001');
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-01', shiftTypeId: workingShift.id }] });
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-01', shiftTypeId: offShift.id }] });

      const active = await prisma.scheduleEntry.findMany({
        where: { userId: staffId, divisionId, deletedAt: null },
      });
      expect(active).toHaveLength(1);
      expect(active[0]!.shiftTypeId).toBe(offShift.id);
    });

    it('blocks manager from editing another division', async () => {
      const cookies = await login('MGR002');
      const res = await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-01', shiftTypeId: workingShift.id }] });
      expect(res.status).toBe(403);
    });

    it('blocks staff from upserting entries', async () => {
      const cookies = await login('STF001');
      const res = await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-01', shiftTypeId: workingShift.id }] });
      expect(res.status).toBe(403);
    });
  });

  // ─── Conflict check ──────────────────────────────────────────────────────────

  describe('Conflict Check', () => {
    it('returns null when no schedule entry exists', async () => {
      const cookies = await login('STF001');
      const res = await request(app)
        .get('/api/schedules/conflict-check')
        .query({ userId: staffId, date: '2026-07-15' })
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      expect(res.body.entry).toBeNull();
    });

    it('returns draft entry (draft overrides nothing when no published exists)', async () => {
      const mgrCookies = await login('MGR001');
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', mgrCookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-15', shiftTypeId: offShift.id }] });

      const cookies = await login('STF001');
      const res = await request(app)
        .get('/api/schedules/conflict-check')
        .query({ userId: staffId, date: '2026-07-15' })
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      expect(res.body.entry).not.toBeNull();
      expect(res.body.entry.isWorkDay).toBe(false);
      expect(res.body.entry.isDraft).toBe(true);
    });

    it('draft overrides published entry for conflict check', async () => {
      // Create a published "working" entry
      await prisma.scheduleEntry.create({
        data: {
          userId: staffId,
          divisionId,
          date: new Date('2026-07-20'),
          slotIndex: 0,
          shiftTypeId: workingShift.id,
          publishedAt: new Date('2026-07-01'),
        },
      });

      // Manager creates a draft "off" entry for same day
      const mgrCookies = await login('MGR001');
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', mgrCookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-20', shiftTypeId: offShift.id }] });

      const cookies = await login('STF001');
      const res = await request(app)
        .get('/api/schedules/conflict-check')
        .query({ userId: staffId, date: '2026-07-20' })
        .set('Cookie', cookies);
      expect(res.body.entry.isWorkDay).toBe(false); // draft wins
      expect(res.body.entry.isDraft).toBe(true);
    });
  });

  // ─── Lock management ─────────────────────────────────────────────────────────

  describe('Edit Lock', () => {
    it('manager can acquire lock', async () => {
      const cookies = await login('MGR001');
      const res = await request(app)
        .post(`/api/schedules/${divisionId}/lock`)
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      expect(res.body.locked).toBe(true);
    });

    it('second manager is rejected while first holds active lock', async () => {
      const mgr1Cookies = await login('MGR001');
      await request(app).post(`/api/schedules/${divisionId}/lock`).set('Cookie', mgr1Cookies);

      const mgr2Cookies = await login('DIR001'); // director is also a manager-class for schedule
      const res = await request(app)
        .post(`/api/schedules/${divisionId}/lock`)
        .set('Cookie', mgr2Cookies);
      expect(res.status).toBe(409);
    });

    it('same user can renew own lock', async () => {
      const cookies = await login('MGR001');
      await request(app).post(`/api/schedules/${divisionId}/lock`).set('Cookie', cookies);
      const res = await request(app)
        .post(`/api/schedules/${divisionId}/lock`)
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
    });

    it('manager can release lock', async () => {
      const cookies = await login('MGR001');
      await request(app).post(`/api/schedules/${divisionId}/lock`).set('Cookie', cookies);
      const res = await request(app)
        .delete(`/api/schedules/${divisionId}/lock`)
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      const lock = await prisma.scheduleEditLock.findUnique({ where: { divisionId } });
      expect(lock).toBeNull();
    });

    it('takeover is allowed when lock is expired', async () => {
      // Create an already-expired lock
      await prisma.scheduleEditLock.upsert({
        where: { divisionId },
        create: { divisionId, lockedByUserId: managerId, lockExpiresAt: new Date('2020-01-01') },
        update: { lockedByUserId: managerId, lockExpiresAt: new Date('2020-01-01') },
      });

      const cookies = await login('DIR001');
      const res = await request(app)
        .post(`/api/schedules/${divisionId}/lock/takeover`)
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      const lock = await prisma.scheduleEditLock.findUnique({ where: { divisionId } });
      expect(lock!.lockedByUserId).toBe(directorId);
    });

    it('takeover is rejected when lock is still active', async () => {
      const cookies = await login('MGR001');
      await request(app).post(`/api/schedules/${divisionId}/lock`).set('Cookie', cookies);

      const dirCookies = await login('DIR001');
      const res = await request(app)
        .post(`/api/schedules/${divisionId}/lock/takeover`)
        .set('Cookie', dirCookies);
      expect(res.status).toBe(409);
    });
  });

  // ─── Publish ─────────────────────────────────────────────────────────────────

  describe('Publish', () => {
    it('publishes all drafts and stamps publishedAt', async () => {
      const cookies = await login('MGR001');
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-01', shiftTypeId: workingShift.id }] });

      const res = await request(app)
        .post(`/api/schedules/${divisionId}/publish`)
        .set('Cookie', cookies)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.published).toBe(1);

      const entry = await prisma.scheduleEntry.findFirst({
        where: { userId: staffId, divisionId, deletedAt: null },
      });
      expect(entry!.publishedAt).not.toBeNull();
    });

    it('writes AuditLog on publish', async () => {
      const cookies = await login('MGR001');
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-02', shiftTypeId: workingShift.id }] });
      await request(app).post(`/api/schedules/${divisionId}/publish`).set('Cookie', cookies).send({});

      const log = await prisma.auditLog.findFirst({
        where: { actionType: 'SCHEDULE_PUBLISH', entityType: 'SCHEDULE', entityId: String(divisionId) },
        orderBy: { timestamp: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log!.performedByUserId).toBe(managerId);
    });

    it('writes FeedPost on publish', async () => {
      const cookies = await login('MGR001');
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-03', shiftTypeId: workingShift.id }] });
      await request(app).post(`/api/schedules/${divisionId}/publish`).set('Cookie', cookies).send({});

      const feed = await prisma.feedPost.findFirst({
        where: { scope: 'DIVISION', scopeId: divisionId, type: 'SYSTEM_EVENT' },
        orderBy: { createdAt: 'desc' },
      });
      expect(feed).not.toBeNull();
      expect(feed!.content).toContain('Schedule published');
    });

    it('on publish, soft-deletes old published entry for the same slot', async () => {
      // Seed a published entry
      const oldEntry = await prisma.scheduleEntry.create({
        data: { userId: staffId, divisionId, date: new Date('2026-07-10'), slotIndex: 0, shiftTypeId: workingShift.id, publishedAt: new Date() },
      });

      // Manager creates draft for same day
      const cookies = await login('MGR001');
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({ entries: [{ userId: staffId, date: '2026-07-10', shiftTypeId: offShift.id }] });
      await request(app).post(`/api/schedules/${divisionId}/publish`).set('Cookie', cookies).send({});

      const superseded = await prisma.scheduleEntry.findUnique({ where: { id: oldEntry.id } });
      expect(superseded!.deletedAt).not.toBeNull();

      const active = await prisma.scheduleEntry.findMany({ where: { userId: staffId, divisionId, date: new Date('2026-07-10'), deletedAt: null } });
      expect(active).toHaveLength(1);
      expect(active[0]!.shiftTypeId).toBe(offShift.id);
    });

    it('publish with no drafts returns 0 published', async () => {
      const cookies = await login('MGR001');
      const res = await request(app)
        .post(`/api/schedules/${divisionId}/publish`)
        .set('Cookie', cookies)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.published).toBe(0);
    });

    it('blocks staff from publishing', async () => {
      const cookies = await login('STF001');
      const res = await request(app)
        .post(`/api/schedules/${divisionId}/publish`)
        .set('Cookie', cookies)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  // ─── Rotation patterns ───────────────────────────────────────────────────────

  describe('Rotation Patterns', () => {
    it('manager can create and apply a pattern', async () => {
      const cookies = await login('MGR001');

      // Create pattern: Mon–Fri working, Sat–Sun off
      const createRes = await request(app)
        .post('/api/schedules/patterns')
        .set('Cookie', cookies)
        .send({
          name: 'Standard Week',
          weekTemplate: {
            mon: workingShift.id, tue: workingShift.id, wed: workingShift.id,
            thu: workingShift.id, fri: workingShift.id,
            sat: offShift.id, sun: offShift.id,
          },
        });
      expect(createRes.status).toBe(201);

      const patternId = createRes.body.id;
      const applyRes = await request(app)
        .post(`/api/schedules/${divisionId}/patterns/${patternId}/apply`)
        .set('Cookie', cookies)
        .send({ userIds: [staffId], dateFrom: '2026-07-06', dateTo: '2026-07-12' }); // Mon–Sun
      expect(applyRes.status).toBe(200);
      // 7 days, all have a shiftType in weekTemplate
      expect(applyRes.body.applied).toBe(7);
    });
  });

  // ─── Copy week ───────────────────────────────────────────────────────────────

  describe('Copy Week', () => {
    it('copies effective entries from source window to next 7 days as drafts', async () => {
      const cookies = await login('MGR001');
      // Seed source entries
      await request(app)
        .put(`/api/schedules/${divisionId}/entries`)
        .set('Cookie', cookies)
        .send({
          entries: [
            { userId: staffId, date: '2026-07-06', shiftTypeId: workingShift.id },
            { userId: staffId, date: '2026-07-07', shiftTypeId: workingShift.id },
          ],
        });

      const res = await request(app)
        .post(`/api/schedules/${divisionId}/copy-week`)
        .set('Cookie', cookies)
        .send({ sourceFrom: '2026-07-06', sourceTo: '2026-07-07' });
      expect(res.status).toBe(200);
      expect(res.body.copied).toBe(2);

      // Verify next week entries exist as drafts
      const nextWeekEntries = await prisma.scheduleEntry.findMany({
        where: {
          userId: staffId,
          divisionId,
          date: { gte: new Date('2026-07-13'), lte: new Date('2026-07-14') },
          publishedAt: null,
          deletedAt: null,
        },
      });
      expect(nextWeekEntries).toHaveLength(2);
    });
  });

  // ─── GET schedule ────────────────────────────────────────────────────────────

  describe('GET /api/schedules/:divisionId', () => {
    it('staff see published-only entries', async () => {
      // Create one draft and one published entry
      await prisma.scheduleEntry.createMany({
        data: [
          { userId: staffId, divisionId, date: new Date('2026-07-01'), slotIndex: 0, shiftTypeId: workingShift.id, publishedAt: new Date() },
          { userId: staffId, divisionId, date: new Date('2026-07-02'), slotIndex: 0, shiftTypeId: offShift.id, publishedAt: null },
        ],
      });

      const cookies = await login('STF001');
      const res = await request(app)
        .get(`/api/schedules/${divisionId}`)
        .query({ dateFrom: '2026-07-01', dateTo: '2026-07-07' })
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].publishedAt).not.toBeNull();
    });

    it('managers see both draft and published entries', async () => {
      await prisma.scheduleEntry.createMany({
        data: [
          { userId: staffId, divisionId, date: new Date('2026-07-01'), slotIndex: 0, shiftTypeId: workingShift.id, publishedAt: new Date() },
          { userId: staffId, divisionId, date: new Date('2026-07-02'), slotIndex: 0, shiftTypeId: offShift.id, publishedAt: null },
        ],
      });

      const cookies = await login('MGR001');
      const res = await request(app)
        .get(`/api/schedules/${divisionId}`)
        .query({ dateFrom: '2026-07-01', dateTo: '2026-07-07' })
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
    });

    it('requires dateFrom and dateTo', async () => {
      const cookies = await login('STF001');
      const res = await request(app)
        .get(`/api/schedules/${divisionId}`)
        .set('Cookie', cookies);
      expect(res.status).toBe(400);
    });
  });
});
