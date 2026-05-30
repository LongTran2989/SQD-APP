import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Hard guard: abort immediately if pointed at anything other than the test DB.
// This prevents accidentally wiping the dev or production database if someone
// runs `jest` directly without loading .env.test first.
const dbUrl = process.env.DATABASE_URL ?? '';
if (!dbUrl.includes('sqd_qa_test_db')) {
  throw new Error(
    `SAFETY ABORT: Tests must run against sqd_qa_test_db.\n` +
    `Current DATABASE_URL points to: ${dbUrl || '(not set)'}\n` +
    `Run tests with: npm test  (which loads .env.test automatically)`
  );
}

const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

beforeAll(async () => {
  // Any global setup
  await prisma.systemSetting.upsert({
    where: { key: 'ENFORCE_SINGLE_SESSION' },
    update: { value: 'false' },
    create: { key: 'ENFORCE_SINGLE_SESSION', value: 'false' }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});
