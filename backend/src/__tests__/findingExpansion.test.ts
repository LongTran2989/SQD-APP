import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function makeToken(userId: number, role: string, divisionId: number): string {
  const secret = process.env.JWT_SECRET || 'fallback_secret';
  return jwt.sign({ userId, role, divisionId }, secret);
}

// ───────────────────────────────────────────────────────────────────────────────
// Findings Expansion — RCA / CAPA / Taxonomy / Traceability / Trend
// ───────────────────────────────────────────────────────────────────────────────

describe('Findings Expansion (RCA / CAPA / Taxonomy / Trend)', () => {
  let directorToken: string;
  let adminToken: string;
  let managerToken: string;
  let staffToken: string;
  let outsiderToken: string;
  let manager2Token: string; // Manager in a different division (FEX2)
  let staff2Token: string;   // Staff in FEX2

  let directorId: number;
  let managerId: number;
  let staffId: number;
  let outsiderId: number;
  let staff2Id: number;

  let divisionId: number;
  let division2Id: number;
  let departmentId: number;

  let allowsFindingsTemplateId: number;
  let autoCloseTemplateId: number;

  let ataA: number;
  let ataB: number;
  let causeA: number;
  let causeB: number;
  let hazX: number;
  let hazY: number;

  let sourceTaskId: number;

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'FExp Dept' }, update: {}, create: { name: 'FExp Dept' } });
    departmentId = dept.id;
    const div = await prisma.division.upsert({ where: { code: 'FEX' }, update: {}, create: { name: 'FExp Div', code: 'FEX', departmentId: dept.id } });
    divisionId = div.id;
    const div2 = await prisma.division.upsert({ where: { code: 'FEX2' }, update: {}, create: { name: 'FExp Div 2', code: 'FEX2', departmentId: dept.id } });
    division2Id = div2.id;

    const director = await prisma.user.create({ data: { name: 'FExp Director', email: 'fexp_director@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: directorRole.id } });
    directorId = director.id;
    const admin = await prisma.user.create({ data: { name: 'FExp Admin', email: 'fexp_admin@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: adminRole.id } });
    const manager = await prisma.user.create({ data: { name: 'FExp Manager', email: 'fexp_manager@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: managerRole.id } });
    managerId = manager.id;
    const staff = await prisma.user.create({ data: { name: 'FExp Staff', email: 'fexp_staff@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    staffId = staff.id;
    const outsider = await prisma.user.create({ data: { name: 'FExp Outsider', email: 'fexp_outsider@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    outsiderId = outsider.id;
    const manager2 = await prisma.user.create({ data: { name: 'FExp Manager2', email: 'fexp_manager2@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId: division2Id, roleId: managerRole.id } });
    const staff2 = await prisma.user.create({ data: { name: 'FExp Staff2', email: 'fexp_staff2@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId: division2Id, roleId: staffRole.id } });
    staff2Id = staff2.id;

    directorToken = makeToken(directorId, 'Director', divisionId);
    adminToken = makeToken(admin.id, 'Admin', divisionId);
    managerToken = makeToken(managerId, 'Manager', divisionId);
    staffToken = makeToken(staffId, 'Staff', divisionId);
    outsiderToken = makeToken(outsiderId, 'Staff', divisionId);
    manager2Token = makeToken(manager2.id, 'Manager', division2Id);
    staff2Token = makeToken(staff2Id, 'Staff', division2Id);

    const baseSchema = [{ id: '1', type: 'radio', label: 'Pass/Fail', options: ['Pass', 'Fail'] }];
    const af = await prisma.template.create({ data: { templateId: 'FEX-T-001', title: 'Allows Findings', formSchema: baseSchema, status: 'Published', publishedAt: new Date(), ownerId: managerId, divisionId, requiresApproval: true, allowsFindings: true, estimatedHours: 2 } });
    allowsFindingsTemplateId = af.id;
    const ac = await prisma.template.create({ data: { templateId: 'FEX-T-002', title: 'Auto Close', formSchema: baseSchema, status: 'Published', publishedAt: new Date(), ownerId: managerId, divisionId, requiresApproval: false, allowsFindings: true } });
    autoCloseTemplateId = ac.id;

    // Reference taxonomies (persist across tests; not wiped in beforeEach).
    const a1 = await prisma.ataChapter.upsert({ where: { code: 'FEX-32' }, update: {}, create: { code: 'FEX-32', title: 'Landing Gear' } });
    ataA = a1.id;
    const a2 = await prisma.ataChapter.upsert({ where: { code: 'FEX-24' }, update: {}, create: { code: 'FEX-24', title: 'Electrical Power' } });
    ataB = a2.id;
    const c1 = await prisma.causeCode.upsert({ where: { code: 'FEXH01' }, update: {}, create: { code: 'FEXH01', name: 'Quality of support', groupCode: 'H', groupName: 'Organizational Factors' } });
    causeA = c1.id;
    const c2 = await prisma.causeCode.upsert({ where: { code: 'FEXE03' }, update: {}, create: { code: 'FEXE03', name: 'Task planning', groupCode: 'E', groupName: 'Knowledge/Skills' } });
    causeB = c2.id;
    const h1 = await prisma.hazardTag.upsert({ where: { label: 'FEX-FOD' }, update: {}, create: { label: 'FEX-FOD' } });
    hazX = h1.id;
    const h2 = await prisma.hazardTag.upsert({ where: { label: 'FEX-Fatigue' }, update: {}, create: { label: 'FEX-Fatigue' } });
    hazY = h2.id;
  });

  beforeEach(async () => {
    // FK-safe wipe — child tables first (CapaAction restricts Task deletes).
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
      data: { taskId: 'FEX-900001', templateId: allowsFindingsTemplateId, issuerId: managerId, targetDivisionId: divisionId, status: 'Closed', schemaSnapshot: [] as any, assignmentType: 'INDIVIDUAL' }
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
    await prisma.template.deleteMany({ where: { templateId: { startsWith: 'FEX-T-' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'fexp_' } } });
    await prisma.$disconnect();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  const raiseFinding = (token: string, overrides: Record<string, unknown> = {}) =>
    request(app).post('/api/findings').set('Authorization', `Bearer ${token}`)
      .send({ taskId: sourceTaskId, eventType: 'Procedural Breach', departmentId, description: 'Issue', ...overrides });

  // Drive a finding to Pending Verification with one Closed follow-up task.
  // Severity defaults to 'Observation' so the graded closed-loop presence-gate
  // (RCA + verified corrective CAPA, required for Level 1/Level 2) does not
  // interfere with tests that exercise other mechanics. Pass a severity to test
  // the graded gates explicitly.
  async function makePendingVerification(
    reporterToken = staffToken,
    severity = 'Observation'
  ): Promise<{ findingId: number; followUpId: number }> {
    const r = await raiseFinding(reporterToken);
    const findingId = r.body.id;
    await request(app).put(`/api/findings/${findingId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity });
    const gen = await request(app).post(`/api/findings/${findingId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: autoCloseTemplateId, title: 'CAR' }] });
    const followUpId = gen.body.createdTasks[0].id;
    await prisma.task.update({ where: { id: followUpId }, data: { assignedToUserId: staffId, status: 'Assigned' } });
    await request(app).put(`/api/tasks/${followUpId}/submit`).set('Authorization', `Bearer ${staffToken}`);
    return { findingId, followUpId };
  }

  // Create a finding row directly with optional RCA cause code + hazard tags (for trend tests).
  async function createClusterFinding(opts: { ataChapterId?: number; causeCodeId?: number; hazardTagIds?: number[]; createdAt?: Date; deletedAt?: Date }) {
    const f = await prisma.finding.create({
      data: {
        eventType: 'Procedural Breach',
        description: 'cluster',
        departmentId,
        reportedByUserId: staffId,
        targetDivisionId: divisionId,
        status: 'In Progress',
        ataChapterId: opts.ataChapterId ?? null,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        ...(opts.deletedAt ? { deletedAt: opts.deletedAt } : {}),
        ...(opts.hazardTagIds && opts.hazardTagIds.length ? { hazardTags: { create: opts.hazardTagIds.map((hazardTagId) => ({ hazardTagId })) } } : {}),
      },
    });
    if (opts.causeCodeId) {
      await prisma.rcaInvestigation.create({ data: { findingId: f.id, method: 'OTHER', status: 'Complete', causeCodeId: opts.causeCodeId } });
    }
    return f.id;
  }

  // ── Group 9 — RCA ──────────────────────────────────────────────────────────
  describe('RCA', () => {
    it('R01: reporter creates a FIVE_WHYS RCA and saves an ordered ladder', async () => {
      const r = await raiseFinding(staffToken);
      const fid = r.body.id;
      const up = await request(app).put(`/api/findings/${fid}/rca`).set('Authorization', `Bearer ${staffToken}`).send({ method: 'FIVE_WHYS' });
      expect(up.status).toBe(200);
      const steps = await request(app).put(`/api/findings/${fid}/rca/why-steps`).set('Authorization', `Bearer ${staffToken}`)
        .send({ steps: [{ question: 'Why 1', answer: 'A1' }, { question: 'Why 2', answer: 'A2' }] });
      expect(steps.status).toBe(200);
      expect(steps.body).toHaveLength(2);
      expect(steps.body[0].orderIndex).toBe(0);
      expect(steps.body[1].orderIndex).toBe(1);
    });

    it('R02: MEDA RCA accepts contributing factors', async () => {
      const r = await raiseFinding(staffToken);
      const fid = r.body.id;
      await request(app).put(`/api/findings/${fid}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'MEDA' });
      const res = await request(app).put(`/api/findings/${fid}/rca/factors`).set('Authorization', `Bearer ${managerToken}`)
        .send({ factors: [{ category: 'Communication', detail: 'Between shifts', isPrimary: true }] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].isPrimary).toBe(true);
    });

    it('R03: why-steps rejected on a MEDA RCA → 400', async () => {
      const r = await raiseFinding(staffToken);
      const fid = r.body.id;
      await request(app).put(`/api/findings/${fid}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'MEDA' });
      const res = await request(app).put(`/api/findings/${fid}/rca/why-steps`).set('Authorization', `Bearer ${managerToken}`).send({ steps: [{ question: 'Why' }] });
      expect(res.status).toBe(400);
    });

    it('R04: invalid method → 400', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${r.body.id}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'ISHIKAWA' });
      expect(res.status).toBe(400);
    });

    it('R05: cannot mark RCA Complete without a cause code → 400', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${r.body.id}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'OTHER', status: 'Complete' });
      expect(res.status).toBe(400);
    });

    it('R06: cause code persists and Complete is allowed once set', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${r.body.id}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'OTHER', status: 'Complete', causeCodeId: causeA });
      expect(res.status).toBe(200);
      expect(res.body.causeCodeId).toBe(causeA);
      expect(res.body.status).toBe('Complete');
    });

    it('R07: an unrelated user cannot edit the RCA → 403', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).put(`/api/findings/${r.body.id}/rca`).set('Authorization', `Bearer ${outsiderToken}`).send({ method: 'OTHER' });
      expect(res.status).toBe(403);
    });

    it('R08: RCA_UPDATED audit entry is written (dual write)', async () => {
      const r = await raiseFinding(staffToken);
      await request(app).put(`/api/findings/${r.body.id}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'OTHER' });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Finding', entityId: String(r.body.id), actionType: 'RCA_UPDATED' } });
      expect(audit).not.toBeNull();
    });
  });

  // ── Group 10 — CAPA + close-gate ────────────────────────────────────────────
  describe('CAPA & close-gate', () => {
    it('C01: reporter can create a CORRECTIVE CAPA', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).post(`/api/findings/${r.body.id}/capa`).set('Authorization', `Bearer ${staffToken}`).send({ type: 'CORRECTIVE', description: 'Re-torque bolts' });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe('CORRECTIVE');
      expect(res.body.status).toBe('Open');
    });

    it('C02: an outsider cannot create a CAPA → 403', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).post(`/api/findings/${r.body.id}/capa`).set('Authorization', `Bearer ${outsiderToken}`).send({ type: 'CORRECTIVE', description: 'x' });
      expect(res.status).toBe(403);
    });

    it('C03: invalid type → 400', async () => {
      const r = await raiseFinding(staffToken);
      const res = await request(app).post(`/api/findings/${r.body.id}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'MITIGATING', description: 'x' });
      expect(res.status).toBe(400);
    });

    it('C04: any non-deleted task can be linked to a CAPA via the links endpoint (no follow-up restriction)', async () => {
      const r = await raiseFinding(staffToken);
      const capa = await request(app).post(`/api/findings/${r.body.id}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'x' });
      // sourceTaskId is NOT a follow-up of this finding — under the per-CAPA-item model it links fine.
      const ok = await request(app).post(`/api/findings/${r.body.id}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, taskId: sourceTaskId });
      expect(ok.status).toBe(201);
      expect(ok.body.taskId).toBe(sourceTaskId);
      expect(ok.body.mandatory).toBe(true);
      // a non-existent task is still rejected
      const bad = await request(app).post(`/api/findings/${r.body.id}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, taskId: 999999 });
      expect(bad.status).toBe(400);
      // exactly one of taskId / wpId must be supplied
      const both = await request(app).post(`/api/findings/${r.body.id}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, taskId: sourceTaskId, wpId: 1 });
      expect(both.status).toBe(400);
    });

    it('C05: verify is blocked without a completed mandatory task → 400', async () => {
      const { findingId } = await makePendingVerification();
      const capa = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      const res = await request(app).put(`/api/findings/${findingId}/capa/${capa.body.id}/verify`).set('Authorization', `Bearer ${managerToken}`).send({ effectivenessNote: 'check' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/mandatory/i);
    });

    it('C05a: verify is blocked without an effectiveness note → 400', async () => {
      const { findingId, followUpId } = await makePendingVerification();
      const capa = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      await request(app).post(`/api/findings/${findingId}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, taskId: followUpId });
      const res = await request(app).put(`/api/findings/${findingId}/capa/${capa.body.id}/verify`).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/effectiveness note/i);
    });

    it('C06: verify succeeds once a Closed mandatory task is linked + a sign-off note', async () => {
      const { findingId, followUpId } = await makePendingVerification();
      const capa = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      await request(app).post(`/api/findings/${findingId}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, taskId: followUpId });
      const res = await request(app).put(`/api/findings/${findingId}/capa/${capa.body.id}/verify`).set('Authorization', `Bearer ${managerToken}`).send({ effectivenessNote: 'Confirmed effective on re-inspection' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Verified');
      expect(res.body.verifiedByUserId).toBe(managerId);
    });

    it('C07: staff cannot verify a CAPA → 403', async () => {
      const { findingId, followUpId } = await makePendingVerification();
      const capa = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      await request(app).post(`/api/findings/${findingId}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, taskId: followUpId });
      const res = await request(app).put(`/api/findings/${findingId}/capa/${capa.body.id}/verify`).set('Authorization', `Bearer ${staffToken}`).send({ effectivenessNote: 'x' });
      expect(res.status).toBe(403);
    });

    it('C08: preventive action can be waived with a reason; corrective cannot', async () => {
      const { findingId } = await makePendingVerification();
      const prev = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'PREVENTIVE', description: 'update procedure' });
      const wOk = await request(app).put(`/api/findings/${findingId}/capa/${prev.body.id}/waive`).set('Authorization', `Bearer ${managerToken}`).send({ reason: 'risk accepted', waivedReason: 'Risk accepted by QA' });
      expect(wOk.status).toBe(200);
      expect(wOk.body.status).toBe('Waived');

      const corr = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      const wBad = await request(app).put(`/api/findings/${findingId}/capa/${corr.body.id}/waive`).set('Authorization', `Bearer ${managerToken}`).send({ waivedReason: 'no' });
      expect(wBad.status).toBe(400);
    });

    it('C09: close is BLOCKED while a corrective CAPA is unverified → 400', async () => {
      const { findingId } = await makePendingVerification();
      await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'closing' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/corrective/i);
    });

    it('C10: close succeeds once the corrective CAPA is verified', async () => {
      const { findingId, followUpId } = await makePendingVerification();
      const capa = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      await request(app).post(`/api/findings/${findingId}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, taskId: followUpId });
      await request(app).put(`/api/findings/${findingId}/capa/${capa.body.id}/verify`).set('Authorization', `Bearer ${managerToken}`).send({ effectivenessNote: 'Effective on re-check' });
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'corrective verified, closing' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Closed');
    });

    it('C11: close is BLOCKED while an RCA is still Draft → 400', async () => {
      const { findingId } = await makePendingVerification();
      await request(app).put(`/api/findings/${findingId}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'OTHER' });
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'closing' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/rca|complete/i);
    });

    it('C12: an Observation with no RCA/CAPA closes (graded gate does not apply)', async () => {
      const { findingId } = await makePendingVerification();
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'Observation closed' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Closed');
    });

    it('C12a: close is BLOCKED without a closure note → 400', async () => {
      const { findingId } = await makePendingVerification();
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/closure note/i);
    });

    it('C12b: a Level 1 finding with no RCA is BLOCKED from closing → 400', async () => {
      const { findingId } = await makePendingVerification(staffToken, 'Level 1');
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'closing' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/root cause|rca/i);
    });

    it('C12c: a Level 1 finding with a Complete RCA but no corrective CAPA is BLOCKED → 400', async () => {
      const { findingId } = await makePendingVerification(staffToken, 'Level 1');
      await request(app).put(`/api/findings/${findingId}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'OTHER', status: 'Complete', causeCodeId: causeA });
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'closing' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/corrective/i);
    });

    it('C12d: a Level 1 finding closes once RCA Complete + corrective CAPA verified', async () => {
      const { findingId, followUpId } = await makePendingVerification(staffToken, 'Level 1');
      await request(app).put(`/api/findings/${findingId}/rca`).set('Authorization', `Bearer ${managerToken}`).send({ method: 'OTHER', status: 'Complete', causeCodeId: causeA });
      const capa = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      await request(app).post(`/api/findings/${findingId}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, taskId: followUpId });
      await request(app).put(`/api/findings/${findingId}/capa/${capa.body.id}/verify`).set('Authorization', `Bearer ${managerToken}`).send({ effectivenessNote: 'Effective' });
      const res = await request(app).put(`/api/findings/${findingId}/close`).set('Authorization', `Bearer ${managerToken}`).send({ closureNote: 'Full closed loop complete' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Closed');
    });

    it('C13: a Manager can remove a CAPA link (hard delete); staff cannot', async () => {
      const { findingId } = await makePendingVerification();
      const capa = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      const link = await request(app).post(`/api/findings/${findingId}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: false, taskId: sourceTaskId });
      expect(link.status).toBe(201);
      const staffDel = await request(app).delete(`/api/findings/${findingId}/capa/${capa.body.id}/links/${link.body.id}`).set('Authorization', `Bearer ${staffToken}`);
      expect(staffDel.status).toBe(403);
      const del = await request(app).delete(`/api/findings/${findingId}/capa/${capa.body.id}/links/${link.body.id}`).set('Authorization', `Bearer ${managerToken}`);
      expect(del.status).toBe(200);
      expect(await prisma.capaTaskLink.count({ where: { capaId: capa.body.id } })).toBe(0);
    });

    it('C14: a mandatory-linked WP gates verify until the WP is Closed', async () => {
      const { findingId } = await makePendingVerification();
      const capa = await request(app).post(`/api/findings/${findingId}/capa`).set('Authorization', `Bearer ${managerToken}`).send({ type: 'CORRECTIVE', description: 'fix' });
      const wp = await prisma.workPackage.create({ data: { wpId: 'FEX-WP-EFF1', name: 'Eff WP', type: 'INVESTIGATION', divisionId, timeframeFrom: new Date(), timeframeTo: new Date(Date.now() + 86400000), creatorId: managerId, status: 'Open' } });
      await request(app).post(`/api/findings/${findingId}/capa/${capa.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ mandatory: true, wpId: wp.id });
      const blocked = await request(app).put(`/api/findings/${findingId}/capa/${capa.body.id}/verify`).set('Authorization', `Bearer ${managerToken}`).send({ effectivenessNote: 'pending' });
      expect(blocked.status).toBe(400);
      await prisma.workPackage.update({ where: { id: wp.id }, data: { status: 'Closed' } });
      const ok = await request(app).put(`/api/findings/${findingId}/capa/${capa.body.id}/verify`).set('Authorization', `Bearer ${managerToken}`).send({ effectivenessNote: 'WP closed, effective' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('Verified');
    });
  });

  // ── Group 11 — Taxonomy ─────────────────────────────────────────────────────
  describe('Taxonomy', () => {
    it('T01: any authenticated user can list active taxonomies', async () => {
      const res = await request(app).get('/api/taxonomy/cause-codes?activeOnly=true').set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('T02: admin can create a hazard tag; staff cannot → 403', async () => {
      const ok = await request(app).post('/api/taxonomy/hazard-tags').set('Authorization', `Bearer ${adminToken}`).send({ label: 'FEX-Tooling' });
      expect(ok.status).toBe(201);
      const bad = await request(app).post('/api/taxonomy/hazard-tags').set('Authorization', `Bearer ${staffToken}`).send({ label: 'FEX-Nope' });
      expect(bad.status).toBe(403);
      await prisma.hazardTag.deleteMany({ where: { label: 'FEX-Tooling' } });
    });

    it('T03: isActive=false hides a tag from the activeOnly list', async () => {
      const tag = await prisma.hazardTag.create({ data: { label: 'FEX-Hidden', isActive: false } });
      const res = await request(app).get('/api/taxonomy/hazard-tags?activeOnly=true').set('Authorization', `Bearer ${staffToken}`);
      const labels = res.body.map((t: any) => t.label);
      expect(labels).not.toContain('FEX-Hidden');
      await prisma.hazardTag.delete({ where: { id: tag.id } });
    });

    it('T04: raising a finding with ATA chapter + hazard tags persists the junction', async () => {
      const res = await raiseFinding(staffToken, { ataChapterId: ataA, hazardTagIds: [hazX, hazY] });
      expect(res.status).toBe(201);
      expect(res.body.ataChapterId).toBe(ataA);
      const tags = await prisma.findingHazardTag.findMany({ where: { findingId: res.body.id } });
      expect(tags).toHaveLength(2);
    });

    it('T05: raising with an unknown ATA chapter → 400', async () => {
      const res = await raiseFinding(staffToken, { ataChapterId: 999999 });
      expect(res.status).toBe(400);
    });
  });

  // ── Group 12 — Finding links ────────────────────────────────────────────────
  describe('Finding links', () => {
    it('L01: Manager can link two findings (RELATED) and read both directions', async () => {
      const a = await raiseFinding(staffToken);
      const b = await raiseFinding(staffToken);
      const res = await request(app).post(`/api/findings/${a.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ relatedFindingId: b.body.id, linkType: 'RELATED' });
      expect(res.status).toBe(201);

      const fromA = await request(app).get(`/api/findings/${a.body.id}/links`).set('Authorization', `Bearer ${managerToken}`);
      expect(fromA.body.outgoing).toHaveLength(1);
      const toB = await request(app).get(`/api/findings/${b.body.id}/links`).set('Authorization', `Bearer ${managerToken}`);
      expect(toB.body.incoming).toHaveLength(1);
    });

    it('L02: self-link → 400', async () => {
      const a = await raiseFinding(staffToken);
      const res = await request(app).post(`/api/findings/${a.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ relatedFindingId: a.body.id, linkType: 'DUPLICATE' });
      expect(res.status).toBe(400);
    });

    it('L03: duplicate identical edge → 400', async () => {
      const a = await raiseFinding(staffToken);
      const b = await raiseFinding(staffToken);
      await request(app).post(`/api/findings/${a.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ relatedFindingId: b.body.id, linkType: 'CAUSED_BY' });
      const res = await request(app).post(`/api/findings/${a.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ relatedFindingId: b.body.id, linkType: 'CAUSED_BY' });
      expect(res.status).toBe(400);
    });

    it('L04: staff cannot create a link → 403', async () => {
      const a = await raiseFinding(staffToken);
      const b = await raiseFinding(staffToken);
      const res = await request(app).post(`/api/findings/${a.body.id}/links`).set('Authorization', `Bearer ${staffToken}`).send({ relatedFindingId: b.body.id, linkType: 'RELATED' });
      expect(res.status).toBe(403);
    });

    it('L05: link can be deleted', async () => {
      const a = await raiseFinding(staffToken);
      const b = await raiseFinding(staffToken);
      const created = await request(app).post(`/api/findings/${a.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ relatedFindingId: b.body.id, linkType: 'RELATED' });
      const res = await request(app).delete(`/api/findings/${a.body.id}/links/${created.body.id}`).set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      const after = await prisma.findingLink.count({ where: { fromFindingId: a.body.id } });
      expect(after).toBe(0);
    });
  });

  // ── Group 13 — Trend engine ─────────────────────────────────────────────────
  describe('Trend engine', () => {
    it('TR01: flags recurring when the signature repeats at threshold', async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push(await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] }));
      const res = await request(app).get(`/api/findings/${ids[0]}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.body.trend.isRecurring).toBe(true);
      expect(res.body.trend.matchCount).toBe(3);
    });

    it('TR02: below threshold is not recurring', async () => {
      const a = await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      const res = await request(app).get(`/api/findings/${a}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.body.trend.isRecurring).toBe(false);
      expect(res.body.trend.matchCount).toBe(2);
    });

    it('TR03: findings outside the time window are excluded', async () => {
      const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
      const a = await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX], createdAt: old });
      const res = await request(app).get(`/api/findings/${a}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.body.trend.matchCount).toBe(2);
      expect(res.body.trend.isRecurring).toBe(false);
    });

    it('TR04: soft-deleted findings are excluded', async () => {
      const a = await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX], deletedAt: new Date() });
      const res = await request(app).get(`/api/findings/${a}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.body.trend.matchCount).toBe(2);
    });

    it('TR05: a different cause code does not join the cluster', async () => {
      const a = await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeB, hazardTagIds: [hazX] });
      const res = await request(app).get(`/api/findings/${a}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.body.trend.matchCount).toBe(2);
    });

    it('TR06: a finding with no cause code is never recurring', async () => {
      const a = await createClusterFinding({ ataChapterId: ataA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, hazardTagIds: [hazX] });
      const res = await request(app).get(`/api/findings/${a}`).set('Authorization', `Bearer ${directorToken}`);
      expect(res.body.trend.isRecurring).toBe(false);
      expect(res.body.trend.matchCount).toBe(0);
    });

    it('TR07: the subject finding is counted even when raised before the window', async () => {
      // Subject is 200 days old; two recent matches share the signature.
      const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
      const subject = await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX], createdAt: old });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      await createClusterFinding({ ataChapterId: ataA, causeCodeId: causeA, hazardTagIds: [hazX] });
      const res = await request(app).get(`/api/findings/${subject}`).set('Authorization', `Bearer ${directorToken}`);
      // 2 recent + the subject itself = 3 → recurring at threshold.
      expect(res.body.trend.matchCount).toBe(3);
      expect(res.body.trend.isRecurring).toBe(true);
    });
  });

  // ── Group 14 — Inactive taxonomy guard ──────────────────────────────────────
  describe('Inactive taxonomy', () => {
    it('IT01: raising with an inactive ATA chapter → 400', async () => {
      const inactive = await prisma.ataChapter.create({ data: { code: 'FEX-INACT', title: 'Retired', isActive: false } });
      const res = await raiseFinding(staffToken, { ataChapterId: inactive.id });
      expect(res.status).toBe(400);
      await prisma.ataChapter.delete({ where: { id: inactive.id } });
    });

    it('IT02: raising with an inactive hazard tag → 400', async () => {
      const inactive = await prisma.hazardTag.create({ data: { label: 'FEX-INACT-HAZ', isActive: false } });
      const res = await raiseFinding(staffToken, { hazardTagIds: [inactive.id] });
      expect(res.status).toBe(400);
      await prisma.hazardTag.delete({ where: { id: inactive.id } });
    });
  });

  // ── Group 15 — Link RBAC (broadened manager scope) ──────────────────────────
  describe('Link RBAC', () => {
    // Create two linkable FEX findings and link them as the FEX manager.
    async function linkTwoFindings(): Promise<{ aId: number; linkId: number }> {
      const a = await raiseFinding(staffToken);
      const b = await raiseFinding(staffToken);
      const created = await request(app).post(`/api/findings/${a.body.id}/links`).set('Authorization', `Bearer ${managerToken}`).send({ relatedFindingId: b.body.id, linkType: 'RELATED' });
      return { aId: a.body.id, linkId: created.body.id };
    }

    it('LR01: a manager of an uninvolved division cannot delete the link → 403', async () => {
      const { aId, linkId } = await linkTwoFindings();
      const res = await request(app).delete(`/api/findings/${aId}/links/${linkId}`).set('Authorization', `Bearer ${manager2Token}`);
      expect(res.status).toBe(403);
      expect(await prisma.findingLink.count({ where: { fromFindingId: aId } })).toBe(1);
    });

    it('LR02: a manager whose division is involved via a follow-up assignee can view and delete the link', async () => {
      const { aId, linkId } = await linkTwoFindings();
      // Generate a follow-up task on the finding and assign it to a FEX2 staffer.
      await request(app).put(`/api/findings/${aId}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const gen = await request(app).post(`/api/findings/${aId}/tasks`).set('Authorization', `Bearer ${managerToken}`).send({ tasks: [{ templateId: allowsFindingsTemplateId, title: 'CAR' }] });
      await prisma.task.update({ where: { id: gen.body.createdTasks[0].id }, data: { assignedToUserId: staff2Id, status: 'Assigned' } });

      // manager2 (FEX2) is now involved → can view links and delete.
      const view = await request(app).get(`/api/findings/${aId}/links`).set('Authorization', `Bearer ${manager2Token}`);
      expect(view.status).toBe(200);
      const res = await request(app).delete(`/api/findings/${aId}/links/${linkId}`).set('Authorization', `Bearer ${manager2Token}`);
      expect(res.status).toBe(200);
      expect(await prisma.findingLink.count({ where: { fromFindingId: aId } })).toBe(0);
    });

    it('LR03: open visibility — all users can see findings from any division in the list', async () => {
      const a = await raiseFinding(staffToken);
      const res = await request(app).get('/api/findings').set('Authorization', `Bearer ${manager2Token}`);
      expect(res.status).toBe(200);
      const ids = res.body.findings.map((f: any) => f.id);
      expect(ids).toContain(a.body.id);
    });
  });

  // ── Group 16 — RBAC: open visibility + mutation scope guards ────────────────
  describe('RBAC scope guards', () => {
    it('C-SEC-1: staff in a different division can GET /findings/:id → 200', async () => {
      // Finding targetDivisionId = divisionId (FEX); staff2Token is in division2Id (FEX2).
      const a = await raiseFinding(staffToken);
      const res = await request(app).get(`/api/findings/${a.body.id}`).set('Authorization', `Bearer ${staff2Token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(a.body.id);
    });

    it('C-SEC-2: Manager in wrong division cannot dismiss a foreign finding → 403', async () => {
      const a = await raiseFinding(staffToken);
      const res = await request(app)
        .put(`/api/findings/${a.body.id}/dismiss`)
        .set('Authorization', `Bearer ${manager2Token}`)
        .send({ reason: 'Raised in error' });
      expect(res.status).toBe(403);
      const f = await prisma.finding.findUnique({ where: { id: a.body.id }, select: { status: true } });
      expect(f?.status).toBe('Open');
    });

    it('C-SEC-3: Manager in correct division can dismiss their own division finding → 200', async () => {
      const a = await raiseFinding(staffToken);
      const res = await request(app)
        .put(`/api/findings/${a.body.id}/dismiss`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ reason: 'Raised in error' });
      expect(res.status).toBe(200);
      const f = await prisma.finding.findUnique({ where: { id: a.body.id }, select: { status: true } });
      expect(f?.status).toBe('Dismissed');
    });

    it('C-SEC-4: Director can dismiss a finding in any division → 200', async () => {
      const a = await raiseFinding(staffToken);
      const res = await request(app)
        .put(`/api/findings/${a.body.id}/dismiss`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ reason: 'Director override' });
      expect(res.status).toBe(200);
    });

    it('C-SEC-5a: Manager in wrong division cannot update severity → 403', async () => {
      const a = await raiseFinding(staffToken);
      await request(app).put(`/api/findings/${a.body.id}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const res = await request(app)
        .put(`/api/findings/${a.body.id}/severity`)
        .set('Authorization', `Bearer ${manager2Token}`)
        .send({ severity: 'Level 2', reason: 'Reclassify' });
      expect(res.status).toBe(403);
    });

    it('C-SEC-5b: Manager in correct division can update severity → 200', async () => {
      const a = await raiseFinding(staffToken);
      await request(app).put(`/api/findings/${a.body.id}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const res = await request(app)
        .put(`/api/findings/${a.body.id}/severity`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ severity: 'Level 2', reason: 'Reclassify' });
      expect(res.status).toBe(200);
    });

    it('C-SEC-5c: Director can update severity in any division → 200', async () => {
      const a = await raiseFinding(staffToken);
      await request(app).put(`/api/findings/${a.body.id}/review`).set('Authorization', `Bearer ${managerToken}`).send({ severity: 'Level 1' });
      const res = await request(app)
        .put(`/api/findings/${a.body.id}/severity`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ severity: 'Observation', reason: 'Director override' });
      expect(res.status).toBe(200);
    });
  });
});
