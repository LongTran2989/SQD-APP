import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL?.includes('test')) {
  throw new Error('clean.ts must only run against a test database. Check DATABASE_URL.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
async function main() {
  await prisma.workPackageAssignment.deleteMany({});
  await prisma.taskActivity.deleteMany({});
  await prisma.taskData.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.workPackage.deleteMany({});
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          'task_director@sqd.com',
          'task_admin@sqd.com',
          'task_manager@sqd.com',
          'task_staff@sqd.com',
          'task_manager2@sqd.com'
        ]
      }
    }
  });
}
main().finally(() => prisma.$disconnect());
