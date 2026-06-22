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
    // Expansion child tables first (CapaAction restricts Task deletes).
    await prisma.findingLink.deleteMany({});
    await prisma.findingHazardTag.deleteMany({});
    await prisma.rcaWhyStep.deleteMany({});
    await prisma.rcaContributingFactor.deleteMany({});
    await prisma.rcaInvestigation.deleteMany({});
    await prisma.capaAction.deleteMany({});
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
    await prisma.findingLink.deleteMany({});
    await prisma.findingHazardTag.deleteMany({});
    await prisma.rcaWhyStep.deleteMany({});
    await prisma.rcaContributingFactor.deleteMany({});
    await prisma.rcaInvestigation.deleteMany({});
    await prisma.capaAction.deleteMany({});
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
      const activity = await prisma.feedPost.findFirst({ where: { scope: 'TASK', scopeId: sourceTaskId, type: 'SYSTEM_EVENT' } });
      expect(activity).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 1b — Raise-time duplicate detection + mark-as-duplicate
  // ────────────────────────────────────────────────────────────────────────

  describe('Duplicate handling', () => {
    const candidates = (token: string, query: string) =>
      request(app).get(`/api/findings/duplicate-candidates?${query}`).set('Authorization', `Bearer ${token}`);

    it('DUP01: returns an active finding in the same division + department', async () => {
      const c = await raiseFinding(staffToken);
      const res = await candidates(staffToken, `departmentId=${departmentId}&taskId=${sourceTaskId}`);
      expect(res.status).toBe(200);
      expect(res.body.map((f: { id: number }) => f.id)).toContain(c.body.id);
    });

    it('DUP02: missing departmentId → 400', async () => {
      const res = await candidates(staffToken, `taskId=${sourceTaskId}`);
      expect(res.status).toBe(400);
    });

    it('DUP03: excludes a different department, and excludes Dismissed findings', async () => {
      const c = await raiseFinding(staffToken);
      // Different department → not returned (here: no other dept seeded, so expect empty)
      const other = await candidates(staffToken, `departmentId=${departmentId + 99999}&taskId=${sourceTaskId}`);
      expect(other.body).toHaveLength(0);
      // Dismiss the candidate → it drops out of the active-candidate list.
      await request(app).put(`/api/findings/${c.body.id}/dismiss`).set('Authorization', `Bearer ${managerToken}`).send({ reason: 'not valid' });
      const after = await candidates(staffToken, `departmentId=${departmentId}&taskId=${sourceTaskId}`);
      expect(after.body.map((f: { id: number }) => f.id)).not.toContain(c.body.id);
    });

    it('DUP04: raise with duplicateOfFindingId → new finding Dismissed + DUPLICATE link + dual-write', async () => {
      const canonical = await raiseFinding(staffToken);
      const res = await raiseFinding(staffToken, { duplicateOfFindingId: canonical.body.id });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('Dismissed');

      const link = await prisma.findingLink.findFirst({
        where: { fromFindingId: res.body.id, relatedFindingId: canonical.body.id, linkType: 'DUPLICATE' },
      });
      expect(link).not.toBeNull();

      const dismissedAudit = await prisma.auditLog.findFirst({ where: { entityType: 'Finding', entityId: String(res.body.id), actionType: 'DISMISSED' } });
      expect(dismissedAudit).not.toBeNull();
      const linkedAudit = await prisma.auditLog.findFirst({ where: { entityType: 'Finding', entityId: String(res.body.id), actionType: 'FINDING_LINKED' } });
      expect(linkedAudit).not.toBeNull();
      // Finding timeline carries the events (FINDING-scope feed post).
      const feed = await prisma.feedPost.findFirst({ where: { scope: 'FINDING', scopeId: res.body.id } });
      expect(feed).not.toBeNull();
    });

    it('DUP05: duplicateOfFindingId not found → 404', async () => {
      const res = await raiseFinding(staffToken, { duplicateOfFindingId: 999999 });
      expect(res.status).toBe(404);
    });

    it('DUP06: duplicateOfFindingId in another division → 400', async () => {
      const f2 = await prisma.finding.create({ data: { eventType: 'X', description: 'other div', departmentId, status: 'Open', targetDivisionId: division2Id, reportedByUserId: staffId } });
      const res = await raiseFinding(staffToken, { duplicateOfFindingId: f2.id });
      expect(res.status).toBe(400);
    });

    it('DUP07: duplicateOfFindingId that is not active (Closed) → 400', async () => {
      const fc = await prisma.finding.create({ data: { eventType: 'X', description: 'closed canonical', departmentId, status: 'Closed', targetDivisionId: divisionId, reportedByUserId: staffId } });
      const res = await raiseFinding(staffToken, { duplicateOfFindingId: fc.id });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 1c — Enrich finding details post-raise (PUT /:id/details)
  // ────────────────────────────────────────────────────────────────────────

  describe('Update finding details', () => {
    it('DET01: reporter can enrich optional context → 200 + DETAILS_UPDATED audit', async () => {
      const f = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${f.body.id}/details`).set('Authorization', `Bearer ${staffToken}`).send({ regulatoryReference: 'EASA Part-M', fieldId: 'FLD-1' });
      expect(res.status).toBe(200);
      expect(res.body.regulatoryReference).toBe('EASA Part-M');
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Finding', entityId: String(f.body.id), actionType: 'DETAILS_UPDATED' } });
      expect(audit).not.toBeNull();
    });

    it('DET02: a non-contributor (other-division manager) → 403', async () => {
      const f = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${f.body.id}/details`).set('Authorization', `Bearer ${manager2Token}`).send({ regulatoryReference: 'x' });
      expect(res.status).toBe(403);
    });

    it('DET03: a same-division reviewer (manager) can enrich → 200', async () => {
      const f = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${f.body.id}/details`).set('Authorization', `Bearer ${managerToken}`).send({ fieldId: 'FLD-2' });
      expect(res.status).toBe(200);
    });

    it('DET04: blocked on a Dismissed finding → 400', async () => {
      const f = await raiseFinding(staffToken);
      await request(app).put(`/api/findings/${f.body.id}/dismiss`).set('Authorization', `Bearer ${managerToken}`).send({ reason: 'dup' });
      const res = await request(app).put(`/api/findings/${f.body.id}/details`).set('Authorization', `Bearer ${staffToken}`).send({ fieldId: 'x' });
      expect(res.status).toBe(400);
    });

    it('DET05: unknown aircraft registration → 400', async () => {
      const f = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${f.body.id}/details`).set('Authorization', `Bearer ${staffToken}`).send({ aircraftRegistrationCode: 'ZZ-NOPE' });
      expect(res.status).toBe(400);
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

    it('F12: open visibility — Manager of another division sees all findings', async () => {
      const res = await request(app).get('/api/findings').set('Authorization', `Bearer ${manager2Token}`);
      expect(res.status).toBe(200);
      const ids = res.body.findings.map((f: any) => f.id);
      expect(ids).toContain(findingByStaff);
      expect(ids).toContain(findingByDirector);
    });

    it('F13: open visibility — Staff sees all findings including those they did not report', async () => {
      const res = await request(app).get('/api/findings').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.findings.map((f: any) => f.id);
      expect(ids).toContain(findingByStaff);
      expect(ids).toContain(findingByDirector);
    });

    it('F14: Staff can GET /findings/:id for any finding (open visibility)', async () => {
      const res = await request(app).get(`/api/findings/${findingByDirector}`).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(findingByDirector);
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

    it('F24: re-reviewing an already-reviewed finding → 400', async () => {
      await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const res = await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 2' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already been reviewed/i);
    });

    it('F24b: a malformed dueDate string → 400 (not a 500 at toISOString)', async () => {
      const res = await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1', dueDate: 'not-a-date' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/dueDate/i);
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

    it('F32: first observed breach notifies division reviewers once (idempotent)', async () => {
      const r = await raiseFinding(staffToken);
      const findingId = r.body.id;
      await prisma.finding.update({ where: { id: findingId }, data: { dueDate: new Date(Date.now() - 86400000), status: 'In Progress' } });
      // Observed by staff (not a reviewer) — the division Manager should be alerted.
      await request(app).get(`/api/findings/${findingId}`).set('Authorization', `Bearer ${staffToken}`);
      let notifs = await prisma.notification.findMany({ where: { userId: managerId, type: 'FINDING_OVERDUE', linkId: findingId } });
      expect(notifs.length).toBe(1);
      // A second read must not duplicate the alert (one-time guard).
      await request(app).get(`/api/findings/${findingId}`).set('Authorization', `Bearer ${staffToken}`);
      notifs = await prisma.notification.findMany({ where: { userId: managerId, type: 'FINDING_OVERDUE', linkId: findingId } });
      expect(notifs.length).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 4b — Director-editable review due date (PUT /:id/due-date)
  // ────────────────────────────────────────────────────────────────────────

  describe('Update due date (Director)', () => {
    let findingId: number;
    const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
    beforeEach(async () => {
      const r = await raiseFinding(staffToken);
      findingId = r.body.id;
      // Review so it carries an initial SLA due date (status → In Progress).
      await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1', dueDate: future(7) });
    });

    it('DD01: Director changes the due date with a reason → 200 + DUE_DATE_UPDATED audit', async () => {
      const newDue = future(30);
      const res = await request(app).put(`/api/findings/${findingId}/due-date`).set('Authorization', `Bearer ${directorToken}`).send({ dueDate: newDue, reason: 'Extended after scope review' });
      expect(res.status).toBe(200);
      expect(new Date(res.body.dueDate).toISOString().slice(0, 10)).toBe(new Date(newDue).toISOString().slice(0, 10));
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Finding', entityId: String(findingId), actionType: 'DUE_DATE_UPDATED' } });
      expect(audit).not.toBeNull();
      expect((audit!.details as any).reason).toBe('Extended after scope review');
    });

    it('DD02: a Manager cannot change the due date → 403', async () => {
      const res = await request(app).put(`/api/findings/${findingId}/due-date`).set('Authorization', `Bearer ${managerToken}`).send({ dueDate: future(30), reason: 'x' });
      expect(res.status).toBe(403);
    });

    it('DD03: missing reason → 400', async () => {
      const res = await request(app).put(`/api/findings/${findingId}/due-date`).set('Authorization', `Bearer ${directorToken}`).send({ dueDate: future(30) });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/reason/i);
    });

    it('DD04: malformed dueDate → 400', async () => {
      const res = await request(app).put(`/api/findings/${findingId}/due-date`).set('Authorization', `Bearer ${directorToken}`).send({ dueDate: 'not-a-date', reason: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/dueDate/i);
    });

    it('DD05: cannot change the due date of a Closed finding → 400', async () => {
      await prisma.finding.update({ where: { id: findingId }, data: { status: 'Closed' } });
      const res = await request(app).put(`/api/findings/${findingId}/due-date`).set('Authorization', `Bearer ${directorToken}`).send({ dueDate: future(30), reason: 'x' });
      expect(res.status).toBe(400);
    });

    it('DD06: extending a breached due date into the future clears the overdue flag on read', async () => {
      await prisma.finding.update({ where: { id: findingId }, data: { dueDate: new Date(Date.now() - 86400000) } });
      let g = await request(app).get(`/api/findings/${findingId}`).set('Authorization', `Bearer ${directorToken}`);
      expect(g.body.dueDateBreached).toBe(true);
      await request(app).put(`/api/findings/${findingId}/due-date`).set('Authorization', `Bearer ${directorToken}`).send({ dueDate: future(14), reason: 'Granting extension' });
      g = await request(app).get(`/api/findings/${findingId}`).set('Authorization', `Bearer ${directorToken}`);
      expect(g.body.dueDateBreached).toBe(false);
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
  // Group F-RAC — Response Action Creation
  // ────────────────────────────────────────────────────────────────────────

  describe('F-RAC: Response Action Creation', () => {
    let findingId: number;
    let dept2: number; // additional departments for multi-dept response actions
    let dept3: number;

    beforeAll(async () => {
      const d2 = await prisma.department.upsert({ where: { name: 'RAC Dept 2' }, update: {}, create: { name: 'RAC Dept 2' } });
      const d3 = await prisma.department.upsert({ where: { name: 'RAC Dept 3' }, update: {}, create: { name: 'RAC Dept 3' } });
      dept2 = d2.id;
      dept3 = d3.id;
    });

    beforeEach(async () => {
      const r = await raiseFinding(staffToken);
      findingId = r.body.id;
    });

    // Generate a single response-action follow-up task and return its db id.
    const genResponseAction = (overrides: Record<string, unknown>, token = managerToken) =>
      request(app)
        .post(`/api/findings/${findingId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tasks: [{ templateId: allowsFindingsTemplateId, title: 'Response Task', ...overrides }] });

    // Create a QN follow-up task and drive it to In Review (assigned + submitted).
    async function createQnInReview(): Promise<number> {
      const gen = await genResponseAction({ responseActionType: 'QN', targetDepartmentIds: [departmentId, dept2] });
      const followUpId = gen.body.createdTasks[0].id;
      await prisma.task.update({ where: { id: followUpId }, data: { assignedToUserId: staffId, status: 'Assigned' } });
      await request(app).put(`/api/tasks/${followUpId}/submit`).set('Authorization', `Bearer ${staffToken}`);
      return followUpId;
    }

    it('RAC-01: IR with one department → 201, task IR, no Director approval, one action row linked', async () => {
      const res = await genResponseAction({ responseActionType: 'IR', targetDepartmentIds: [departmentId] });
      expect(res.status).toBe(201);
      const taskDbId = res.body.createdTasks[0].id;
      const task = await prisma.task.findUnique({ where: { id: taskDbId } });
      expect(task?.responseActionType).toBe('IR');
      expect(task?.requiresDirectorApproval).toBe(false);
      const actions = await prisma.findingResponseAction.findMany({ where: { findingId } });
      expect(actions).toHaveLength(1);
      expect(actions[0]?.taskId).toBe(taskDbId);
      expect(actions[0]?.type).toBe('IR');
    });

    it('RAC-02: CAR with one department → 201, action row stores the department', async () => {
      const res = await genResponseAction({ responseActionType: 'CAR', targetDepartmentIds: [departmentId] });
      expect(res.status).toBe(201);
      const actions = await prisma.findingResponseAction.findMany({
        where: { findingId },
        include: { targetDepartments: { select: { departmentId: true } } }
      });
      expect(actions).toHaveLength(1);
      expect(actions[0]?.type).toBe('CAR');
      expect(actions[0]?.targetDepartments.map((d) => d.departmentId)).toEqual([departmentId]);
    });

    it('RAC-03: QN with three departments → 201, one task, one action with three dept IDs', async () => {
      const res = await genResponseAction({ responseActionType: 'QN', targetDepartmentIds: [departmentId, dept2, dept3] });
      expect(res.status).toBe(201);
      expect(res.body.createdTasks).toHaveLength(1);
      const actions = await prisma.findingResponseAction.findMany({
        where: { findingId },
        include: { targetDepartments: { select: { departmentId: true }, orderBy: { departmentId: 'asc' } } }
      });
      expect(actions).toHaveLength(1);
      expect(actions[0]?.targetDepartments.map((d) => d.departmentId).sort()).toEqual(
        [departmentId, dept2, dept3].sort()
      );
    });

    it('RAC-04: CAR + QN in one call → 201, two tasks, two action rows with correct types', async () => {
      const res = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [
        { templateId: allowsFindingsTemplateId, title: 'CAR Task', responseActionType: 'CAR', targetDepartmentIds: [departmentId] },
        { templateId: allowsFindingsTemplateId, title: 'QN Task', responseActionType: 'QN', targetDepartmentIds: [dept2, dept3] }
      ] });
      expect(res.status).toBe(201);
      expect(res.body.createdTasks).toHaveLength(2);
      const actions = await prisma.findingResponseAction.findMany({ where: { findingId } });
      expect(actions).toHaveLength(2);
      expect(actions.map((a) => a.type).sort()).toEqual(['CAR', 'QN']);
    });

    it('RAC-05: Director can review (approve) a QN task → 200, Closed', async () => {
      const taskId = await createQnInReview();
      const res = await request(app).put(`/api/tasks/${taskId}/review`).set('Authorization', `Bearer ${directorToken}`).send({ action: 'approve' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Closed');
    });

    it('RAC-06: Manager cannot review a QN task → 403 with Director-approval message', async () => {
      const taskId = await createQnInReview();
      const res = await request(app).put(`/api/tasks/${taskId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ action: 'approve' });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Director approval/i);
    });

    it('RAC-07: QN follow-up → resubmit → Director approval full flow → 200', async () => {
      const taskId = await createQnInReview();
      // Director requests follow-up (only a Director may act on a QN task).
      const fu = await request(app).put(`/api/tasks/${taskId}/review`).set('Authorization', `Bearer ${directorToken}`).send({ action: 'follow-up', comment: 'Add more detail' });
      expect(fu.status).toBe(200);
      expect(fu.body.status).toBe('Follow-up Required');
      // Assignee resubmits.
      const resubmit = await request(app).put(`/api/tasks/${taskId}/submit`).set('Authorization', `Bearer ${staffToken}`);
      expect(resubmit.status).toBe(200);
      expect(resubmit.body.status).toBe('In Review');
      // Director approves.
      const approve = await request(app).put(`/api/tasks/${taskId}/review`).set('Authorization', `Bearer ${directorToken}`).send({ action: 'approve' });
      expect(approve.status).toBe(200);
      expect(approve.body.status).toBe('Closed');
    });

    it('RAC-08: invalid responseActionType → 400', async () => {
      const res = await genResponseAction({ responseActionType: 'INVALID', targetDepartmentIds: [departmentId] });
      expect(res.status).toBe(400);
    });

    it('RAC-09: response action with empty targetDepartmentIds → 400', async () => {
      const res = await genResponseAction({ responseActionType: 'IR', targetDepartmentIds: [] });
      expect(res.status).toBe(400);
    });

    it('RAC-10: CAR with two departments → 400 (single-dept type allows exactly one)', async () => {
      const res = await genResponseAction({ responseActionType: 'CAR', targetDepartmentIds: [departmentId, dept2] });
      expect(res.status).toBe(400);
    });

    it('RAC-11: targetDepartmentIds with non-existent IDs → 400', async () => {
      const res = await genResponseAction({ responseActionType: 'QN', targetDepartmentIds: [999998, 999999] });
      expect(res.status).toBe(400);
    });

    it('RAC-12: follow-up task without responseActionType → 201, null type, no action row', async () => {
      const res = await genResponseAction({});
      expect(res.status).toBe(201);
      const task = await prisma.task.findUnique({ where: { id: res.body.createdTasks[0].id } });
      expect(task?.responseActionType).toBeNull();
      expect(task?.requiresDirectorApproval).toBe(false);
      const actions = await prisma.findingResponseAction.findMany({ where: { findingId } });
      expect(actions).toHaveLength(0);
    });

    it('RAC-13: GET /findings/:id returns responseActions with resolved departments and linked task status', async () => {
      await genResponseAction({ responseActionType: 'QN', targetDepartmentIds: [departmentId, dept2] });
      const res = await request(app).get(`/api/findings/${findingId}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.responseActions)).toBe(true);
      expect(res.body.responseActions).toHaveLength(1);
      const ra = res.body.responseActions[0];
      expect(ra.type).toBe('QN');
      expect(ra.targetDepartments).toHaveLength(2);
      expect(ra.targetDepartments[0]).toHaveProperty('name');
      expect(ra.task.status).toBe('Unassigned');
    });

    it('RAC-14: GET /tasks/:id for a QN follow-up exposes responseActionType + requiresDirectorApproval', async () => {
      const gen = await genResponseAction({ responseActionType: 'QN', targetDepartmentIds: [departmentId] });
      const taskDbId = gen.body.createdTasks[0].id;
      const res = await request(app).get(`/api/tasks/${taskDbId}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.responseActionType).toBe('QN');
      expect(res.body.requiresDirectorApproval).toBe(true);
    });

    it('RAC-15: creating a response action writes a RESPONSE_ACTION_CREATED audit log for the finding', async () => {
      await genResponseAction({ responseActionType: 'IR', targetDepartmentIds: [departmentId] });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Finding', entityId: String(findingId), actionType: 'RESPONSE_ACTION_CREATED' } });
      expect(audit).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 6 — Stage 2 (removed — superseded by RCA + CAPA workflows, F-6)
  // ────────────────────────────────────────────────────────────────────────

  describe('Stage 2 (removed)', () => {
    it('F50: PUT /:id/stage2 is gone → 404', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${r.body.id}/stage2`).set('Authorization', `Bearer ${staffToken}`).send({ rootCause: 'x' });
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 7 — Close
  // ────────────────────────────────────────────────────────────────────────

  describe('Close', () => {
    // Uses an Observation severity so the finding closes without the graded
    // closed-loop gate (RCA + verified corrective CAPA), which applies only to
    // Level 1 / Level 2 per the default FINDING_WORKFLOW_CONFIG.
    async function makePendingVerification(): Promise<number> {
      const r = await raiseFinding(staffToken);
      const findingId = r.body.id;
      await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Observation' });
      const gen = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: autoCloseTemplateId, title: 'CAR' }] });
      const followUpId = gen.body.createdTasks[0].id;
      await prisma.task.update({ where: { id: followUpId }, data: { assignedToUserId: staffId, status: 'Assigned' } });
      await request(app).put(`/api/tasks/${followUpId}/submit`).set('Authorization', `Bearer ${staffToken}`);
      return findingId;
    }

    it('F60: cannot close when not Pending Verification → 400', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${r.body.id}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'Closing out' });
      expect(res.status).toBe(400);
    });

    it('F60b: cannot close without a closure note → 400', async () => {
      const findingId = await makePendingVerification();
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(400);
    });

    it('F61: Manager can close a Pending Verification finding directly (no Stage 2 gate)', async () => {
      const findingId = await makePendingVerification();
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'Verified and closed' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Closed');
    });

    it('F62: Staff cannot close → 403', async () => {
      const findingId = await makePendingVerification();
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${staffToken}`).send({ closureNote: 'x' });
      expect(res.status).toBe(403);
    });

    it('F63: Manager closes → status Closed, closedBy set', async () => {
      const findingId = await makePendingVerification();
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'Closed after verification' });
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

  // ────────────────────────────────────────────────────────────────────────
  // Group 9 — Related findings for a task (back-to-finding link + quick-view)
  // GET /api/tasks/:id/related-findings — every finding a task ties back to,
  // by any relation: source (it raised it), follow-up parent, or CAPA link.
  // ────────────────────────────────────────────────────────────────────────
  describe('Related findings for a task', () => {
    const mkFinding = (overrides: Record<string, unknown> = {}) =>
      prisma.finding.create({
        data: { description: 'Rel test finding', eventType: 'Procedural Breach', departmentId, reportedByUserId: staffId, ...overrides }
      });

    const mkTask = (taskId: string, overrides: Record<string, unknown> = {}) =>
      prisma.task.create({
        data: { taskId, templateId: allowsFindingsTemplateId, issuerId: managerId, targetDivisionId: divisionId, status: 'Closed', schemaSnapshot: [] as any, assignmentType: 'INDIVIDUAL', ...overrides }
      });

    const mkCapa = (findingId: number, overrides: Record<string, unknown> = {}) =>
      prisma.capaAction.create({
        data: { findingId, type: 'CORRECTIVE', description: 'Fix it', createdByUserId: managerId, ...overrides }
      });

    const getRelated = (taskId: number, token = staffToken) =>
      request(app).get(`/api/tasks/${taskId}/related-findings`).set('Authorization', `Bearer ${token}`);

    it('R01: returns the finding a task raised (source), excluding unrelated findings', async () => {
      const f = await mkFinding({ sourceTaskId });
      await mkFinding(); // unrelated — must not appear
      const res = await getRelated(sourceTaskId);
      expect(res.status).toBe(200);
      expect(res.body.map((x: any) => x.id)).toEqual([f.id]);
      expect(res.body[0]).toEqual(expect.objectContaining({ id: f.id, status: 'Open', description: 'Rel test finding' }));
      expect(res.body[0]).toHaveProperty('severity');
    });

    it('R02: returns the finding a follow-up task belongs to (parentFindingId)', async () => {
      const f = await mkFinding();
      const t = await mkTask('REL-T-002', { parentFindingId: f.id });
      const res = await getRelated(t.id);
      expect(res.status).toBe(200);
      expect(res.body.map((x: any) => x.id)).toEqual([f.id]);
    });

    it('R03: returns the finding a CAPA action links to — task is neither source nor follow-up', async () => {
      const f = await mkFinding();
      const t = await mkTask('REL-T-003');
      const capa = await mkCapa(f.id);
      await prisma.capaTaskLink.create({ data: { capaId: capa.id, taskId: t.id, mandatory: true } });
      const res = await getRelated(t.id);
      expect(res.status).toBe(200);
      expect(res.body.map((x: any) => x.id)).toEqual([f.id]);
    });

    it('R04: a task related by multiple paths returns the finding once (dedup)', async () => {
      const f = await mkFinding({ sourceTaskId });
      const capa = await mkCapa(f.id);
      await prisma.capaTaskLink.create({ data: { capaId: capa.id, taskId: sourceTaskId, mandatory: true } });
      const res = await getRelated(sourceTaskId);
      expect(res.status).toBe(200);
      expect(res.body.map((x: any) => x.id)).toEqual([f.id]); // not [f.id, f.id]
    });

    it('R05: excludes soft-deleted findings', async () => {
      await mkFinding({ sourceTaskId, deletedAt: new Date() });
      const res = await getRelated(sourceTaskId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('R06: excludes a finding linked only via a soft-deleted CAPA action', async () => {
      const f = await mkFinding();
      const t = await mkTask('REL-T-006');
      const capa = await mkCapa(f.id, { deletedAt: new Date() });
      await prisma.capaTaskLink.create({ data: { capaId: capa.id, taskId: t.id, mandatory: true } });
      const res = await getRelated(t.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('R07: 404 for a non-existent task', async () => {
      const res = await getRelated(99999999);
      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Group 10 — Finding summary (lightweight, side-effect-free preview read)
  // GET /api/findings/:id/summary — used by the quick-view drawer.
  // ────────────────────────────────────────────────────────────────────────
  describe('Finding summary', () => {
    const getSummary = (id: number, token = staffToken) =>
      request(app).get(`/api/findings/${id}/summary`).set('Authorization', `Bearer ${token}`);

    it('S01: returns the preview fields and omits the heavy detail tree', async () => {
      const raised = await raiseFinding(staffToken);
      const res = await getSummary(raised.body.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({
        id: raised.body.id,
        status: 'Open',
        description: 'Torque values missing',
        eventType: 'Procedural Breach'
      }));
      expect(res.body.reportedByUser).toEqual(expect.objectContaining({ id: staffId }));
      expect(res.body.department).toEqual(expect.objectContaining({ id: departmentId }));
      expect(Array.isArray(res.body.hazardTags)).toBe(true);
      // Detail-only fields must NOT be in the lightweight projection.
      expect(res.body).not.toHaveProperty('trend');
      expect(res.body).not.toHaveProperty('capaActions');
      expect(res.body).not.toHaveProperty('rca');
    });

    it('S02: 404 for a non-existent finding', async () => {
      const res = await getSummary(99999999);
      expect(res.status).toBe(404);
    });

    it('S03: 404 for a soft-deleted finding', async () => {
      const raised = await raiseFinding(staffToken);
      await prisma.finding.update({ where: { id: raised.body.id }, data: { deletedAt: new Date() } });
      const res = await getSummary(raised.body.id);
      expect(res.status).toBe(404);
    });
  });
});
