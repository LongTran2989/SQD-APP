import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { createFindingService } from '../controllers/finding.controller';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Phase 4b (B2): Finding gains a human-readable business code (findingId, FND-000001)
// generated at creation via a global, advisory-locked sequence — mirroring the
// Task.taskId / WorkPackage.wpId pattern.
describe('Finding business identifier (findingId)', () => {
  let userId: number;
  let divisionId: number;
  let departmentId: number;

  beforeAll(async () => {
    const role = await prisma.role.upsert({ where: { name: 'Director' }, update: {}, create: { name: 'Director' } });
    const dept = await prisma.department.upsert({ where: { name: 'FID Dept' }, update: {}, create: { name: 'FID Dept' } });
    departmentId = dept.id;
    const div = await prisma.division.upsert({ where: { code: 'FID' }, update: {}, create: { name: 'FID Div', code: 'FID', departmentId: dept.id } });
    divisionId = div.id;
    const user = await prisma.user.create({ data: { name: 'FID User', email: 'fid_user@sqd.com', passwordHash: 'h', forcePasswordChange: false, divisionId, roleId: role.id } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.finding.deleteMany({ where: { reportedByUserId: userId } });
    await prisma.user.deleteMany({ where: { email: 'fid_user@sqd.com' } });
    await prisma.$disconnect();
    await pool.end();
  });

  const raise = (description: string) =>
    prisma.$transaction((tx) =>
      createFindingService(tx, { userId }, { targetDivisionId: divisionId, eventType: 'AUDIT', departmentId, description })
    );

  it('assigns a sequential, well-formed findingId at creation', async () => {
    const first = await raise('first finding');
    const second = await raise('second finding');

    expect(first.findingId).toMatch(/^FND-\d{6}$/);
    expect(second.findingId).toMatch(/^FND-\d{6}$/);

    const firstSeq = parseInt(first.findingId!.split('-')[1]!, 10);
    const secondSeq = parseInt(second.findingId!.split('-')[1]!, 10);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it('enforces uniqueness of findingId', async () => {
    const existing = await prisma.finding.findFirst({ where: { reportedByUserId: userId, findingId: { not: null } }, select: { findingId: true } });
    await expect(
      prisma.finding.create({ data: { findingId: existing!.findingId, description: 'dup code', eventType: 'AUDIT', reportedByUserId: userId, departmentId, status: 'Open' } })
    ).rejects.toThrow();
  });
});
