import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { fireAutoGenForWp, runAutoGenCron, validateAutoGenConfig, parseInlineSet } from '../services/autoGenService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

describe('Auto-Generate Service', () => {
  let divisionId: number;
  let creatorId: number;
  let viewerId: number;
  let viewerToken: string;
  let wpSeq = 700000;

  beforeAll(async () => {
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const department = await prisma.department.upsert({ where: { name: 'AutoGen Dept' }, update: {}, create: { name: 'AutoGen Dept' } });
    const division = await prisma.division.upsert({ where: { code: 'AGN' }, update: {}, create: { name: 'AutoGen Div', code: 'AGN', departmentId: department.id } });
    divisionId = division.id;

    const creator = await prisma.user.create({
      data: { name: 'AutoGen Creator', email: 'creator_agn@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id },
    });
    creatorId = creator.id;

    const viewer = await prisma.user.create({
      data: { name: 'AutoGen Viewer', email: 'viewer_agn@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id },
    });
    viewerId = viewer.id;
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    viewerToken = jwt.sign({ userId: viewer.id, role: 'Director', divisionId }, secret);

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
    await prisma.user.deleteMany({ where: { email: { in: ['creator_agn@sqd.com', 'viewer_agn@sqd.com'] } } });
    await prisma.$disconnect();
    await pool.end();
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  let tplSeq = 0;
  const publishTemplate = (overrides: Record<string, unknown> = {}) =>
    prisma.template.create({
      data: {
        templateId: `AGN-T${tplSeq++}-${Date.now() % 100000}`,
        title: 'AutoGen Template',
        formSchema: [{ id: '1', type: 'text', label: 'x' }],
        status: 'Published',
        publishedAt: new Date(),
        ownerId: creatorId,
        divisionId,
        ...overrides,
      },
    });

  const createWp = (data: Record<string, unknown> = {}) =>
    prisma.workPackage.create({
      data: {
        wpId: `AGN-WP-${wpSeq++}`,
        name: 'AutoGen WP',
        type: 'AUDIT',
        divisionId,
        timeframeFrom: daysAgo(1),
        timeframeTo: daysFromNow(30),
        creatorId,
        status: 'Open',
        ...data,
      },
    });

  // ── config validation ───────────────────────────────────────────────────────
  describe('validateAutoGenConfig', () => {
    it('disabled config nulls all source columns', async () => {
      const r = await validateAutoGenConfig(prisma, { autoGenerate: false });
      expect('data' in r && r.data.autoGenerate).toBe(false);
    });

    it('rejects REPEAT with a set source', async () => {
      const set = await prisma.templateSet.create({ data: { name: 'S', divisionId, ownerId: creatorId } });
      const r = await validateAutoGenConfig(prisma, { autoGenerate: true, autoGenMode: 'REPEAT', autoGenSetId: set.id, autoGenInterval: 7 });
      expect('error' in r).toBe(true);
    });

    it('rejects more than one source', async () => {
      const t = await publishTemplate();
      const set = await prisma.templateSet.create({ data: { name: 'S', divisionId, ownerId: creatorId } });
      const r = await validateAutoGenConfig(prisma, { autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenTemplateId: t.id, autoGenSetId: set.id });
      expect('error' in r).toBe(true);
    });

    it('rejects a non-Published template source', async () => {
      const t = await publishTemplate({ status: 'Draft', publishedAt: null });
      const r = await validateAutoGenConfig(prisma, { autoGenerate: true, autoGenMode: 'REPEAT', autoGenTemplateId: t.id, autoGenInterval: 1 });
      expect('error' in r).toBe(true);
    });

    it('accepts a valid REPEAT single-template config', async () => {
      const t = await publishTemplate();
      const r = await validateAutoGenConfig(prisma, { autoGenerate: true, autoGenMode: 'REPEAT', autoGenTemplateId: t.id, autoGenInterval: 7 });
      expect('data' in r).toBe(true);
    });

    it('coerces a string-typed autoGenInterval (JSON body numerics)', async () => {
      const t = await publishTemplate();
      const r = await validateAutoGenConfig(prisma, { autoGenerate: true, autoGenMode: 'REPEAT', autoGenTemplateId: t.id, autoGenInterval: '7' as unknown as number });
      expect('data' in r && r.data.autoGenInterval).toBe(7);
    });

    it('rejects a stored autoGenInterval of 0', async () => {
      const t = await publishTemplate();
      const r = await validateAutoGenConfig(prisma, { autoGenerate: true, autoGenMode: 'REPEAT', autoGenTemplateId: t.id, autoGenInterval: 0 });
      expect('error' in r).toBe(true);
    });
  });

  describe('parseInlineSet', () => {
    it('rejects a non-array', () => {
      expect('error' in parseInlineSet({})).toBe(true);
    });
    it('rejects duplicate orderIndex', () => {
      expect('error' in parseInlineSet([{ templateId: 1, orderIndex: 0 }, { templateId: 2, orderIndex: 0 }])).toBe(true);
    });
    it('parses a valid array', () => {
      const r = parseInlineSet([{ templateId: 1, orderIndex: 0 }, { templateId: 2, orderIndex: 1 }]);
      expect('items' in r && r.items.length).toBe(2);
    });
    it('coerces string-typed numerics (templateId, orderIndex, deadlineOffsetDays)', () => {
      const r = parseInlineSet([{ templateId: '1', orderIndex: '0', deadlineOffsetDays: '3' }]);
      expect('items' in r).toBe(true);
      if ('items' in r) {
        expect(r.items[0]).toMatchObject({ templateId: 1, orderIndex: 0, deadlineOffsetDays: 3 });
      }
    });
  });

  // ── REPEAT mode ──────────────────────────────────────────────────────────────
  describe('REPEAT mode', () => {
    it('fires once, then respects the interval, then fires again after it elapses', async () => {
      const t = await publishTemplate();
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'REPEAT', autoGenInterval: 1, autoGenTemplateId: t.id });

      const r1 = await fireAutoGenForWp(wp.id, prisma);
      expect(r1.fired).toBe(true);
      expect(r1.spawned).toBe(1);

      // Immediately again — interval (1 day) has not elapsed.
      const r2 = await fireAutoGenForWp(wp.id, prisma);
      expect(r2.fired).toBe(false);
      expect(r2.reason).toMatch(/interval has not elapsed/i);

      // Backdate the last fire so the interval has elapsed.
      await prisma.workPackage.update({ where: { id: wp.id }, data: { autoGenFiredAt: daysAgo(3) } });
      const r3 = await fireAutoGenForWp(wp.id, prisma);
      expect(r3.fired).toBe(true);

      expect(await prisma.task.count({ where: { wpId: wp.id } })).toBe(2);
    });

    it('REPEAT task deadline equals timeframeTo (new model)', async () => {
      const t = await publishTemplate();
      const to = daysFromNow(15);
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'REPEAT', autoGenInterval: 1, autoGenTemplateId: t.id, timeframeTo: to });
      await fireAutoGenForWp(wp.id, prisma);
      const task = await prisma.task.findFirst({ where: { wpId: wp.id } });
      expect(task!.deadline!.getTime()).toBe(to.getTime());
    });

    it('does not fire before the WP has started', async () => {
      const t = await publishTemplate();
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'REPEAT', autoGenInterval: 1, autoGenTemplateId: t.id, timeframeFrom: daysFromNow(5), timeframeTo: daysFromNow(40) });
      const r = await fireAutoGenForWp(wp.id, prisma);
      expect(r.fired).toBe(false);
      expect(r.reason).toMatch(/not started/i);
    });

    it('does not fire after the WP timeframe has ended', async () => {
      const t = await publishTemplate();
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'REPEAT', autoGenInterval: 1, autoGenTemplateId: t.id, timeframeFrom: daysAgo(40), timeframeTo: daysAgo(5) });
      const r = await fireAutoGenForWp(wp.id, prisma);
      expect(r.fired).toBe(false);
      expect(r.reason).toMatch(/ended/i);
    });

    it('spawned task carries a schemaSnapshot and dual-write entries', async () => {
      const t = await publishTemplate();
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'REPEAT', autoGenInterval: 1, autoGenTemplateId: t.id });
      const r = await fireAutoGenForWp(wp.id, prisma);
      const task = await prisma.task.findUnique({ where: { id: r.spawnedTaskIds[0]! } });
      expect(task!.status).toBe('Unassigned');
      expect(task!.schemaSnapshot).toBeDefined();

      // Per-task SYSTEM_EVENT (from createTaskService) + WP-scope summary event.
      const taskEvent = await prisma.feedPost.findFirst({ where: { scope: 'TASK', scopeId: task!.id, type: 'SYSTEM_EVENT' } });
      expect(taskEvent).not.toBeNull();
      const wpEvent = await prisma.feedPost.findFirst({ where: { scope: 'WP', scopeId: wp.id, type: 'SYSTEM_EVENT' } });
      expect(wpEvent).not.toBeNull();
      const audit = await prisma.auditLog.findFirst({ where: { actionType: 'WP_AUTO_GEN_FIRED', entityId: String(wp.id) } });
      expect(audit).not.toBeNull();
    });
  });

  // ── SINGLE_SHOT mode + sources ────────────────────────────────────────────────
  describe('SINGLE_SHOT mode', () => {
    it('single-template source fires exactly once', async () => {
      const t = await publishTemplate();
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenTemplateId: t.id });
      const r1 = await fireAutoGenForWp(wp.id, prisma);
      expect(r1.fired).toBe(true);
      expect(r1.spawned).toBe(1);
      const r2 = await fireAutoGenForWp(wp.id, prisma);
      expect(r2.fired).toBe(false);
      expect(r2.reason).toMatch(/already fired/i);
      expect(await prisma.task.count({ where: { wpId: wp.id } })).toBe(1);
    });

    it('saved set spawns all items in order with per-item deadline offsets', async () => {
      const t1 = await publishTemplate();
      const t2 = await publishTemplate();
      const to = daysFromNow(20);
      const set = await prisma.templateSet.create({
        data: {
          name: 'Two-item set', divisionId, ownerId: creatorId,
          items: { create: [
            { templateId: t1.id, orderIndex: 0, deadlineOffsetDays: 5 },
            { templateId: t2.id, orderIndex: 1, deadlineOffsetDays: 1 },
          ] },
        },
      });
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenSetId: set.id, timeframeTo: to });

      const r = await fireAutoGenForWp(wp.id, prisma);
      expect(r.fired).toBe(true);
      expect(r.spawned).toBe(2);

      const tasks = await prisma.task.findMany({ where: { wpId: wp.id }, orderBy: { id: 'asc' } });
      expect(tasks.map((t) => t.templateId)).toEqual([t1.id, t2.id]);
      expect(tasks[0]!.deadline!.getTime()).toBe(to.getTime() - 5 * DAY);
      expect(tasks[1]!.deadline!.getTime()).toBe(to.getTime() - 1 * DAY);
    });

    it('inline set spawns items in order', async () => {
      const t1 = await publishTemplate();
      const t2 = await publishTemplate();
      const inline = [
        { templateId: t2.id, orderIndex: 1 },
        { templateId: t1.id, orderIndex: 0 },
      ];
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenInlineSet: inline });
      const r = await fireAutoGenForWp(wp.id, prisma);
      expect(r.spawned).toBe(2);
      const tasks = await prisma.task.findMany({ where: { wpId: wp.id }, orderBy: { id: 'asc' } });
      // Sorted by orderIndex → t1 (0) before t2 (1).
      expect(tasks.map((t) => t.templateId)).toEqual([t1.id, t2.id]);
    });

    it('skips an archived template in a set but still spawns the rest and fires once', async () => {
      const good = await publishTemplate();
      const archived = await publishTemplate();
      const set = await prisma.templateSet.create({
        data: {
          name: 'Mixed set', divisionId, ownerId: creatorId,
          items: { create: [
            { templateId: good.id, orderIndex: 0 },
            { templateId: archived.id, orderIndex: 1 },
          ] },
        },
      });
      // Archive after building the set (config validation only runs at WP create time).
      await prisma.template.update({ where: { id: archived.id }, data: { status: 'Archived' } });

      const wp = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenSetId: set.id });
      const r = await fireAutoGenForWp(wp.id, prisma);
      expect(r.fired).toBe(true);
      expect(r.spawned).toBe(1);
      expect(r.warnings && r.warnings.length).toBe(1);

      // Fired-once: a second run does nothing even though one item was skipped.
      const r2 = await fireAutoGenForWp(wp.id, prisma);
      expect(r2.fired).toBe(false);
      expect(await prisma.task.count({ where: { wpId: wp.id } })).toBe(1);
    });

    it('malformed autoGenInlineSet surfaces a warning instead of a silent permanent no-op', async () => {
      // Bypasses validateAutoGenConfig (which would reject this at create time)
      // to simulate data that became malformed after the fact.
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenInlineSet: [{ orderIndex: 0 }] });
      const r = await fireAutoGenForWp(wp.id, prisma);
      expect(r.fired).toBe(false);
      expect(r.warnings && r.warnings.length).toBe(1);
      expect(await prisma.task.count({ where: { wpId: wp.id } })).toBe(0);

      const feedPost = await prisma.feedPost.findFirst({ where: { scope: 'WP', scopeId: wp.id, type: 'SYSTEM_EVENT' } });
      expect(feedPost).not.toBeNull();
      const auditEntry = await prisma.auditLog.findFirst({ where: { entityType: 'WorkPackage', entityId: String(wp.id), actionType: 'WP_AUTO_GEN_FAILED' } });
      expect(auditEntry).not.toBeNull();

      // Not stamped — once the data is fixed it can still fire normally.
      const reloaded = await prisma.workPackage.findUnique({ where: { id: wp.id } });
      expect(reloaded?.autoGenFiredAt).toBeNull();
    });
  });

  // ── concurrency / idempotency ─────────────────────────────────────────────────
  describe('concurrency', () => {
    it('two concurrent fires spawn exactly once (FOR UPDATE lock)', async () => {
      const t = await publishTemplate();
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenTemplateId: t.id });
      const [r1, r2] = await Promise.all([fireAutoGenForWp(wp.id, prisma), fireAutoGenForWp(wp.id, prisma)]);
      const firedCount = [r1, r2].filter((r) => r.fired).length;
      expect(firedCount).toBe(1);
      expect(await prisma.task.count({ where: { wpId: wp.id } })).toBe(1);
    });
  });

  // ── cron sweep ─────────────────────────────────────────────────────────────────
  describe('runAutoGenCron', () => {
    it('fires eligible WPs and skips disabled / closed ones', async () => {
      const t = await publishTemplate();
      const eligible = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenTemplateId: t.id });
      await createWp({ autoGenerate: false }); // disabled
      await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenTemplateId: t.id, status: 'Closed' }); // closed

      const summary = await runAutoGenCron(prisma);
      expect(summary.fired).toBe(1);
      expect(await prisma.task.count({ where: { wpId: eligible.id } })).toBe(1);
    });
  });

  // ── on-demand catch-up via GET endpoint ──────────────────────────────────────────
  describe('on-demand catch-up (GET /work-packages/:id)', () => {
    it('REPEAT mode fires on view; SINGLE_SHOT does not', async () => {
      const t = await publishTemplate();
      const repeatWp = await createWp({ autoGenerate: true, autoGenMode: 'REPEAT', autoGenInterval: 1, autoGenTemplateId: t.id });
      const singleWp = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenTemplateId: t.id });

      const repeatRes = await request(app).get(`/api/work-packages/${repeatWp.id}`).set('Authorization', `Bearer ${viewerToken}`);
      expect(repeatRes.status).toBe(200);
      expect(repeatRes.body.autoGenResult?.fired).toBe(true);
      expect(await prisma.task.count({ where: { wpId: repeatWp.id } })).toBe(1);

      const singleRes = await request(app).get(`/api/work-packages/${singleWp.id}`).set('Authorization', `Bearer ${viewerToken}`);
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.autoGenResult).toBeUndefined();
      expect(await prisma.task.count({ where: { wpId: singleWp.id } })).toBe(0);
    });
  });

  // ── spawn notifications (P8) ───────────────────────────────────────────────────
  describe('spawn notifications', () => {
    it('notifies WP-assigned members with TASKS_GENERATED when tasks auto-generate', async () => {
      const t = await publishTemplate();
      const wp = await createWp({ autoGenerate: true, autoGenMode: 'SINGLE_SHOT', autoGenTemplateId: t.id });
      // Assign a member AFTER WP creation — resolveWpWatchers reads the live list, so
      // a user attached later is still covered on the next spawn.
      await prisma.workPackageAssignment.create({ data: { wpId: wp.id, userId: viewerId } });

      const r = await fireAutoGenForWp(wp.id, prisma);
      expect(r.fired).toBe(true);

      const notes = await prisma.notification.findMany({ where: { userId: viewerId, type: 'TASKS_GENERATED', linkId: wp.id } });
      expect(notes).toHaveLength(1);
      expect(notes[0]!.linkScope).toBe('WP');
    });
  });
});
