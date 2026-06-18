import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { fireRecurrenceForBlueprint, runRecurrenceCron } from '../services/recurrenceService';
import { calendarDateUtc } from '../services/autoGenService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

describe('Recurrence Service (P7)', () => {
  let divisionId: number;
  let ownerId: number;
  let directorToken: string;

  beforeAll(async () => {
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const dept = await prisma.department.upsert({ where: { name: 'Rec Dept' }, update: {}, create: { name: 'Rec Dept' } });
    const division = await prisma.division.upsert({ where: { code: 'REC' }, update: {}, create: { name: 'Rec Div', code: 'REC', departmentId: dept.id } });
    divisionId = division.id;

    const owner = await prisma.user.create({
      data: { name: 'Rec Owner', email: 'owner_rec@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id },
    });
    ownerId = owner.id;
    const director = await prisma.user.create({
      data: { name: 'Rec Director', email: 'director_rec@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id },
    });
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    directorToken = jwt.sign({ userId: director.id, role: 'Director', divisionId }, secret);

    await prisma.wpType.upsert({ where: { code: 'AUDIT' }, update: {}, create: { code: 'AUDIT', description: 'Audit' } });
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.wpBlueprint.deleteMany({});
    await prisma.templateSetItem.deleteMany({});
    await prisma.templateSet.deleteMany({});
    await prisma.template.deleteMany({});
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.wpBlueprint.deleteMany({});
    await prisma.templateSetItem.deleteMany({});
    await prisma.templateSet.deleteMany({});
    await prisma.template.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { in: ['owner_rec@sqd.com', 'director_rec@sqd.com'] } } });
    await prisma.$disconnect();
    await pool.end();
  });

  // ── helpers ─────────────────────────────────────────────────────────────────
  const createBlueprint = (data: Record<string, unknown> = {}) =>
    prisma.wpBlueprint.create({
      data: {
        name: 'Routine line audit',
        type: 'AUDIT',
        divisionId,
        defaultDuration: 10,
        ownerId,
        isActive: true,
        ...data,
      },
    });

  // ── CALENDAR mode ─────────────────────────────────────────────────────────────
  describe('CALENDAR recurrence', () => {
    it('fires a routine WP and advances nextRunAt by the interval (from the scheduled date)', async () => {
      const scheduled = calendarDateUtc(daysAgo(1));
      const bp = await createBlueprint({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: scheduled, nextRunAt: scheduled });

      const r = await fireRecurrenceForBlueprint(bp.id, prisma);
      expect(r.fired).toBe(true);

      const wp = await prisma.workPackage.findUnique({ where: { id: r.workPackageId! } });
      expect(wp?.blueprintId).toBe(bp.id);
      expect(wp?.isRoutine).toBe(true);
      expect(wp?.wpId).toMatch(/^REC-WP-\d{6}$/);

      const reloaded = await prisma.wpBlueprint.findUnique({ where: { id: bp.id } });
      const expectedNext = new Date(scheduled.getTime() + 30 * DAY);
      expect(reloaded?.nextRunAt?.toISOString()).toBe(expectedNext.toISOString());

      // Audit row for the auto-launch.
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'WorkPackage', entityId: String(r.workPackageId), actionType: 'BLUEPRINT_AUTO_LAUNCHED' } });
      expect(audit).not.toBeNull();
    });

    it('skips cycles missed by a late cron so nextRunAt lands in the future', async () => {
      // Scheduled 95 days ago with a 30-day cadence → next should be the first future multiple.
      const scheduled = calendarDateUtc(daysAgo(95));
      const bp = await createBlueprint({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: scheduled, nextRunAt: scheduled });

      const r = await fireRecurrenceForBlueprint(bp.id, prisma);
      expect(r.fired).toBe(true);
      const reloaded = await prisma.wpBlueprint.findUnique({ where: { id: bp.id } });
      const today = calendarDateUtc(new Date());
      expect(reloaded!.nextRunAt!.getTime()).toBeGreaterThan(today.getTime());
    });

    it('does not touch nextRunAt when a CALENDAR instance is closed', async () => {
      const scheduled = calendarDateUtc(daysFromNow(5));
      const bp = await createBlueprint({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: scheduled, nextRunAt: scheduled });
      const wp = await prisma.workPackage.create({
        data: { wpId: 'REC-WP-900001', name: 'inst', type: 'AUDIT', divisionId, timeframeFrom: daysAgo(1), timeframeTo: daysFromNow(9), creatorId: ownerId, status: 'In Progress', blueprintId: bp.id, isRoutine: true },
      });
      await request(app).put(`/api/work-packages/${wp.id}/status`).set('Authorization', `Bearer ${directorToken}`).send({ status: 'Closed' });

      const reloaded = await prisma.wpBlueprint.findUnique({ where: { id: bp.id } });
      expect(reloaded?.nextRunAt?.toISOString()).toBe(scheduled.toISOString());
    });
  });

  // ── LAST_DONE mode ────────────────────────────────────────────────────────────
  describe('LAST_DONE recurrence', () => {
    it('fires a routine WP then nulls nextRunAt until the instance is closed', async () => {
      const scheduled = calendarDateUtc(daysAgo(1));
      const bp = await createBlueprint({ recurrenceType: 'LAST_DONE', recurrenceInterval: 14, recurrenceStartDate: scheduled, nextRunAt: scheduled });

      const r = await fireRecurrenceForBlueprint(bp.id, prisma);
      expect(r.fired).toBe(true);
      const reloaded = await prisma.wpBlueprint.findUnique({ where: { id: bp.id } });
      expect(reloaded?.nextRunAt).toBeNull();
    });

    it('re-arms nextRunAt to closedAt + interval when the instance is closed', async () => {
      const bp = await createBlueprint({ recurrenceType: 'LAST_DONE', recurrenceInterval: 14, recurrenceStartDate: calendarDateUtc(daysAgo(1)), nextRunAt: null });
      const wp = await prisma.workPackage.create({
        data: { wpId: 'REC-WP-910001', name: 'inst', type: 'AUDIT', divisionId, timeframeFrom: daysAgo(1), timeframeTo: daysFromNow(9), creatorId: ownerId, status: 'In Progress', blueprintId: bp.id, isRoutine: true },
      });

      const res = await request(app).put(`/api/work-packages/${wp.id}/status`).set('Authorization', `Bearer ${directorToken}`).send({ status: 'Closed' });
      expect(res.status).toBe(200);

      const closed = await prisma.workPackage.findUnique({ where: { id: wp.id } });
      expect(closed?.closedAt).not.toBeNull();
      const reloaded = await prisma.wpBlueprint.findUnique({ where: { id: bp.id } });
      const expectedNext = new Date(calendarDateUtc(closed!.closedAt!).getTime() + 14 * DAY);
      expect(reloaded?.nextRunAt?.toISOString()).toBe(expectedNext.toISOString());
    });
  });

  // ── eligibility / cron ─────────────────────────────────────────────────────────
  describe('runRecurrenceCron', () => {
    it('fires due blueprints and skips disabled / future / non-recurring ones', async () => {
      const due = await createBlueprint({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: calendarDateUtc(daysAgo(1)), nextRunAt: calendarDateUtc(daysAgo(1)) });
      await createBlueprint({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: calendarDateUtc(daysFromNow(5)), nextRunAt: calendarDateUtc(daysFromNow(5)) }); // future
      await createBlueprint({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: calendarDateUtc(daysAgo(1)), nextRunAt: calendarDateUtc(daysAgo(1)), isActive: false }); // disabled
      await createBlueprint({ recurrenceType: null, nextRunAt: null }); // non-recurring

      const summary = await runRecurrenceCron(prisma);
      expect(summary.fired).toBe(1);
      expect(await prisma.workPackage.count({ where: { blueprintId: due.id } })).toBe(1);
    });

    it('does not fire a blueprint whose nextRunAt is null', async () => {
      const bp = await createBlueprint({ recurrenceType: 'LAST_DONE', recurrenceInterval: 14, recurrenceStartDate: calendarDateUtc(daysAgo(1)), nextRunAt: null });
      const r = await fireRecurrenceForBlueprint(bp.id, prisma);
      expect(r.fired).toBe(false);
      expect(await prisma.workPackage.count({ where: { blueprintId: bp.id } })).toBe(0);
    });
  });

  // ── concurrency ─────────────────────────────────────────────────────────────
  describe('concurrency', () => {
    it('two concurrent fires launch exactly one WP (FOR UPDATE lock)', async () => {
      const scheduled = calendarDateUtc(daysAgo(1));
      const bp = await createBlueprint({ recurrenceType: 'CALENDAR', recurrenceInterval: 30, recurrenceStartDate: scheduled, nextRunAt: scheduled });
      const [r1, r2] = await Promise.all([fireRecurrenceForBlueprint(bp.id, prisma), fireRecurrenceForBlueprint(bp.id, prisma)]);
      const firedCount = [r1, r2].filter((r) => r.fired).length;
      expect(firedCount).toBe(1);
      expect(await prisma.workPackage.count({ where: { blueprintId: bp.id } })).toBe(1);
    });
  });
});
