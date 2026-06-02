import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Escalation core (Phase 3)', () => {
  const secret = process.env.JWT_SECRET || 'fallback_secret';

  let directorToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let groupLeaderToken: string;
  let staffToken: string;

  let staffUserId: number;
  let divAId: number;
  let divBId: number;

  let taskWithWpId: number; // task in divA, inside wpA
  let taskNoWpId: number; // task in divA, NOT in any WP
  let wpAId: number; // WP in divA
  let wpBId: number; // WP in divB

  // Source COMMENT posts (recreated each test).
  let taskComment: number; // on taskWithWp's TASK feed
  let taskNoWpComment: number; // on taskNoWp's TASK feed
  let wpAComment: number; // on wpA's WP feed
  let wpBComment: number; // on wpB's WP feed
  let divAComment: number; // on divA's DIVISION feed
  let orgComment: number; // on the ORG feed
  let systemEventPost: number; // a non-COMMENT post

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const glRole = await prisma.role.upsert({ where: { name: 'Group Leader' }, update: {}, create: { name: 'Group Leader' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Esc Test Dept' }, update: {}, create: { name: 'Esc Test Dept' } });
    const divA = await prisma.division.upsert({ where: { code: 'ESCA' }, update: {}, create: { name: 'Esc Div A', code: 'ESCA', departmentId: dept.id } });
    const divB = await prisma.division.upsert({ where: { code: 'ESCB' }, update: {}, create: { name: 'Esc Div B', code: 'ESCB', departmentId: dept.id } });
    divAId = divA.id;
    divBId = divB.id;

    const mk = (name: string, email: string, roleId: number, divId: number) =>
      prisma.user.create({ data: { name, email, passwordHash: 'hash', forcePasswordChange: false, divisionId: divId, roleId } });

    const director = await mk('Esc Director', 'esc_director@sqd.com', directorRole.id, divAId);
    const managerA = await mk('Esc Manager A', 'esc_managerA@sqd.com', managerRole.id, divAId);
    const managerB = await mk('Esc Manager B', 'esc_managerB@sqd.com', managerRole.id, divBId);
    const gl = await mk('Esc GL', 'esc_gl@sqd.com', glRole.id, divAId);
    const staff = await mk('Esc Staff', 'esc_staff@sqd.com', staffRole.id, divAId);
    staffUserId = staff.id;

    directorToken = jwt.sign({ userId: director.id, role: 'Director', divisionId: divAId }, secret);
    managerAToken = jwt.sign({ userId: managerA.id, role: 'Manager', divisionId: divAId }, secret);
    managerBToken = jwt.sign({ userId: managerB.id, role: 'Manager', divisionId: divBId }, secret);
    groupLeaderToken = jwt.sign({ userId: gl.id, role: 'Group Leader', divisionId: divAId }, secret);
    staffToken = jwt.sign({ userId: staff.id, role: 'Staff', divisionId: divAId }, secret);

    const template = await prisma.template.create({
      data: { templateId: 'ESC-001', title: 'Esc Template', status: 'Published', formSchema: { fields: [] }, divisionId: divAId, ownerId: director.id },
    });

    const wpA = await prisma.workPackage.create({
      data: { wpId: 'ESCA-WP-000001', name: 'Esc WP A', type: 'AUDIT', divisionId: divAId, timeframeFrom: new Date('2026-06-01'), timeframeTo: new Date('2026-06-30'), creatorId: director.id, status: 'Open' },
    });
    wpAId = wpA.id;

    const wpB = await prisma.workPackage.create({
      data: { wpId: 'ESCB-WP-000001', name: 'Esc WP B', type: 'AUDIT', divisionId: divBId, timeframeFrom: new Date('2026-06-01'), timeframeTo: new Date('2026-06-30'), creatorId: director.id, status: 'Open' },
    });
    wpBId = wpB.id;

    const taskWithWp = await prisma.task.create({
      data: { taskId: 'ESCA-000001', templateId: template.id, issuerId: director.id, status: 'Assigned', targetDivisionId: divAId, assignedToUserId: staff.id, wpId: wpAId, schemaSnapshot: { fields: [] } },
    });
    taskWithWpId = taskWithWp.id;

    const taskNoWp = await prisma.task.create({
      data: { taskId: 'ESCA-000002', templateId: template.id, issuerId: director.id, status: 'Assigned', targetDivisionId: divAId, assignedToUserId: staff.id, schemaSnapshot: { fields: [] } },
    });
    taskNoWpId = taskNoWp.id;
  });

  // Tear down this suite's own fixtures in FK-safe order so a global cleanup in
  // another suite (e.g. user.test's prisma.user.deleteMany) never trips over a
  // Template/Task still owned by our users. Mirrors the feed.test pattern.
  afterAll(async () => {
    await prisma.feedPost.deleteMany({});
    await prisma.escalationFlag.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'ESCA-' } } });
    await prisma.workPackage.deleteMany({ where: { wpId: { startsWith: 'ESC' } } });
    await prisma.template.deleteMany({ where: { templateId: 'ESC-001' } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'esc_' } } });
    await prisma.$disconnect();
  });

  // Fresh source posts every test (the feed/flag/audit tables are wiped below).
  const mkComment = async (scope: string, scopeId: number | null, content = 'A concern worth raising') => {
    const p = await prisma.feedPost.create({ data: { type: 'COMMENT', scope, scopeId, content, authorId: staffUserId } });
    return p.id;
  };

  beforeEach(async () => {
    await prisma.feedPost.deleteMany({}); // delete posts first (cards reference flags)
    await prisma.escalationFlag.deleteMany({});
    await prisma.auditLog.deleteMany({});

    taskComment = await mkComment('TASK', taskWithWpId);
    taskNoWpComment = await mkComment('TASK', taskNoWpId);
    wpAComment = await mkComment('WP', wpAId);
    wpBComment = await mkComment('WP', wpBId);
    divAComment = await mkComment('DIVISION', divAId);
    orgComment = await mkComment('ORG', null);
    const sysEvent = await prisma.feedPost.create({ data: { type: 'SYSTEM_EVENT', scope: 'TASK', scopeId: taskWithWpId, content: 'Status changed', authorId: null } });
    systemEventPost = sysEvent.id;
  });

  const flag = (postId: number, targetScope: string, token = staffToken) =>
    request(app).post(`/api/feeds/posts/${postId}/flag`).set('Authorization', `Bearer ${token}`).send({ targetScope });

  // Returns a sorted "TYPE:SCOPE:SCOPEID" descriptor of the placed cards for a flag.
  const describeCards = async (flagId: number) => {
    const cards = await prisma.feedPost.findMany({
      where: { flagId, type: { in: ['ESCALATION_CARD', 'INFO_CARD'] } },
      orderBy: { id: 'asc' },
    });
    return cards.map((c) => `${c.type}:${c.scope}:${c.scopeId ?? 'null'}`).sort();
  };

  // ─── Placement matrix (6 rows) ──────────────────────────────────────────────

  describe('placement matrix', () => {
    it('Task → WP: escalation card at WP feed, no info cards', async () => {
      const res = await flag(taskComment, 'WP');
      expect(res.status).toBe(201);
      expect(await describeCards(res.body.flag.id)).toEqual([`ESCALATION_CARD:WP:${wpAId}`]);
    });

    it('WP → Division: escalation card at Division Board, no info cards', async () => {
      const res = await flag(wpAComment, 'DIVISION');
      expect(res.status).toBe(201);
      expect(await describeCards(res.body.flag.id)).toEqual([`ESCALATION_CARD:DIVISION:${divAId}`]);
    });

    it('Task → Division: escalation at Division Board, info card at WP feed', async () => {
      const res = await flag(taskComment, 'DIVISION');
      expect(res.status).toBe(201);
      expect(await describeCards(res.body.flag.id)).toEqual(
        [`ESCALATION_CARD:DIVISION:${divAId}`, `INFO_CARD:WP:${wpAId}`].sort()
      );
    });

    it('WP → Org: escalation at Org Feed, info card at Division Board', async () => {
      const res = await flag(wpAComment, 'ORG');
      expect(res.status).toBe(201);
      expect(await describeCards(res.body.flag.id)).toEqual(
        [`ESCALATION_CARD:ORG:null`, `INFO_CARD:DIVISION:${divAId}`].sort()
      );
    });

    it('Task → Org: escalation at Org Feed, info cards at WP feed + Division Board', async () => {
      const res = await flag(taskComment, 'ORG');
      expect(res.status).toBe(201);
      expect(await describeCards(res.body.flag.id)).toEqual(
        [`ESCALATION_CARD:ORG:null`, `INFO_CARD:WP:${wpAId}`, `INFO_CARD:DIVISION:${divAId}`].sort()
      );
    });

    it('Division → Org: escalation at Org Feed, no info cards', async () => {
      const res = await flag(divAComment, 'ORG');
      expect(res.status).toBe(201);
      expect(await describeCards(res.body.flag.id)).toEqual([`ESCALATION_CARD:ORG:null`]);
    });

    it('Task (no WP) → Division: places the Division card and skips the WP info card', async () => {
      const res = await flag(taskNoWpComment, 'DIVISION');
      expect(res.status).toBe(201);
      // The WP info-card level is skipped because the task has no Work Package.
      expect(await describeCards(res.body.flag.id)).toEqual([`ESCALATION_CARD:DIVISION:${divAId}`]);
    });
  });

  // ─── Card content: excerpt + link, never a full copy ────────────────────────

  it('cards carry a truncated excerpt + deep-link fields, not a full copy of the comment', async () => {
    const longContent = 'ESCALATE: ' + 'this is a detailed concern that must be summarised. '.repeat(8);
    expect(longContent.length).toBeGreaterThan(160);
    const longComment = await prisma.feedPost.create({
      data: { type: 'COMMENT', scope: 'TASK', scopeId: taskWithWpId, content: longContent, authorId: staffUserId },
    });

    const res = await flag(longComment.id, 'ORG');
    expect(res.status).toBe(201);

    const cards = await prisma.feedPost.findMany({
      where: { flagId: res.body.flag.id, type: { in: ['ESCALATION_CARD', 'INFO_CARD'] } },
    });
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      // Excerpt is a truncation, never the full text.
      expect(card.sourceExcerpt).toBeTruthy();
      expect((card.sourceExcerpt as string).length).toBeLessThanOrEqual(161); // 160 + ellipsis
      expect(card.sourceExcerpt).not.toBe(longContent);
      expect((card.sourceExcerpt as string).endsWith('…')).toBe(true);
      expect(longContent.startsWith((card.sourceExcerpt as string).replace(/…$/, '').trimEnd())).toBe(true);
      // The card body (content) is a generated headline — it does NOT embed the source text.
      expect(card.content).not.toContain(longContent);
      // Deep-link denormalisation present (sourceWpId set for a task inside a WP).
      expect(card.sourcePostId).toBe(longComment.id);
      expect(card.sourceTaskId).toBe(taskWithWpId);
      expect(card.sourceWpId).toBe(wpAId);
      expect(card.flagId).toBe(res.body.flag.id);
    }
  });

  // ─── Flag state + audit dual-write ──────────────────────────────────────────

  it('creates the flag in PENDING status', async () => {
    const res = await flag(taskComment, 'WP');
    expect(res.status).toBe(201);
    expect(res.body.flag.status).toBe('PENDING');
    const dbFlag = await prisma.escalationFlag.findUnique({ where: { id: res.body.flag.id } });
    expect(dbFlag?.status).toBe('PENDING');
    expect(dbFlag?.reviewedByUserId).toBeNull();
    expect(dbFlag?.actionedAt).toBeNull();
  });

  it('dual-writes AuditLog (ESCALATION_RAISED) AND a SYSTEM_EVENT on the source feed', async () => {
    const res = await flag(taskComment, 'ORG');
    expect(res.status).toBe(201);
    const flagId = res.body.flag.id;

    const audit = await prisma.auditLog.findFirst({
      where: { actionType: 'ESCALATION_RAISED', entityType: 'EscalationFlag', entityId: String(flagId) },
    });
    expect(audit).not.toBeNull();

    const sysEvent = await prisma.feedPost.findFirst({
      where: { type: 'SYSTEM_EVENT', scope: 'TASK', scopeId: taskWithWpId, flagId },
    });
    expect(sysEvent).not.toBeNull();
  });

  // ─── Anyone may flag a comment ──────────────────────────────────────────────

  it('lets any authenticated role (e.g. Staff) flag a comment', async () => {
    const res = await flag(taskComment, 'DIVISION', staffToken);
    expect(res.status).toBe(201);
  });

  // ─── Validation / eligibility ───────────────────────────────────────────────

  describe('validation', () => {
    it('rejects an unauthenticated flag (401)', async () => {
      const res = await request(app).post(`/api/feeds/posts/${taskComment}/flag`).send({ targetScope: 'ORG' });
      expect(res.status).toBe(401);
    });

    it('rejects escalating an ORG-level comment (nothing sits above Org)', async () => {
      const res = await flag(orgComment, 'ORG');
      expect(res.status).toBe(400);
    });

    it('rejects flagging a non-COMMENT post', async () => {
      const res = await flag(systemEventPost, 'ORG');
      expect(res.status).toBe(400);
    });

    it('rejects a same-level / downward target (WP comment → WP)', async () => {
      const res = await flag(wpAComment, 'WP');
      expect(res.status).toBe(400);
    });

    it('rejects an out-of-matrix target below origin (Division comment → WP)', async () => {
      const res = await flag(divAComment, 'WP');
      expect(res.status).toBe(400);
    });

    it('rejects Task → WP when the task has no Work Package', async () => {
      const res = await flag(taskNoWpComment, 'WP');
      expect(res.status).toBe(400);
    });

    it('rejects an invalid targetScope', async () => {
      const res = await flag(taskComment, 'TASK');
      expect(res.status).toBe(400);
    });

    it('returns 404 for a non-existent post', async () => {
      const res = await flag(99999999, 'ORG');
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /api/escalations — actionable-by-viewer RBAC ────────────────────────

  describe('GET /api/escalations (actionable queue)', () => {
    let fWpA: number; // Task → WP (divA)
    let fDivA: number; // Task → Division (divA)
    let fOrg: number; // WP → Org
    let fDivB: number; // WP(divB) → Division (divB)

    beforeEach(async () => {
      fWpA = (await flag(taskComment, 'WP', directorToken)).body.flag.id;
      fDivA = (await flag(taskComment, 'DIVISION', directorToken)).body.flag.id;
      fOrg = (await flag(wpAComment, 'ORG', directorToken)).body.flag.id;
      fDivB = (await flag(wpBComment, 'DIVISION', directorToken)).body.flag.id;
    });

    const ids = (body: any[]) => body.map((f) => f.id).sort();

    it('requires authentication (401)', async () => {
      const res = await request(app).get('/api/escalations?status=PENDING');
      expect(res.status).toBe(401);
    });

    it('Director sees every pending flag', async () => {
      const res = await request(app).get('/api/escalations?status=PENDING').set('Authorization', `Bearer ${directorToken}`);
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([fWpA, fDivA, fOrg, fDivB].sort());
    });

    it('Manager sees own-division WP/Division flags + all Org flags, not other divisions', async () => {
      const res = await request(app).get('/api/escalations?status=PENDING').set('Authorization', `Bearer ${managerAToken}`);
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([fWpA, fDivA, fOrg].sort());
      expect(res.body.map((f: any) => f.id)).not.toContain(fDivB);
    });

    it('Manager of the other division sees its own Division flag + the Org flag only', async () => {
      const res = await request(app).get('/api/escalations?status=PENDING').set('Authorization', `Bearer ${managerBToken}`);
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([fOrg, fDivB].sort());
    });

    it('Group Leader and Staff have no actionable flags (empty list)', async () => {
      const gl = await request(app).get('/api/escalations?status=PENDING').set('Authorization', `Bearer ${groupLeaderToken}`);
      const staff = await request(app).get('/api/escalations?status=PENDING').set('Authorization', `Bearer ${staffToken}`);
      expect(gl.status).toBe(200);
      expect(gl.body).toEqual([]);
      expect(staff.status).toBe(200);
      expect(staff.body).toEqual([]);
    });

    it('enriches each flag with excerpt, deep-link fields, flagger, and target card', async () => {
      const res = await request(app).get('/api/escalations?status=PENDING').set('Authorization', `Bearer ${directorToken}`);
      const wpFlag = res.body.find((f: any) => f.id === fWpA);
      expect(wpFlag.targetScope).toBe('WP');
      expect(wpFlag.sourceExcerpt).toBeTruthy();
      expect(wpFlag.sourceTaskId).toBe(taskWithWpId);
      expect(wpFlag.flaggedBy).toMatchObject({ name: expect.any(String) });
      expect(wpFlag.card).toMatchObject({ scope: 'WP', scopeId: wpAId });
    });
  });
});
