// backend/prisma/seed.ts
// -----------------------------------------------------------------------
// Generated from seed data spreadsheet — 2026-05-26
// Departments: 15 | Divisions: 4 | Users: 63
//
// Aviation data (AircraftTypes, Operators, Authorities, Registrations,
// AuthTypes, UserAuthorizations) — TO BE ADDED in next seed update.
//
// HOW TO RUN (from inside /backend):
//   npx ts-node prisma/seed.ts
//
// Add this to backend/package.json if not already present:
//   "prisma": { "seed": "ts-node prisma/seed.ts" }
// Then run: npx prisma db seed
// -----------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { readFileSync } from 'fs';
import path from 'path';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // ── ROLES ──────────────────────────────────────────────────────────────────
  const roles = await Promise.all([
    prisma.role.upsert({ where: { name: 'Director'     }, update: {}, create: { name: 'Director'     } }),
    prisma.role.upsert({ where: { name: 'Admin'        }, update: {}, create: { name: 'Admin'        } }),
    prisma.role.upsert({ where: { name: 'Manager'      }, update: {}, create: { name: 'Manager'      } }),
    prisma.role.upsert({ where: { name: 'Group Leader' }, update: {}, create: { name: 'Group Leader' } }),
    prisma.role.upsert({ where: { name: 'Staff'        }, update: {}, create: { name: 'Staff'        } }),
  ]);
  const roleMap = Object.fromEntries(roles.map(r => [r.name, r.id]));
  console.log(`✅ Roles seeded (${roles.length})`);

  // ── DEPARTMENTS ────────────────────────────────────────────────────────────
  const departmentNames = [
    'SQD', 'EGD', 'MCC', 'HAN BMC', 'HAN RMC',
    'HCM BMC', 'HCM RMC', 'DAD BRANCH', 'LGC', 'BDD',
    'HRD', 'TC', 'ADM', 'HCM BRANCH', 'EXTERNAL',
  ];

  const departments = await Promise.all(
    departmentNames.map(name =>
      prisma.department.upsert({
        where:  { name },
        update: {},
        create: { name },
      })
    )
  );
  const deptMap = Object.fromEntries(departments.map(d => [d.name, d.id]));
  console.log(`✅ Departments seeded (${departments.length})`);

  // ── DIVISIONS ──────────────────────────────────────────────────────────────
  // code is used as prefix for Template IDs (e.g. QA → QA-001)
  // and Task IDs (e.g. QA → QA-000001)
  const divisionData = [
    { name: 'Quality Assurance',           code: 'QA',  department: 'SQD' },
    { name: 'Hanoi Quality Control',       code: 'QCH', department: 'SQD' },
    { name: 'Ho Chi Minh Quality Control', code: 'QCS', department: 'SQD' },
    { name: 'Staff Qualification',         code: 'KS',  department: 'SQD' },
  ];

  const divisions = await Promise.all(
    divisionData.map(d =>
      prisma.division.upsert({
        where:  { code: d.code },
        update: { name: d.name, departmentId: deptMap[d.department]! },
        create: {
          name:         d.name,
          code:         d.code,
          departmentId: deptMap[d.department]!,
        },
      })
    )
  );
  const divMap = Object.fromEntries(divisions.map(d => [d.code, d.id]));
  console.log(`✅ Divisions seeded (${divisions.length})`);

  // ── RENAME SQ → KS if old SQ division still exists ────────────────────────
  // Safe no-op if SQ was already renamed or never existed
  await prisma.division.updateMany({
    where: { code: 'SQ' },
    data:  { code: 'KS', name: 'Staff Qualification' },
  }).catch(() => { /* ignore if SQ doesn't exist */ });

  // ── SYSTEM SETTINGS ────────────────────────────────────────────────────────
  await prisma.systemSetting.upsert({
    where:  { key: 'ENFORCE_SINGLE_SESSION' },
    update: {},
    create: {
      key:         'ENFORCE_SINGLE_SESSION',
      value:       'false',
      description: 'If true, logging in on a new device invalidates all other active sessions.',
    },
  });
  console.log('✅ System settings seeded');

  // ── WP TYPES ───────────────────────────────────────────────────────────────
  const wpTypes = [
    { code: 'CHECK',         description: 'Check' },
    { code: 'AUDIT',         description: 'Audit' },
    { code: 'INVESTIGATION', description: 'Investigation' },
    { code: 'OTHER',         description: 'Other' },
  ];
  await Promise.all(
    wpTypes.map(t =>
      prisma.wpType.upsert({
        where:  { code: t.code },
        update: {},
        create: t,
      })
    )
  );
  console.log(`✅ WP Types seeded (${wpTypes.length})`);

  // ── USERS ──────────────────────────────────────────────────────────────────
  // All users: forcePasswordChange = true (must change on first login)
  // employeeId is the login field. email is optional (notifications only).

  type UserRow = {
    employeeId: string;
    name:       string;
    role:       string;
    division:   string;
    phone?:     string;
    password:   string;
  };

  const userData: UserRow[] = [
    // ── QCH ─────────────────────────────────────────────────────────────────
    { employeeId: 'VAE00071', name: 'Lê Viết Thành',           role: 'Director', division: 'QCH', phone: '0868325588', password: 'Abc@123' },
    { employeeId: 'VAE00483', name: 'Vũ Hồng Hải',             role: 'Manager',  division: 'QCH', phone: '0912233470', password: 'Abc@123' },
    { employeeId: 'VAE02285', name: 'Lê Xuân Anh',             role: 'Manager',  division: 'QCH', phone: '0983801230', password: 'Abc@123' },
    { employeeId: 'VAE00057', name: 'Chu Thế Cường',           role: 'Staff',    division: 'QCH', phone: '0983012228', password: 'Abc@123' },
    { employeeId: 'VAE02207', name: 'Lê Viết Dũng',            role: 'Staff',    division: 'QCH', phone: '0982455985', password: 'Abc@123' },
    { employeeId: 'VAE02250', name: 'Hoàng Đức Lâm',           role: 'Staff',    division: 'QCH', phone: '0987999545', password: 'Abc@123' },
    { employeeId: 'VAE02244', name: 'Nguyễn Gia Quỳnh',        role: 'Staff',    division: 'QCH', phone: '0979707986', password: 'Abc@123' },
    { employeeId: 'VAE02424', name: 'Lê Ngọc Hưng',            role: 'Staff',    division: 'QCH', phone: '0948680570', password: 'Abc@123' },
    { employeeId: 'VAE02431', name: 'Nguyễn Quốc Đức',         role: 'Staff',    division: 'QCH', phone: '0915071214', password: 'Abc@123' },
    { employeeId: 'VAE00560', name: 'Đào Văn Đức',             role: 'Staff',    division: 'QCH', phone: '0988456890', password: 'Abc@123' },
    { employeeId: 'VAE00534', name: 'Đinh Thanh Mạnh',         role: 'Staff',    division: 'QCH', phone: '0982217580', password: 'Abc@123' },
    { employeeId: 'VAE02562', name: 'Nguyễn Đăng Minh',        role: 'Staff',    division: 'QCH', phone: '0936208235', password: 'Abc@123' },
    { employeeId: 'VAE02205', name: 'Bùi Ngọc Đức',            role: 'Staff',    division: 'QCH', phone: '0912535966', password: 'Abc@123' },
    { employeeId: 'VAE02690', name: 'Trần Thanh Long',         role: 'Manager',  division: 'QCH', phone: '0902274888', password: 'Abc@123' },
    { employeeId: 'VAE02142', name: 'Nguyễn Văn Trọng',        role: 'Staff',    division: 'QCH', phone: '0869368368', password: 'Abc@123' },
    { employeeId: 'VAE02705', name: 'Bùi Hoài Nam',            role: 'Staff',    division: 'QCH', phone: '0914282004', password: 'Abc@123' },
    { employeeId: 'VAE00870', name: 'Tô Quang Hoàn',           role: 'Staff',    division: 'QCH', phone: '0902174567', password: 'Abc@123' },
    { employeeId: 'VAE02682', name: 'Vũ Ngọc Duy',             role: 'Staff',    division: 'QCH', phone: '0904001216', password: 'Abc@123' },
    { employeeId: 'VAE03594', name: 'Kim Anh Tú',              role: 'Staff',    division: 'QCH', phone: '0395295696', password: 'Abc@123' },
    { employeeId: 'VAE03073', name: 'Trần Mạnh Hùng',          role: 'Staff',    division: 'QCH', phone: '0969393626', password: 'Abc@123' },

    // ── QCS ─────────────────────────────────────────────────────────────────
    { employeeId: 'VAE02576', name: 'Võ Lục Nguyên Thông',     role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE00713', name: 'Trương Quảng Phú',        role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE01191', name: 'Trần Phương Nam',         role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE01202', name: 'Trần Phương',             role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE01267', name: 'Phạm Vương Quý',          role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE00087', name: 'Nguyễn Thế Khôi',         role: 'Manager',  division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE04091', name: 'Nguyễn Thái Thành',       role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE01363', name: 'Nguyễn Minh Việt',        role: 'Manager',  division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE00739', name: 'Nguyễn Khoa',             role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE00089', name: 'Nguyễn Công Toàn',        role: 'Manager',  division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE00098', name: 'Lê Thu Vân',              role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE02483', name: 'Lê Thanh Nga',            role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE02729', name: 'Hồ Nguyễn Bảo Phương',   role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE03546', name: 'Đỗ Ngọc Quỳnh Như',      role: 'Staff',    division: 'QCS', password: 'Abc@123' },
    { employeeId: 'VAE02578', name: 'Đỗ Hoàng Tuấn',          role: 'Staff',    division: 'QCS', password: 'Abc@123' },

    // ── QA ──────────────────────────────────────────────────────────────────
    { employeeId: 'VAE99999', name: 'Eve Admin',               role: 'Admin',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE02566', name: 'Trần Thị Kim Tú',         role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE00061', name: 'Trần Quốc Hải',           role: 'Manager',  division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE00548', name: 'Trần Quang Anh',          role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE03740', name: 'Phạm Thanh Tùng',         role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE00051', name: 'Nguyễn Việt Hồng',        role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE01514', name: 'Nguyễn Thị Thanh Thiêm', role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE00053', name: 'Nguyễn Minh Phương',      role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE04093', name: 'Nguyễn Hữu Đức',         role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE03211', name: 'Nguyễn Đức Dinh',         role: 'Manager',  division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE03215', name: 'Lê Văn Sơn',              role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE04092', name: 'Lê Huy Phúc',             role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE02442', name: 'Đoàn Văn Chung',          role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE03209', name: 'Đỗ Trường Sơn',           role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE03200', name: 'Đình Xuân Đài',           role: 'Staff',    division: 'QA',  password: 'Abc@123' },
    { employeeId: 'VAE02294', name: 'Bùi Thị Nhuận',           role: 'Staff',    division: 'QA',  password: 'Abc@123' },

    // ── KS ──────────────────────────────────────────────────────────────────
    { employeeId: 'VAE00049', name: 'Trương Kỳ Long',          role: 'Manager',  division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE02279', name: 'Trịnh Xuân Thắng',        role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE03267', name: 'Trần Minh Khôi',          role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE02918', name: 'Trần Hữu Tiến',           role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE03741', name: 'Trần Đình Dương',         role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE03991', name: 'Nguyễn Tiến Sơn',         role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE02676', name: 'Nguyễn Hùng Thắng',       role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE02960', name: 'Nguyễn Hoàng Anh',        role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE04004', name: 'Nguyễn Duy Khánh',        role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE03742', name: 'Nguyễn Đức Đông',         role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE00420', name: 'Nguyễn Đăng Tùng',        role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE02679', name: 'Lỗ Quang Nam',            role: 'Staff',    division: 'KS',  password: 'Abc@123' },
    { employeeId: 'VAE03210', name: 'Đỗ Hồng Hà',              role: 'Staff',    division: 'KS',  password: 'Abc@123' },
  ];

  // Hash all unique passwords upfront to avoid re-hashing duplicates
  const uniquePasswords = [...new Set(userData.map(u => u.password))];
  const hashCache: Record<string, string> = {};
  for (const pwd of uniquePasswords) {
    hashCache[pwd] = await bcrypt.hash(pwd, 10);
  }

  let created = 0;
  for (const u of userData) {
    await prisma.user.upsert({
      where:  { employeeId: u.employeeId },
      update: {},
      create: {
        employeeId:          u.employeeId,
        name:                u.name,
        ...(u.phone !== undefined && { phone: u.phone }),
        passwordHash:        hashCache[u.password]!,
        forcePasswordChange: false,
        divisionId:          divMap[u.division]!,
        roleId:              roleMap[u.role]!,
      },
    });
    created++;
  }
  console.log(`✅ Users seeded (${created})`);

  // ── FINDINGS TAXONOMY: ATA CHAPTERS ────────────────────────────────────────
  // ATA 100 chapter reference (common subset; admin-extendable via /api/taxonomy).
  const ataChapters = [
    { code: '05', title: 'Time Limits / Maintenance Checks' },
    { code: '12', title: 'Servicing' },
    { code: '20', title: 'Standard Practices — Airframe' },
    { code: '21', title: 'Air Conditioning' },
    { code: '22', title: 'Auto Flight' },
    { code: '23', title: 'Communications' },
    { code: '24', title: 'Electrical Power' },
    { code: '25', title: 'Equipment / Furnishings' },
    { code: '26', title: 'Fire Protection' },
    { code: '27', title: 'Flight Controls' },
    { code: '28', title: 'Fuel' },
    { code: '29', title: 'Hydraulic Power' },
    { code: '30', title: 'Ice & Rain Protection' },
    { code: '31', title: 'Indicating / Recording Systems' },
    { code: '32', title: 'Landing Gear' },
    { code: '33', title: 'Lights' },
    { code: '34', title: 'Navigation' },
    { code: '35', title: 'Oxygen' },
    { code: '36', title: 'Pneumatic' },
    { code: '38', title: 'Water / Waste' },
    { code: '49', title: 'Airborne Auxiliary Power (APU)' },
    { code: '51', title: 'Standard Practices & Structures — General' },
    { code: '52', title: 'Doors' },
    { code: '53', title: 'Fuselage' },
    { code: '54', title: 'Nacelles / Pylons' },
    { code: '55', title: 'Stabilizers' },
    { code: '56', title: 'Windows' },
    { code: '57', title: 'Wings' },
    { code: '71', title: 'Power Plant' },
    { code: '72', title: 'Engine' },
    { code: '73', title: 'Engine Fuel & Control' },
    { code: '74', title: 'Ignition' },
    { code: '79', title: 'Oil' },
    { code: '80', title: 'Starting' },
  ];
  await Promise.all(
    ataChapters.map(c =>
      prisma.ataChapter.upsert({ where: { code: c.code }, update: { title: c.title }, create: c })
    )
  );
  console.log(`✅ ATA chapters seeded (${ataChapters.length})`);

  // ── FINDINGS TAXONOMY: CAUSE CODES ─────────────────────────────────────────
  // Human-factors cause-code taxonomy (MEDA-style groups A–J). Source of truth
  // is prisma/data/causeCodes.json.
  type CauseCodeRow = { group_code: string; group_name: string; cause_code: string; cause_name: string };
  const causeCodeRows: CauseCodeRow[] = JSON.parse(
    readFileSync(path.join(__dirname, 'data', 'causeCodes.json'), 'utf-8')
  );
  for (const r of causeCodeRows) {
    await prisma.causeCode.upsert({
      where: { code: r.cause_code },
      update: { name: r.cause_name, groupCode: r.group_code, groupName: r.group_name },
      create: { code: r.cause_code, name: r.cause_name, groupCode: r.group_code, groupName: r.group_name },
    });
  }
  console.log(`✅ Cause codes seeded (${causeCodeRows.length})`);

  // ── FINDINGS TAXONOMY: HAZARD TAGS ─────────────────────────────────────────
  const hazardTags = [
    { label: 'FOD', description: 'Foreign Object Debris/Damage' },
    { label: 'Fatigue', description: 'Personnel fatigue contributing factor' },
    { label: 'Tooling Control', description: 'Tool accountability / calibration' },
    { label: 'Documentation', description: 'Documentation / record-keeping' },
    { label: 'Human Factors', description: 'Human-factors related hazard' },
    { label: 'Procedural Non-compliance', description: 'Procedure not followed' },
    { label: 'Environmental', description: 'Environmental / facility condition' },
    { label: 'Communication', description: 'Communication breakdown' },
    { label: 'Training Gap', description: 'Knowledge / training shortfall' },
    { label: 'Safety Critical', description: 'Directly affects flight safety' },
  ];
  await Promise.all(
    hazardTags.map(t =>
      prisma.hazardTag.upsert({ where: { label: t.label }, update: { description: t.description }, create: t })
    )
  );
  console.log(`✅ Hazard tags seeded (${hazardTags.length})`);

  // ── AVIATION DATA PLACEHOLDER ──────────────────────────────────────────────
  // AircraftTypes, Operators, Authorities, Registrations,
  // AuthTypes, UserAuthorizations — to be added in next seed update.
  console.log('⏭️  Aviation data skipped — will be seeded in next update');

  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('── Summary ──────────────────────────────────────────────');
  console.log('   Departments : 15');
  console.log('   Divisions   : 4  (QA, QCH, QCS, KS)');
  console.log(`   Users       : ${created}`);
  console.log('   Login field : employeeId  (e.g. VAE00071)');
  console.log('   Password    : Abc@123  (all users — must change on first login)');
  console.log('─────────────────────────────────────────────────────────');
}

main()
  .catch(e => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
