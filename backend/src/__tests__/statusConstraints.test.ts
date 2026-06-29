import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// The status/severity CHECK constraints live in raw migration SQL (migration
// 20260623000100), NOT in schema.prisma — Prisma has no native CHECK support, so
// `db push` (which builds the test DB) does not create them. This suite applies
// the same constraints to the test DB, verifies they reject off-list writes and
// accept valid ones, then drops them in afterAll so the rest of the run is
// unaffected. It is the executable proof that the migration SQL is correct.
//
// The statements below MUST stay in sync with
// prisma/migrations/20260623000100_add_status_check_constraints/migration.sql.
const CONSTRAINTS: Array<{ name: string; table: string; sql: string }> = [
  { name: 'Task_status_check', table: 'Task', sql: `CHECK ("status" IN ('Unassigned','Assigned','In Progress','In Review','Follow-up Required','Closed','Rejected','Terminated','Inactive'))` },
  { name: 'Finding_status_check', table: 'Finding', sql: `CHECK ("status" IN ('Open','In Progress','Pending Verification','Closed','Dismissed'))` },
  { name: 'Finding_severity_check', table: 'Finding', sql: `CHECK ("severity" IS NULL OR "severity" IN ('Observation','Level 1','Level 2'))` },
  { name: 'WorkPackage_status_check', table: 'WorkPackage', sql: `CHECK ("status" IN ('Open','In Progress','Overdue','Closed','Inactive'))` },
  { name: 'FindingLink_no_self_reference_check', table: 'FindingLink', sql: `CHECK ("fromFindingId" <> "relatedFindingId")` },
];

describe('Status/severity CHECK constraints (migration 20260623000100)', () => {
  let userId: number;
  let divisionId: number;
  let departmentId: number;
  let templateId: number;

  beforeAll(async () => {
    for (const c of CONSTRAINTS) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${c.table}" DROP CONSTRAINT IF EXISTS "${c.name}"`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "${c.table}" ADD CONSTRAINT "${c.name}" ${c.sql}`);
    }

    const role = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const dept = await prisma.department.upsert({ where: { name: 'CK Dept' }, update: {}, create: { name: 'CK Dept' } });
    departmentId = dept.id;
    const div = await prisma.division.upsert({ where: { code: 'CKK' }, update: {}, create: { name: 'CK Div', code: 'CKK', departmentId: dept.id } });
    divisionId = div.id;
    const user = await prisma.user.create({ data: { name: 'CK User', email: 'ck_user@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: role.id } });
    userId = user.id;
    const template = await prisma.template.create({ data: { templateId: 'CK-001', title: 'CK Tpl', status: 'Published', formSchema: { fields: [] }, divisionId, ownerId: user.id } });
    templateId = template.id;
  });

  afterAll(async () => {
    for (const c of CONSTRAINTS) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${c.table}" DROP CONSTRAINT IF EXISTS "${c.name}"`);
    }
    await prisma.task.deleteMany({ where: { taskId: { startsWith: 'CK-' } } });
    await prisma.finding.deleteMany({ where: { description: { startsWith: 'CK ' } } });
    await prisma.workPackage.deleteMany({ where: { wpId: { startsWith: 'CK-WP-' } } });
    await prisma.template.deleteMany({ where: { templateId: 'CK-001' } });
    await prisma.user.deleteMany({ where: { email: 'ck_user@sqd.com' } });
    await prisma.$disconnect();
    await pool.end();
  });

  const mkTask = (status: string) =>
    prisma.task.create({ data: { taskId: `CK-${Math.random().toString(36).slice(2, 8)}`, templateId, issuerId: userId, status, targetDivisionId: divisionId, schemaSnapshot: { fields: [] } } });

  const mkFinding = (data: { status?: string; severity?: string | null }) =>
    prisma.finding.create({ data: { description: `CK ${Math.random()}`, eventType: 'AUDIT', reportedByUserId: userId, departmentId, status: data.status ?? 'Open', severity: data.severity ?? null } });

  it('accepts a valid Task.status and rejects an off-list one', async () => {
    await expect(mkTask('In Review')).resolves.toBeDefined();
    await expect(mkTask('Approved')).rejects.toThrow(); // dead status — must be rejected
    await expect(mkTask('in progress')).rejects.toThrow(); // wrong casing
  });

  it('accepts valid Finding.status / severity (incl. NULL) and rejects off-list', async () => {
    await expect(mkFinding({ status: 'Dismissed', severity: 'Level 1' })).resolves.toBeDefined();
    await expect(mkFinding({ status: 'Open', severity: null })).resolves.toBeDefined();
    await expect(mkFinding({ status: 'Bogus' })).rejects.toThrow();
    await expect(mkFinding({ severity: 'Level 3' })).rejects.toThrow();
  });

  it('rejects an off-list WorkPackage.status', async () => {
    const base = { wpId: `CK-WP-${Math.random().toString(36).slice(2, 8)}`, name: 'CK WP', type: 'AUDIT', divisionId, timeframeFrom: new Date(), timeframeTo: new Date(Date.now() + 86400000), creatorId: userId };
    await expect(prisma.workPackage.create({ data: { ...base, status: 'Open' } })).resolves.toBeDefined();
    await expect(prisma.workPackage.create({ data: { ...base, wpId: `CK-WP-${Math.random().toString(36).slice(2, 8)}`, status: 'Done' } })).rejects.toThrow();
  });

  it('rejects a FindingLink that references itself', async () => {
    const f = await mkFinding({ status: 'Open' });
    await expect(
      prisma.findingLink.create({ data: { fromFindingId: f.id, relatedFindingId: f.id, linkType: 'RELATED', createdByUserId: userId } })
    ).rejects.toThrow();
  });
});
