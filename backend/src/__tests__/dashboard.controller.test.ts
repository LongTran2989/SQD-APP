import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Regression coverage for the dashboard controller. The headline case (B1) is the
// GET /api/dashboard/feed path that resolves FINDING-scoped FeedPosts into human
// readable scopeNames. Findings DO write FINDING-scoped feed posts (findingService
// logFindingAuditAndActivity), so any user whose feed includes a finding hits this
// branch. Before the fix it selected a non-existent Finding.findingId column and
// threw PrismaClientValidationError (HTTP 500); this suite locks the 200 behaviour.
describe('Dashboard API — feed scopeName resolution (B1 regression)', () => {
  let directorToken: string;
  let staffToken: string;

  let directorUserId: number;
  let staffUserId: number;
  let divisionId: number;
  let findingId: number;
  let taskId: number;

  const secret = process.env.JWT_SECRET || 'fallback_secret';

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Dash Test Dept' }, update: {}, create: { name: 'Dash Test Dept' } });
    const div = await prisma.division.upsert({ where: { code: 'DSH' }, update: {}, create: { name: 'Dash Div', code: 'DSH', departmentId: dept.id } });
    divisionId = div.id;

    const director = await prisma.user.create({
      data: { name: 'Dash Director', email: 'dash_director@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id },
    });
    const staff = await prisma.user.create({
      data: { name: 'Dash Staff', email: 'dash_staff@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id },
    });
    directorUserId = director.id;
    staffUserId = staff.id;

    directorToken = jwt.sign({ userId: director.id, role: 'Director', divisionId }, secret);
    staffToken = jwt.sign({ userId: staff.id, role: 'Staff', divisionId }, secret);

    // A finding reported by the Staff user — so it appears in the Staff feed branch
    // (scope FINDING, scopeId in [reported finding ids]).
    const finding = await prisma.finding.create({
      data: {
        description: 'Dashboard feed regression finding',
        eventType: 'AUDIT',
        status: 'Open',
        reportedByUserId: staff.id,
        targetDivisionId: divisionId,
        departmentId: dept.id,
      },
    });
    findingId = finding.id;

    // A template + task to provide a TASK-scope feed target (taskId label path).
    const template = await prisma.template.create({
      data: { templateId: 'DSH-001', title: 'Dash Template', status: 'Published', formSchema: { fields: [] }, divisionId, ownerId: director.id },
    });
    const task = await prisma.task.create({
      data: { taskId: 'DSH-000001', templateId: template.id, issuerId: director.id, status: 'Assigned', targetDivisionId: divisionId, assignedToUserId: staff.id, schemaSnapshot: { fields: [] } },
    });
    taskId = task.id;
  });

  beforeEach(async () => {
    await prisma.feedPost.deleteMany({});
  });

  afterAll(async () => {
    await prisma.feedPost.deleteMany({});
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'DSH-' } } });
    await prisma.template.deleteMany({ where: { templateId: 'DSH-001' } });
    await prisma.finding.deleteMany({ where: { id: findingId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'dash_' } } });
    await prisma.$disconnect();
    await pool.end();
  });

  it('resolves a FINDING-scoped post for the Director feed without erroring (B1)', async () => {
    await prisma.feedPost.create({
      data: { type: 'SYSTEM_EVENT', scope: 'FINDING', scopeId: findingId, content: 'Finding raised', authorId: null },
    });

    const res = await request(app).get('/api/dashboard/feed').set('Authorization', `Bearer ${directorToken}`);

    expect(res.status).toBe(200);
    const post = res.body.find((p: any) => p.scope === 'FINDING' && p.scopeId === findingId);
    expect(post).toBeDefined();
    expect(post.scopeName).toBe(`#${findingId}`);
  });

  it('resolves a FINDING-scoped post for the reporting Staff user (the originally broken path)', async () => {
    await prisma.feedPost.create({
      data: { type: 'SYSTEM_EVENT', scope: 'FINDING', scopeId: findingId, content: 'Finding raised', authorId: null },
    });

    const res = await request(app).get('/api/dashboard/feed').set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    const post = res.body.find((p: any) => p.scope === 'FINDING' && p.scopeId === findingId);
    expect(post).toBeDefined();
    expect(post.scopeName).toBe(`#${findingId}`);
  });

  it('still resolves TASK-scoped posts to the human-readable taskId label', async () => {
    await prisma.feedPost.create({
      data: { type: 'SYSTEM_EVENT', scope: 'TASK', scopeId: taskId, content: 'Task assigned', authorId: null },
    });

    const res = await request(app).get('/api/dashboard/feed').set('Authorization', `Bearer ${directorToken}`);

    expect(res.status).toBe(200);
    const post = res.body.find((p: any) => p.scope === 'TASK' && p.scopeId === taskId);
    expect(post).toBeDefined();
    expect(post.scopeName).toBe('DSH-000001');
  });
});
