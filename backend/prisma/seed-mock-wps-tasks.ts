// backend/prisma/seed-mock-wps-tasks.ts
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding mock Work Packages and Tasks...');

  // Get active users for assignment
  const director = await prisma.user.findFirst({ where: { role: { name: 'Director' } } });
  const staff = await prisma.user.findFirst({ where: { role: { name: 'Staff' } } });
  const division = await prisma.division.findFirst({ where: { code: 'QA' } });
  const dept = await prisma.department.findFirst({ where: { name: 'SQD' } });
  const template = await prisma.template.findFirst({ where: { templateId: 'GENERIC-ADHOC' } });

  if (!director || !staff || !division || !template) {
    console.error('❌ Missing core seeded data (users, division, or GENERIC-ADHOC template). Please run main seed first.');
    return;
  }

  // Create Work Packages
  const wp1 = await prisma.workPackage.upsert({
    where: { wpId: 'QA-WP-000001' },
    update: {},
    create: {
      wpId: 'QA-WP-000001',
      name: 'Q2 Quality Assurance Audit',
      type: 'AUDIT',
      divisionId: division.id,
      timeframeFrom: new Date(),
      timeframeTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 days
      creatorId: director.id,
      targetDepartmentId: dept?.id || null,
      status: 'Open',
    },
  });

  const wp2 = await prisma.workPackage.upsert({
    where: { wpId: 'QA-WP-000002' },
    update: {},
    create: {
      wpId: 'QA-WP-000002',
      name: 'A321 Landing Gear Routine Check',
      type: 'CHECK',
      divisionId: division.id,
      timeframeFrom: new Date(),
      timeframeTo: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // +15 days
      creatorId: director.id,
      acRegistration: 'VN-A321',
      status: 'In Progress',
    },
  });

  console.log(`✅ Seeded Work Packages: ${wp1.wpId}, ${wp2.wpId}`);

  // Create Tasks under the Work Packages
  const task1 = await prisma.task.upsert({
    where: { taskId: 'QA-000001' },
    update: {},
    create: {
      taskId: 'QA-000001',
      title: 'Verify Tooling Calibration Logs',
      templateId: template.id,
      status: 'Assigned',
      issuerId: director.id,
      assignedToUserId: staff.id,
      wpId: wp1.id,
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 days
      schemaSnapshot: template.formSchema || {},
      targetDivisionId: division.id,
    },
  });

  const task2 = await prisma.task.upsert({
    where: { taskId: 'QA-000002' },
    update: {},
    create: {
      taskId: 'QA-000002',
      title: 'Visual Inspection of Nose Gear Assembly',
      templateId: template.id,
      status: 'InProgress',
      issuerId: director.id,
      assignedToUserId: staff.id,
      wpId: wp2.id,
      deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // +3 days
      schemaSnapshot: template.formSchema || {},
      targetDivisionId: division.id,
    },
  });

  console.log(`✅ Seeded Tasks: ${task1.taskId}, ${task2.taskId}`);
  console.log('🎉 Mock Work Packages and Tasks seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
