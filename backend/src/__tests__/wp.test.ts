import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { generateDailyCheckTasks } from '../services/wpCheckService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('Work Package Backend', () => {
  let adminToken: string;
  let directorToken: string;
  let managerToken: string;
  let staffToken: string;

  let adminUserId: number;
  let directorUserId: number;
  let managerUserId: number;
  let staffUserId: number;
  let divisionId: number;
  let otherDivisionId: number;

  beforeAll(async () => {
    // Setup roles
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    // Setup divisions
    const department = await prisma.department.upsert({ where: { name: 'WP Test Dept' }, update: {}, create: { name: 'WP Test Dept' } });
    const division = await prisma.division.upsert({ where: { code: 'WPT' }, update: {}, create: { name: 'WP Test Div', code: 'WPT', departmentId: department.id } });
    divisionId = division.id;

    const otherDepartment = await prisma.department.upsert({ where: { name: 'WP Other Dept' }, update: {}, create: { name: 'WP Other Dept' } });
    const otherDivision = await prisma.division.upsert({ where: { code: 'WPO' }, update: {}, create: { name: 'WP Other Div', code: 'WPO', departmentId: otherDepartment.id } });
    otherDivisionId = otherDivision.id;

    // Create users
    const adminUser = await prisma.user.create({
      data: { name: 'WP Admin', email: 'admin_wp@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: adminRole.id }
    });
    adminUserId = adminUser.id;

    const directorUser = await prisma.user.create({
      data: { name: 'WP Director', email: 'director_wp@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id }
    });
    directorUserId = directorUser.id;

    const managerUser = await prisma.user.create({
      data: { name: 'WP Manager', email: 'manager_wp@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id }
    });
    managerUserId = managerUser.id;

    const staffUser = await prisma.user.create({
      data: { name: 'WP Staff', email: 'staff_wp@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id }
    });
    staffUserId = staffUser.id;

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    adminToken = jwt.sign({ userId: adminUserId, role: 'Admin', divisionId }, secret);
    directorToken = jwt.sign({ userId: directorUserId, role: 'Director', divisionId }, secret);
    managerToken = jwt.sign({ userId: managerUserId, role: 'Manager', divisionId }, secret);
    staffToken = jwt.sign({ userId: staffUserId, role: 'Staff', divisionId }, secret);

    // Seed WpTypes
    await prisma.wpType.upsert({ where: { code: 'CHECK' }, update: {}, create: { code: 'CHECK', description: 'Daily check' } });
    await prisma.wpType.upsert({ where: { code: 'AUDIT' }, update: {}, create: { code: 'AUDIT', description: 'Audit' } });
  });

  beforeEach(async () => {
    // Clean up WP-related data between tests
    await prisma.taskActivity.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.templateRevisionArchive.deleteMany({});
    await prisma.template.deleteMany({});
  });

  afterAll(async () => {
    await prisma.taskActivity.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.templateRevisionArchive.deleteMany({});
    await prisma.template.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['admin_wp@sqd.com', 'director_wp@sqd.com', 'manager_wp@sqd.com', 'staff_wp@sqd.com'] } }
    });
    await prisma.$disconnect();
  });

  // ─── WP CRUD ─────────────────────────────────────────────────────────

  describe('WP Creation & Validation', () => {
    it('should create a Work Package with auto-generated wpId', async () => {
      const res = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Daily Check WP',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: '2026-06-01',
          timeframeTo: '2026-06-30'
        });

      expect(res.status).toBe(201);
      expect(res.body.wpId).toMatch(/^WPT-WP-\d{6}$/);
      expect(res.body.name).toBe('Daily Check WP');
      expect(res.body.status).toBe('Open');
    });

    it('should reject creation with missing required fields', async () => {
      const res = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ name: 'Incomplete' });

      expect(res.status).toBe(400);
    });

    it('should reject creation with invalid WP type', async () => {
      const res = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Bad Type',
          type: 'NONEXISTENT',
          divisionId,
          timeframeFrom: '2026-06-01',
          timeframeTo: '2026-06-30'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid WP type/);
    });

    it('should reject CHECK type without checkTemplateId', async () => {
      const res = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Check WP',
          type: 'CHECK',
          divisionId,
          timeframeFrom: '2026-06-01',
          timeframeTo: '2026-06-30'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/checkTemplateId/);
    });

    it('should reject creation with invalid timeframe', async () => {
      const res = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Bad Timeframe',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: '2026-06-30',
          timeframeTo: '2026-06-01'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/timeframeFrom must be before/);
    });

    it('should block Staff from creating Work Packages', async () => {
      const res = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Staff WP',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: '2026-06-01',
          timeframeTo: '2026-06-30'
        });

      expect(res.status).toBe(403);
    });
  });

  // ─── STATUS COMPUTATION ──────────────────────────────────────────────

  describe('Status Computation Logic', () => {
    it('should return "Open" for WPs with future timeframe', async () => {
      const res = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Future WP',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: '2030-01-01',
          timeframeTo: '2030-12-31'
        });

      expect(res.status).toBe(201);
      const wpId = res.body.id;

      const getRes = await request(app)
        .get(`/api/work-packages/${wpId}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(getRes.body.computedStatus).toBe('Open');
    });

    it('should return "In Progress" for WPs within timeframe', async () => {
      // Create WP with current date inside timeframe
      const now = new Date();
      const pastDate = new Date(now);
      pastDate.setDate(now.getDate() - 5);
      const futureDate = new Date(now);
      futureDate.setDate(now.getDate() + 30);

      const res = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Active WP',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: pastDate.toISOString(),
          timeframeTo: futureDate.toISOString()
        });

      expect(res.status).toBe(201);

      const getRes = await request(app)
        .get(`/api/work-packages/${res.body.id}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(getRes.body.computedStatus).toBe('In Progress');
    });

    it('should return "Overdue" when timeframe passed with incomplete tasks', async () => {
      // Create WP with past timeframe
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999001',
          name: 'Overdue WP',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2020-01-01'),
          timeframeTo: new Date('2020-01-31'),
          creatorId: managerUserId,
          status: 'Open'
        }
      });

      // Create a minimal template so the task can reference a valid templateId
      const overdueTemplate = await prisma.template.create({
        data: {
          templateId: 'WPT-OVERDUE-001',
          title: 'Overdue Test Template',
          formSchema: [{ id: '1', type: 'text', label: 'Observation' }],
          status: 'Published',
          publishedAt: new Date(),
          ownerId: managerUserId,
          divisionId
        }
      });

      // Create an incomplete task linked to this WP
      await prisma.task.create({
        data: {
          taskId: 'WPT-999001',
          templateId: overdueTemplate.id,
          status: 'In Progress',
          wpId: wp.id,
          targetDivisionId: divisionId,
          assignmentType: 'INDIVIDUAL',
          issuerId: managerUserId,
          schemaSnapshot: [{ id: '1', type: 'text', label: 'Observation' }]
        }
      });

      const getRes = await request(app)
        .get(`/api/work-packages/${wp.id}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(getRes.body.computedStatus).toBe('Overdue');
    });

    it('should return "Closed" when manually set', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999002',
          name: 'Closed WP',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2020-01-01'),
          timeframeTo: new Date('2020-01-31'),
          creatorId: managerUserId,
          status: 'Closed'
        }
      });

      const getRes = await request(app)
        .get(`/api/work-packages/${wp.id}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(getRes.body.computedStatus).toBe('Closed');
    });

    it('should return "Inactive" when manually set', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999003',
          name: 'Inactive WP',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2020-01-01'),
          timeframeTo: new Date('2020-01-31'),
          creatorId: managerUserId,
          status: 'Inactive',
          inactivationLog: { reason: 'test', inactivatedBy: managerUserId, inactivatedAt: new Date().toISOString() }
        }
      });

      const getRes = await request(app)
        .get(`/api/work-packages/${wp.id}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(getRes.body.computedStatus).toBe('Inactive');
    });
  });

  // ─── STATUS CHANGES ──────────────────────────────────────────────────

  describe('Manual Status Changes', () => {
    it('should require reason when inactivating', async () => {
      const createRes = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${directorToken}`)
        .send({
          name: 'Inactivate Test',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: '2026-06-01',
          timeframeTo: '2026-06-30'
        });

      const res = await request(app)
        .put(`/api/work-packages/${createRes.body.id}/status`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ status: 'Inactive' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reason is required/i);
    });

    it('should block closing WP with non-final tasks', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999004',
          name: 'Close Block Test',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2026-01-01'),
          timeframeTo: new Date('2026-12-31'),
          creatorId: directorUserId,
          status: 'Open'
        }
      });

      // Create a minimal template so the task can reference a valid templateId
      const closeBlockTemplate = await prisma.template.create({
        data: {
          templateId: 'WPT-CLOSE-001',
          title: 'Close Block Test Template',
          formSchema: [{ id: '1', type: 'text', label: 'Observation' }],
          status: 'Published',
          publishedAt: new Date(),
          ownerId: managerUserId,
          divisionId
        }
      });

      await prisma.task.create({
        data: {
          taskId: 'WPT-999002',
          templateId: closeBlockTemplate.id,
          status: 'In Progress',
          wpId: wp.id,
          targetDivisionId: divisionId,
          assignmentType: 'INDIVIDUAL',
          issuerId: managerUserId,
          schemaSnapshot: [{ id: '1', type: 'text', label: 'Observation' }]
        }
      });

      const res = await request(app)
        .put(`/api/work-packages/${wp.id}/status`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ status: 'Closed' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not in a final state/);
    });
  });

  // ─── CHECK TASK GENERATION ───────────────────────────────────────────

  describe('On-Demand CHECK Task Generation', () => {
    it('should generate a task from a Published template', async () => {
      // Create a published template
      const template = await prisma.template.create({
        data: {
          templateId: 'WPT-001',
          title: 'Daily Check Template',
          formSchema: [{ id: '1', type: 'radio', label: 'Pass/Fail', options: ['Pass', 'Fail'] }],
          status: 'Published',
          publishedAt: new Date(),
          ownerId: managerUserId,
          divisionId
        }
      });

      // Create a CHECK WP with today inside the timeframe
      const now = new Date();
      const pastDate = new Date(now);
      pastDate.setDate(now.getDate() - 1);
      const futureDate = new Date(now);
      futureDate.setDate(now.getDate() + 30);

      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999010',
          name: 'Check Gen Test',
          type: 'CHECK',
          divisionId,
          timeframeFrom: pastDate,
          timeframeTo: futureDate,
          creatorId: managerUserId,
          checkTemplateId: template.id,
          status: 'Open'
        }
      });

      // Call the service function directly
      const result = await generateDailyCheckTasks(wp.id, prisma);

      expect(result.generated).toBe(true);
      expect(result.taskId).toMatch(/^WPT-\d{6}$/);

      // Verify the task was created in DB
      const task = await prisma.task.findUnique({ where: { id: result.taskDbId! } });
      expect(task).not.toBeNull();
      expect(task!.status).toBe('Unassigned');
      expect(task!.wpId).toBe(wp.id);
      expect(task!.schemaSnapshot).toBeDefined();

      // Verify TaskActivity was logged
      const activity = await prisma.taskActivity.findFirst({
        where: { taskId: result.taskDbId! }
      });
      expect(activity).not.toBeNull();
      expect(activity!.type).toBe('SYSTEM_EVENT');
      expect(activity!.content).toMatch(/auto-generated/i);
    });

    it('should NOT generate task from Archived template (guard test)', async () => {
      const template = await prisma.template.create({
        data: {
          templateId: 'WPT-002',
          title: 'Archived Template',
          formSchema: [{ id: '1', type: 'text', label: 'Test' }],
          status: 'Archived',
          ownerId: managerUserId,
          divisionId
        }
      });

      const now = new Date();
      const pastDate = new Date(now);
      pastDate.setDate(now.getDate() - 1);
      const futureDate = new Date(now);
      futureDate.setDate(now.getDate() + 30);

      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999011',
          name: 'Archived Template Guard',
          type: 'CHECK',
          divisionId,
          timeframeFrom: pastDate,
          timeframeTo: futureDate,
          creatorId: managerUserId,
          checkTemplateId: template.id,
          status: 'Open'
        }
      });

      const result = await generateDailyCheckTasks(wp.id, prisma);

      expect(result.generated).toBe(false);
      expect(result.checkTemplateWarning).toMatch(/archived/i);

      // Verify NO task was created
      const tasks = await prisma.task.findMany({ where: { wpId: wp.id } });
      expect(tasks.length).toBe(0);
    });

    it('should NOT generate duplicate tasks for the same day', async () => {
      const template = await prisma.template.create({
        data: {
          templateId: 'WPT-003',
          title: 'Dedup Template',
          formSchema: [{ id: '1', type: 'text', label: 'Test' }],
          status: 'Published',
          publishedAt: new Date(),
          ownerId: managerUserId,
          divisionId
        }
      });

      const now = new Date();
      const pastDate = new Date(now);
      pastDate.setDate(now.getDate() - 1);
      const futureDate = new Date(now);
      futureDate.setDate(now.getDate() + 30);

      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999012',
          name: 'Dedup Test',
          type: 'CHECK',
          divisionId,
          timeframeFrom: pastDate,
          timeframeTo: futureDate,
          creatorId: managerUserId,
          checkTemplateId: template.id,
          status: 'Open'
        }
      });

      // First call should generate
      const result1 = await generateDailyCheckTasks(wp.id, prisma);
      expect(result1.generated).toBe(true);

      // Second call should be deduplicated
      const result2 = await generateDailyCheckTasks(wp.id, prisma);
      expect(result2.generated).toBe(false);
      expect(result2.reason).toMatch(/already been generated today/i);
    });

    it('should NOT generate task when WP is not In Progress (future timeframe)', async () => {
      const template = await prisma.template.create({
        data: {
          templateId: 'WPT-004',
          title: 'Future Check Template',
          formSchema: [{ id: '1', type: 'text', label: 'Test' }],
          status: 'Published',
          publishedAt: new Date(),
          ownerId: managerUserId,
          divisionId
        }
      });

      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999013',
          name: 'Future Check',
          type: 'CHECK',
          divisionId,
          timeframeFrom: new Date('2030-01-01'),
          timeframeTo: new Date('2030-12-31'),
          creatorId: managerUserId,
          checkTemplateId: template.id,
          status: 'Open'
        }
      });

      const result = await generateDailyCheckTasks(wp.id, prisma);
      expect(result.generated).toBe(false);
      expect(result.reason).toMatch(/not started/i);
    });
  });

  // ─── ASSIGNMENT AUTHORIZATION ────────────────────────────────────────

  describe('Assignment Authorization', () => {
    it('should allow Manager to assign a user in the same division', async () => {
      const createRes = await request(app)
        .post('/api/work-packages')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          name: 'Assignment Test',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: '2026-06-01',
          timeframeTo: '2026-06-30'
        });

      const assignRes = await request(app)
        .post(`/api/work-packages/${createRes.body.id}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ userId: staffUserId });

      expect(assignRes.status).toBe(201);
      expect(assignRes.body.assignment.user.name).toBe('WP Staff');
    });

    it('should block Staff from assigning users', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999020',
          name: 'Staff Assign Block',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2026-06-01'),
          timeframeTo: new Date('2026-06-30'),
          creatorId: managerUserId,
          status: 'Open'
        }
      });

      const res = await request(app)
        .post(`/api/work-packages/${wp.id}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ userId: managerUserId });

      expect(res.status).toBe(403);
    });

    it('should prevent duplicate assignments', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999021',
          name: 'Dup Assign Test',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2026-06-01'),
          timeframeTo: new Date('2026-06-30'),
          creatorId: managerUserId,
          status: 'Open'
        }
      });

      // First assignment
      await request(app)
        .post(`/api/work-packages/${wp.id}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ userId: staffUserId });

      // Duplicate
      const dupRes = await request(app)
        .post(`/api/work-packages/${wp.id}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ userId: staffUserId });

      expect(dupRes.status).toBe(400);
      expect(dupRes.body.message).toMatch(/already assigned/i);
    });

    it('should block Manager from assigning cross-division users', async () => {
      const otherUser = await prisma.user.create({
        data: {
          name: 'Other Div User', email: 'other_div_wp@sqd.com', passwordHash: 'hash',
          forcePasswordChange: false, divisionId: otherDivisionId,
          roleId: (await prisma.role.findUnique({ where: { name: 'Staff' } }))!.id
        }
      });

      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999022',
          name: 'Cross Div Test',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2026-06-01'),
          timeframeTo: new Date('2026-06-30'),
          creatorId: managerUserId,
          status: 'Open'
        }
      });

      const res = await request(app)
        .post(`/api/work-packages/${wp.id}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ userId: otherUser.id });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/same division/i);

      // Cleanup
      await prisma.user.delete({ where: { id: otherUser.id } });
    });

    it('should allow Director to assign cross-division users', async () => {
      const otherUser = await prisma.user.create({
        data: {
          name: 'Other Div User 2', email: 'other_div_wp2@sqd.com', passwordHash: 'hash',
          forcePasswordChange: false, divisionId: otherDivisionId,
          roleId: (await prisma.role.findUnique({ where: { name: 'Staff' } }))!.id
        }
      });

      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'WPT-WP-999023',
          name: 'Director Cross Div',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2026-06-01'),
          timeframeTo: new Date('2026-06-30'),
          creatorId: directorUserId,
          status: 'Open'
        }
      });

      const res = await request(app)
        .post(`/api/work-packages/${wp.id}/assign`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ userId: otherUser.id });

      expect(res.status).toBe(201);

      // Cleanup
      await prisma.workPackageAssignment.deleteMany({ where: { userId: otherUser.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    });
  });

  // ─── WP TYPE CRUD ────────────────────────────────────────────────────

  describe('WpType CRUD (Admin only)', () => {
    it('should allow Admin to create a new WP type', async () => {
      // Pre-delete in case the seed already populated this code
      await prisma.wpType.deleteMany({ where: { code: 'INVESTIGATION' } });

      const res = await request(app)
        .post('/api/work-packages/types')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'INVESTIGATION', description: 'Investigation type' });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe('INVESTIGATION');

      // Cleanup
      await prisma.wpType.delete({ where: { code: 'INVESTIGATION' } });
    });

    it('should reject duplicate WP types', async () => {
      const res = await request(app)
        .post('/api/work-packages/types')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'CHECK' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should block non-Admin from creating WP types', async () => {
      const res = await request(app)
        .post('/api/work-packages/types')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ code: 'NEWTYPE' });

      expect(res.status).toBe(403);
    });

    it('should list available WP types', async () => {
      const res = await request(app)
        .get('/api/work-packages/types')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });
  });
});
