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

describe('Findings Backend (Phase 6)', () => {
  let directorToken: string;
  let adminToken: string;
  let managerToken: string;
  let manager2Token: string;
  let staffToken: string;

  let directorId: number;
  let managerId: number;
  let staffId: number;

  let divisionId: number;   // FND
  let division2Id: number;  // FN2
  let departmentId: number;

  let allowsFindingsTemplateId: number; // Published, allowsFindings = true, requiresApproval = true
  let noFindingsTemplateId: number;     // Published, allowsFindings = false
  let autoCloseTemplateId: number;      // Published, requiresApproval = false (for hook test)
  let archivedTemplateId: number;       // Archived (for generate-task rejection)

  let sourceTaskId: number; // recreated each test (tasks are wiped in beforeEach)

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Finding Test Dept' }, update: {}, create: { name: 'Finding Test Dept' } });
    departmentId = dept.id;
    const div = await prisma.division.upsert({ where: { code: 'FND' }, update: {}, create: { name: 'Finding Test Div', code: 'FND', departmentId: dept.id } });
    const div2 = await prisma.division.upsert({ where: { code: 'FN2' }, update: {}, create: { name: 'Finding Test Div 2', code: 'FN2', departmentId: dept.id } });
    divisionId = div.id;
    division2Id = div2.id;

    const director = await prisma.user.create({ data: { name: 'Fnd Director', email: 'fnd_director@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id } });
    directorId = director.id;
    const admin = await prisma.user.create({ data: { name: 'Fnd Admin', email: 'fnd_admin@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: adminRole.id } });
    const manager = await prisma.user.create({ data: { name: 'Fnd Manager', email: 'fnd_manager@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id } });
    managerId = manager.id;
    const manager2 = await prisma.user.create({ data: { name: 'Fnd Manager2', email: 'fnd_manager2@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: division2Id, roleId: managerRole.id } });
    const staff = await prisma.user.create({ data: { name: 'Fnd Staff', email: 'fnd_staff@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    staffId = staff.id;

    directorToken = makeToken(directorId, 'Director', divisionId);
    adminToken = makeToken(admin.id, 'Admin', divisionId);
    managerToken = makeToken(managerId, 'Manager', divisionId);
    manager2Token = makeToken(manager2.id, 'Manager', division2Id);
    staffToken = makeToken(staffId, 'Staff', divisionId);

    const baseSchema = [{ id: '1', type: 'radio', label: 'Pass/Fail', options: ['Pass', 'Fail'] }];

    const af = await prisma.template.create({ data: { templateId: 'FND-T-001', title: 'Allows Findings', formSchema: baseSchema, status: 'Published', publishedAt: new Date(), ownerId: managerId, divisionId, requiresApproval: true, allowsFindings: true, estimatedHours: 3 } });
    allowsFindingsTemplateId = af.id;
    const nf = await prisma.template.create({ data: { templateId: 'FND-T-002', title: 'No Findings', formSchema: baseSchema, status: 'Published', publishedAt: new Date(), ownerId: managerId, divisionId, requiresApproval: true, allowsFindings: false } });
    noFindingsTemplateId = nf.id;
    const ac = await prisma.template.create({ data: { templateId: 'FND-T-003', title: 'Auto Close', formSchema: baseSchema, status: 'Published', publishedAt: new Date(), ownerId: managerId, divisionId, requiresApproval: false, allowsFindings: true } });
    autoCloseTemplateId = ac.id;
    const ar = await prisma.template.create({ data: { templateId: 'FND-T-004', title: 'Archived', formSchema: baseSchema, status: 'Archived', ownerId: managerId, divisionId } });
    archivedTemplateId = ar.id;
  });

  beforeEach(async () => {
    // FK-safe wipe (Task <-> Finding are mutually referential).
    await prisma.taskActivity.deleteMany({});
    await prisma.timeBooking.deleteMany({});
    await prisma.taskData.deleteMany({});
    await prisma.task.updateMany({ data: { parentFindingId: null } });
    await prisma.finding.updateMany({ data: { sourceTaskId: null } });
    await prisma.finding.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.auditLog.deleteMany({});

    const t = await prisma.task.create({
      data: {
        taskId: 'FND-900001',
        templateId: allowsFindingsTemplateId,
        issuerId: managerId,
        targetDivisionId: divisionId,
        status: 'Closed',
        schemaSnapshot: [] as any,
        assignmentType: 'INDIVIDUAL'
      }
    });
    sourceTaskId = t.id;
  });

  afterAll(async () => {
    await prisma.taskActivity.deleteMany({});
    await prisma.timeBooking.deleteMany({});
    await prisma.taskData.deleteMany({});
    await prisma.task.updateMany({ data: { parentFindingId: null } });
    await prisma.finding.updateMany({ data: { sourceTaskId: null } });
    await prisma.finding.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.template.deleteMany({ where: { templateId: { startsWith: 'FND-T-' } } });
    await prisma.user.deleteMany({ where: { email: { in: ['fnd_director@sqd.com', 'fnd_admin@sqd.com', 'fnd_manager@sqd.com', 'fnd_manager2@sqd.com', 'fnd_staff@sqd.com'] } } });
    await prisma.$disconnect();
  });

  // Convenience: raise a finding directly via API as a given token.
  const raiseFinding = (token: string, overrides: Record<string, unknown> = {}) =>
    request(app)
      .post('/api/findings')
      .set('Authorization', `Bearer ${token}`)
      .send({ taskId: sourceTaskId, eventType: 'Procedural Breach', departmentId, description: 'Torque values missing', ...overrides });

  // ────────────────────────────────────────────────────────────────────────
  // Group 1 — Create Finding
  // ────────────────────────────────────────────────────────────────────────

  describe('Create Finding', () => {
    it('F01: Staff can raise a finding on an allowsFindings task → 201, status Open', async () => {
      const res = await raiseFinding(staffToken);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('Open');
      expect(res.body.reportedByUserId).toBe(staffId);
      expect(res.body.targetDivisionId).toBe(divisionId);
    });

    it('F02: rejects when the template does not allow findings → 400', async () => {
      const task = await prisma.task.create({ data: { taskId: 'FND-900002', templateId: noFindingsTemplateId, issuerId: managerId, targetDivisionId: divisionId, status: 'Closed', schemaSnapshot: [] as any } });
      const res = await request(app).post('/api/findings').set('Authorization', `Bearer ${staffToken}`).send({ taskId: task.id, eventType: 'X', departmentId, description: 'y' });
      expect(res.status).toBe(400);
    });

    it('F03: missing required fields → 400', async () => {
      const res = await request(app).post('/api/findings').set('Authorization', `Bearer ${staffToken}`).send({ taskId: sourceTaskId, description: 'no eventType or dept' });
      expect(res.status).toBe(400);
    });

    it('F04: unknown source task → 404', async () => {
      const res = await request(app).post('/api/findings').set('Authorization', `Bearer ${staffToken}`).send({ taskId: 999999, eventType: 'X', departmentId, description: 'y' });
      expect(res.status).toBe(404);
    });

    it('F05: unknown department → 400', async () => {
      const res = await raiseFinding(staffToken, { departmentId: 999999 });
      expect(res.status).toBe(400);
    });

    it('F06: create writes an AuditLog (Finding/CREATED) and a SYSTEM_EVENT on the source task feed', async () => {
      const res = await raiseFinding(managerToken);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Finding', entityId: String(res.body.id), actionType: 'CREATED' } });
      expect(audit).not.toBeNull();
      const activity = await prisma.taskActivity.findFirst({ where: { taskId: sourceTaskId, type: 'SYSTEM_EVENT' } });
      expect(activity).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 2 — List Findings (RBAC scoping)
  // ────────────────────────────────────────────────────────────────────────

  describe('List Findings — RBAC scoping', () => {
    let findingByStaff: number;
    let findingByDirector: number;

    beforeEach(async () => {
      const a = await raiseFinding(staffToken);
      findingByStaff = a.body.id;
      const b = await raiseFinding(directorToken);
      findingByDirector = b.body.id;
    });

    it('F10: Director sees all findings', async () => {
      const res = await request(app).get('/api/findings').set('Authorization', `Bearer ${directorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('F11: Manager sees findings in their division', async () => {
      const res = await request(app).get('/api/findings').set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.findings.map((f: any) => f.id);
      expect(ids).toContain(findingByStaff);
      expect(ids).toContain(findingByDirector);
    });

    it('F12: Manager of another division sees none of these', async () => {
      const res = await request(app).get('/api/findings').set('Authorization', `Bearer ${manager2Token}`);
      const ids = res.body.findings.map((f: any) => f.id);
      expect(ids).not.toContain(findingByStaff);
      expect(ids).not.toContain(findingByDirector);
    });

    it('F13: Staff sees only findings they reported (not others)', async () => {
      const res = await request(app).get('/api/findings').set('Authorization', `Bearer ${staffToken}`);
      const ids = res.body.findings.map((f: any) => f.id);
      expect(ids).toContain(findingByStaff);
      expect(ids).not.toContain(findingByDirector);
    });

    it('F14: Staff sees a finding where they are a follow-up Task assignee', async () => {
      // Director reports; generate a follow-up task; assign it to staff.
      await request(app).put(`/api/findings/${findingByDirector}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const gen = await request(app).post(`/api/findings/${findingByDirector}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: allowsFindingsTemplateId, title: 'Corrective Action' }] });
      const followUpId = gen.body.createdTasks[0].id;
      await prisma.task.update({ where: { id: followUpId }, data: { assignedToUserId: staffId, status: 'Assigned' } });

      const res = await request(app).get('/api/findings').set('Authorization', `Bearer ${staffToken}`);
      const ids = res.body.findings.map((f: any) => f.id);
      expect(ids).toContain(findingByDirector);
    });

    it('F15: status filter narrows results', async () => {
      const res = await request(app).get('/api/findings?status=Open').set('Authorization', `Bearer ${directorToken}`);
      expect(res.body.findings.every((f: any) => f.status === 'Open')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 3 — Review
  // ────────────────────────────────────────────────────────────────────────

  describe('Review', () => {
    let findingId: number;
    beforeEach(async () => {
      const r = await raiseFinding(staffToken);
      findingId = r.body.id;
    });

    it('F20: Manager sets severity → status becomes In Progress', async () => {
      const res = await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 2' });
      expect(res.status).toBe(200);
      expect(res.body.severity).toBe('Level 2');
      expect(res.body.status).toBe('In Progress');
    });

    it('F21: Director can set a due date', async () => {
      const due = new Date(Date.now() + 7 * 86400000).toISOString();
      const res = await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${directorToken}`).send({ severity: 'Level 1', dueDate: due });
      expect(res.status).toBe(200);
      expect(res.body.dueDate).not.toBeNull();
    });

    it('F22: Staff cannot review → 403', async () => {
      const res = await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${staffToken}`).send({ severity: 'Level 1' });
      expect(res.status).toBe(403);
    });

    it('F23: invalid severity → 400', async () => {
      const res = await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Catastrophic' });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 4 — Due date breach flag
  // ────────────────────────────────────────────────────────────────────────

  describe('Due date breach', () => {
    it('F30: GET flags dueDateBreached when due date is in the past and not Closed', async () => {
      const r = await raiseFinding(staffToken);
      const findingId = r.body.id;
      await prisma.finding.update({ where: { id: findingId }, data: { dueDate: new Date(Date.now() - 86400000), status: 'In Progress' } });
      const res = await request(app).get(`/api/findings/${findingId}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.dueDateBreached).toBe(true);
    });

    it('F31: not breached when due date is in the future', async () => {
      const r = await raiseFinding(staffToken);
      const findingId = r.body.id;
      await prisma.finding.update({ where: { id: findingId }, data: { dueDate: new Date(Date.now() + 86400000), status: 'In Progress' } });
      const res = await request(app).get(`/api/findings/${findingId}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.body.dueDateBreached).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 5 — Generate follow-up tasks
  // ────────────────────────────────────────────────────────────────────────

  describe('Generate follow-up tasks', () => {
    let findingId: number;
    beforeEach(async () => {
      const r = await raiseFinding(staffToken);
      findingId = r.body.id;
    });

    it('F40: Manager generates a single follow-up task → 201, Unassigned, linked, status In Progress', async () => {
      const res = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: allowsFindingsTemplateId, title: 'Corrective Action Request' }] });
      expect(res.status).toBe(201);
      expect(res.body.createdTasks).toHaveLength(1);
      expect(res.body.createdTasks[0].taskId).toMatch(/^FND-\d{6}$/);

      const task = await prisma.task.findUnique({ where: { id: res.body.createdTasks[0].id } });
      expect(task?.status).toBe('Unassigned');
      expect(task?.parentFindingId).toBe(findingId);
      expect(task?.title).toBe('Corrective Action Request');

      const finding = await prisma.finding.findUnique({ where: { id: findingId } });
      expect(finding?.status).toBe('In Progress');
    });

    it('F41: generates multiple follow-up tasks in one call', async () => {
      const res = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${directorToken}`).send({ tasks: [
        { templateId: allowsFindingsTemplateId, title: 'Task A' },
        { templateId: autoCloseTemplateId, title: 'Task B' }
      ] });
      expect(res.status).toBe(201);
      expect(res.body.createdTasks).toHaveLength(2);
    });

    it('F42: createNewWp builds a new Work Package and links the task to it', async () => {
      const res = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: allowsFindingsTemplateId, title: 'WP Task', createNewWp: true, newWpName: 'CAR Investigation WP' }] });
      expect(res.status).toBe(201);
      const task = await prisma.task.findUnique({ where: { id: res.body.createdTasks[0].id } });
      expect(task?.wpId).not.toBeNull();
      const wp = await prisma.workPackage.findUnique({ where: { id: task!.wpId! } });
      expect(wp?.name).toBe('CAR Investigation WP');
    });

    it('F43: Staff cannot generate follow-up tasks → 403', async () => {
      const res = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${staffToken}`).send({ tasks: [{ templateId: allowsFindingsTemplateId, title: 'X' }] });
      expect(res.status).toBe(403);
    });

    it('F44: non-Published template → 400 and creates no tasks', async () => {
      const res = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: archivedTemplateId, title: 'X' }] });
      expect(res.status).toBe(400);
      const count = await prisma.task.count({ where: { parentFindingId: findingId } });
      expect(count).toBe(0);
    });

    it('F45: a Closed WP is rejected → 400', async () => {
      const wp = await prisma.workPackage.create({ data: { wpId: 'FND-WP-900001', name: 'Closed WP', type: 'AUDIT', divisionId, timeframeFrom: new Date(), timeframeTo: new Date(Date.now() + 86400000), creatorId: managerId, status: 'Closed' } });
      const res = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: allowsFindingsTemplateId, title: 'X', wpId: wp.id }] });
      expect(res.status).toBe(400);
    });

    it('F46: a batch with one invalid entry creates zero tasks (atomic)', async () => {
      const res = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [
        { templateId: allowsFindingsTemplateId, title: 'Good' },
        { templateId: archivedTemplateId, title: 'Bad' }
      ] });
      expect(res.status).toBe(400);
      const count = await prisma.task.count({ where: { parentFindingId: findingId } });
      expect(count).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 6 — Stage 2
  // ────────────────────────────────────────────────────────────────────────

  describe('Stage 2', () => {
    // Helper: get a finding into Pending Verification with one closed follow-up task.
    async function makePendingVerification(reporterToken: string): Promise<{ findingId: number; followUpId: number }> {
      const r = await raiseFinding(reporterToken);
      const findingId = r.body.id;
      await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const gen = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: autoCloseTemplateId, title: 'CAR' }] });
      const followUpId = gen.body.createdTasks[0].id;
      // Assign to staff, then staff submits → auto-close (requiresApproval=false) → hook fires.
      await prisma.task.update({ where: { id: followUpId }, data: { assignedToUserId: staffId, status: 'Assigned' } });
      await request(app).put(`/api/tasks/${followUpId}/submit`).set('Authorization', `Bearer ${staffToken}`);
      return { findingId, followUpId };
    }

    it('F50: wrong status (not Pending Verification) → 400', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${r.body.id}/stage2`).set('Authorization', `Bearer ${staffToken}`).send({ rootCause: 'x' });
      expect(res.status).toBe(400);
    });

    it('F51: reporter can complete Stage 2', async () => {
      const { findingId } = await makePendingVerification(staffToken);
      const res = await request(app).put(`/api/findings/${findingId}/stage2`).set('Authorization', `Bearer ${staffToken}`).send({ errorCode: 'E1', rootCause: 'Process gap', correctiveAction: 'Retrain', recurrence: false });
      expect(res.status).toBe(200);
      expect(res.body.rootCause).toBe('Process gap');
    });

    it('F52: Manager can complete Stage 2', async () => {
      const { findingId } = await makePendingVerification(staffToken);
      const res = await request(app).put(`/api/findings/${findingId}/stage2`).set('Authorization', `Bearer ${managerToken}`).send({ rootCause: 'rc', correctiveAction: 'ca' });
      expect(res.status).toBe(200);
    });

    it('F53: Director can complete Stage 2', async () => {
      const { findingId } = await makePendingVerification(staffToken);
      const res = await request(app).put(`/api/findings/${findingId}/stage2`).set('Authorization', `Bearer ${directorToken}`).send({ rootCause: 'rc', correctiveAction: 'ca' });
      expect(res.status).toBe(200);
    });

    it('F54: a follow-up Task assignee can complete Stage 2', async () => {
      // Director reports so staff is NOT the reporter — staff qualifies only as assignee.
      const { findingId } = await makePendingVerification(directorToken);
      const res = await request(app).put(`/api/findings/${findingId}/stage2`).set('Authorization', `Bearer ${staffToken}`).send({ rootCause: 'rc', correctiveAction: 'ca' });
      expect(res.status).toBe(200);
    });

    it('F55: an unrelated user cannot complete Stage 2 → 403', async () => {
      // Director reports; manager2 (other division) is neither reporter, assignee, nor Manager/Director of relevance...
      // manager2 IS a Manager by role, which is permitted. Use a fresh unrelated Staff instead.
      const outsider = await prisma.user.create({ data: { name: 'Outsider', email: 'fnd_outsider@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: (await prisma.role.findUnique({ where: { name: 'Staff' } }))!.id } });
      const outsiderToken = makeToken(outsider.id, 'Staff', divisionId);
      const { findingId } = await makePendingVerification(staffToken);
      const res = await request(app).put(`/api/findings/${findingId}/stage2`).set('Authorization', `Bearer ${outsiderToken}`).send({ rootCause: 'rc', correctiveAction: 'ca' });
      expect(res.status).toBe(403);
      await prisma.user.delete({ where: { id: outsider.id } });
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 7 — Close
  // ────────────────────────────────────────────────────────────────────────

  describe('Close', () => {
    async function makePendingVerification(): Promise<number> {
      const r = await raiseFinding(staffToken);
      const findingId = r.body.id;
      await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const gen = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: autoCloseTemplateId, title: 'CAR' }] });
      const followUpId = gen.body.createdTasks[0].id;
      await prisma.task.update({ where: { id: followUpId }, data: { assignedToUserId: staffId, status: 'Assigned' } });
      await request(app).put(`/api/tasks/${followUpId}/submit`).set('Authorization', `Bearer ${staffToken}`);
      return findingId;
    }

    it('F60: cannot close when not Pending Verification → 400', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${r.body.id}/close`).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(400);
    });

    it('F61: cannot close without Stage 2 fields → 400', async () => {
      const findingId = await makePendingVerification();
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(400);
    });

    it('F62: Staff cannot close → 403', async () => {
      const findingId = await makePendingVerification();
      await request(app).put(`/api/findings/${findingId}/stage2`).set('Authorization', `Bearer ${managerToken}`).send({ rootCause: 'rc', correctiveAction: 'ca' });
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(403);
    });

    it('F63: Manager closes after Stage 2 → status Closed, closedBy set', async () => {
      const findingId = await makePendingVerification();
      await request(app).put(`/api/findings/${findingId}/stage2`).set('Authorization', `Bearer ${managerToken}`).send({ rootCause: 'rc', correctiveAction: 'ca' });
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Closed');
      expect(res.body.closedByUserId).toBe(managerId);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 8 — Pending Verification hook
  // ────────────────────────────────────────────────────────────────────────

  describe('Pending Verification hook', () => {
    it('F70: finding advances to Pending Verification when its only follow-up task closes', async () => {
      const r = await raiseFinding(staffToken);
      const findingId = r.body.id;
      await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const gen = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: autoCloseTemplateId, title: 'CAR' }] });
      const followUpId = gen.body.createdTasks[0].id;

      await prisma.task.update({ where: { id: followUpId }, data: { assignedToUserId: staffId, status: 'Assigned' } });
      await request(app).put(`/api/tasks/${followUpId}/submit`).set('Authorization', `Bearer ${staffToken}`);

      const finding = await prisma.finding.findUnique({ where: { id: findingId } });
      expect(finding?.status).toBe('Pending Verification');
    });

    it('F71: finding stays In Progress while some follow-up tasks are still open', async () => {
      const r = await raiseFinding(staffToken);
      const findingId = r.body.id;
      await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const gen = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [
        { templateId: autoCloseTemplateId, title: 'CAR 1' },
        { templateId: autoCloseTemplateId, title: 'CAR 2' }
      ] });
      const firstId = gen.body.createdTasks[0].id;

      await prisma.task.update({ where: { id: firstId }, data: { assignedToUserId: staffId, status: 'Assigned' } });
      await request(app).put(`/api/tasks/${firstId}/submit`).set('Authorization', `Bearer ${staffToken}`);

      const finding = await prisma.finding.findUnique({ where: { id: findingId } });
      expect(finding?.status).toBe('In Progress');
    });
  });
});
