import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const divs = await prisma.division.findMany({
    include: { department: true }
  });
  console.log(JSON.stringify(divs.map(d => ({
    code: d.code,
    name: d.name,
    dept: d.department.name
  })), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
