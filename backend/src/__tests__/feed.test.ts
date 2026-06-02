import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Feed API (Phase 2)', () => {
  let directorToken: string;
  let managerToken: string;
  let groupLeaderToken: string;
  let staffToken: string;
  let adminToken: string;
  let staffBToken: string; // Staff in the other division

  let directorUserId: number;
  let managerUserId: number;
  let staffUserId: number;
  let staffBUserId: number;

  let divisionId: number; // primary division (A)
  let otherDivisionId: number; // division B
  let templateId: number;
  let taskId: number;
  let wpId: number;

  const secret = process.env.JWT_SECRET || 'fallback_secret';

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const glRole = await prisma.role.upsert({ where: { name: 'Group Leader' }, update: {}, create: { name: 'Group Leader' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });

    const dept = await prisma.department.upsert({ where: { name: 'Feed Test Dept' }, update: {}, create: { name: 'Feed Test Dept' } });
    const divA = await prisma.division.upsert({ where: { code: 'FED' }, update: {}, create: { name: 'Feed Div A', code: 'FED', departmentId: dept.id } });
    const divB = await prisma.division.upsert({ where: { code: 'FEDB' }, update: {}, create: { name: 'Feed Div B', code: 'FEDB', departmentId: dept.id } });
    divisionId = divA.id;
    otherDivisionId = divB.id;

    const mk = (name: string, email: string, roleId: number, divId: number) =>
      prisma.user.create({ data: { name, email, passwordHash: 'hash', forcePasswordChange: false, divisionId: divId, roleId } });

    const director = await mk('Feed Director', 'feed_director@sqd.com', directorRole.id, divisionId);
    const manager = await mk('Feed Manager', 'feed_manager@sqd.com', managerRole.id, divisionId);
    const groupLeader = await mk('Feed GL', 'feed_gl@sqd.com', glRole.id, divisionId);
    const staff = await mk('Feed Staff', 'feed_staff@sqd.com', staffRole.id, divisionId);
    const admin = await mk('Feed Admin', 'feed_admin@sqd.com', adminRole.id, divisionId);
    const staffB = await mk('Feed Staff B', 'feed_staffb@sqd.com', staffRole.id, otherDivisionId);

    directorUserId = director.id;
    managerUserId = manager.id;
    staffUserId = staff.id;
    staffBUserId = staffB.id;

    directorToken = jwt.sign({ userId: director.id, role: 'Director', divisionId }, secret);
    managerToken = jwt.sign({ userId: manager.id, role: 'Manager', divisionId }, secret);
    groupLeaderToken = jwt.sign({ userId: groupLeader.id, role: 'Group Leader', divisionId }, secret);
    staffToken = jwt.sign({ userId: staff.id, role: 'Staff', divisionId }, secret);
    adminToken = jwt.sign({ userId: admin.id, role: 'Admin', divisionId }, secret);
    staffBToken = jwt.sign({ userId: staffB.id, role: 'Staff', divisionId: otherDivisionId }, secret);

    // Template + Task in division A — provides a TASK-scope feed target.
    const template = await prisma.template.create({
      data: {
        templateId: 'FED-001', title: 'Feed Template', status: 'Published',
        formSchema: { fields: [] }, divisionId, ownerId: director.id,
      },
    });
    templateId = template.id;

    const task = await prisma.task.create({
      data: {
        taskId: 'FED-000001', templateId, issuerId: director.id, status: 'Assigned',
        targetDivisionId: divisionId, assignedToUserId: staff.id, schemaSnapshot: { fields: [] },
      },
    });
    taskId = task.id;

    // A Work Package in division A — provides a WP-scope feed target.
    const wp = await prisma.workPackage.create({
      data: {
        wpId: 'FED-WP-000001', name: 'Feed WP', type: 'AUDIT', divisionId,
        timeframeFrom: new Date('2026-06-01'), timeframeTo: new Date('2026-06-30'),
        creatorId: director.id, status: 'Open',
      },
    });
    wpId = wp.id;

    await prisma.wpType.upsert({ where: { code: 'AUDIT' }, update: {}, create: { code: 'AUDIT', description: 'Audit' } });
  });

  beforeEach(async () => {
    await prisma.feedPost.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'FED-' } } });
    await prisma.workPackage.deleteMany({ where: { wpId: { startsWith: 'FED-WP-' } } });
    await prisma.template.deleteMany({ where: { templateId: 'FED-001' } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'feed_' } } });
    await prisma.$disconnect();
  });

  // ─── Reads ─────────────────────────────────────────────────────────────────

  describe('GET feeds — read access (transparency: all authenticated users)', () => {
    it('rejects an unauthenticated read', async () => {
      const res = await request(app).get(`/api/feeds/WP/${wpId}`);
      expect(res.status).toBe(401);
    });

    it.each([
      ['Director', () => directorToken],
      ['Manager', () => managerToken],
      ['Group Leader', () => groupLeaderToken],
      ['Staff', () => staffToken],
    ])('lets a %s read every scope', async (_role, getToken) => {
      const token = getToken();
      for (const path of [`/api/feeds/TASK/${taskId}`, `/api/feeds/WP/${wpId}`, `/api/feeds/DIVISION/${divisionId}`, '/api/feeds/ORG']) {
        const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      }
    });

    it('returns posts oldest-first with author enrichment', async () => {
      await prisma.feedPost.create({ data: { type: 'COMMENT', scope: 'DIVISION', scopeId: divisionId, content: 'first', authorId: staffUserId } });
      await new Promise((r) => setTimeout(r, 5));
      await prisma.feedPost.create({ data: { type: 'SYSTEM_EVENT', scope: 'DIVISION', scopeId: divisionId, content: 'second' } });

      const res = await request(app).get(`/api/feeds/DIVISION/${divisionId}`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].content).toBe('first');
      expect(res.body[0].author).toEqual({ id: staffUserId, name: 'Feed Staff' });
      expect(res.body[1].content).toBe('second');
      expect(res.body[1].author).toBeNull();
    });

    it('reads the singleton ORG feed without a scopeId', async () => {
      await prisma.feedPost.create({ data: { type: 'COMMENT', scope: 'ORG', scopeId: null, content: 'org-wide', authorId: directorUserId } });
      const res = await request(app).get('/api/feeds/ORG').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].content).toBe('org-wide');
    });

    it('does not leak posts across scopes or scopeIds', async () => {
      await prisma.feedPost.create({ data: { type: 'COMMENT', scope: 'DIVISION', scopeId: divisionId, content: 'div A' } });
      await prisma.feedPost.create({ data: { type: 'COMMENT', scope: 'DIVISION', scopeId: otherDivisionId, content: 'div B' } });
      await prisma.feedPost.create({ data: { type: 'COMMENT', scope: 'WP', scopeId: wpId, content: 'wp post' } });

      const res = await request(app).get(`/api/feeds/DIVISION/${divisionId}`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].content).toBe('div A');
    });

    it('400s on an invalid scope', async () => {
      const res = await request(app).get('/api/feeds/BOGUS/1').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(400);
    });

    it('400s when a non-ORG scope is missing its scopeId', async () => {
      const res = await request(app).get('/api/feeds/WP').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(400);
    });

    it('404s on a non-existent WP / Division / Task target', async () => {
      for (const path of ['/api/feeds/WP/999999', '/api/feeds/DIVISION/999999', '/api/feeds/TASK/999999']) {
        const res = await request(app).get(path).set('Authorization', `Bearer ${staffToken}`);
        expect(res.status).toBe(404);
      }
    });
  });

  // ─── Posting RBAC ────────────────────────────────────────────────────────────

  describe('POST feeds — comment RBAC', () => {
    it('lets any role comment on TASK and WP feeds', async () => {
      const t = await request(app).post(`/api/feeds/TASK/${taskId}/posts`).set('Authorization', `Bearer ${staffToken}`).send({ content: 'task comment' });
      expect(t.status).toBe(201);
      expect(t.body.type).toBe('COMMENT');
      expect(t.body.author).toEqual({ id: staffUserId, name: 'Feed Staff' });

      const w = await request(app).post(`/api/feeds/WP/${wpId}/posts`).set('Authorization', `Bearer ${groupLeaderToken}`).send({ content: 'wp comment' });
      expect(w.status).toBe(201);
    });

    it('requires non-empty content', async () => {
      const res = await request(app).post(`/api/feeds/WP/${wpId}/posts`).set('Authorization', `Bearer ${staffToken}`).send({ content: '   ' });
      expect(res.status).toBe(400);
    });

    it('lets a Staff post to their OWN division board', async () => {
      const res = await request(app).post(`/api/feeds/DIVISION/${divisionId}/posts`).set('Authorization', `Bearer ${staffToken}`).send({ content: 'own div' });
      expect(res.status).toBe(201);
      expect(res.body.scope).toBe('DIVISION');
      expect(res.body.scopeId).toBe(divisionId);
    });

    it('blocks a Staff from posting to ANOTHER division board', async () => {
      const res = await request(app).post(`/api/feeds/DIVISION/${otherDivisionId}/posts`).set('Authorization', `Bearer ${staffToken}`).send({ content: 'other div' });
      expect(res.status).toBe(403);
    });

    it('lets a Director post to ANY division board (division bypass)', async () => {
      const res = await request(app).post(`/api/feeds/DIVISION/${otherDivisionId}/posts`).set('Authorization', `Bearer ${directorToken}`).send({ content: 'director cross-div' });
      expect(res.status).toBe(201);
    });

    it('restricts ORG feed posting to Director / Admin / Manager', async () => {
      for (const token of [directorToken, adminToken, managerToken]) {
        const res = await request(app).post('/api/feeds/ORG/posts').set('Authorization', `Bearer ${token}`).send({ content: 'org post' });
        expect(res.status).toBe(201);
        expect(res.body.scopeId).toBeNull();
      }
      for (const token of [groupLeaderToken, staffToken]) {
        const res = await request(app).post('/api/feeds/ORG/posts').set('Authorization', `Bearer ${token}`).send({ content: 'org post' });
        expect(res.status).toBe(403);
      }
    });

    it('404s when posting to a non-existent feed target', async () => {
      const res = await request(app).post('/api/feeds/WP/999999/posts').set('Authorization', `Bearer ${staffToken}`).send({ content: 'x' });
      expect(res.status).toBe(404);
    });

    it('does NOT write an AuditLog for a plain comment', async () => {
      await request(app).post(`/api/feeds/DIVISION/${divisionId}/posts`).set('Authorization', `Bearer ${staffToken}`).send({ content: 'no audit' });
      const audits = await prisma.auditLog.count();
      expect(audits).toBe(0);
    });
  });

  // ─── WP system-event emission ────────────────────────────────────────────────

  describe('WorkPackage lifecycle emits WP-scope SYSTEM_EVENTs', () => {
    it('emits a SYSTEM_EVENT on WP creation', async () => {
      const res = await request(app).post('/api/work-packages').set('Authorization', `Bearer ${managerToken}`).send({
        name: 'Lifecycle WP', type: 'AUDIT', divisionId, timeframeFrom: '2026-06-01', timeframeTo: '2026-06-30',
      });
      expect(res.status).toBe(201);
      const events = await prisma.feedPost.findMany({ where: { scope: 'WP', scopeId: res.body.id, type: 'SYSTEM_EVENT' } });
      expect(events).toHaveLength(1);
      expect(events[0]!.content).toContain('created');
    });

    it('emits a SYSTEM_EVENT on a WP status change', async () => {
      const res = await request(app).put(`/api/work-packages/${wpId}/status`).set('Authorization', `Bearer ${directorToken}`).send({ status: 'Inactive', reason: 'paused' });
      expect(res.status).toBe(200);
      const events = await prisma.feedPost.findMany({ where: { scope: 'WP', scopeId: wpId, type: 'SYSTEM_EVENT' } });
      expect(events).toHaveLength(1);
      expect(events[0]!.content).toContain('inactive');

      // Restore for other tests.
      await prisma.workPackage.update({ where: { id: wpId }, data: { status: 'Open' } });
    });

    it('emits a SYSTEM_EVENT on user assignment', async () => {
      const res = await request(app).post(`/api/work-packages/${wpId}/assign`).set('Authorization', `Bearer ${directorToken}`).send({ userId: staffUserId });
      expect(res.status).toBe(201);
      const events = await prisma.feedPost.findMany({ where: { scope: 'WP', scopeId: wpId, type: 'SYSTEM_EVENT' } });
      expect(events).toHaveLength(1);
      expect(events[0]!.content).toContain('assigned');

      // Cleanup the assignment so re-runs stay idempotent.
      await prisma.workPackageAssignment.deleteMany({ where: { wpId, userId: staffUserId } });
    });
  });
});
