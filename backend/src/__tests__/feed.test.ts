import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToken(userId: number, role: string, divisionId: number): string {
  const secret = process.env.JWT_SECRET || 'fallback_secret';
  return jwt.sign({ userId, role, divisionId }, secret);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Feed & Escalation Backend (Phase 8.1)', () => {
  let directorToken: string;
  let managerToken: string;
  let staffToken: string;

  let directorId: number;
  let managerId: number;
  let staffId: number;

  let divisionId: number;   // FED
  let division2Id: number;  // FE2
  let templateId: number;

  // Recreated each test (wiped in beforeEach).
  let wpId: number;          // WP in division FED
  let taskWithWpId: number;  // task linked to wpId, targetDivisionId = divisionId
  let taskNoWpId: number;    // task with no WP, targetDivisionId = divisionId

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Feed Test Dept' }, update: {}, create: { name: 'Feed Test Dept' } });
    const div = await prisma.division.upsert({ where: { code: 'FED' }, update: {}, create: { name: 'Feed Test Div', code: 'FED', departmentId: dept.id } });
    const div2 = await prisma.division.upsert({ where: { code: 'FE2' }, update: {}, create: { name: 'Feed Test Div 2', code: 'FE2', departmentId: dept.id } });
    divisionId = div.id;
    division2Id = div2.id;

    const director = await prisma.user.create({ data: { name: 'Feed Director', email: 'feed_director@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id } });
    directorId = director.id;
    const manager = await prisma.user.create({ data: { name: 'Feed Manager', email: 'feed_manager@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id } });
    managerId = manager.id;
    const staff = await prisma.user.create({ data: { name: 'Feed Staff', email: 'feed_staff@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    staffId = staff.id;

    directorToken = makeToken(directorId, 'Director', divisionId);
    managerToken = makeToken(managerId, 'Manager', divisionId);
    staffToken = makeToken(staffId, 'Staff', divisionId);

    const baseSchema = [{ id: '1', type: 'radio', label: 'Pass/Fail', options: ['Pass', 'Fail'] }];
    const tpl = await prisma.template.create({ data: { templateId: 'FED-T-001', title: 'Feed Template', formSchema: baseSchema, status: 'Published', publishedAt: new Date(), ownerId: managerId, divisionId, requiresApproval: true, allowsFindings: true } });
    templateId = tpl.id;
  });

  beforeEach(async () => {
    await prisma.escalationFlag.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.timeBooking.deleteMany({});
    await prisma.taskData.deleteMany({});
    await prisma.task.updateMany({ data: { parentFindingId: null } });
    await prisma.finding.updateMany({ data: { sourceTaskId: null } });
    await prisma.finding.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.auditLog.deleteMany({});

    const wp = await prisma.workPackage.create({
      data: {
        wpId: 'FED-WP-900001',
        name: 'Feed Test WP',
        type: 'AUDIT',
        divisionId,
        timeframeFrom: new Date(),
        timeframeTo: new Date(Date.now() + 30 * 86400000),
        creatorId: managerId,
        status: 'Open'
      }
    });
    wpId = wp.id;

    const taskWithWp = await prisma.task.create({
      data: { taskId: 'FED-900001', templateId, issuerId: managerId, targetDivisionId: divisionId, wpId, status: 'InProgress', schemaSnapshot: [] as any, assignmentType: 'INDIVIDUAL' }
    });
    taskWithWpId = taskWithWp.id;

    const taskNoWp = await prisma.task.create({
      data: { taskId: 'FED-900002', templateId, issuerId: managerId, targetDivisionId: divisionId, status: 'InProgress', schemaSnapshot: [] as any, assignmentType: 'INDIVIDUAL' }
    });
    taskNoWpId = taskNoWp.id;
  });

  afterAll(async () => {
    await prisma.escalationFlag.deleteMany({});
    await prisma.feedPost.deleteMany({});
    await prisma.timeBooking.deleteMany({});
    await prisma.taskData.deleteMany({});
    await prisma.task.updateMany({ data: { parentFindingId: null } });
    await prisma.finding.updateMany({ data: { sourceTaskId: null } });
    await prisma.finding.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.template.deleteMany({ where: { templateId: { startsWith: 'FED-T-' } } });
    await prisma.user.deleteMany({ where: { email: { in: ['feed_director@sqd.com', 'feed_manager@sqd.com', 'feed_staff@sqd.com'] } } });
    await prisma.$disconnect();
  });

  // Convenience: post a task comment and return its id.
  async function postTaskComment(token: string, taskId: number, content: string): Promise<number> {
    const res = await request(app).post(`/api/feed/task/${taskId}`).set('Authorization', `Bearer ${token}`).send({ content });
    return res.body.id;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Group 1 — Task Feed: getTaskFeed
  // ────────────────────────────────────────────────────────────────────────

  describe('getTaskFeed', () => {
    it('FE01: returns 200 with empty posts array for a task with no feed posts', async () => {
      const res = await request(app).get(`/api/feed/task/${taskWithWpId}`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.posts)).toBe(true);
      expect(res.body.posts).toHaveLength(0);
    });

    it('FE02: returns posts ordered by createdAt asc', async () => {
      await postTaskComment(staffToken, taskWithWpId, 'first');
      await postTaskComment(managerToken, taskWithWpId, 'second');
      const res = await request(app).get(`/api/feed/task/${taskWithWpId}`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(2);
      const times = res.body.posts.map((p: any) => new Date(p.createdAt).getTime());
      expect(times[0]).toBeLessThanOrEqual(times[1]);
      const contents = res.body.posts.map((p: any) => p.content);
      expect(contents).toContain('first');
      expect(contents).toContain('second');
    });

    it('FE03: includes a flattened author object on COMMENT posts', async () => {
      await postTaskComment(staffToken, taskWithWpId, 'hello');
      const res = await request(app).get(`/api/feed/task/${taskWithWpId}`).set('Authorization', `Bearer ${staffToken}`);
      const post = res.body.posts[0];
      expect(post.author).not.toBeNull();
      expect(post.author.id).toBe(staffId);
      expect(post.author.name).toBe('Feed Staff');
      expect(post.author.role).toBe('Staff');
    });

    it('FE04: returns 404 for a non-existent task', async () => {
      const res = await request(app).get('/api/feed/task/999999').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(404);
    });

    it('FE05: requires authentication → 401', async () => {
      const res = await request(app).get(`/api/feed/task/${taskWithWpId}`);
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 2 — Task Feed: postTaskComment
  // ────────────────────────────────────────────────────────────────────────

  describe('postTaskComment', () => {
    it('FE10: returns 201 and creates a COMMENT FeedPost with scope=TASK', async () => {
      const res = await request(app).post(`/api/feed/task/${taskWithWpId}`).set('Authorization', `Bearer ${staffToken}`).send({ content: 'A comment' });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe('COMMENT');
      expect(res.body.scope).toBe('TASK');
      expect(res.body.scopeId).toBe(taskWithWpId);
      expect(res.body.authorId).toBe(staffId);

      const stored = await prisma.feedPost.findUnique({ where: { id: res.body.id } });
      expect(stored?.type).toBe('COMMENT');
      expect(stored?.scope).toBe('TASK');
      expect(stored?.scopeId).toBe(taskWithWpId);
    });

    it('FE11: returns 400 if content is empty', async () => {
      const res = await request(app).post(`/api/feed/task/${taskWithWpId}`).set('Authorization', `Bearer ${staffToken}`).send({ content: '   ' });
      expect(res.status).toBe(400);
    });

    it('FE12: returns 404 for a non-existent task', async () => {
      const res = await request(app).post('/api/feed/task/999999').set('Authorization', `Bearer ${staffToken}`).send({ content: 'x' });
      expect(res.status).toBe(404);
    });

    it('FE13: requires authentication → 401', async () => {
      const res = await request(app).post(`/api/feed/task/${taskWithWpId}`).send({ content: 'x' });
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 3 — WP Feed: getWpFeed
  // ────────────────────────────────────────────────────────────────────────

  describe('getWpFeed', () => {
    it('FE20: returns 200 with posts for a WP', async () => {
      await request(app).post(`/api/feed/wp/${wpId}`).set('Authorization', `Bearer ${managerToken}`).send({ content: 'wp note' });
      const res = await request(app).get(`/api/feed/wp/${wpId}`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(1);
      expect(res.body.posts[0].scope).toBe('WP');
      expect(res.body.posts[0].content).toBe('wp note');
    });

    it('FE21: returns 404 for a non-existent WP', async () => {
      const res = await request(app).get('/api/feed/wp/999999').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(404);
    });

    it('FE22: requires authentication → 401', async () => {
      const res = await request(app).get(`/api/feed/wp/${wpId}`);
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 4 — WP Feed: postWpComment
  // ────────────────────────────────────────────────────────────────────────

  describe('postWpComment', () => {
    it('FE30: returns 201 and creates a COMMENT with scope=WP', async () => {
      const res = await request(app).post(`/api/feed/wp/${wpId}`).set('Authorization', `Bearer ${staffToken}`).send({ content: 'hello wp' });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe('COMMENT');
      expect(res.body.scope).toBe('WP');
      expect(res.body.scopeId).toBe(wpId);

      const stored = await prisma.feedPost.findUnique({ where: { id: res.body.id } });
      expect(stored?.scope).toBe('WP');
    });

    it('FE31: returns 400 if content is empty', async () => {
      const res = await request(app).post(`/api/feed/wp/${wpId}`).set('Authorization', `Bearer ${staffToken}`).send({ content: '' });
      expect(res.status).toBe(400);
    });

    it('FE32: requires authentication → 401', async () => {
      const res = await request(app).post(`/api/feed/wp/${wpId}`).send({ content: 'x' });
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 5 — escalatePost: basic validation
  // ────────────────────────────────────────────────────────────────────────

  describe('escalatePost — validation', () => {
    it('FE40: returns 404 for a non-existent post', async () => {
      const res = await request(app).post('/api/feed/posts/999999/escalate').set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'WP' });
      expect(res.status).toBe(404);
    });

    it('FE41: returns 400 if the post type is not COMMENT', async () => {
      const sysPost = await prisma.feedPost.create({ data: { type: 'SYSTEM_EVENT', scope: 'TASK', scopeId: taskWithWpId, content: 'status change', authorId: null } });
      const res = await request(app).post(`/api/feed/posts/${sysPost.id}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'WP' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/only comments/i);
    });

    it('FE42: returns 400 if the post has already been escalated', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'flagged already');
      await prisma.feedPost.update({ where: { id: postId }, data: { flagId: 12345 } });
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'WP' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already been escalated/i);
    });

    it('FE43: returns 400 for an invalid targetScope value', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'comment');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'GALAXY' });
      expect(res.status).toBe(400);
    });

    it('FE44: returns 400 when escalating to WP but the task has no wpId', async () => {
      const postId = await postTaskComment(staffToken, taskNoWpId, 'no wp comment');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'WP' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not linked to a Work Package/i);
    });

    it('FE45: requires authentication → 401', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'comment');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).send({ targetScope: 'WP' });
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 6 — escalatePost: TASK → WP
  // ────────────────────────────────────────────────────────────────────────

  describe('escalatePost — TASK to WP', () => {
    it('FE50: creates a PENDING flag, an ESCALATION_CARD at WP scope, no INFO_CARDs, and links the source post', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'escalate me to WP');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'WP', reason: 'important' });

      expect(res.status).toBe(201);
      expect(res.body.flag.status).toBe('PENDING');
      expect(res.body.flag.targetScope).toBe('WP');
      expect(res.body.infoCards).toHaveLength(0);

      // ESCALATION_CARD at WP scope with the correct scopeId.
      expect(res.body.escalationCard.type).toBe('ESCALATION_CARD');
      expect(res.body.escalationCard.scope).toBe('WP');
      expect(res.body.escalationCard.scopeId).toBe(wpId);
      expect(res.body.escalationCard.sourcePostId).toBe(postId);
      expect(res.body.escalationCard.flagId).toBe(res.body.flag.id);

      // Source post updated with the flag id.
      const source = await prisma.feedPost.findUnique({ where: { id: postId } });
      expect(source?.flagId).toBe(res.body.flag.id);

      // No INFO_CARDs anywhere (WP is the natural next level from TASK).
      const infoCount = await prisma.feedPost.count({ where: { type: 'INFO_CARD' } });
      expect(infoCount).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 7 — escalatePost: TASK → DIVISION (skipping WP)
  // ────────────────────────────────────────────────────────────────────────

  describe('escalatePost — TASK to DIVISION', () => {
    it('FE60: creates an ESCALATION_CARD at DIVISION scope and an INFO_CARD at WP scope when the task has a wpId', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'escalate to division');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'DIVISION' });

      expect(res.status).toBe(201);
      expect(res.body.escalationCard.scope).toBe('DIVISION');
      expect(res.body.escalationCard.scopeId).toBe(divisionId);
      expect(res.body.infoCards).toHaveLength(1);
      expect(res.body.infoCards[0].type).toBe('INFO_CARD');
      expect(res.body.infoCards[0].scope).toBe('WP');
      expect(res.body.infoCards[0].scopeId).toBe(wpId);
    });

    it('FE61: creates no WP INFO_CARD when the task has no wpId', async () => {
      const postId = await postTaskComment(staffToken, taskNoWpId, 'escalate to division, no wp');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'DIVISION' });

      expect(res.status).toBe(201);
      expect(res.body.escalationCard.scope).toBe('DIVISION');
      expect(res.body.escalationCard.scopeId).toBe(divisionId);
      expect(res.body.infoCards).toHaveLength(0);
    });

    it('FE62: truncates sourceExcerpt to 200 characters', async () => {
      const longContent = 'X'.repeat(500);
      const postId = await postTaskComment(staffToken, taskWithWpId, longContent);
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'DIVISION' });

      expect(res.status).toBe(201);
      expect(res.body.escalationCard.sourceExcerpt).toHaveLength(200);
      expect(res.body.escalationCard.sourceExcerpt.endsWith('...')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 8 — escalatePost: TASK → ORG (skipping WP and DIVISION)
  // ────────────────────────────────────────────────────────────────────────

  describe('escalatePost — TASK to ORG', () => {
    it('FE70: creates an ESCALATION_CARD at ORG scope with scopeId null', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'escalate to org');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'ORG' });

      expect(res.status).toBe(201);
      expect(res.body.escalationCard.scope).toBe('ORG');
      expect(res.body.escalationCard.scopeId).toBeNull();
    });

    it('FE71: creates INFO_CARDs at both the WP and DIVISION scopes', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'escalate to org with skips');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'ORG' });

      expect(res.status).toBe(201);
      expect(res.body.infoCards).toHaveLength(2);
      const wpCard = await prisma.feedPost.findFirst({ where: { type: 'INFO_CARD', scope: 'WP', scopeId: wpId } });
      const divCard = await prisma.feedPost.findFirst({ where: { type: 'INFO_CARD', scope: 'DIVISION', scopeId: divisionId } });
      expect(wpCard).not.toBeNull();
      expect(divCard).not.toBeNull();
    });

    it('FE72: writes an AuditLog entry with action ESCALATION_FLAG_CREATED', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'audit me');
      const res = await request(app).post(`/api/feed/posts/${postId}/escalate`).set('Authorization', `Bearer ${staffToken}`).send({ targetScope: 'ORG' });

      expect(res.status).toBe(201);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'EscalationFlag', entityId: String(res.body.flag.id), actionType: 'ESCALATION_FLAG_CREATED' } });
      expect(audit).not.toBeNull();
      expect(audit?.performedByUserId).toBe(staffId);
    });
  });
});
