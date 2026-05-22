import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
