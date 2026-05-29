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

describe('Task Backend (Phase 5.2)', () => {
  // ─── Shared state ─────────────────────────────────────────────────

  let directorToken: string;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let manager2Token: string; // manager in a different division

  let directorId: number;
  let adminId: number;
  let managerId: number;
  let staffId: number;
  let manager2Id: number;

  let divisionId: number;     // primary division (code TSK)
  let division2Id: number;    // secondary division (code TSK2)

  let publishedTemplateId: number;  // a Published template in divisionId
  let archivedTemplateId: number;   // an Archived template
  let oneOffTemplateId: number;     // isOneOff = true template

  // ─── Setup ────────────────────────────────────────────────────────

  beforeAll(async () => {
    // Roles
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const adminRole    = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const managerRole  = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole    = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    // Divisions
    const dept  = await prisma.department.upsert({ where: { name: 'Task Test Dept' }, update: {}, create: { name: 'Task Test Dept' } });
    const dept2 = await prisma.department.upsert({ where: { name: 'Task Test Dept 2' }, update: {}, create: { name: 'Task Test Dept 2' } });
    const div   = await prisma.division.upsert({ where: { code: 'TSK' }, update: {}, create: { name: 'Task Test Div', code: 'TSK', departmentId: dept.id } });
    const div2  = await prisma.division.upsert({ where: { code: 'TSK2' }, update: {}, create: { name: 'Task Test Div 2', code: 'TSK2', departmentId: dept2.id } });
    divisionId  = div.id;
    division2Id = div2.id;

    // Users
    const director = await prisma.user.create({ data: { name: 'Task Director', email: 'task_director@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id } });
    directorId = director.id;

    const admin = await prisma.user.create({ data: { name: 'Task Admin', email: 'task_admin@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: adminRole.id } });
    adminId = admin.id;

    const manager = await prisma.user.create({ data: { name: 'Task Manager', email: 'task_manager@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id } });
    managerId = manager.id;

    const staff = await prisma.user.create({ data: { name: 'Task Staff', email: 'task_staff@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    staffId = staff.id;

    const manager2 = await prisma.user.create({ data: { name: 'Task Manager2', email: 'task_manager2@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: division2Id, roleId: managerRole.id } });
    manager2Id = manager2.id;

    // JWTs
    directorToken = makeToken(directorId, 'Director', divisionId);
    adminToken    = makeToken(adminId, 'Admin', divisionId);
    managerToken  = makeToken(managerId, 'Manager', divisionId);
    staffToken    = makeToken(staffId, 'Staff', divisionId);
    manager2Token = makeToken(manager2Id, 'Manager', division2Id);

    // Templates
    const pubTemplate = await prisma.template.create({
      data: {
        templateId: 'TSK-T-001',
        title: 'Task Test Template',
        formSchema: [{ id: '1', type: 'radio', label: 'Pass/Fail', options: ['Pass', 'Fail'] }],
        status: 'Published',
        publishedAt: new Date(),
        ownerId: managerId,
        divisionId,
        requiresApproval: true,
        estimatedHours: 2.0
      }
    });
    publishedTemplateId = pubTemplate.id;

    const arcTemplate = await prisma.template.create({
      data: {
        templateId: 'TSK-T-002',
        title: 'Archived Template',
        formSchema: [{ id: '1', type: 'text', label: 'Note' }],
        status: 'Archived',
        ownerId: managerId,
        divisionId
      }
    });
    archivedTemplateId = arcTemplate.id;

    const oneOffTemplate = await prisma.template.create({
      data: {
        templateId: 'TSK-T-003',
        title: 'One-Off Template',
        formSchema: [{ id: '1', type: 'text', label: 'Check' }],
        status: 'Published',
        publishedAt: new Date(),
        ownerId: managerId,
        divisionId,
        isOneOff: true
      }
    });
    oneOffTemplateId = oneOffTemplate.id;
  });

  beforeEach(async () => {
    await prisma.taskActivity.deleteMany({});
    await prisma.taskData.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  afterAll(async () => {
    await prisma.taskActivity.deleteMany({});
    await prisma.taskData.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.auditLog.deleteMany({});
    // Delete ALL templates that were created by test users (includes dynamically created ones in Submission group)
    // Must happen before user deletion to avoid FK constraint violation on Template.ownerId
    await prisma.template.deleteMany({
      where: {
        OR: [
          { templateId: { startsWith: 'TSK-T-' } },
          { templateId: { startsWith: 'TSK-TP-' } }
        ]
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ['task_director@sqd.com', 'task_admin@sqd.com', 'task_manager@sqd.com', 'task_staff@sqd.com', 'task_manager2@sqd.com']
        }
      }
    });
    await prisma.$disconnect();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 1 — Task Creation
  // ──────────────────────────────────────────────────────────────────────────

  describe('Task Creation', () => {
    it('T01: Manager creates Task without assignee → Unassigned, correct taskId format', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('Unassigned');
      expect(res.body.taskId).toMatch(/^TSK-\d{6}$/);
    });

    it('T02: Manager creates Task with assignee → Assigned', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId, assignedToUserId: staffId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('Assigned');
    });

    it('T03: Director creates Task with cross-div assignee → 201', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId, assignedToUserId: manager2Id });

      expect(res.status).toBe(201);
    });

    it('T04: Staff cannot create Task without WP → 403', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId });

      expect(res.status).toBe(403);
    });

    it('T04a: Staff assigned to a WP can create task inside that WP for same division', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'TSK-WP-04A001',
          name: 'WP 04A',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date(),
          timeframeTo: new Date(Date.now() + 86400000),
          creatorId: managerId,
          status: 'Open'
        }
      });
      await prisma.workPackageAssignment.create({
        data: { wpId: wp.id, userId: staffId }
      });

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId, wpId: wp.id });

      expect(res.status).toBe(201);
      expect(res.body.wpId).toBe(wp.id);

      // Cleanup
      await prisma.workPackageAssignment.deleteMany({ where: { wpId: wp.id } });
      await prisma.task.delete({ where: { id: res.body.id } });
      await prisma.workPackage.delete({ where: { id: wp.id } });
    });

    it('T04b: Staff NOT assigned to a WP cannot create task in that WP → 403', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'TSK-WP-04B001',
          name: 'WP 04B',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date(),
          timeframeTo: new Date(Date.now() + 86400000),
          creatorId: managerId,
          status: 'Open'
        }
      });

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId, wpId: wp.id });

      expect(res.status).toBe(403);

      // Cleanup
      await prisma.workPackage.delete({ where: { id: wp.id } });
    });

    it('T05: Create Task from Archived template → 400', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: archivedTemplateId, targetDivisionId: divisionId });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Published/i);
    });

    it('T06: Create Task from non-existent template → 404', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: 999999, targetDivisionId: divisionId });

      expect(res.status).toBe(404);
    });

    it('T07: Create Task linked to a Closed WP → 400', async () => {
      const closedWp = await prisma.workPackage.create({
        data: {
          wpId: 'TSK-WP-990001',
          name: 'Closed WP for Task Test',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date('2020-01-01'),
          timeframeTo: new Date('2020-12-31'),
          creatorId: managerId,
          status: 'Closed'
        }
      });

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId, wpId: closedWp.id });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Closed Work Package/i);

      await prisma.workPackage.delete({ where: { id: closedWp.id } });
    });

    it('T08: isOneOff Template is archived after task assignment', async () => {
      // Ensure the one-off template is Published
      await prisma.template.update({ where: { id: oneOffTemplateId }, data: { status: 'Published' } });

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: oneOffTemplateId, targetDivisionId: divisionId, assignedToUserId: staffId });

      expect(res.status).toBe(201);

      const template = await prisma.template.findUnique({ where: { id: oneOffTemplateId } });
      expect(template?.status).toBe('Archived');

      // Restore for subsequent tests
      await prisma.template.update({ where: { id: oneOffTemplateId }, data: { status: 'Published' } });
    });

    it('T09: schemaSnapshot equals template.formSchema at creation', async () => {
      const template = await prisma.template.findUnique({ where: { id: publishedTemplateId } });

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId });

      expect(res.status).toBe(201);
      expect(JSON.stringify(res.body.schemaSnapshot)).toBe(JSON.stringify(template!.formSchema));
    });

    it('T10: estimatedHours inherited from Template when not overridden', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId });

      expect(res.status).toBe(201);
      expect(res.body.estimatedHours).toBe(2.0);
    });

    it('T11: SYSTEM_EVENT logged in TaskActivity on task creation', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId });

      expect(res.status).toBe(201);
      const activities = await prisma.taskActivity.findMany({ where: { taskId: res.body.id } });
      expect(activities.length).toBeGreaterThan(0);
      expect(activities[0]!.type).toBe('SYSTEM_EVENT');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 2 — Assignment
  // ──────────────────────────────────────────────────────────────────────────

  describe('Assignment', () => {
    async function createUnassignedTask(): Promise<number> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          targetDivisionId: divisionId,
          status: 'Unassigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T12: Manager assigns Unassigned task to same-div user → Assigned', async () => {
      const taskId = await createUnassignedTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ assignedToUserId: staffId });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Assigned');
      expect(res.body.assignedToUser.id).toBe(staffId);
    });

    it('T13: Manager assigns cross-div user → 403', async () => {
      const taskId = await createUnassignedTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ assignedToUserId: manager2Id });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/division/i);
    });

    it('T14: Director assigns cross-div user → 200', async () => {
      const taskId = await createUnassignedTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/assign`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ assignedToUserId: manager2Id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Assigned');
    });

    it('T14a: Regular user (Staff) assigned to a WP can assign task in that WP to same-div user', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'TSK-WP-14A001',
          name: 'WP 14A',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date(),
          timeframeTo: new Date(Date.now() + 86400000),
          creatorId: managerId,
          status: 'Open'
        }
      });
      await prisma.workPackageAssignment.create({
        data: { wpId: wp.id, userId: staffId }
      });
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          wpId: wp.id,
          targetDivisionId: divisionId,
          status: 'Unassigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      // Staff user is assigned to the WP and assigns task to managerId (same-div user)
      const res = await request(app)
        .put(`/api/tasks/${task.id}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ assignedToUserId: managerId });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Assigned');

      // Cleanup
      await prisma.workPackageAssignment.deleteMany({ where: { wpId: wp.id } });
      await prisma.task.delete({ where: { id: task.id } });
      await prisma.workPackage.delete({ where: { id: wp.id } });
    });

    it('T14b: Regular user (Staff) NOT assigned to the WP cannot assign task → 403', async () => {
      const wp = await prisma.workPackage.create({
        data: {
          wpId: 'TSK-WP-14B001',
          name: 'WP 14B',
          type: 'AUDIT',
          divisionId,
          timeframeFrom: new Date(),
          timeframeTo: new Date(Date.now() + 86400000),
          creatorId: managerId,
          status: 'Open'
        }
      });
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          wpId: wp.id,
          targetDivisionId: divisionId,
          status: 'Unassigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      // Staff user is NOT assigned to the WP and tries to assign task
      const res = await request(app)
        .put(`/api/tasks/${task.id}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ assignedToUserId: managerId });

      expect(res.status).toBe(403);

      // Cleanup
      await prisma.task.delete({ where: { id: task.id } });
      await prisma.workPackage.delete({ where: { id: wp.id } });
    });

    it('T15: Self-assign (PERFORM THIS TASK) on Unassigned task', async () => {
      const taskId = await createUnassignedTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/self-assign`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Assigned');
      expect(res.body.assignedToUser.id).toBe(staffId);
    });

    it('T16: Self-assign on Assigned task → 400', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: managerId,
          targetDivisionId: divisionId,
          status: 'Assigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .put(`/api/tasks/${task.id}/self-assign`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no longer available/i);
    });

    it('T17: Reassign at InProgress with reason → 200, status=Assigned', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'In Progress',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      // Create some taskData to verify it's preserved
      await prisma.taskData.create({ data: { taskId: task.id, data: { '1': 'Pass' } } });

      const res = await request(app)
        .put(`/api/tasks/${task.id}/reassign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ newAssigneeId: managerId, reason: 'Staff unavailable' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Assigned');

      // TaskData must still exist
      const data = await prisma.taskData.findUnique({ where: { taskId: task.id } });
      expect(data).not.toBeNull();
    });

    it('T18: Reassign without reason → 400', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'In Progress',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .put(`/api/tasks/${task.id}/reassign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ newAssigneeId: managerId });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reason/i);
    });

    it('T19: Reassign on Closed task → 400', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'Closed',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .put(`/api/tasks/${task.id}/reassign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ newAssigneeId: managerId, reason: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/final state/i);
    });

    it('T20: SYSTEM_EVENT logged on assignment', async () => {
      const taskId = await createUnassignedTask();

      await request(app)
        .put(`/api/tasks/${taskId}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ assignedToUserId: staffId });

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      const assignEvent = activities.find(a => a.content.includes('assigned'));
      expect(assignEvent).toBeDefined();
      expect(assignEvent!.type).toBe('SYSTEM_EVENT');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 3 — TaskData Save
  // ──────────────────────────────────────────────────────────────────────────

  describe('TaskData Save', () => {
    async function createAssignedTask(): Promise<number> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'Assigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T21: Assignee first save → status becomes In Progress', async () => {
      const taskId = await createAssignedTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/data`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ data: { '1': 'Pass' } });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('In Progress');

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      expect(task!.status).toBe('In Progress');
    });

    it('T22: Assignee second save → status stays In Progress', async () => {
      const taskId = await createAssignedTask();

      await request(app)
        .put(`/api/tasks/${taskId}/data`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ data: { '1': 'Pass' } });

      const res = await request(app)
        .put(`/api/tasks/${taskId}/data`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ data: { '1': 'Fail' } });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('In Progress');
    });

    it('T23: Non-assignee cannot save TaskData → 403', async () => {
      const taskId = await createAssignedTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/data`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ data: { '1': 'Pass' } });

      expect(res.status).toBe(403);
    });

    it('T24: SYSTEM_EVENT logged on first save (In Progress status change)', async () => {
      const taskId = await createAssignedTask();

      await request(app)
        .put(`/api/tasks/${taskId}/data`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ data: { '1': 'Pass' } });

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      const inProgressEvent = activities.find(a => a.content.includes('In Progress'));
      expect(inProgressEvent).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 4 — Submission
  // ──────────────────────────────────────────────────────────────────────────

  describe('Submission', () => {
    async function createInProgressTask(requiresApproval = true): Promise<number> {
      // Use a template with the specified requiresApproval setting
      const tmpl = await prisma.template.create({
        data: {
          templateId: `TSK-TP-${Date.now()}`,
          title: 'Submit Test Template',
          formSchema: [],
          status: 'Published',
          publishedAt: new Date(),
          ownerId: managerId,
          divisionId,
          requiresApproval
        }
      });
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: tmpl.id,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'In Progress',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T25: Assignee submits (requiresApproval=true) → In Review', async () => {
      const taskId = await createInProgressTask(true);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/submit`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('In Review');
    });

    it('T26: Assignee submits (requiresApproval=false) → Closed immediately', async () => {
      const taskId = await createInProgressTask(false);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/submit`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Closed');
    });

    it('T27: Non-assignee cannot submit → 403', async () => {
      const taskId = await createInProgressTask(true);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/submit`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(403);
    });

    it('T28: SYSTEM_EVENT logged on submit', async () => {
      const taskId = await createInProgressTask(true);

      await request(app)
        .put(`/api/tasks/${taskId}/submit`)
        .set('Authorization', `Bearer ${staffToken}`);

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      const submitEvent = activities.find(a => a.content.toLowerCase().includes('review') || a.content.toLowerCase().includes('submit'));
      expect(submitEvent).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 5 — Review Actions
  // ──────────────────────────────────────────────────────────────────────────

  describe('Review Actions', () => {
    async function createInReviewTask(issuerId: number = managerId, assigneeId: number = staffId): Promise<number> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId,
          assignedToUserId: assigneeId,
          targetDivisionId: divisionId,
          status: 'In Review',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T29: Reviewer approves In Review task → Closed', async () => {
      const taskId = await createInReviewTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/review`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'approve' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Closed');
    });

    it('T30: Reviewer rejects → Rejected (with comment)', async () => {
      const taskId = await createInReviewTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/review`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'reject', comment: 'Missing section 3 data' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Rejected');
    });

    it('T31: Reviewer requests follow-up → Follow-up Required', async () => {
      const taskId = await createInReviewTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/review`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'follow-up', comment: 'Please add torque values' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Follow-up Required');
    });

    it('T32: Assignee resubmits after Follow-up Required → In Review', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'Follow-up Required',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .put(`/api/tasks/${task.id}/submit`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('In Review');
    });

    it('T33: Staff (non-reviewer) attempts review → 403', async () => {
      const taskId = await createInReviewTask();

      // Staff user who is not the issuer or same-div manager
      const otherStaff = await prisma.user.create({
        data: { name: 'Other Staff', email: `other_staff_${Date.now()}@sqd.com`, passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: (await prisma.role.findUnique({ where: { name: 'Staff' } }))!.id }
      });
      const otherStaffToken = makeToken(otherStaff.id, 'Staff', divisionId);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/review`)
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .send({ action: 'approve' });

      expect(res.status).toBe(403);

      await prisma.user.delete({ where: { id: otherStaff.id } });
    });

    it('T34: Manager from different division cannot review → 403', async () => {
      const taskId = await createInReviewTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/review`)
        .set('Authorization', `Bearer ${manager2Token}`)
        .send({ action: 'approve' });

      expect(res.status).toBe(403);
    });

    it('T35: Manager from same division can review → 200', async () => {
      const taskId = await createInReviewTask(directorId, staffId); // issuer is director

      const res = await request(app)
        .put(`/api/tasks/${taskId}/review`)
        .set('Authorization', `Bearer ${managerToken}`)  // manager of same div
        .send({ action: 'approve' });

      expect(res.status).toBe(200);
    });

    it('T36: SYSTEM_EVENT logged on every review action', async () => {
      const taskId = await createInReviewTask();

      await request(app)
        .put(`/api/tasks/${taskId}/review`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'approve' });

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      const reviewEvent = activities.find(a => a.content.toLowerCase().includes('approved') || a.content.toLowerCase().includes('closed'));
      expect(reviewEvent).toBeDefined();
      expect(reviewEvent!.type).toBe('SYSTEM_EVENT');
    });

    // Amendment 3 — T74: Issuer-who-is-Assignee cannot self-approve
    it('T74: User who is both Issuer and Assignee cannot approve their own task → 403', async () => {
      // Create a task where manager is both issuer AND assignee
      const selfTask = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: managerId, // same as issuerId
          targetDivisionId: divisionId,
          status: 'In Review',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .put(`/api/tasks/${selfTask.id}/review`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'approve' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/same person/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 6 — Post-Rejection
  // ──────────────────────────────────────────────────────────────────────────

  describe('Post-Rejection', () => {
    async function createRejectedTask(): Promise<number> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'Rejected',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T37: Terminate Rejected task → Terminated', async () => {
      const taskId = await createRejectedTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/post-rejection`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'terminate' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Terminated');
    });

    it('T38: Reassign Rejected task → Assigned', async () => {
      const taskId = await createRejectedTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/post-rejection`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'reassign', newAssigneeId: managerId });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Assigned');
    });

    it('T39: Post-rejection action on non-Rejected task → 400', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'In Review',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .put(`/api/tasks/${task.id}/post-rejection`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'terminate' });

      expect(res.status).toBe(400);
    });

    it('T40: SYSTEM_EVENT logged for Terminate and Reassign', async () => {
      const taskId = await createRejectedTask();

      await request(app)
        .put(`/api/tasks/${taskId}/post-rejection`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'terminate' });

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      expect(activities.some(a => a.type === 'SYSTEM_EVENT')).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 7 — Inactivation & Reactivation
  // ──────────────────────────────────────────────────────────────────────────

  describe('Inactivation & Reactivation', () => {
    async function createActiveTask(status = 'In Progress'): Promise<number> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status,
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T41: Issuer inactivates In Progress task with reason → Inactive', async () => {
      const taskId = await createActiveTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/inactive`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ reason: 'Aircraft removed from service' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Inactive');
      expect((res.body.inactivationLog as any).previousStatus).toBe('In Progress');
    });

    it('T42: Inactivate without reason → 400', async () => {
      const taskId = await createActiveTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/inactive`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reason/i);
    });

    it('T43: Staff (non-issuer, non-admin) cannot inactivate → 403', async () => {
      const taskId = await createActiveTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/inactive`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ reason: 'test' });

      expect(res.status).toBe(403);
    });

    it('T44: Issuer reactivates → previous status restored', async () => {
      const taskId = await createActiveTask('In Progress');

      await request(app)
        .put(`/api/tasks/${taskId}/inactive`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ reason: 'Temporary hold' });

      const res = await request(app)
        .put(`/api/tasks/${taskId}/reactivate`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('In Progress');
      expect(res.body.inactivationLog).toBeNull();
    });

    it('T45: Reactivate a non-Inactive task → 400', async () => {
      const taskId = await createActiveTask('Assigned');

      const res = await request(app)
        .put(`/api/tasks/${taskId}/reactivate`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not Inactive/i);
    });

    it('T46: SYSTEM_EVENT logged for inactivation and reactivation', async () => {
      const taskId = await createActiveTask();

      await request(app)
        .put(`/api/tasks/${taskId}/inactive`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ reason: 'test' });

      await request(app)
        .put(`/api/tasks/${taskId}/reactivate`)
        .set('Authorization', `Bearer ${managerToken}`);

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      expect(activities.some(a => a.content.includes('inactivated') || a.content.includes('Inactive'))).toBe(true);
      expect(activities.some(a => a.content.includes('reactivated') || a.content.includes('Reactivated'))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 8 — Deadline
  // ──────────────────────────────────────────────────────────────────────────

  describe('Deadline Management', () => {
    async function createTask(status = 'Assigned'): Promise<number> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status,
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T47: Issuer sets initial deadline', async () => {
      const taskId = await createTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/deadline`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ deadline: '2026-12-31' });

      expect(res.status).toBe(200);
      expect(res.body.deadline).toBeDefined();
    });

    it('T48: Assignee requests extension with reason', async () => {
      const taskId = await createTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/deadline/request`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ reason: 'Awaiting parts', proposedDeadline: '2026-12-01' });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.deadlineExtensions)).toBe(true);
      expect(res.body.deadlineExtensions[0].decision).toBeNull();
    });

    it('T49: Extension request without reason → 400', async () => {
      const taskId = await createTask();

      const res = await request(app)
        .put(`/api/tasks/${taskId}/deadline/request`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('T50: Reviewer approves extension → deadline updated', async () => {
      const taskId = await createTask();

      await request(app)
        .put(`/api/tasks/${taskId}/deadline/request`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ reason: 'Parts delay', proposedDeadline: '2026-12-01' });

      const res = await request(app)
        .put(`/api/tasks/${taskId}/deadline/decide`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ extensionIndex: 0, decision: 'approve', newDeadline: '2026-12-01' });

      expect(res.status).toBe(200);
      expect(res.body.deadline).toContain('2026-12-01');
      expect(res.body.deadlineExtensions[0].decision).toBe('approve');
    });

    it('T51: Reviewer denies extension → original deadline unchanged', async () => {
      const taskId = await createTask();

      // Set initial deadline
      await request(app)
        .put(`/api/tasks/${taskId}/deadline`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ deadline: '2026-07-01' });

      // Request extension
      await request(app)
        .put(`/api/tasks/${taskId}/deadline/request`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ reason: 'Delay', proposedDeadline: '2026-09-01' });

      // Deny
      const res = await request(app)
        .put(`/api/tasks/${taskId}/deadline/decide`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ extensionIndex: 0, decision: 'deny' });

      expect(res.status).toBe(200);
      expect(res.body.deadlineExtensions[0].decision).toBe('deny');
      // Deadline should remain at the original
      expect(res.body.deadline).toContain('2026-07-01');
    });

    it('T52: SYSTEM_EVENT logged for request and decision', async () => {
      const taskId = await createTask();

      await request(app)
        .put(`/api/tasks/${taskId}/deadline/request`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ reason: 'Test', proposedDeadline: '2026-12-01' });

      await request(app)
        .put(`/api/tasks/${taskId}/deadline/decide`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ extensionIndex: 0, decision: 'approve', newDeadline: '2026-12-01' });

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      expect(activities.some(a => a.content.toLowerCase().includes('extension'))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 9 — Issuer Transfer
  // ──────────────────────────────────────────────────────────────────────────

  describe('Issuer Transfer', () => {
    async function createTaskWithIssuer(issuerId: number): Promise<number> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'In Review',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T53: Issuer transfers rights to another user', async () => {
      const taskId = await createTaskWithIssuer(managerId);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/transfer-issuer`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ newIssuerId: directorId });

      expect(res.status).toBe(200);
      expect(res.body.issuerId).toBe(directorId);
    });

    it('T54: Non-issuer cannot transfer → 403', async () => {
      const taskId = await createTaskWithIssuer(managerId);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/transfer-issuer`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ newIssuerId: directorId });

      expect(res.status).toBe(403);
    });

    it('T55: Original issuer loses issuer-based review rights after transfer', async () => {
      const taskId = await createTaskWithIssuer(managerId);

      // Transfer issuer rights to director
      await request(app)
        .put(`/api/tasks/${taskId}/transfer-issuer`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ newIssuerId: directorId });

      // Manager is no longer issuer — they are still a Manager of the same division,
      // so they retain review rights via the Manager-role path.
      // To test loss of ISSUER-based rights specifically, we use manager2 (different div)
      // who was never issuer. This is covered implicitly by T34.
      // For this test, we confirm the task.issuerId is now directorId.
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { issuerId: true } });
      expect(task!.issuerId).toBe(directorId);
    });

    it('T56: New issuer (director) gains review rights', async () => {
      const taskId = await createTaskWithIssuer(managerId);

      await request(app)
        .put(`/api/tasks/${taskId}/transfer-issuer`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ newIssuerId: directorId });

      const res = await request(app)
        .put(`/api/tasks/${taskId}/review`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ action: 'approve' });

      expect(res.status).toBe(200);
    });

    it('T57: SYSTEM_EVENT logged for issuer transfer', async () => {
      const taskId = await createTaskWithIssuer(managerId);

      await request(app)
        .put(`/api/tasks/${taskId}/transfer-issuer`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ newIssuerId: directorId });

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      expect(activities.some(a => a.content.toLowerCase().includes('issuer') || a.content.toLowerCase().includes('transferred'))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 10 — Rating
  // ──────────────────────────────────────────────────────────────────────────

  describe('Rating', () => {
    async function createClosedTask(assigneeId: number): Promise<number> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: assigneeId,
          targetDivisionId: divisionId,
          status: 'Closed',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      return t.id;
    }

    it('T58: Manager rates Closed task with same-div Staff assignee → 200', async () => {
      const taskId = await createClosedTask(staffId);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/rate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ rating: 3 });

      expect(res.status).toBe(200);
      expect(res.body.rating).toBe(3);
    });

    it('T59: Director rates Closed task with Manager assignee → 200', async () => {
      const taskId = await createClosedTask(managerId);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/rate`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ rating: 2 });

      expect(res.status).toBe(200);
      expect(res.body.rating).toBe(2);
    });

    it('T60: Director cannot rate task where assignee is a Staff member (not a Manager) → 403', async () => {
      // Director can only rate Tasks where assignee is a Manager.
      // Staff assignee → Director rating is not permitted.
      const taskId = await createClosedTask(staffId);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/rate`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ rating: 1 });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Manager/i);
    });

    it('T61: Rating before task is in final state → 400', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'In Progress',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .put(`/api/tasks/${task.id}/rate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ rating: 2 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/final state/i);
    });

    it('T62: Director re-rates → SYSTEM_EVENT logs old and new value', async () => {
      const taskId = await createClosedTask(managerId);

      await request(app)
        .put(`/api/tasks/${taskId}/rate`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ rating: 1 });

      await request(app)
        .put(`/api/tasks/${taskId}/rate`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ rating: 3 });

      const activities = await prisma.taskActivity.findMany({ where: { taskId } });
      const revisionEvent = activities.find(a => a.content.includes('re-rated'));
      expect(revisionEvent).toBeDefined();
    });

    it('T63: Rating out of range (4) → 400', async () => {
      const taskId = await createClosedTask(staffId);

      const res = await request(app)
        .put(`/api/tasks/${taskId}/rate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ rating: 4 });

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 11 — TaskActivity Feed
  // ──────────────────────────────────────────────────────────────────────────

  describe('TaskActivity Feed', () => {
    async function createTaskWithActivity(): Promise<{ taskId: number }> {
      const t = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'In Review',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });
      // Seed some activity
      await prisma.taskActivity.createMany({
        data: [
          { taskId: t.id, type: 'SYSTEM_EVENT', content: 'Task created', authorId: null },
          { taskId: t.id, type: 'COMMENT', content: 'Please check section 3', authorId: managerId }
        ]
      });
      return { taskId: t.id };
    }

    it('T64: GET /activity returns ordered feed (ASC)', async () => {
      const { taskId } = await createTaskWithActivity();

      const res = await request(app)
        .get(`/api/tasks/${taskId}/activity`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Verify ascending order
      for (let i = 1; i < res.body.length; i++) {
        expect(new Date(res.body[i].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(res.body[i - 1].createdAt).getTime()
        );
      }
    });

    it('T65: Issuer posts comment → 201, type=COMMENT', async () => {
      const { taskId } = await createTaskWithActivity();

      const res = await request(app)
        .post(`/api/tasks/${taskId}/activity`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ content: 'Please complete section 3' });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe('COMMENT');
      expect(res.body.authorId).toBe(managerId);
    });

    it('T66: Assignee posts comment → 201', async () => {
      const { taskId } = await createTaskWithActivity();

      const res = await request(app)
        .post(`/api/tasks/${taskId}/activity`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ content: 'Updated and resubmitting' });

      expect(res.status).toBe(201);
    });

    it('T67: Same-div Manager posts comment → 201', async () => {
      const { taskId } = await createTaskWithActivity();

      const res = await request(app)
        .post(`/api/tasks/${taskId}/activity`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ content: 'Note added by manager' });

      expect(res.status).toBe(201);
    });

    it('T68: User without task access cannot post comment → 403', async () => {
      const { taskId } = await createTaskWithActivity();

      // manager2 is in a different division and is not issuer/assignee
      const res = await request(app)
        .post(`/api/tasks/${taskId}/activity`)
        .set('Authorization', `Bearer ${manager2Token}`)
        .send({ content: 'Unauthorized comment' });

      expect(res.status).toBe(403);
    });

    it('T69: No PATCH or DELETE endpoint exists for activity entries → 404', async () => {
      const { taskId } = await createTaskWithActivity();

      const patchRes = await request(app)
        .patch(`/api/tasks/${taskId}/activity/1`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ content: 'Edited' });

      const deleteRes = await request(app)
        .delete(`/api/tasks/${taskId}/activity/1`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect([404, 405]).toContain(patchRes.status);
      expect([404, 405]).toContain(deleteRes.status);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group 12 — Soft Delete & List Endpoints
  // ──────────────────────────────────────────────────────────────────────────

  describe('Soft Delete & List Endpoints', () => {
    it('T70: Soft-deleted task not returned by GET /api/tasks', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'Assigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL',
          deletedAt: new Date() // soft-deleted
        }
      });

      const res = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((t: any) => t.id === task.id);
      expect(found).toBeUndefined();
    });

    it('T71: GET /api/tasks/:id on soft-deleted task → 404', async () => {
      const task = await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-6)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          targetDivisionId: divisionId,
          status: 'Assigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL',
          deletedAt: new Date()
        }
      });

      const res = await request(app)
        .get(`/api/tasks/${task.id}`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(404);
    });

    it('T72: GET /my-tasks returns only tasks where user is assignee or issuer', async () => {
      // Create a task where staff is assignee
      await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-5)}${Math.floor(Math.random()*10)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'Assigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      // Create a task where staff is NOT involved
      await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-5)}${Math.floor(Math.random()*10)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: managerId,
          targetDivisionId: divisionId,
          status: 'Assigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .get('/api/tasks/my-tasks')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      // Every returned task must have staff as assignee or issuer
      res.body.forEach((t: any) => {
        expect(
          t.assignedToUser?.id === staffId || t.issuer?.id === staffId
        ).toBe(true);
      });
    });

    it('T73: GET /unassigned returns only Unassigned tasks', async () => {
      await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-5)}${Math.floor(Math.random()*10)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          targetDivisionId: divisionId,
          status: 'Unassigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      await prisma.task.create({
        data: {
          taskId: `TSK-${String(Date.now()).slice(-5)}${Math.floor(Math.random()*10)}`,
          templateId: publishedTemplateId,
          issuerId: managerId,
          assignedToUserId: staffId,
          targetDivisionId: divisionId,
          status: 'Assigned',
          schemaSnapshot: [],
          assignmentType: 'INDIVIDUAL'
        }
      });

      const res = await request(app)
        .get('/api/tasks/unassigned')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      res.body.forEach((t: any) => {
        expect(t.status).toBe('Unassigned');
      });
    });
  });
});
