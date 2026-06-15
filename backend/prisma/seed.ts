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
import { seedPrivileges } from '../src/seeds/seed-privileges';

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

  // ── PRIVILEGES (Phase 7) ─────────────────────────────────────────────────────
  const privilegeCount = await seedPrivileges(prisma);
  console.log(`✅ Privilege configs seeded (${privilegeCount})`);

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
    { code: 'SURVEILLANCE',  description: 'Surveillance' },
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
        forcePasswordChange: true,
        divisionId:          divMap[u.division]!,
        roleId:              roleMap[u.role]!,
      },
    });
    created++;
  }
  console.log(`✅ Users seeded (${created})`);

  // ── GENERIC AD-HOC TASK TEMPLATE ───────────────────────────────────────────
  // System-seeded template that backs the "Quick Task" flow. Tasks are created
  // from this template by stable slug (GENERIC-ADHOC), never by numeric PK.
  // Must stay Published and non-archiving. Minimal formSchema (single free-text
  // instruction field) so ad-hoc tasks need no template builder.
  const adHocOwner = await prisma.user.findUnique({ where: { employeeId: 'VAE00071' } });
  if (adHocOwner) {
    await prisma.template.upsert({
      where:  { templateId: 'GENERIC-ADHOC' },
      update: {
        status:           'Published',
        requiresApproval: false,
      },
      create: {
        templateId:       'GENERIC-ADHOC',
        title:            'Generic Ad-Hoc Task',
        description:      'System template for ad-hoc / Quick Tasks. Do not delete.',
        status:           'Published',
        publishedAt:      new Date(),
        requiresApproval: false,
        allowsFindings:   true,
        skillLevel:       0,
        formSchema:       [{ id: 'instruction', type: 'textarea', label: 'Instruction / Note' }],
        ownerId:          adHocOwner.id,
        divisionId:       divMap['QA']!,
      },
    });
    console.log('✅ Generic Ad-Hoc Task template seeded (GENERIC-ADHOC)');
  } else {
    console.warn('⚠️  Director VAE00071 not found — skipped Generic Ad-Hoc template seed');
  }

  // ── FINDINGS TAXONOMY: EVENT TYPES ─────────────────────────────────────────
  // Finding event-type vocabulary. Admins can add more via /api/taxonomy.
  const eventTypes = [
    { code: 'Procedural Breach', description: 'Non-compliance with procedure' },
    { code: 'Equipment Fault', description: 'Equipment malfunction or defect' },
    { code: 'Documentation Error', description: 'Error in documentation or records' },
    { code: 'Maintenance Error', description: 'Maintenance execution error' },
    { code: 'Safety Observation', description: 'Observation related to safety' },
    { code: 'Regulatory Non-compliance', description: 'Non-compliance with regulations' },
    { code: 'Training Gap', description: 'Training or knowledge deficiency' },
    { code: 'Communication Failure', description: 'Communication or coordination failure' },
    { code: 'Other', description: 'Other / free-text entry' },
  ];
  await Promise.all(
    eventTypes.map(t =>
      prisma.eventType.upsert({ where: { code: t.code }, update: { description: t.description }, create: t })
    )
  );
  console.log(`✅ Event types seeded (${eventTypes.length})`);

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

  // ── SAMPLE FINDINGS ────────────────────────────────────────────────────────
  // 8 realistic findings across 2 divisions and all lifecycle statuses.
  // Idempotent: skips creation if a finding with the same description already exists.
  // Reporters / reviewers drawn from the seeded user roster.

  const findingReporterQCH = await prisma.user.findFirst({ where: { employeeId: 'VAE00057' } }); // Chu Thế Cường, Staff QCH
  const findingReporterQCS = await prisma.user.findFirst({ where: { employeeId: 'VAE02576' } }); // Võ Lục Nguyên Thông, Staff QCS
  const findingReviewerQCH = await prisma.user.findFirst({ where: { employeeId: 'VAE00483' } }); // Vũ Hồng Hải, Manager QCH
  const findingReviewerQCS = await prisma.user.findFirst({ where: { employeeId: 'VAE00087' } }); // Nguyễn Thế Khôi, Manager QCS
  const findingDirector    = await prisma.user.findFirst({ where: { employeeId: 'VAE00071' } }); // Lê Viết Thành, Director

  const ataLandingGear = await prisma.ataChapter.findUnique({ where: { code: '32' } });
  const ataStdPractice = await prisma.ataChapter.findUnique({ where: { code: '20' } });

  type SeedFinding = {
    description: string;
    eventType: string;
    status: string;
    severity: string | null;
    divisionCode: string;
    deptName: string;
    aircraftRegistration: string | null;
    dueDate: Date | null;
    closedAt: Date | null;
    createdAt: Date;
    ataCode: string | null;
    reporterId: number;
    closedById: number | null;
    feedEvents: string[];
  };

  if (findingReporterQCH && findingReporterQCS && findingReviewerQCH && findingReviewerQCS && findingDirector) {
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

    const seedFindings: SeedFinding[] = [
      // ── Open findings (freshly raised, not yet reviewed) ──
      {
        description: 'Torque wrench calibration record was missing for VN-A xxx engine run on line maintenance. Technician proceeded without verifying calibration status.',
        eventType: 'Procedural Breach',
        status: 'Open',
        severity: null,
        divisionCode: 'QCH',
        deptName: 'HAN BMC',
        aircraftRegistration: 'VN-A101',
        dueDate: null,
        closedAt: null,
        createdAt: daysAgo(5),
        ataCode: '20',
        reporterId: findingReporterQCH.id,
        closedById: null,
        feedEvents: ['Finding raised by Chu Thế Cường — Procedural Breach'],
      },
      {
        description: 'Component replacement record (P/N 5001-00-01) has an incorrect part number entry in the maintenance log for aircraft undergoing check at HCM base.',
        eventType: 'Documentation Error',
        status: 'Open',
        severity: null,
        divisionCode: 'QCS',
        deptName: 'HCM BMC',
        aircraftRegistration: 'VN-A205',
        dueDate: null,
        closedAt: null,
        createdAt: daysAgo(3),
        ataCode: null,
        reporterId: findingReporterQCS.id,
        closedById: null,
        feedEvents: ['Finding raised by Võ Lục Nguyên Thông — Documentation Error'],
      },

      // ── In Progress findings (reviewed, severity set) ──
      {
        description: 'Landing gear retraction test completed without required two-person verification. Only one engineer signed off on the test card.',
        eventType: 'Equipment Fault',
        status: 'In Progress',
        severity: 'Level 1',
        divisionCode: 'QCH',
        deptName: 'HAN RMC',
        aircraftRegistration: 'VN-A112',
        dueDate: daysAgo(-14), // 14 days from now
        closedAt: null,
        createdAt: daysAgo(10),
        ataCode: '32',
        reporterId: findingReporterQCH.id,
        closedById: null,
        feedEvents: [
          'Finding raised by Chu Thế Cường — Equipment Fault',
          'Finding reviewed by Vũ Hồng Hải — severity: Level 1',
        ],
      },
      {
        description: 'CASR Part 145.A.55 — maintenance record for engine borescope inspection was not transferred to aircraft technical log within the required 30-day window.',
        eventType: 'Regulatory Non-compliance',
        status: 'In Progress',
        severity: 'Level 2',
        divisionCode: 'QCS',
        deptName: 'HCM RMC',
        aircraftRegistration: 'VN-A311',
        dueDate: daysAgo(-7), // 7 days from now
        closedAt: null,
        createdAt: daysAgo(15),
        ataCode: null,
        reporterId: findingReporterQCS.id,
        closedById: null,
        feedEvents: [
          'Finding raised by Võ Lục Nguyên Thông — Regulatory Non-compliance',
          'Finding reviewed by Nguyễn Thế Khôi — severity: Level 2',
        ],
      },

      // ── Pending Verification findings ──
      {
        description: 'Hydraulic fluid level check interval exceeded by 3 days on line station aircraft. No adverse event occurred but procedure requires escalation.',
        eventType: 'Maintenance Error',
        status: 'Pending Verification',
        severity: 'Level 1',
        divisionCode: 'QCH',
        deptName: 'EGD',
        aircraftRegistration: null,
        dueDate: null,
        closedAt: null,
        createdAt: daysAgo(25),
        ataCode: '29',
        reporterId: findingReporterQCH.id,
        closedById: null,
        feedEvents: [
          'Finding raised by Chu Thế Cường — Maintenance Error',
          'Finding reviewed by Vũ Hồng Hải — severity: Level 1',
          'Finding advanced to Pending Verification by Vũ Hồng Hải',
        ],
      },
      {
        description: 'Ramp safety briefing was skipped for contract ground crew during pushback operations. Verbal warning issued on the spot; no incident.',
        eventType: 'Safety Observation',
        status: 'Pending Verification',
        severity: 'Observation',
        divisionCode: 'QCS',
        deptName: 'DAD BRANCH',
        aircraftRegistration: null,
        dueDate: null,
        closedAt: null,
        createdAt: daysAgo(20),
        ataCode: null,
        reporterId: findingReporterQCS.id,
        closedById: null,
        feedEvents: [
          'Finding raised by Võ Lục Nguyên Thông — Safety Observation',
          'Finding reviewed by Nguyễn Thế Khôi — severity: Observation',
          'Finding advanced to Pending Verification by Nguyễn Thế Khôi',
        ],
      },

      // ── Closed finding ──
      {
        description: 'Approved maintenance data (AMM 32-11-01 Rev.14) was not available at the work site. Technician used printed copy two revisions behind the current AMM.',
        eventType: 'Procedural Breach',
        status: 'Closed',
        severity: 'Level 2',
        divisionCode: 'QCH',
        deptName: 'HAN BMC',
        aircraftRegistration: 'VN-A098',
        dueDate: null,
        closedAt: daysAgo(2),
        createdAt: daysAgo(30),
        ataCode: '32',
        reporterId: findingReporterQCH.id,
        closedById: findingReviewerQCH.id,
        feedEvents: [
          'Finding raised by Chu Thế Cường — Procedural Breach',
          'Finding reviewed by Vũ Hồng Hải — severity: Level 2',
          'Finding advanced to Pending Verification by Vũ Hồng Hải',
          'Finding closed by Vũ Hồng Hải',
        ],
      },

      // ── Dismissed finding ──
      {
        description: 'Reported suspected fuel contamination on VN-A402 — subsequent lab analysis confirmed within spec. Finding raised in error by trainee technician.',
        eventType: 'Other',
        status: 'Dismissed',
        severity: null,
        divisionCode: 'QCS',
        deptName: 'HCM BMC',
        aircraftRegistration: 'VN-A402',
        dueDate: null,
        closedAt: null,
        createdAt: daysAgo(12),
        ataCode: null,
        reporterId: findingReporterQCS.id,
        closedById: null,
        feedEvents: [
          'Finding raised by Võ Lục Nguyên Thông — Other',
          'Finding dismissed by Nguyễn Thế Khôi: Lab result confirms fuel in-spec; finding not substantiated.',
        ],
      },
    ];

    let findingCount = 0;
    for (const sf of seedFindings) {
      // Idempotent: skip if a finding with this exact description already exists.
      const exists = await prisma.finding.findFirst({ where: { description: sf.description } });
      if (exists) continue;

      const ataChapter = sf.ataCode
        ? (sf.ataCode === '32' ? ataLandingGear : ataStdPractice)
        : null;

      const finding = await prisma.finding.create({
        data: {
          description:         sf.description,
          eventType:           sf.eventType,
          status:              sf.status,
          severity:            sf.severity,
          departmentId:        deptMap[sf.deptName]!,
          targetDivisionId:    divMap[sf.divisionCode]!,
          reportedByUserId:    sf.reporterId,
          closedByUserId:      sf.closedById,
          closedAt:            sf.closedAt,
          aircraftRegistration: sf.aircraftRegistration,
          ataChapterId:        ataChapter?.id ?? null,
          createdAt:           sf.createdAt,
          ...(sf.dueDate && { dueDate: sf.dueDate }),
        },
      });

      // Seed feed events (SYSTEM_EVENT) so the finding's feed history is visible
      // immediately, before any server-side writes occur via the live API.
      for (const content of sf.feedEvents) {
        await prisma.feedPost.create({
          data: {
            type:     'SYSTEM_EVENT',
            scope:    'FINDING',
            scopeId:  finding.id,
            content,
            authorId: null,
            createdAt: sf.createdAt, // align with finding creation date
          },
        });
      }

      findingCount++;
    }
    console.log(`✅ Sample findings seeded (${findingCount} new)`);
  } else {
    console.warn('⚠️  Sample findings skipped — required seed users not found');
  }

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

  // ── ShiftTypes ────────────────────────────────────────────────────────────
  // 85 working shifts from Excel (Phân Ca) + 6 off/trip codes.
  // Using createMany with skipDuplicates so re-running the seed is safe.
  const SHIFT_TYPES = [
    { code: "C1_1", name: "Ca 1 từ 04h00 – 12h00", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "04:00", endTime: "12:00", isWorkDay: true, sortOrder: 0 },
    { code: "C1_1TC", name: "Ca 1 từ 04h00 – 12h00 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "04:00", endTime: "12:00", isWorkDay: true, sortOrder: 1 },
    { code: "C1_2", name: "Ca 1 từ 06h00 – 14h00", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "06:00", endTime: "14:00", isWorkDay: true, sortOrder: 2 },
    { code: "C1_2TC", name: "Ca 1 từ 06h00 – 14h00 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "06:00", endTime: "14:00", isWorkDay: true, sortOrder: 3 },
    { code: "C1_3", name: "Ca 1 từ 07h00 - 16h00", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "07:00", endTime: "16:00", isWorkDay: true, sortOrder: 4 },
    { code: "C1_3TC", name: "Ca 1 từ 07h00 - 16h00 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "07:00", endTime: "16:00", isWorkDay: true, sortOrder: 5 },
    { code: "C1_4", name: "Ca 1 từ 09h00 - 17h00", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "09:00", endTime: "17:00", isWorkDay: true, sortOrder: 6 },
    { code: "C1_4TC", name: "Ca 1 từ 09h00 - 17h00 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "09:00", endTime: "17:00", isWorkDay: true, sortOrder: 7 },
    { code: "C1_5", name: "Ca 1 từ 09h00 – 18h00", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "09:00", endTime: "18:00", isWorkDay: true, sortOrder: 8 },
    { code: "C1_5TC", name: "Ca 1 từ 09h00 - 18h00 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "09:00", endTime: "18:00", isWorkDay: true, sortOrder: 9 },
    { code: "C1_6", name: "Ca 1 từ 10h00 – 18h00", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "10:00", endTime: "18:00", isWorkDay: true, sortOrder: 10 },
    { code: "C1_6TC", name: "Ca 1 từ 10h00 – 18h00 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "10:00", endTime: "18:00", isWorkDay: true, sortOrder: 11 },
    { code: "C1_7", name: "Ca 1 từ 12h00 – 20h00", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "12:00", endTime: "20:00", isWorkDay: true, sortOrder: 12 },
    { code: "C1_7TC", name: "Ca 1 từ 12h00 – 20h00 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "12:00", endTime: "20:00", isWorkDay: true, sortOrder: 13 },
    { code: "C1_8", name: "Ca 1 từ 13h00 – 21h00", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "13:00", endTime: "21:00", isWorkDay: true, sortOrder: 14 },
    { code: "C1_8TC", name: "Ca 1 từ 13h00 – 21h00 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "13:00", endTime: "21:00", isWorkDay: true, sortOrder: 15 },
    { code: "C1_9", name: "Ca 1 từ 13h30 – 21h30", groupCode: "C1", groupName: "Ca 1", color: "#3B82F6", startTime: "13:30", endTime: "21:30", isWorkDay: true, sortOrder: 16 },
    { code: "C1_9TC", name: "Ca 1 từ 13h30 – 21h30 - Tăng cường", groupCode: "C1-TC", groupName: "Ca 1 (Tăng cường)", color: "#93C5FD", startTime: "13:30", endTime: "21:30", isWorkDay: true, sortOrder: 17 },
    { code: "C2_1", name: "Ca 2 từ 14h00 – 22h00", groupCode: "C2", groupName: "Ca 2", color: "#10B981", startTime: "14:00", endTime: "22:00", isWorkDay: true, sortOrder: 18 },
    { code: "C2_1TC", name: "Ca 2 từ 14h00 – 22h00 - Tăng cường", groupCode: "C2-TC", groupName: "Ca 2 (Tăng cường)", color: "#6EE7B7", startTime: "14:00", endTime: "22:00", isWorkDay: true, sortOrder: 19 },
    { code: "C2_2", name: "Ca 2 từ 15h00-23h00", groupCode: "C2", groupName: "Ca 2", color: "#10B981", startTime: "15:00", endTime: "23:00", isWorkDay: true, sortOrder: 20 },
    { code: "C2_2TC", name: "Ca 2 từ 15h00-23h00 - Tăng cường", groupCode: "C2-TC", groupName: "Ca 2 (Tăng cường)", color: "#6EE7B7", startTime: "15:00", endTime: "23:00", isWorkDay: true, sortOrder: 21 },
    { code: "C2_3", name: "Ca 2 từ 16h00 – 24h00", groupCode: "C2", groupName: "Ca 2", color: "#10B981", startTime: "16:00", endTime: "00:00", isWorkDay: true, sortOrder: 22 },
    { code: "C2_3TC", name: "Ca 2 từ 16h00 – 24h00 - Tăng cường", groupCode: "C2-TC", groupName: "Ca 2 (Tăng cường)", color: "#6EE7B7", startTime: "16:00", endTime: "00:00", isWorkDay: true, sortOrder: 23 },
    { code: "C2_4", name: "Ca 2 từ 16h30 – 24h30", groupCode: "C2", groupName: "Ca 2", color: "#10B981", startTime: "16:30", endTime: "00:30", isWorkDay: true, sortOrder: 24 },
    { code: "C2_4TC", name: "Ca 2 từ 16h30 – 24h30 - Tăng cường", groupCode: "C2-TC", groupName: "Ca 2 (Tăng cường)", color: "#6EE7B7", startTime: "16:30", endTime: "00:30", isWorkDay: true, sortOrder: 25 },
    { code: "C2_5", name: "Ca 2 từ 17h00 – 01h00", groupCode: "C2", groupName: "Ca 2", color: "#10B981", startTime: "17:00", endTime: "01:00", isWorkDay: true, sortOrder: 26 },
    { code: "C2_5TC", name: "Ca 2 từ 17h00 – 01h00 - Tăng cường", groupCode: "C2-TC", groupName: "Ca 2 (Tăng cường)", color: "#6EE7B7", startTime: "17:00", endTime: "01:00", isWorkDay: true, sortOrder: 27 },
    { code: "C2_6", name: "Ca 2 từ 18h00 – 02h00", groupCode: "C2", groupName: "Ca 2", color: "#10B981", startTime: "18:00", endTime: "02:00", isWorkDay: true, sortOrder: 28 },
    { code: "C2_6TC", name: "Ca 2 từ 18h00 – 02h00 - Tăng cường", groupCode: "C2-TC", groupName: "Ca 2 (Tăng cường)", color: "#6EE7B7", startTime: "18:00", endTime: "02:00", isWorkDay: true, sortOrder: 29 },
    { code: "C2_7", name: "Ca 2 từ 20h00 – 04h00", groupCode: "C2", groupName: "Ca 2", color: "#10B981", startTime: "20:00", endTime: "04:00", isWorkDay: true, sortOrder: 30 },
    { code: "C2_7TC", name: "Ca 2 từ 20h00 – 04h00 - Tăng cường", groupCode: "C2-TC", groupName: "Ca 2 (Tăng cường)", color: "#6EE7B7", startTime: "20:00", endTime: "04:00", isWorkDay: true, sortOrder: 31 },
    { code: "C2_8", name: "Ca 2 từ 21h00 – 05h00", groupCode: "C2", groupName: "Ca 2", color: "#10B981", startTime: "21:00", endTime: "05:00", isWorkDay: true, sortOrder: 32 },
    { code: "C2_8TC", name: "Ca 2 từ 21h00 – 05h00 - Tăng cường", groupCode: "C2-TC", groupName: "Ca 2 (Tăng cường)", color: "#6EE7B7", startTime: "21:00", endTime: "05:00", isWorkDay: true, sortOrder: 33 },
    { code: "C3_2TC", name: "Ca 2 từ 23h00 – 07h00 - Tăng cường", groupCode: "C3-TC", groupName: "Ca 3 (Tăng cường)", color: "#C4B5FD", startTime: "23:00", endTime: "07:00", isWorkDay: true, sortOrder: 34 },
    { code: "C3_1", name: "Ca 3 từ 22h00 – 06h00", groupCode: "C3", groupName: "Ca 3", color: "#8B5CF6", startTime: "22:00", endTime: "06:00", isWorkDay: true, sortOrder: 35 },
    { code: "C3_TC", name: "Ca 3 từ 22h00 – 06h00 - Tăng cường", groupCode: "C3-TC", groupName: "Ca 3 (Tăng cường)", color: "#C4B5FD", startTime: "22:00", endTime: "06:00", isWorkDay: true, sortOrder: 36 },
    { code: "C3_2", name: "Ca 3 từ 23h00 – 07h00", groupCode: "C3", groupName: "Ca 3", color: "#8B5CF6", startTime: "23:00", endTime: "07:00", isWorkDay: true, sortOrder: 37 },
    { code: "C3_3", name: "Ca 3 từ 24h00 – 08h00", groupCode: "C3", groupName: "Ca 3", color: "#8B5CF6", startTime: "00:00", endTime: "08:00", isWorkDay: true, sortOrder: 38 },
    { code: "C3_3TC", name: "Ca 3 từ 24h00 – 08h00 - Tăng cường", groupCode: "C3-TC", groupName: "Ca 3 (Tăng cường)", color: "#C4B5FD", startTime: "00:00", endTime: "08:00", isWorkDay: true, sortOrder: 39 },
    { code: "CC_1", name: "Ca chiều từ 14h - 2h", groupCode: "CC", groupName: "Ca chiều", color: "#06B6D4", startTime: "14:00", endTime: "02:00", isWorkDay: true, sortOrder: 40 },
    { code: "CC_1TC", name: "Ca chiều từ 14h - 2h - Tăng cường", groupCode: "CC-TC", groupName: "Ca chiều (Tăng cường)", color: "#67E8F9", startTime: "14:00", endTime: "02:00", isWorkDay: true, sortOrder: 41 },
    { code: "CC_2", name: "Ca chiều từ 15h - 3h", groupCode: "CC", groupName: "Ca chiều", color: "#06B6D4", startTime: "15:00", endTime: "03:00", isWorkDay: true, sortOrder: 42 },
    { code: "CC_2TC", name: "Ca chiều từ 15h - 3h - Tăng cường", groupCode: "CC-TC", groupName: "Ca chiều (Tăng cường)", color: "#67E8F9", startTime: "15:00", endTime: "03:00", isWorkDay: true, sortOrder: 43 },
    { code: "CC_3", name: "Ca chiều từ 16h - 4h", groupCode: "CC", groupName: "Ca chiều", color: "#06B6D4", startTime: "16:00", endTime: "04:00", isWorkDay: true, sortOrder: 44 },
    { code: "CC_3TC", name: "Ca chiều từ 16h - 4h - Tăng cường", groupCode: "CC-TC", groupName: "Ca chiều (Tăng cường)", color: "#67E8F9", startTime: "16:00", endTime: "04:00", isWorkDay: true, sortOrder: 45 },
    { code: "CC_4", name: "Ca chiều từ 17h - 5h", groupCode: "CC", groupName: "Ca chiều", color: "#06B6D4", startTime: "17:00", endTime: "05:00", isWorkDay: true, sortOrder: 46 },
    { code: "CC_4TC", name: "Ca chiều từ 17h - 5h - Tăng cường", groupCode: "CC-TC", groupName: "Ca chiều (Tăng cường)", color: "#67E8F9", startTime: "17:00", endTime: "05:00", isWorkDay: true, sortOrder: 47 },
    { code: "CC_5", name: "Ca chiều từ 18h - 6h", groupCode: "CC", groupName: "Ca chiều", color: "#06B6D4", startTime: "18:00", endTime: "06:00", isWorkDay: true, sortOrder: 48 },
    { code: "CC_5TC", name: "Ca chiều từ 18h - 6h - Tăng cường", groupCode: "CC-TC", groupName: "Ca chiều (Tăng cường)", color: "#67E8F9", startTime: "18:00", endTime: "06:00", isWorkDay: true, sortOrder: 49 },
    { code: "CC_6", name: "Ca chiều từ 19h - 7h", groupCode: "CC", groupName: "Ca chiều", color: "#06B6D4", startTime: "19:00", endTime: "07:00", isWorkDay: true, sortOrder: 50 },
    { code: "CC_6TC", name: "Ca chiều từ 19h - 7h - Tăng cường", groupCode: "CC-TC", groupName: "Ca chiều (Tăng cường)", color: "#67E8F9", startTime: "19:00", endTime: "07:00", isWorkDay: true, sortOrder: 51 },
    { code: "CC_7", name: "Ca chiều từ 19h30 - 7h30", groupCode: "CC", groupName: "Ca chiều", color: "#06B6D4", startTime: "19:30", endTime: "07:30", isWorkDay: true, sortOrder: 52 },
    { code: "CC_7TC", name: "Ca chiều từ 19h30 - 7h30 - Tăng cường", groupCode: "CC-TC", groupName: "Ca chiều (Tăng cường)", color: "#67E8F9", startTime: "19:30", endTime: "07:30", isWorkDay: true, sortOrder: 53 },
    { code: "CC_8", name: "Ca chiều từ 20h - 8h", groupCode: "CC", groupName: "Ca chiều", color: "#06B6D4", startTime: "20:00", endTime: "08:00", isWorkDay: true, sortOrder: 54 },
    { code: "CC_8TC", name: "Ca chiều từ 20h - 8h - Tăng cường", groupCode: "CC-TC", groupName: "Ca chiều (Tăng cường)", color: "#67E8F9", startTime: "20:00", endTime: "08:00", isWorkDay: true, sortOrder: 55 },
    { code: "DB_1", name: "Ca đặc biệt 1 (VP-Lái xe đưa đón CBCNV ca sáng và ca chiều)", groupCode: "DB_1", groupName: "Đặc biệt 1", color: "#EC4899", startTime: "04:00", endTime: "12:00", isWorkDay: true, sortOrder: 56 },
    { code: "DB_2", name: "Ca đặc biệt 2 (DAD)", groupCode: "DB_2", groupName: "Đặc biệt 2", color: "#F9A8D4", startTime: "07:30", endTime: "16:30", isWorkDay: true, sortOrder: 57 },
    { code: "HC", name: "Ca hành chính 07h30 – 16h30", groupCode: "HC", groupName: "Hành chính", color: "#6B7280", startTime: "07:30", endTime: "16:30", isWorkDay: true, sortOrder: 58 },
    { code: "HC_TC", name: "Ca hành chính 07h30 – 16h30 - Tăng cường", groupCode: "HC-TC", groupName: "Hành chính (Tăng cường)", color: "#D1D5DB", startTime: "07:30", endTime: "16:30", isWorkDay: true, sortOrder: 59 },
    { code: "CS_9TC", name: "Ca sáng từ 10 - 22h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "10:00", endTime: "22:00", isWorkDay: true, sortOrder: 60 },
    { code: "CS_9", name: "Ca sáng từ 10h - 22h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "10:00", endTime: "22:00", isWorkDay: true, sortOrder: 61 },
    { code: "CS_10", name: "Ca sáng từ 12h - 24h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "12:00", endTime: "00:00", isWorkDay: true, sortOrder: 62 },
    { code: "CS_10TC", name: "Ca sáng từ 12h - 24h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "12:00", endTime: "00:00", isWorkDay: true, sortOrder: 63 },
    { code: "CS_1", name: "Ca sáng từ 3h - 15h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "03:00", endTime: "15:00", isWorkDay: true, sortOrder: 64 },
    { code: "CS_1TC", name: "Ca sáng từ 3h - 15h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "03:00", endTime: "15:00", isWorkDay: true, sortOrder: 65 },
    { code: "CS_2", name: "Ca sáng từ 4h - 16h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "04:00", endTime: "16:00", isWorkDay: true, sortOrder: 66 },
    { code: "CS_2TC", name: "Ca sáng từ 4h - 16h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "04:00", endTime: "16:00", isWorkDay: true, sortOrder: 67 },
    { code: "CS_3", name: "Ca sáng từ 5h - 17h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "05:00", endTime: "17:00", isWorkDay: true, sortOrder: 68 },
    { code: "CS_3TC", name: "Ca sáng từ 5h - 17h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "05:00", endTime: "17:00", isWorkDay: true, sortOrder: 69 },
    { code: "CS_4", name: "Ca sáng từ 6h - 18h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "06:00", endTime: "18:00", isWorkDay: true, sortOrder: 70 },
    { code: "CS_4TC", name: "Ca sáng từ 6h - 18h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "06:00", endTime: "18:00", isWorkDay: true, sortOrder: 71 },
    { code: "CS_5", name: "Ca sáng từ 7h - 19h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "07:00", endTime: "19:00", isWorkDay: true, sortOrder: 72 },
    { code: "CS_5TC", name: "Ca sáng từ 7h - 19h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "07:00", endTime: "19:00", isWorkDay: true, sortOrder: 73 },
    { code: "CS_6", name: "Ca sáng từ 7h30 - 19h30", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "07:30", endTime: "19:30", isWorkDay: true, sortOrder: 74 },
    { code: "CS_6TC", name: "Ca sáng từ 7h30 - 19h30 - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "07:30", endTime: "19:30", isWorkDay: true, sortOrder: 75 },
    { code: "CS_7", name: "Ca sáng từ 8h - 20h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "08:00", endTime: "20:00", isWorkDay: true, sortOrder: 76 },
    { code: "CS_7TC", name: "Ca sáng từ 8h - 20h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "08:00", endTime: "20:00", isWorkDay: true, sortOrder: 77 },
    { code: "CS_8", name: "Ca sáng từ 9h - 21h", groupCode: "CS", groupName: "Ca sáng", color: "#F59E0B", startTime: "09:00", endTime: "21:00", isWorkDay: true, sortOrder: 78 },
    { code: "CS_8TC", name: "Ca sáng từ 9h - 21h - Tăng cường", groupCode: "CS-TC", groupName: "Ca sáng (Tăng cường)", color: "#FCD34D", startTime: "09:00", endTime: "21:00", isWorkDay: true, sortOrder: 79 },
    { code: "H2", name: "Công học hưởng công tác phí (chấm được vân tay)", groupCode: "H2", groupName: "Công học (có CT phí, có vân tay)", color: "#7C3AED", startTime: "07:30", endTime: "16:30", isWorkDay: true, sortOrder: 80 },
    { code: "H2_1", name: "Công học hưởng công tác phí (không chấm được vân tay)", groupCode: "H2_1", groupName: "Công học (có CT phí, không vân tay)", color: "#C4B5FD", startTime: "07:30", endTime: "16:30", isWorkDay: true, sortOrder: 81 },
    { code: "H1", name: "Công học không hưởng công tác phí (chấm được vân tay)", groupCode: "H1", groupName: "Công học (không CT phí, có vân tay)", color: "#6366F1", startTime: "07:30", endTime: "16:30", isWorkDay: true, sortOrder: 82 },
    { code: "H1_1", name: "Công học không hưởng công tác phí (không chấm được vân tay)", groupCode: "H1_1", groupName: "Công học (không CT phí, không vân tay)", color: "#A5B4FC", startTime: "07:30", endTime: "16:30", isWorkDay: true, sortOrder: 83 },
    { code: "GD", name: "GD (Giáo viên giảng dạy chấm được vân tay)", groupCode: "GD", groupName: "Giáo viên giảng dạy", color: "#D97706", startTime: "07:30", endTime: "16:30", isWorkDay: true, sortOrder: 84 },
    // Off / leave types — isWorkDay: false → triggers conflict warnings
    { code: "B", name: "Nghỉ bệnh", groupCode: "OFF", groupName: "Nghỉ", color: "#EF4444", startTime: null, endTime: null, isWorkDay: false, sortOrder: 85 },
    { code: "F", name: "Nghỉ phép", groupCode: "OFF", groupName: "Nghỉ", color: "#F97316", startTime: null, endTime: null, isWorkDay: false, sortOrder: 86 },
    { code: "O", name: "Nghỉ", groupCode: "OFF", groupName: "Nghỉ", color: "#6B7280", startTime: null, endTime: null, isWorkDay: false, sortOrder: 87 },
    { code: "R", name: "Nghỉ bù", groupCode: "OFF", groupName: "Nghỉ", color: "#9CA3AF", startTime: null, endTime: null, isWorkDay: false, sortOrder: 88 },
    // Business trip — isWorkDay: true (still working, just traveling)
    { code: "CTn", name: "Công tác trong nước", groupCode: "CT", groupName: "Công tác", color: "#7C3AED", startTime: null, endTime: null, isWorkDay: true, sortOrder: 89 },
    { code: "CTt", name: "Công tác nước ngoài", groupCode: "CT", groupName: "Công tác", color: "#5B21B6", startTime: null, endTime: null, isWorkDay: true, sortOrder: 90 },
  ];

  const { count: shiftCount } = await prisma.shiftType.createMany({ data: SHIFT_TYPES, skipDuplicates: true });
  console.log(`   ShiftTypes  : ${shiftCount} seeded (91 total — ${SHIFT_TYPES.length - shiftCount} already existed)`);
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
