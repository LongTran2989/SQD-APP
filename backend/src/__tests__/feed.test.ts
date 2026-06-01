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
  let deptId: number;

  // Recreated each test (wiped in beforeEach).
  let wpId: number;          // WP in division FED
  let taskWithWpId: number;  // task linked to wpId, targetDivisionId = divisionId
  let taskNoWpId: number;    // task with no WP, targetDivisionId = divisionId

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Feed Test Dept' }, update: {}, create: { name: 'Feed Test Dept' } });
    deptId = dept.id;
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

  // ────────────────────────────────────────────────────────────────────────
  // Phase 8.2 helpers
  // ────────────────────────────────────────────────────────────────────────

  // Escalate a task comment and return the created flag id.
  async function escalate(token: string, postId: number, targetScope: string): Promise<number> {
    const res = await request(app)
      .post(`/api/feed/posts/${postId}/escalate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ targetScope });
    return res.body.flag.id;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Group 9 — getDivisionFeed
  // ────────────────────────────────────────────────────────────────────────

  describe('getDivisionFeed', () => {
    it('FE80: returns 200 with posts for a valid division', async () => {
      await request(app).post(`/api/feed/division/${divisionId}`).set('Authorization', `Bearer ${staffToken}`).send({ content: 'div note' });
      const res = await request(app).get(`/api/feed/division/${divisionId}`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(1);
      expect(res.body.posts[0].scope).toBe('DIVISION');
      expect(res.body.posts[0].scopeId).toBe(divisionId);
      expect(res.body.posts[0].content).toBe('div note');
    });

    it('FE81: returns 404 for a non-existent division', async () => {
      const res = await request(app).get('/api/feed/division/999999').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(404);
    });

    it('FE82: requires authentication → 401', async () => {
      const res = await request(app).get(`/api/feed/division/${divisionId}`);
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 10 — postDivisionMessage
  // ────────────────────────────────────────────────────────────────────────

  describe('postDivisionMessage', () => {
    it('FE90: returns 201 for a division member posting a message', async () => {
      const res = await request(app).post(`/api/feed/division/${divisionId}`).set('Authorization', `Bearer ${staffToken}`).send({ content: 'member message' });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe('COMMENT');
      expect(res.body.scope).toBe('DIVISION');
      expect(res.body.scopeId).toBe(divisionId);
      expect(res.body.authorId).toBe(staffId);
    });

    it('FE91: returns 403 for a user from a different division', async () => {
      // Staff identity but token carries a different divisionId.
      const otherDivToken = makeToken(staffId, 'Staff', division2Id);
      const res = await request(app).post(`/api/feed/division/${divisionId}`).set('Authorization', `Bearer ${otherDivToken}`).send({ content: 'outsider' });
      expect(res.status).toBe(403);
    });

    it('FE92: Director can post to any division', async () => {
      // Director carries divisionId FED but posts to FE2.
      const res = await request(app).post(`/api/feed/division/${division2Id}`).set('Authorization', `Bearer ${directorToken}`).send({ content: 'director note' });
      expect(res.status).toBe(201);
      expect(res.body.scopeId).toBe(division2Id);
    });

    it('FE93: returns 400 for empty content', async () => {
      const res = await request(app).post(`/api/feed/division/${divisionId}`).set('Authorization', `Bearer ${staffToken}`).send({ content: '   ' });
      expect(res.status).toBe(400);
    });

    it('FE94: requires authentication → 401', async () => {
      const res = await request(app).post(`/api/feed/division/${divisionId}`).send({ content: 'x' });
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 11 — getOrgFeed
  // ────────────────────────────────────────────────────────────────────────

  describe('getOrgFeed', () => {
    it('FE100: returns 200 with all ORG scope posts when no filter', async () => {
      await request(app).post('/api/feed/org').set('Authorization', `Bearer ${directorToken}`).send({ content: 'org a' });
      await request(app).post('/api/feed/org').set('Authorization', `Bearer ${managerToken}`).send({ content: 'org b', taggedDivisionIds: [division2Id] });
      const res = await request(app).get('/api/feed/org').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(2);
      expect(res.body.posts.every((p: any) => p.scope === 'ORG')).toBe(true);
    });

    it('FE101: returns only tagged posts when ?divisionTag= is provided', async () => {
      await request(app).post('/api/feed/org').set('Authorization', `Bearer ${directorToken}`).send({ content: 'untagged org' });
      await request(app).post('/api/feed/org').set('Authorization', `Bearer ${managerToken}`).send({ content: 'tagged org', taggedDivisionIds: [division2Id] });
      const res = await request(app).get(`/api/feed/org?divisionTag=${division2Id}`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(1);
      expect(res.body.posts[0].content).toBe('tagged org');
    });

    it('FE102: posts without taggedDivisionIds are included when no filter', async () => {
      await request(app).post('/api/feed/org').set('Authorization', `Bearer ${directorToken}`).send({ content: 'plain org' });
      const res = await request(app).get('/api/feed/org').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.posts.some((p: any) => p.content === 'plain org' && (p.taggedDivisionIds === null || p.taggedDivisionIds === undefined))).toBe(true);
    });

    it('FE103: requires authentication → 401', async () => {
      const res = await request(app).get('/api/feed/org');
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 12 — postOrgMessage
  // ────────────────────────────────────────────────────────────────────────

  describe('postOrgMessage', () => {
    it('FE110: Director can post to Org Feed', async () => {
      const res = await request(app).post('/api/feed/org').set('Authorization', `Bearer ${directorToken}`).send({ content: 'director org' });
      expect(res.status).toBe(201);
      expect(res.body.scope).toBe('ORG');
      expect(res.body.scopeId).toBeNull();
    });

    it('FE111: Manager can post to Org Feed', async () => {
      const res = await request(app).post('/api/feed/org').set('Authorization', `Bearer ${managerToken}`).send({ content: 'manager org' });
      expect(res.status).toBe(201);
      expect(res.body.scope).toBe('ORG');
    });

    it('FE112: Staff cannot post to Org Feed → 403', async () => {
      const res = await request(app).post('/api/feed/org').set('Authorization', `Bearer ${staffToken}`).send({ content: 'staff org' });
      expect(res.status).toBe(403);
    });

    it('FE113: taggedDivisionIds is stored and returned correctly', async () => {
      const res = await request(app).post('/api/feed/org').set('Authorization', `Bearer ${managerToken}`).send({ content: 'tagged', taggedDivisionIds: [divisionId, division2Id] });
      expect(res.status).toBe(201);
      expect(res.body.taggedDivisionIds).toEqual([divisionId, division2Id]);
      const stored = await prisma.feedPost.findUnique({ where: { id: res.body.id } });
      expect(stored?.taggedDivisionIds).toEqual([divisionId, division2Id]);
    });

    it('FE114: requires authentication → 401', async () => {
      const res = await request(app).post('/api/feed/org').send({ content: 'x' });
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 13 — getPendingFlags
  // ────────────────────────────────────────────────────────────────────────

  describe('getPendingFlags', () => {
    it('FE120: Director sees all pending flags', async () => {
      const p1 = await postTaskComment(staffToken, taskWithWpId, 'c1');
      await escalate(staffToken, p1, 'WP');
      const p2 = await postTaskComment(staffToken, taskWithWpId, 'c2');
      await escalate(staffToken, p2, 'ORG');

      const res = await request(app).get('/api/feed/flags/pending').set('Authorization', `Bearer ${directorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.flags).toHaveLength(2);
    });

    it('FE121: Manager sees flags from their division + ORG flags', async () => {
      const p1 = await postTaskComment(staffToken, taskWithWpId, 'div flag'); // task in FED
      await escalate(staffToken, p1, 'DIVISION');
      const p2 = await postTaskComment(staffToken, taskWithWpId, 'org flag');
      await escalate(staffToken, p2, 'ORG');

      const res = await request(app).get('/api/feed/flags/pending').set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.flags).toHaveLength(2);
    });

    it('FE122: Manager does not see flags from another division', async () => {
      // Task targeting division2 — escalate to DIVISION (FE2). FED manager must not see it.
      const otherTask = await prisma.task.create({
        data: { taskId: 'FED-900003', templateId, issuerId: managerId, targetDivisionId: division2Id, status: 'InProgress', schemaSnapshot: [] as any, assignmentType: 'INDIVIDUAL' }
      });
      const comment = await prisma.feedPost.create({ data: { type: 'COMMENT', scope: 'TASK', scopeId: otherTask.id, authorId: staffId, content: 'other div' } });
      await escalate(staffToken, comment.id, 'DIVISION');

      const res = await request(app).get('/api/feed/flags/pending').set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.flags).toHaveLength(0);
    });

    it('FE123: Staff gets 403', async () => {
      const res = await request(app).get('/api/feed/flags/pending').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(403);
    });

    it('FE124: requires authentication → 401', async () => {
      const res = await request(app).get('/api/feed/flags/pending');
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 14 — actOnFlag: validation
  // ────────────────────────────────────────────────────────────────────────

  describe('actOnFlag — validation', () => {
    it('FE130: returns 404 for non-existent flag', async () => {
      const res = await request(app).put('/api/feed/flags/999999/action').set('Authorization', `Bearer ${managerToken}`).send({ action: 'ACKNOWLEDGED' });
      expect(res.status).toBe(404);
    });

    it('FE131: returns 400 for already-actioned flag', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'to ack');
      const flagId = await escalate(staffToken, postId, 'WP');
      await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${managerToken}`).send({ action: 'ACKNOWLEDGED' });
      const res = await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${managerToken}`).send({ action: 'ACKNOWLEDGED' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already been actioned/i);
    });

    it('FE132: returns 400 for invalid action value', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'bad action');
      const flagId = await escalate(staffToken, postId, 'WP');
      const res = await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${managerToken}`).send({ action: 'NUKE' });
      expect(res.status).toBe(400);
    });

    it('FE133: Staff gets 403', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'staff acts');
      const flagId = await escalate(staffToken, postId, 'WP');
      const res = await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${staffToken}`).send({ action: 'ACKNOWLEDGED' });
      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 15 — actOnFlag: ACKNOWLEDGED
  // ────────────────────────────────────────────────────────────────────────

  describe('actOnFlag — ACKNOWLEDGED', () => {
    it('FE140: flag moves to ACTIONED with action ACKNOWLEDGED', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'ack me');
      const flagId = await escalate(staffToken, postId, 'WP');
      const res = await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${managerToken}`).send({ action: 'ACKNOWLEDGED' });
      expect(res.status).toBe(200);
      expect(res.body.flag.status).toBe('ACTIONED');
      expect(res.body.flag.action).toBe('ACKNOWLEDGED');
      expect(res.body.flag.reviewedByUserId).toBe(managerId);
    });

    it('FE141: writes an AuditLog entry', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'ack audit');
      const flagId = await escalate(staffToken, postId, 'WP');
      await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${managerToken}`).send({ action: 'ACKNOWLEDGED' });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'EscalationFlag', entityId: String(flagId), actionType: 'ESCALATION_FLAG_ACTIONED' } });
      expect(audit).not.toBeNull();
      expect(audit?.performedByUserId).toBe(managerId);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 16 — actOnFlag: DISSEMINATED
  // ────────────────────────────────────────────────────────────────────────

  describe('actOnFlag — DISSEMINATED', () => {
    it('FE150: creates an ESCALATION_CARD at ORG scope and moves flag to ACTIONED', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'disseminate me');
      const flagId = await escalate(staffToken, postId, 'DIVISION');
      const res = await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${directorToken}`).send({ action: 'DISSEMINATED', taggedDivisionIds: [division2Id] });
      expect(res.status).toBe(200);
      expect(res.body.flag.status).toBe('ACTIONED');
      expect(res.body.flag.action).toBe('DISSEMINATED');

      const orgCard = await prisma.feedPost.findFirst({ where: { type: 'ESCALATION_CARD', scope: 'ORG', flagId } });
      expect(orgCard).not.toBeNull();
      expect(orgCard?.taggedDivisionIds).toEqual([division2Id]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 17 — actOnFlag: FINDING_RAISED
  // ────────────────────────────────────────────────────────────────────────

  describe('actOnFlag — FINDING_RAISED', () => {
    it('FE160: creates a Finding with correct fields and links it to the flag', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'raise finding from this');
      const flagId = await escalate(staffToken, postId, 'WP');
      const res = await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${managerToken}`).send({
        action: 'FINDING_RAISED',
        findingOverride: { eventType: 'Procedural Breach', departmentId: deptId, description: 'Override desc' }
      });
      expect(res.status).toBe(200);
      expect(res.body.flag.status).toBe('ACTIONED');
      expect(res.body.flag.action).toBe('FINDING_RAISED');
      expect(res.body.flag.linkedEntityId).not.toBeNull();

      const finding = await prisma.finding.findUnique({ where: { id: parseInt(res.body.flag.linkedEntityId, 10) } });
      expect(finding).not.toBeNull();
      expect(finding?.eventType).toBe('Procedural Breach');
      expect(finding?.departmentId).toBe(deptId);
      expect(finding?.description).toBe('Override desc');
      expect(finding?.sourceTaskId).toBe(taskWithWpId);
      expect(finding?.status).toBe('Open');
    });

    it('FE161: returns 400 if departmentId or eventType is missing', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'missing fields');
      const flagId = await escalate(staffToken, postId, 'WP');
      const res = await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${managerToken}`).send({
        action: 'FINDING_RAISED',
        findingOverride: { description: 'no event/dept' }
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/departmentId and eventType/i);
    });

    it('FE162: description falls back to the source comment content when not overridden', async () => {
      const postId = await postTaskComment(staffToken, taskWithWpId, 'fallback description content');
      const flagId = await escalate(staffToken, postId, 'WP');
      const res = await request(app).put(`/api/feed/flags/${flagId}/action`).set('Authorization', `Bearer ${managerToken}`).send({
        action: 'FINDING_RAISED',
        findingOverride: { eventType: 'Safety Observation', departmentId: deptId }
      });
      expect(res.status).toBe(200);
      const finding = await prisma.finding.findUnique({ where: { id: parseInt(res.body.flag.linkedEntityId, 10) } });
      expect(finding?.description).toBe('fallback description content');
    });
  });
});
