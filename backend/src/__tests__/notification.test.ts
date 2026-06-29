import request from 'supertest';
import http from 'http';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const secret = process.env.JWT_SECRET || 'fallback_secret';

describe('Notification Center & SSE (live notifications)', () => {
  let directorToken: string;
  let managerToken: string;
  let staffAToken: string;
  let staffBToken: string;

  let directorId: number;
  let managerId: number;
  let staffAId: number;
  let staffBId: number;
  let managerBId: number;

  let divisionA: number;
  let divisionB: number;
  let templateId: number;
  let wpId: number;

  // Creates a fresh Unassigned task in division A issued by the director.
  let taskSeq = 0;
  const makeTask = async (overrides: Record<string, unknown> = {}) => {
    taskSeq += 1;
    return prisma.task.create({
      data: {
        taskId: `NOTIF-${String(taskSeq).padStart(6, '0')}`,
        templateId,
        issuerId: directorId,
        status: 'Unassigned',
        targetDivisionId: divisionA,
        schemaSnapshot: { fields: [] },
        ...overrides,
      },
    });
  };

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Notif Test Dept' }, update: {}, create: { name: 'Notif Test Dept' } });
    const divA = await prisma.division.upsert({ where: { code: 'NTF' }, update: {}, create: { name: 'Notif Div A', code: 'NTF', departmentId: dept.id } });
    const divB = await prisma.division.upsert({ where: { code: 'NTFB' }, update: {}, create: { name: 'Notif Div B', code: 'NTFB', departmentId: dept.id } });
    divisionA = divA.id;
    divisionB = divB.id;

    const mk = (name: string, email: string, roleId: number, divId: number) =>
      prisma.user.create({ data: { name, email, passwordHash: 'hash', forcePasswordChange: false, divisionId: divId, roleId } });

    const director = await mk('Notif Director', 'notif_director@sqd.com', directorRole.id, divisionA);
    const manager = await mk('Notif Manager', 'notif_manager@sqd.com', managerRole.id, divisionA);
    const staffA = await mk('Notif Staff A', 'notif_staffa@sqd.com', staffRole.id, divisionA);
    const staffB = await mk('Notif Staff B', 'notif_staffb@sqd.com', staffRole.id, divisionA);
    const managerB = await mk('Notif Manager B', 'notif_managerb@sqd.com', managerRole.id, divisionB);

    directorId = director.id;
    managerId = manager.id;
    staffAId = staffA.id;
    staffBId = staffB.id;
    managerBId = managerB.id;

    directorToken = jwt.sign({ userId: director.id, role: 'Director', divisionId: divisionA }, secret);
    managerToken = jwt.sign({ userId: manager.id, role: 'Manager', divisionId: divisionA }, secret);
    staffAToken = jwt.sign({ userId: staffA.id, role: 'Staff', divisionId: divisionA }, secret);
    staffBToken = jwt.sign({ userId: staffB.id, role: 'Staff', divisionId: divisionA }, secret);

    const template = await prisma.template.create({
      data: {
        templateId: 'NTF-001', title: 'Notif Template', status: 'Published',
        formSchema: { fields: [] }, divisionId: divisionA, ownerId: director.id,
        allowsFindings: true, requiresApproval: true,
      },
    });
    templateId = template.id;

    const wp = await prisma.workPackage.create({
      data: {
        wpId: 'NTF-WP-000001', name: 'Notif WP', type: 'AUDIT', divisionId: divisionA,
        timeframeFrom: new Date('2026-06-01'), timeframeTo: new Date('2026-06-30'),
        creatorId: director.id, status: 'Open',
      },
    });
    wpId = wp.id;
    await prisma.workPackageAssignment.create({ data: { wpId: wp.id, userId: staffAId } });
    await prisma.wpType.upsert({ where: { code: 'AUDIT' }, update: {}, create: { code: 'AUDIT', description: 'Audit' } });
  });

  beforeEach(async () => {
    await prisma.escalationFlag.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.finding.deleteMany({});
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'NOTIF-' } } });
    taskSeq = 0;
  });

  afterAll(async () => {
    await prisma.escalationFlag.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.finding.deleteMany({});
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'NOTIF-' } } });
    await prisma.workPackageAssignment.deleteMany({ where: { wpId } });
    await prisma.workPackage.deleteMany({ where: { wpId: 'NTF-WP-000001' } });
    await prisma.template.deleteMany({ where: { templateId: 'NTF-001' } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'notif_' } } });
    await prisma.$disconnect();
  });

  // Convenience: notifications belonging to a user, newest first.
  const inboxOf = (userId: number) =>
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });

  // ─── REST: ownership, filtering, mark-read ──────────────────────────────────

  describe('REST /api/notifications', () => {
    beforeEach(async () => {
      await prisma.notification.createMany({
        data: [
          { userId: staffAId, type: 'TASK_ASSIGNED', title: 'A1', linkScope: 'TASK', linkId: 1 },
          { userId: staffAId, type: 'TASK_REVIEWED', title: 'A2', readAt: new Date() },
          { userId: staffBId, type: 'TASK_ASSIGNED', title: 'B1' },
        ],
      });
    });

    it('rejects an unauthenticated read', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });

    it('returns only the caller’s own notifications', async () => {
      const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${staffAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items.every((n: { userId: number }) => n.userId === staffAId)).toBe(true);
    });

    it('filters to unread with ?unread=true', async () => {
      const res = await request(app).get('/api/notifications?unread=true').set('Authorization', `Bearer ${staffAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].title).toBe('A1');
    });

    it('reports the unread count', async () => {
      const res = await request(app).get('/api/notifications/unread-count').set('Authorization', `Bearer ${staffAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    it('marks one notification read (own only)', async () => {
      const [unread] = await prisma.notification.findMany({ where: { userId: staffAId, readAt: null } });
      if (!unread) throw new Error('expected an unread notification for staffA');
      const res = await request(app).patch(`/api/notifications/${unread.id}/read`).set('Authorization', `Bearer ${staffAToken}`);
      expect(res.status).toBe(200);
      const after = await prisma.notification.findUnique({ where: { id: unread.id } });
      expect(after?.readAt).not.toBeNull();
    });

    it('cannot mark another user’s notification read (404)', async () => {
      const [othersNotif] = await prisma.notification.findMany({ where: { userId: staffBId } });
      if (!othersNotif) throw new Error('expected a notification for staffB');
      const res = await request(app).patch(`/api/notifications/${othersNotif.id}/read`).set('Authorization', `Bearer ${staffAToken}`);
      expect(res.status).toBe(404);
      const after = await prisma.notification.findUnique({ where: { id: othersNotif.id } });
      expect(after?.readAt).toBeNull(); // untouched
    });

    it('marks all read', async () => {
      const res = await request(app).post('/api/notifications/read-all').set('Authorization', `Bearer ${staffAToken}`);
      expect(res.status).toBe(200);
      const remaining = await prisma.notification.count({ where: { userId: staffAId, readAt: null } });
      expect(remaining).toBe(0);
      // Other users untouched.
      expect(await prisma.notification.count({ where: { userId: staffBId, readAt: null } })).toBe(1);
    });
  });

  // ─── Trigger: task assignment ───────────────────────────────────────────────

  describe('Task lifecycle triggers', () => {
    it('notifies the assignee (not the actor) on assignment', async () => {
      const task = await makeTask();
      const res = await request(app)
        .put(`/api/tasks/${task.id}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ assignedToUserId: staffAId });
      expect(res.status).toBe(200);

      const inbox = await inboxOf(staffAId);
      expect(inbox).toHaveLength(1);
      const [notif] = inbox;
      if (!notif) throw new Error('expected a notification in staffA inbox');
      expect(notif.type).toBe('TASK_ASSIGNED');
      expect(notif.linkScope).toBe('TASK');
      expect(notif.linkId).toBe(task.id);
      // The assigning manager gets nothing.
      expect(await inboxOf(managerId)).toHaveLength(0);
    });

    it('notifies the issuer on submit, then the assignee on review', async () => {
      const task = await makeTask({ status: 'Assigned', assignedToUserId: staffAId });

      // Assignee submits → issuer (director) notified.
      const submitRes = await request(app).put(`/api/tasks/${task.id}/submit`).set('Authorization', `Bearer ${staffAToken}`);
      expect(submitRes.status).toBe(200);
      const issuerInbox = await inboxOf(directorId);
      expect(issuerInbox.map((n) => n.type)).toContain('TASK_SUBMITTED');

      // Manager (same division) approves → assignee notified of outcome.
      const reviewRes = await request(app)
        .put(`/api/tasks/${task.id}/review`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'approve' });
      expect(reviewRes.status).toBe(200);
      const assigneeInbox = await inboxOf(staffAId);
      const reviewed = assigneeInbox.find((n) => n.type === 'TASK_REVIEWED');
      expect(reviewed).toBeDefined();
      expect((reviewed?.metadata as { action?: string })?.action).toBe('approve');
    });
  });

  // ─── Trigger: feed activity (watchers + collapse) ───────────────────────────

  describe('Feed activity triggers (watchers, collapse-unread)', () => {
    it('notifies task watchers on a comment and collapses repeats', async () => {
      const task = await makeTask({ status: 'Assigned', assignedToUserId: staffAId });

      // staffB (not a watcher) comments → issuer + assignee notified, author skipped.
      const c1 = await request(app)
        .post(`/api/tasks/${task.id}/activity`)
        .set('Authorization', `Bearer ${staffBToken}`)
        .send({ content: 'first comment' });
      expect(c1.status).toBe(201);

      expect((await inboxOf(directorId)).filter((n) => n.type === 'FEED_ACTIVITY')).toHaveLength(1);
      expect((await inboxOf(staffAId)).filter((n) => n.type === 'FEED_ACTIVITY')).toHaveLength(1);
      expect((await inboxOf(staffBId)).filter((n) => n.type === 'FEED_ACTIVITY')).toHaveLength(0);

      // A second comment collapses onto the same unread entry (count bumps to 2).
      await request(app)
        .post(`/api/tasks/${task.id}/activity`)
        .set('Authorization', `Bearer ${staffBToken}`)
        .send({ content: 'second comment' });

      const assigneeFeed = (await inboxOf(staffAId)).filter((n) => n.type === 'FEED_ACTIVITY');
      expect(assigneeFeed).toHaveLength(1);
      const [collapsed] = assigneeFeed;
      if (!collapsed) throw new Error('expected a collapsed FEED_ACTIVITY notification');
      expect((collapsed.metadata as { count?: number })?.count).toBe(2);
    });

    it('notifies WP watchers on a WP feed comment', async () => {
      const res = await request(app)
        .post(`/api/feeds/WP/${wpId}/posts`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ content: 'wp note' });
      expect(res.status).toBe(201);
      // WP watchers = creator (director) + assigned member (staffA). Author (manager) skipped.
      expect((await inboxOf(directorId)).some((n) => n.type === 'FEED_ACTIVITY')).toBe(true);
      expect((await inboxOf(staffAId)).some((n) => n.type === 'FEED_ACTIVITY')).toBe(true);
      expect(await inboxOf(managerId)).toHaveLength(0);
    });
  });

  // ─── Trigger: finding created ───────────────────────────────────────────────

  it('notifies finding reviewers (division + global) on finding creation, not the reporter', async () => {
    const dept = await prisma.department.findFirst({ where: { name: 'Notif Test Dept' } });
    const res = await request(app)
      .post('/api/findings')
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ targetDivisionId: divisionA, eventType: 'Safety', departmentId: dept!.id, description: 'A serious finding' });
    expect(res.status).toBe(201);

    // Director (global finding:review) + Manager (div A finding:review) notified.
    expect((await inboxOf(directorId)).some((n) => n.type === 'FINDING_CREATED')).toBe(true);
    expect((await inboxOf(managerId)).some((n) => n.type === 'FINDING_CREATED')).toBe(true);
    // Manager in OTHER division is not notified (division scope).
    expect((await inboxOf(managerBId)).some((n) => n.type === 'FINDING_CREATED')).toBe(false);
    // Reporter excluded.
    expect((await inboxOf(staffAId)).some((n) => n.type === 'FINDING_CREATED')).toBe(false);
  });

  // ─── Trigger: escalation queued ─────────────────────────────────────────────

  it('notifies actionable reviewers when a comment is escalated', async () => {
    const task = await makeTask({ status: 'Assigned', assignedToUserId: staffAId });
    // staffA posts a comment to escalate.
    const comment = await request(app)
      .post(`/api/tasks/${task.id}/activity`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ content: 'please look at this' });
    expect(comment.status).toBe(201);

    // staffB flags it up to the Division board.
    const flag = await request(app)
      .post(`/api/feeds/posts/${comment.body.id}/flag`)
      .set('Authorization', `Bearer ${staffBToken}`)
      .send({ targetScope: 'DIVISION' });
    expect(flag.status).toBe(201);

    // Director (global) + Manager (div A) can action it → both notified.
    expect((await inboxOf(directorId)).some((n) => n.type === 'ESCALATION_QUEUED')).toBe(true);
    expect((await inboxOf(managerId)).some((n) => n.type === 'ESCALATION_QUEUED')).toBe(true);
    // The flagger (staffB) and out-of-division manager are not notified.
    expect((await inboxOf(staffBId)).some((n) => n.type === 'ESCALATION_QUEUED')).toBe(false);
    expect((await inboxOf(managerBId)).some((n) => n.type === 'ESCALATION_QUEUED')).toBe(false);
  });

  // ─── SSE stream ─────────────────────────────────────────────────────────────

  describe('GET /api/events/stream', () => {
    it('rejects an unauthenticated connection', async () => {
      const res = await request(app).get('/api/events/stream');
      expect(res.status).toBe(401);
    });

    it('opens an event-stream for an authenticated user', async () => {
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as { port: number };

      const result = await new Promise<{ status: number; contentType: string | undefined }>((resolve, reject) => {
        const req = http.get(
          { host: '127.0.0.1', port, path: '/api/events/stream', headers: { Authorization: `Bearer ${staffAToken}` } },
          (res) => {
            const out = { status: res.statusCode ?? 0, contentType: res.headers['content-type'] };
            req.destroy(); // close the long-lived stream
            resolve(out);
          }
        );
        req.on('error', (err) => {
          // ECONNRESET from our own destroy() is expected once headers are in.
          if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') return;
          reject(err);
        });
      });

      await new Promise<void>((resolve) => server.close(() => resolve()));

      expect(result.status).toBe(200);
      expect(result.contentType).toContain('text/event-stream');
    });
  });
});
