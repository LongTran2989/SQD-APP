import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check1() {
  console.log('CHECK 1: Divisions');
  const divisions = await prisma.division.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { code: 'asc' }
  });

  const expected = [
    { name: 'QA', code: 'QA' },
    { name: 'QC HAN', code: 'QCH' },
    { name: 'QC SGN', code: 'QCS' },
    { name: 'SQ', code: 'SQ' }
  ].sort((a, b) => a.code.localeCompare(b.code));

  console.table(divisions);

  const match = divisions.length === 4 && divisions.every((d, i) => {
    const exp = expected[i];
    return exp && d.name === exp.name && d.code === exp.code;
  });

  if (match) {
    console.log('✅ PASS: Exactly 4 divisions exist with correct names and codes.\n');
    return true;
  } else {
    console.log('❌ FAIL: Division mismatch.\n');
    return false;
  }
}

async function check2() {
  console.log('CHECK 2: Users');
  const users = await prisma.user.findMany({
    include: {
      role: true,
      division: true
    },
    orderBy: { email: 'asc' }
  });

  const expectedUsers = [
    { email: 'director@sqd.com',       role: 'Director',     division: 'QA'  },
    { email: 'admin.qa@sqd.com',       role: 'Admin',        division: 'QA'  },
    { email: 'manager.qch@sqd.com',    role: 'Manager',      division: 'QC HAN' },
    { email: 'manager.qcs@sqd.com',    role: 'Manager',      division: 'QC SGN' },
    { email: 'gl.qa@sqd.com',          role: 'Group Leader', division: 'QA'  },
    { email: 'nguyen.van.an@sqd.com',  role: 'Staff',        division: 'QA'  },
    { email: 'tran.thi.bich@sqd.com',  role: 'Staff',        division: 'QA'  },
    { email: 'le.quoc.hung@sqd.com',   role: 'Staff',        division: 'QC HAN' },
    { email: 'pham.minh.duc@sqd.com',  role: 'Staff',        division: 'QC HAN' },
    { email: 'hoang.thi.lan@sqd.com',  role: 'Staff',        division: 'QC SGN' },
    { email: 'vo.thanh.liem@sqd.com',  role: 'Staff',        division: 'QC SGN' },
  ].sort((a, b) => a.email.localeCompare(b.email));

  console.log(`Total users found: ${users.length}`);
  
  const results = users.map(u => ({
    email: u.email,
    role: u.role.name,
    division: u.division.name
  }));
  console.table(results);

  const match = users.length === 11 && expectedUsers.every((expected, i) => {
    const actual = results[i];
    return actual && 
           actual.email === expected.email && 
           actual.role === expected.role && 
           actual.division === expected.division;
  });

  if (match) {
    console.log('✅ PASS: All 11 seeded users exist with correct roles and divisions.\n');
    return true;
  } else {
    console.log('❌ FAIL: User data mismatch.\n');
    return false;
  }
}

async function check3() {
  console.log('CHECK 3: AircraftType Table');
  try {
    const count = await prisma.aircraftType.count();
    console.log(`AircraftType records found: ${count}`);
    console.log('✅ PASS: AircraftType table is queryable.\n');
    return true;
  } catch (error) {
    console.log('❌ FAIL: AircraftType table error:', error, '\n');
    return false;
  }
}

async function check4() {
  console.log('CHECK 4: AircraftRegistration Table');
  try {
    const count = await prisma.aircraftRegistration.count();
    console.log(`AircraftRegistration records found: ${count}`);
    console.log('✅ PASS: AircraftRegistration table is queryable.\n');
    return true;
  } catch (error) {
    console.log('❌ FAIL: AircraftRegistration table error:', error, '\n');
    return false;
  }
}

async function check5and6() {
  console.log('CHECK 5 & 6: Template integrity');
  const templates = await prisma.template.findMany({
    select: { templateId: true }
  });

  if (templates.length === 0) {
    console.log('No templates found. Skipping pattern/uniqueness check.');
    console.log('✅ PASS (Skipped): No templates to verify.\n');
    return true;
  }

  const divisionCodes = ['QA', 'QCH', 'QCS', 'SQ'];
  const pattern = new RegExp(`^(${divisionCodes.join('|')})-\\d{3}$`);
  
  let allMatch = true;
  const ids = new Set();
  let duplicates = false;

  for (const t of templates) {
    if (!pattern.test(t.templateId)) {
      console.log(`Invalid templateId format: ${t.templateId}`);
      allMatch = false;
    }
    if (ids.has(t.templateId)) {
      console.log(`Duplicate templateId found: ${t.templateId}`);
      duplicates = true;
    }
    ids.add(t.templateId);
  }

  const pass5 = allMatch;
  const pass6 = !duplicates;

  if (pass5) console.log('✅ PASS: All templates match pattern [DivisionCode]-[0-9]{3}.');
  else console.log('❌ FAIL: Some templates have invalid ID format.');

  if (pass6) console.log('✅ PASS: No duplicate templateIds found.');
  else console.log('❌ FAIL: Duplicate templateIds exist.');

  console.log('');
  return pass5 && pass6;
}

async function check7() {
  console.log('CHECK 7: TemplateRevisionArchive Table');
  try {
    const count = await prisma.templateRevisionArchive.count();
    console.log(`TemplateRevisionArchive records found: ${count}`);
    console.log('✅ PASS: TemplateRevisionArchive table is queryable.\n');
    return true;
  } catch (error) {
    console.log('❌ FAIL: TemplateRevisionArchive table error:', error, '\n');
    return false;
  }
}

async function main() {
  console.log('🚀 Starting Data Integrity Checks...\n');
  
  const results = [
    await check1(),
    await check2(),
    await check3(),
    await check4(),
    await check5and6(),
    await check7()
  ];

  const allPass = results.every(r => r === true);
  
  console.log('-------------------------------------------');
  if (allPass) {
    console.log('🏆 FINAL RESULT: ALL CHECKS PASSED');
  } else {
    console.log('⚠️ FINAL RESULT: SOME CHECKS FAILED');
  }
  console.log('-------------------------------------------');
}

main()
  .catch(e => {
    console.error('Fatal error during checks:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
