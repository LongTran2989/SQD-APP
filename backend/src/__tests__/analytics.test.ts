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

// Look up a bucket count by key in a [{ key, count }] array (0 if absent).
function countFor(arr: { key: string; count: number }[], key: string): number {
  return arr.find((b) => b.key === key)?.count ?? 0;
}

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Findings Analytics (GET /api/analytics/findings)', () => {
  let directorToken: string;
  let adminToken: string;
  let managerToken: string;   // division 1 (ANA)
  let manager2Token: string;  // division 2 (AN2)
  let staffToken: string;

  let directorId: number;
  let staffId: number;

  let divisionId: number;   // ANA
  let division2Id: number;  // AN2
  let deptId: number;       // Analytics Test Dept
  let dept2Id: number;      // Analytics Test Dept 2
  let ataId: number;        // ATA chapter attached to one finding

  beforeAll(async () => {
    const directorRole = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const adminRole = await prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin' } });
    const managerRole = await prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager' } });
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });

    const dept = await prisma.department.upsert({ where: { name: 'Analytics Test Dept' }, update: {}, create: { name: 'Analytics Test Dept' } });
    deptId = dept.id;
    const dept2 = await prisma.department.upsert({ where: { name: 'Analytics Test Dept 2' }, update: {}, create: { name: 'Analytics Test Dept 2' } });
    dept2Id = dept2.id;

    const div = await prisma.division.upsert({ where: { code: 'ANA' }, update: {}, create: { name: 'Analytics Test Div', code: 'ANA', departmentId: dept.id } });
    const div2 = await prisma.division.upsert({ where: { code: 'AN2' }, update: {}, create: { name: 'Analytics Test Div 2', code: 'AN2', departmentId: dept.id } });
    divisionId = div.id;
    division2Id = div2.id;

    const ata = await prisma.ataChapter.upsert({ where: { code: 'ANA99' }, update: {}, create: { code: 'ANA99', title: 'Analytics Test Chapter' } });
    ataId = ata.id;

    const director = await prisma.user.create({ data: { name: 'Ana Director', email: 'ana_director@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: directorRole.id } });
    directorId = director.id;
    const admin = await prisma.user.create({ data: { name: 'Ana Admin', email: 'ana_admin@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: adminRole.id } });
    const manager = await prisma.user.create({ data: { name: 'Ana Manager', email: 'ana_manager@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: managerRole.id } });
    const manager2 = await prisma.user.create({ data: { name: 'Ana Manager2', email: 'ana_manager2@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: division2Id, roleId: managerRole.id } });
    const staff = await prisma.user.create({ data: { name: 'Ana Staff', email: 'ana_staff@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId, roleId: staffRole.id } });
    staffId = staff.id;

    directorToken = makeToken(directorId, 'Director', divisionId);
    adminToken = makeToken(admin.id, 'Admin', divisionId);
    managerToken = makeToken(manager.id, 'Manager', divisionId);
    manager2Token = makeToken(manager2.id, 'Manager', division2Id);
    staffToken = makeToken(staffId, 'Staff', divisionId);
  });

  beforeEach(async () => {
    // FK-safe wipe of all findings + child tables (this suite creates plain findings only).
    await prisma.findingResponseActionDepartment.deleteMany({});
    await prisma.findingResponseAction.deleteMany({});
    await prisma.findingLink.deleteMany({});
    await prisma.findingHazardTag.deleteMany({});
    await prisma.rcaWhyStep.deleteMany({});
    await prisma.rcaContributingFactor.deleteMany({});
    await prisma.rcaInvestigation.deleteMany({});
    await prisma.capaAction.deleteMany({});
    await prisma.task.updateMany({ data: { parentFindingId: null } });
    await prisma.finding.updateMany({ data: { sourceTaskId: null } });
    await prisma.finding.deleteMany({});
    await prisma.auditLog.deleteMany({});

    // ── Dataset ──
    // Division 1 (ANA) — 4 active findings + 1 soft-deleted (must be excluded).
    await prisma.finding.create({ data: { description: 'F1', eventType: 'Procedural Breach', departmentId: deptId, reportedByUserId: directorId, targetDivisionId: divisionId, severity: 'Level 1', status: 'Open', createdAt: D('2026-01-15') } });
    await prisma.finding.create({ data: { description: 'F2', eventType: 'Procedural Breach', departmentId: deptId, reportedByUserId: directorId, targetDivisionId: divisionId, severity: 'Level 2', status: 'Closed', ataChapterId: ataId, createdAt: D('2026-01-10'), closedAt: D('2026-01-20') } }); // 10 days
    await prisma.finding.create({ data: { description: 'F3', eventType: 'Documentation Error', departmentId: deptId, reportedByUserId: staffId, targetDivisionId: divisionId, severity: null, status: 'In Progress', createdAt: D('2026-02-05') } });
    await prisma.finding.create({ data: { description: 'F4', eventType: 'Tooling', departmentId: dept2Id, reportedByUserId: staffId, targetDivisionId: divisionId, severity: 'Observation', status: 'Closed', createdAt: D('2026-02-01'), closedAt: D('2026-02-05') } }); // 4 days
    await prisma.finding.create({ data: { description: 'F-DEL', eventType: 'Procedural Breach', departmentId: deptId, reportedByUserId: staffId, targetDivisionId: divisionId, severity: 'Level 1', status: 'Open', createdAt: D('2026-01-12'), deletedAt: D('2026-01-13') } });

    // Division 2 (AN2) — 2 active findings.
    await prisma.finding.create({ data: { description: 'G1', eventType: 'Procedural Breach', departmentId: deptId, reportedByUserId: directorId, targetDivisionId: division2Id, severity: 'Level 1', status: 'Open', createdAt: D('2026-03-01') } });
    await prisma.finding.create({ data: { description: 'G2', eventType: 'Other', departmentId: deptId, reportedByUserId: directorId, targetDivisionId: division2Id, severity: null, status: 'Dismissed', createdAt: D('2026-03-10') } });
  });

  afterAll(async () => {
    // Full wipe (not a named list) so any finding a test leaves behind — e.g. the
    // intraday fixture in A21 — is cleared before the FK-linked users are deleted.
    await prisma.finding.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { in: ['ana_director@sqd.com', 'ana_admin@sqd.com', 'ana_manager@sqd.com', 'ana_manager2@sqd.com', 'ana_staff@sqd.com'] } } });
    await prisma.$disconnect();
    await pool.end();
  });

  const get = (token: string, query = '') =>
    request(app).get(`/api/analytics/findings${query}`).set('Authorization', `Bearer ${token}`);

  // ── RBAC ──

  it('A01: Staff (no analytics:view) → 403', async () => {
    const res = await get(staffToken);
    expect(res.status).toBe(403);
  });

  it('A02: unauthenticated → 401', async () => {
    const res = await request(app).get('/api/analytics/findings');
    expect(res.status).toBe(401);
  });

  it('A03: Director → 200 with the full (division-wide) dataset, soft-deleted excluded', async () => {
    const res = await get(directorToken);
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(6); // F-DEL excluded
  });

  it('A04: Admin → 200', async () => {
    const res = await get(adminToken);
    expect(res.status).toBe(200);
  });

  // ── Aggregations (Director, all divisions) ──

  it('A05: bySeverity buckets, nulls counted as Unreviewed, all canonical buckets present', async () => {
    const { body } = await get(directorToken);
    expect(countFor(body.bySeverity, 'Level 1')).toBe(2);   // F1, G1
    expect(countFor(body.bySeverity, 'Level 2')).toBe(1);   // F2
    expect(countFor(body.bySeverity, 'Observation')).toBe(1); // F4
    expect(countFor(body.bySeverity, 'Unreviewed')).toBe(2); // F3, G2
    // Canonical buckets always rendered even at 0
    expect(body.bySeverity.map((b: any) => b.key)).toEqual(
      expect.arrayContaining(['Observation', 'Level 1', 'Level 2', 'Unreviewed'])
    );
  });

  it('A06: byStatus buckets incl. zero-count Pending Verification', async () => {
    const { body } = await get(directorToken);
    expect(countFor(body.byStatus, 'Open')).toBe(2);
    expect(countFor(body.byStatus, 'In Progress')).toBe(1);
    expect(countFor(body.byStatus, 'Closed')).toBe(2);
    expect(countFor(body.byStatus, 'Dismissed')).toBe(1);
    expect(countFor(body.byStatus, 'Pending Verification')).toBe(0);
  });

  it('A07: open/closed/dismissed scalar counts', async () => {
    const { body } = await get(directorToken);
    expect(body.openCount).toBe(3);      // Open + In Progress (not Closed/Dismissed)
    expect(body.closedCount).toBe(2);
    expect(body.dismissedCount).toBe(1);
  });

  it('A08: byEventType is dynamic and sorted desc by count', async () => {
    const { body } = await get(directorToken);
    expect(countFor(body.byEventType, 'Procedural Breach')).toBe(3); // F1, F2, G1
    expect(countFor(body.byEventType, 'Documentation Error')).toBe(1);
    expect(countFor(body.byEventType, 'Tooling')).toBe(1);
    expect(countFor(body.byEventType, 'Other')).toBe(1);
    expect(body.byEventType[0].key).toBe('Procedural Breach'); // highest count first
  });

  it('A09: byDepartment counts with names', async () => {
    const { body } = await get(directorToken);
    const d1 = body.byDepartment.find((d: any) => d.id === deptId);
    const d2 = body.byDepartment.find((d: any) => d.id === dept2Id);
    expect(d1.count).toBe(5); // F1, F2, F3, G1, G2
    expect(d1.name).toBe('Analytics Test Dept');
    expect(d2.count).toBe(1); // F4
  });

  it('A10: byAtaChapter only counts findings with an ATA chapter', async () => {
    const { body } = await get(directorToken);
    expect(body.byAtaChapter).toHaveLength(1);
    expect(body.byAtaChapter[0]).toMatchObject({ id: ataId, code: 'ANA99', count: 1 });
  });

  it('A11: byMonth trend over createdAt, sorted ascending', async () => {
    const { body } = await get(directorToken);
    expect(body.byMonth).toEqual([
      { month: '2026-01', count: 2 }, // F1, F2
      { month: '2026-02', count: 2 }, // F3, F4
      { month: '2026-03', count: 2 }, // G1, G2
    ]);
  });

  it('A12: avgDaysToClose averages (closedAt − createdAt) over Closed findings', async () => {
    const { body } = await get(directorToken);
    expect(body.avgDaysToClose).toBe(7); // (10 + 4) / 2
  });

  // ── Division transparency + optional narrowing ──
  // Findings analytics is organisation-wide for every role (matches the open
  // Findings list); ?divisionId narrows to a single division for anyone.

  it('A13: Manager sees all findings org-wide, not just their division', async () => {
    const { body } = await get(managerToken);
    expect(body.totalCount).toBe(6); // F1–F4 (ANA) + G1, G2 (AN2)
    expect(body.closedCount).toBe(2);
    expect(body.dismissedCount).toBe(1); // G2 (AN2) now visible
    expect(countFor(body.byEventType, 'Other')).toBe(1); // G2 in AN2 now included
  });

  it('A14: a Manager in another division (AN2) also sees the full org-wide dataset', async () => {
    const { body } = await get(manager2Token);
    expect(body.totalCount).toBe(6);
    expect(countFor(body.byStatus, 'Dismissed')).toBe(1);
  });

  it('A15: Director ?divisionId narrows to a single division', async () => {
    const { body } = await get(directorToken, `?divisionId=${division2Id}`);
    expect(body.totalCount).toBe(2);
  });

  it('A16: Manager may narrow to any division via ?divisionId (transparency)', async () => {
    const { body } = await get(managerToken, `?divisionId=${division2Id}`);
    expect(body.totalCount).toBe(2); // narrowed to AN2, which the Manager can now see
  });

  // ── Query filters ──

  it('A17: ?severity filter', async () => {
    const { body } = await get(directorToken, '?severity=Level 1');
    expect(body.totalCount).toBe(2); // F1, G1
  });

  it('A18: ?eventType filter', async () => {
    const { body } = await get(directorToken, '?eventType=Procedural Breach');
    expect(body.totalCount).toBe(3); // F1, F2, G1
  });

  it('A19: ?departmentId filter', async () => {
    const { body } = await get(directorToken, `?departmentId=${dept2Id}`);
    expect(body.totalCount).toBe(1); // F4
  });

  it('A20: ?from/?to filter on createdAt', async () => {
    const { body } = await get(directorToken, '?from=2026-02-01&to=2026-02-28');
    expect(body.totalCount).toBe(2); // F3 (02-05), F4 (02-01)
  });

  it('A21: date-only ?to is inclusive of the whole boundary day (intraday timestamps not dropped)', async () => {
    // A finding created later on the `to` day must still fall inside the range.
    // A naive `lte midnight(to)` would drop this; the controller uses `lt next-midnight`.
    await prisma.finding.create({ data: { description: 'F-INTRADAY', eventType: 'Procedural Breach', departmentId: deptId, reportedByUserId: directorId, targetDivisionId: divisionId, severity: 'Level 1', status: 'Open', createdAt: new Date('2026-02-28T14:30:00.000Z') } });
    const { body } = await get(directorToken, '?from=2026-02-01&to=2026-02-28');
    expect(body.totalCount).toBe(3); // F4 (02-01), F3 (02-05), F-INTRADAY (02-28 14:30)
  });
});
