import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // Create Department
  const department = await prisma.department.upsert({
    where: { name: 'Engineering' },
    update: {},
    create: {
      name: 'Engineering',
    },
  });

  // Create Division
  const division = await prisma.division.upsert({
    where: { id: 1 }, // Assuming ID 1 for initial division or we can query by name if it had a unique constraint
    update: {},
    create: {
      name: 'Quality Assurance',
      departmentId: department.id,
    },
  });

  // Create Roles
  const roles = ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'];
  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }

  const directorRole = await prisma.role.findUnique({ where: { name: 'Director' } });

  if (!directorRole) {
    throw new Error('Director role could not be created or found.');
  }

  // Create Director User
  const passwordHash = await bcrypt.hash('password123', 10);
  const directorUser = await prisma.user.upsert({
    where: { email: 'director@sqd.com' },
    update: {},
    create: {
      name: 'System Director',
      email: 'director@sqd.com',
      passwordHash: passwordHash,
      divisionId: division.id,
      roleId: directorRole.id,
    },
  });

  const adminRole = await prisma.role.findUnique({ where: { name: 'Admin' } });

  if (!adminRole) {
    throw new Error('Admin role could not be created or found.');
  }

  // Create Admin User
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@sqd.com' },
    update: {},
    create: {
      name: 'System Administrator',
      email: 'admin@sqd.com',
      passwordHash: passwordHash,
      divisionId: division.id,
      roleId: adminRole.id,
    },
  });

  console.log(`Database has been seeded. 🌱`);
  console.log(`Director Account created: ${directorUser.email} / password123`);
  console.log(`Admin Account created: ${adminUser.email} / password123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
