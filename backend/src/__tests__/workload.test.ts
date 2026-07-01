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

function rowFor(personnel: any[], userId: number) {
  return personnel.find((p) => p.userId === userId);
}

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Personnel Workload (GET /api/workload/personnel)', () => {
  let directorToken: string;
  let managerToken: string;  // division 1 (WLA)
  let manager2Token: string; // division 2 (WL2)
  let staffToken: string;

  let staffId: number;
  let manager2Id: number;
  let divisionId: number;
  let division2Id: number;
  let departmentId: number;
  let templateId: number;

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Workload Test Dept' }, update: {}, create: { name: 'Workload Test Dept' } });
    departmentId = dept.id;

    const div = await prisma.division.upsert({ where: { code: 'WLA' }, update: {}, create: { name: 'Workload Test Div', code: 'WLA', departmentId: dept.id } });
    divisionId = div.id;
    const div2 = await prisma.division.upsert({ where: { code: 'WL2' }, update: {}, create: { name: 'Workload Test Div 2', code: 'WL2', departmentId: dept.id } });
    division2Id = div2.id;

    const director = await prisma.user.create({ data: { name: 'Wl Director', email: 'wl_director@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: directorRole.id } });
    const manager = await prisma.user.create({ data: { name: 'Wl Manager', email: 'wl_manager@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: managerRole.id } });
    const manager2 = await prisma.user.create({ data: { name: 'Wl Manager2', email: 'wl_manager2@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId: division2Id, roleId: managerRole.id } });
    manager2Id = manager2.id;
    const staff = await prisma.user.create({ data: { name: 'Wl Staff', email: 'wl_staff@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    staffId = staff.id;

    directorToken = makeToken(director.id, 'Director', divisionId);
    managerToken = makeToken(manager.id, 'Manager', divisionId);
    manager2Token = makeToken(manager2.id, 'Manager', division2Id);
    staffToken = makeToken(staff.id, 'Staff', divisionId);

    const tpl = await prisma.template.create({
      data: {
        templateId: 'WL-T-001',
        title: 'Workload Test Template',
        formSchema: [{ id: '1', type: 'radio', label: 'Pass/Fail', options: ['Pass', 'Fail'] }],
        status: 'Published',
        publishedAt: new Date(),
        ownerId: manager.id,
        divisionId,
        requiresApproval: true,
        estimatedHours: 2,
      },
    });
    templateId = tpl.id;
  });

  beforeEach(async () => {
    await prisma.timeEntry.deleteMany({});
    await prisma.timeBooking.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.capaTaskLink.deleteMany({});
    await prisma.capaAction.deleteMany({});
    await prisma.rcaWhyStep.deleteMany({});
    await prisma.rcaContributingFactor.deleteMany({});
    await prisma.rcaInvestigation.deleteMany({});
    await prisma.finding.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({});
    await prisma.timeBooking.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.capaTaskLink.deleteMany({});
    await prisma.capaAction.deleteMany({});
    await prisma.rcaInvestigation.deleteMany({});
    await prisma.finding.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.template.deleteMany({ where: { templateId: { startsWith: 'WL-T-' } } });
    await prisma.user.deleteMany({ where: { email: { in: ['wl_director@sqd.com', 'wl_manager@sqd.com', 'wl_manager2@sqd.com', 'wl_staff@sqd.com'] } } });
  });

  const get = (token: string, query = '') =>
    request(app).get(`/api/workload/personnel${query}`).set('Authorization', `Bearer ${token}`);

  // ── RBAC ──

  it('W01: Staff (no analytics:view) → 403', async () => {
    const res = await get(staffToken);
    expect(res.status).toBe(403);
  });

  it('W02: unauthenticated → 401', async () => {
    const res = await request(app).get('/api/workload/personnel');
    expect(res.status).toBe(401);
  });

  it('W03: Manager → 200, only own-division personnel returned', async () => {
    const res = await get(managerToken);
    expect(res.status).toBe(200);
    const userIds = res.body.personnel.map((p: any) => p.userId);
    expect(userIds).toContain(staffId);
    expect(userIds).not.toContain(manager2Id);
  });

  it('W04: Director → 200, sees all divisions', async () => {
    const res = await get(directorToken);
    expect(res.status).toBe(200);
    const userIds = res.body.personnel.map((p: any) => p.userId);
    expect(userIds).toContain(staffId);
    expect(userIds).toContain(manager2Id);
  });

  it('W05: Director with ?divisionId narrows to that division', async () => {
    const res = await get(directorToken, `?divisionId=${division2Id}`);
    expect(res.status).toBe(200);
    const userIds = res.body.personnel.map((p: any) => p.userId);
    expect(userIds).not.toContain(staffId);
    expect(userIds).toContain(manager2Id);
  });

  // ── Workload metrics ──

  it('W06: active tasks + estimated hours exclude final-state tasks; Inactive counts as active', async () => {
    await prisma.task.create({ data: { taskId: 'WL-000001', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Assigned', schemaSnapshot: [], estimatedHours: 3, targetDivisionId: divisionId } });
    await prisma.task.create({ data: { taskId: 'WL-000002', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Inactive', schemaSnapshot: [], estimatedHours: 5, targetDivisionId: divisionId } });
    await prisma.task.create({ data: { taskId: 'WL-000003', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Closed', schemaSnapshot: [], estimatedHours: 99, targetDivisionId: divisionId, completedAt: new Date() } });

    const res = await get(managerToken);
    const row = rowFor(res.body.personnel, staffId);
    expect(row.workload.activeTasks).toBe(2);
    expect(row.workload.estimatedHours).toBe(8);
  });

  it('W07: upcoming deadlines within the default 7-day window', async () => {
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.task.create({ data: { taskId: 'WL-000010', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Assigned', schemaSnapshot: [], targetDivisionId: divisionId, deadline: soon } });
    await prisma.task.create({ data: { taskId: 'WL-000011', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Assigned', schemaSnapshot: [], targetDivisionId: divisionId, deadline: far } });

    const res = await get(managerToken);
    const row = rowFor(res.body.personnel, staffId);
    expect(row.workload.upcomingDeadlines).toBe(1);
  });

  it('W08: WPs managed excludes Closed/Inactive work packages', async () => {
    const wpOpen = await prisma.workPackage.create({ data: { wpId: 'WL-WP-0001', name: 'Open WP', type: 'AUDIT', divisionId, timeframeFrom: new Date(), timeframeTo: new Date(Date.now() + 86400000), creatorId: staffId, status: 'Open' } });
    const wpClosed = await prisma.workPackage.create({ data: { wpId: 'WL-WP-0002', name: 'Closed WP', type: 'AUDIT', divisionId, timeframeFrom: new Date(), timeframeTo: new Date(Date.now() + 86400000), creatorId: staffId, status: 'Closed' } });
    await prisma.workPackageAssignment.create({ data: { wpId: wpOpen.id, userId: staffId } });
    await prisma.workPackageAssignment.create({ data: { wpId: wpClosed.id, userId: staffId } });

    const res = await get(managerToken);
    const row = rowFor(res.body.personnel, staffId);
    expect(row.workload.wpsManaged).toBe(1);
  });

  it('W09: open CAPAs + active RCAs counted correctly', async () => {
    const finding = await prisma.finding.create({ data: { eventType: 'Procedural Breach', description: 'WL finding', departmentId, reportedByUserId: staffId, targetDivisionId: divisionId, status: 'In Progress' } });
    await prisma.capaAction.create({ data: { findingId: finding.id, type: 'CORRECTIVE', description: 'Fix it', ownerUserId: staffId, status: 'Open', createdByUserId: staffId } });
    await prisma.capaAction.create({ data: { findingId: finding.id, type: 'CORRECTIVE', description: 'Already done', ownerUserId: staffId, status: 'Verified', createdByUserId: staffId, verifiedByUserId: staffId, verifiedAt: new Date() } });
    await prisma.rcaInvestigation.create({ data: { findingId: finding.id, method: 'FIVE_WHYS', status: 'Draft', conductedByUserId: staffId } });

    const res = await get(managerToken);
    const row = rowFor(res.body.personnel, staffId);
    expect(row.workload.openCapas).toBe(1);
    expect(row.workload.activeRcas).toBe(1);
    expect(row.performance.capasVerified).toBe(1);
  });

  // ── Performance metrics ──

  it('W10: hours logged sums sessionHours within the date range', async () => {
    const task = await prisma.task.create({ data: { taskId: 'WL-000020', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'In Progress', schemaSnapshot: [], targetDivisionId: divisionId } });
    await prisma.timeEntry.create({ data: { taskId: task.id, loggedByUserId: staffId, sessionHours: 2, sessionNotes: 'n', collaboratorEntries: [], loggedAt: D('2026-01-10') } });
    await prisma.timeEntry.create({ data: { taskId: task.id, loggedByUserId: staffId, sessionHours: 3, sessionNotes: 'n', collaboratorEntries: [], loggedAt: D('2026-06-10') } });

    const all = await get(managerToken);
    expect(rowFor(all.body.personnel, staffId).performance.hoursLogged).toBe(5);

    const scoped = await get(managerToken, '?from=2026-06-01&to=2026-06-30');
    expect(rowFor(scoped.body.personnel, staffId).performance.hoursLogged).toBe(3);
  });

  it('W11: rejection rate + proactivity ratio over final-state tasks', async () => {
    await prisma.task.create({ data: { taskId: 'WL-000030', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Closed', schemaSnapshot: [], targetDivisionId: divisionId, completedAt: D('2026-03-01') } });
    await prisma.task.create({ data: { taskId: 'WL-000031', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Rejected', schemaSnapshot: [], targetDivisionId: divisionId, completedAt: D('2026-03-02') } });
    await prisma.finding.create({ data: { eventType: 'Tooling', description: 'reported', departmentId, reportedByUserId: staffId, targetDivisionId: divisionId, status: 'Open', createdAt: D('2026-03-03') } });

    const res = await get(managerToken);
    const row = rowFor(res.body.personnel, staffId);
    expect(row.performance.rejectionRate).toBe(0.5);
    expect(row.performance.findingsReported).toBe(1);
    expect(row.performance.proactivityRatio).toBe(0.5);
  });

  it('W12: findings closed counted by closedAt within range', async () => {
    await prisma.finding.create({ data: { eventType: 'Tooling', description: 'closed one', departmentId, reportedByUserId: staffId, closedByUserId: staffId, targetDivisionId: divisionId, status: 'Closed', closedAt: D('2026-05-01') } });

    const res = await get(managerToken, '?from=2026-04-01&to=2026-05-31');
    const row = rowFor(res.body.personnel, staffId);
    expect(row.performance.findingsClosed).toBe(1);
  });

  it('W16: rejectedCount and overdueCount are reported separately', async () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.task.create({ data: { taskId: 'WL-000040', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Rejected', schemaSnapshot: [], targetDivisionId: divisionId, completedAt: new Date() } });
    await prisma.task.create({ data: { taskId: 'WL-000041', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Assigned', schemaSnapshot: [], targetDivisionId: divisionId, deadline: past } });
    const wpOverdue = await prisma.workPackage.create({ data: { wpId: 'WL-WP-0010', name: 'Overdue WP', type: 'AUDIT', divisionId, timeframeFrom: new Date(Date.now() - 10 * 86400000), timeframeTo: past, creatorId: staffId, status: 'Open' } });
    await prisma.workPackageAssignment.create({ data: { wpId: wpOverdue.id, userId: staffId } });

    const res = await get(managerToken);
    const row = rowFor(res.body.personnel, staffId);
    expect(row.performance.rejectedCount).toBe(1);   // 1 Rejected task
    expect(row.performance.overdueCount).toBe(2);    // 1 overdue task + 1 overdue WP
  });

  it('W17: overdueCount excludes a task whose deadline is past `now` but outside the selected range', async () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.task.create({ data: { taskId: 'WL-000042', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Assigned', schemaSnapshot: [], targetDivisionId: divisionId, deadline: past } });

    const res = await get(managerToken, '?from=2099-01-01&to=2099-12-31');
    const row = rowFor(res.body.personnel, staffId);
    expect(row.performance.overdueCount).toBe(0);
    expect(row.performance.rejectedCount).toBe(0);
  });
});

// ─── Detail endpoint ───────────────────────────────────────────────────────────

describe('Personnel Detail (GET /api/workload/personnel/:userId)', () => {
  let managerToken: string;
  let manager2Token: string;
  let staffId: number;
  let divisionId: number;
  let templateId: number;

  beforeAll(async () => {
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
    const dept = await prisma.department.upsert({ where: { name: 'Workload Detail Dept' }, update: {}, create: { name: 'Workload Detail Dept' } });
    const div = await prisma.division.upsert({ where: { code: 'WLD' }, update: {}, create: { name: 'Workload Detail Div', code: 'WLD', departmentId: dept.id } });
    divisionId = div.id;
    const div2 = await prisma.division.upsert({ where: { code: 'WLD2' }, update: {}, create: { name: 'Workload Detail Div 2', code: 'WLD2', departmentId: dept.id } });

    const manager = await prisma.user.create({ data: { name: 'Wld Manager', email: 'wld_manager@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: managerRole.id } });
    const manager2 = await prisma.user.create({ data: { name: 'Wld Manager2', email: 'wld_manager2@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId: div2.id, roleId: managerRole.id } });
    const staff = await prisma.user.create({ data: { name: 'Wld Staff', email: 'wld_staff@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    staffId = staff.id;

    managerToken = makeToken(manager.id, 'Manager', divisionId);
    manager2Token = makeToken(manager2.id, 'Manager', div2.id);

    const tpl = await prisma.template.create({
      data: {
        templateId: 'WLD-T-001',
        title: 'Workload Detail Test Template',
        formSchema: [{ id: '1', type: 'radio', label: 'Pass/Fail', options: ['Pass', 'Fail'] }],
        status: 'Published',
        publishedAt: new Date(),
        ownerId: manager.id,
        divisionId,
        requiresApproval: true,
        estimatedHours: 2,
      },
    });
    templateId = tpl.id;
  });

  beforeEach(async () => {
    await prisma.timeEntry.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.workPackage.deleteMany({});
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.workPackageAssignment.deleteMany({});
    await prisma.workPackage.deleteMany({});
    await prisma.template.deleteMany({ where: { templateId: { startsWith: 'WLD-T-' } } });
    await prisma.user.deleteMany({ where: { email: { in: ['wld_manager@sqd.com', 'wld_manager2@sqd.com', 'wld_staff@sqd.com'] } } });
    await prisma.$disconnect();
    await pool.end();
  });

  it('W13: Manager can view a user in own division → 200', async () => {
    const res = await request(app).get(`/api/workload/personnel/${staffId}`).set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(staffId);
  });

  it('W14: Manager from another division → 403', async () => {
    const res = await request(app).get(`/api/workload/personnel/${staffId}`).set('Authorization', `Bearer ${manager2Token}`);
    expect(res.status).toBe(403);
  });

  it('W15: unknown user id → 404', async () => {
    const res = await request(app).get('/api/workload/personnel/999999').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(404);
  });

  it('W18: activeTasks lists all non-final tasks regardless of deadline; activeWps excludes Closed/Inactive', async () => {
    const far = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    await prisma.task.create({ data: { taskId: 'WLD-000001', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Assigned', schemaSnapshot: [], targetDivisionId: divisionId, deadline: far } });
    await prisma.task.create({ data: { taskId: 'WLD-000002', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'Closed', schemaSnapshot: [], targetDivisionId: divisionId, completedAt: new Date() } });

    const wpOpen = await prisma.workPackage.create({ data: { wpId: 'WLD-WP-0001', name: 'Open WP', type: 'AUDIT', divisionId, timeframeFrom: new Date(), timeframeTo: far, creatorId: staffId, status: 'Open' } });
    const wpClosed = await prisma.workPackage.create({ data: { wpId: 'WLD-WP-0002', name: 'Closed WP', type: 'AUDIT', divisionId, timeframeFrom: new Date(), timeframeTo: far, creatorId: staffId, status: 'Closed' } });
    await prisma.workPackageAssignment.create({ data: { wpId: wpOpen.id, userId: staffId } });
    await prisma.workPackageAssignment.create({ data: { wpId: wpClosed.id, userId: staffId } });

    const res = await request(app).get(`/api/workload/personnel/${staffId}`).set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.activeTasks.map((t: any) => t.taskId)).toEqual(['WLD-000001']);
    expect(res.body.activeWps.map((w: any) => w.wpId)).toEqual(['WLD-WP-0001']);
  });

  it('W19: hoursLoggedByMonth respects ?from/?to instead of always defaulting to the last 12 months', async () => {
    const task = await prisma.task.create({ data: { taskId: 'WLD-000010', templateId, issuerId: staffId, assignedToUserId: staffId, status: 'In Progress', schemaSnapshot: [], targetDivisionId: divisionId } });
    await prisma.timeEntry.create({ data: { taskId: task.id, loggedByUserId: staffId, sessionHours: 4, sessionNotes: 'n', collaboratorEntries: [], loggedAt: D('2020-01-15') } });
    await prisma.timeEntry.create({ data: { taskId: task.id, loggedByUserId: staffId, sessionHours: 1, sessionNotes: 'n', collaboratorEntries: [], loggedAt: D('2026-06-10') } });

    // Default (no range): last 12 months only — the 2020 entry should be excluded.
    const noRange = await request(app).get(`/api/workload/personnel/${staffId}`).set('Authorization', `Bearer ${managerToken}`);
    expect(noRange.body.hoursLoggedByMonth.find((m: any) => m.month === '2020-01')).toBeUndefined();

    // Explicit range covering the 2020 entry — it should now appear.
    const withRange = await request(app)
      .get(`/api/workload/personnel/${staffId}?from=2020-01-01&to=2020-01-31`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(withRange.body.hoursLoggedByMonth).toEqual([{ month: '2020-01', hours: 4 }]);
  });
});
