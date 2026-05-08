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
  console.log('🌱 Seeding SQD-APP database...\n');

  // ─── 1. Department ─────────────────────────────────────────────────
  const dept = await prisma.department.upsert({
    where: { name: 'Quality System Division' },
    update: {},
    create: { name: 'Quality System Division' },
  });
  console.log(`✔ Department: ${dept.name}`);

  // ─── 2. Divisions (with code for templateId generation) ────────────
  const divisionData = [
    { name: 'QA',     code: 'QA' },
    { name: 'QC HAN', code: 'QCH' },
    { name: 'QC SGN', code: 'QCS' },
    { name: 'SQ',     code: 'SQ' },
  ];

  const divisions: Record<string, any> = {};
  for (const d of divisionData) {
    const div = await prisma.division.upsert({
      where: { code: d.code },
      update: { name: d.name },
      create: { name: d.name, code: d.code, departmentId: dept.id },
    });
    divisions[d.code] = div;
  }
  console.log(`✔ Divisions: ${divisionData.map(d => d.code).join(', ')}`);

  // ─── 3. Roles ──────────────────────────────────────────────────────
  const roleNames = ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'];
  const roles: Record<string, any> = {};
  for (const roleName of roleNames) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    roles[roleName] = role;
  }
  console.log(`✔ Roles: ${roleNames.join(', ')}`);

  // ─── 4. Users ──────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 10);
  const users = [
    { name: 'System Director',  email: 'director@sqd.com',       role: 'Director',     division: 'QA'  },
    { name: 'QA Admin',         email: 'admin.qa@sqd.com',       role: 'Admin',        division: 'QA'  },
    { name: 'Manager QC HAN',   email: 'manager.qch@sqd.com',    role: 'Manager',      division: 'QCH' },
    { name: 'Manager QC SGN',   email: 'manager.qcs@sqd.com',    role: 'Manager',      division: 'QCS' },
    { name: 'Group Leader QA',  email: 'gl.qa@sqd.com',          role: 'Group Leader', division: 'QA'  },
    { name: 'Nguyen Van An',    email: 'nguyen.van.an@sqd.com',  role: 'Staff',        division: 'QA'  },
    { name: 'Tran Thi Bich',    email: 'tran.thi.bich@sqd.com',  role: 'Staff',        division: 'QA'  },
    { name: 'Le Quoc Hung',     email: 'le.quoc.hung@sqd.com',   role: 'Staff',        division: 'QCH' },
    { name: 'Pham Minh Duc',    email: 'pham.minh.duc@sqd.com',  role: 'Staff',        division: 'QCH' },
    { name: 'Hoang Thi Lan',    email: 'hoang.thi.lan@sqd.com',  role: 'Staff',        division: 'QCS' },
    { name: 'Vo Thanh Liem',    email: 'vo.thanh.liem@sqd.com',  role: 'Staff',        division: 'QCS' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        passwordHash,
        forcePasswordChange: false,
        divisionId: divisions[u.division].id,
        roleId: roles[u.role].id,
      },
    });
  }
  console.log(`✔ Users: ${users.length} accounts created`);

  // ─── 5. Aircraft Types (IATA/ICAO) ────────────────────────────────
  const aircraftTypes = [
    { iataCode: '321', icaoCode: 'A321', manufacturer: 'Airbus',  model: 'A321-200' },
    { iataCode: '350', icaoCode: 'A350', manufacturer: 'Airbus',  model: 'A350-900' },
    { iataCode: '787', icaoCode: 'B787', manufacturer: 'Boeing',  model: '787-9 Dreamliner' },
    { iataCode: '77W', icaoCode: 'B77W', manufacturer: 'Boeing',  model: '777-200ER' },
  ];

  for (const at of aircraftTypes) {
    await prisma.aircraftType.upsert({
      where: { iataCode: at.iataCode },
      update: {},
      create: at,
    });
  }
  console.log(`✔ Aircraft Types: ${aircraftTypes.map(a => a.icaoCode).join(', ')}`);

  // ─── 6. Aircraft Registrations ─────────────────────────────────────
  const a321 = await prisma.aircraftType.findUnique({ where: { iataCode: '321' } });
  const a350 = await prisma.aircraftType.findUnique({ where: { iataCode: '350' } });
  const b787 = await prisma.aircraftType.findUnique({ where: { iataCode: '787' } });

  const registrations = [
    { registration: 'VN-A361', operator: 'Vietnam Airlines', authority: 'CAAV', aircraftTypeId: a321!.id },
    { registration: 'VN-A362', operator: 'Vietnam Airlines', authority: 'CAAV', aircraftTypeId: a321!.id },
    { registration: 'VN-A891', operator: 'Vietnam Airlines', authority: 'CAAV', aircraftTypeId: a350!.id },
    { registration: 'VN-A892', operator: 'Vietnam Airlines', authority: 'CAAV', aircraftTypeId: a350!.id },
    { registration: 'VN-A868', operator: 'Vietnam Airlines', authority: 'CAAV', aircraftTypeId: b787!.id },
  ];

  for (const reg of registrations) {
    await prisma.aircraftRegistration.upsert({
      where: { registration: reg.registration },
      update: {},
      create: reg,
    });
  }
  console.log(`✔ Aircraft Registrations: ${registrations.length} airframes`);

  // ─── 7. Authorization Types ────────────────────────────────────────
  const authTypes = [
    { code: 'INSPECTOR', description: 'Qualified QA Inspector' },
    { code: 'MECHANIC',  description: 'Certifying Staff / Mechanic' },
    { code: 'AVIONICS',  description: 'Avionics Specialist' },
  ];

  for (const auth of authTypes) {
    await prisma.authorizationType.upsert({
      where: { code: auth.code },
      update: {},
      create: auth,
    });
  }
  console.log(`✔ Authorization Types: ${authTypes.map(a => a.code).join(', ')}`);

  // ─── Done ──────────────────────────────────────────────────────────
  console.log('\n🎉 Database seeded successfully!');
  console.log('\nLogin credentials (all passwords: password123):');
  for (const u of users) {
    console.log(`  ${u.role.padEnd(14)} | ${u.email.padEnd(28)} | ${u.division}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
