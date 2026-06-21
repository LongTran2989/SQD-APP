// backend/prisma/seed.ts
// -----------------------------------------------------------------------
// Updated from seed data spreadsheet — 2026-06-15
// Departments: 16 | Divisions: 4 | Users: 57 + 1 admin
// Aviation: 15 AircraftTypes | 45 Operators | 13 Authorities
//          419 Registrations | 10 AuthorizationTypes
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
import * as bcrypt from 'bcrypt';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import 'dotenv/config';
import { seedPrivileges } from '../src/seeds/seed-privileges';
import { FILE_UPLOAD_CONFIG_KEY, DEFAULT_FILE_UPLOAD_CONFIG } from '../src/constants/fileUpload';

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
    prisma.role.upsert({ where: { name: 'Senior Advisor'}, update: {}, create: { name: 'Senior Advisor'} }),
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
    'HRD', 'TC', 'ADM', 'HCM BRANCH', 'EXTERNAL_COMPANY', 'EXTERNAL_AUTHORITY',
  ];

  // Rename legacy 'EXTERNAL' → 'EXTERNAL_COMPANY' if it still exists
  await prisma.department.updateMany({
    where: { name: 'EXTERNAL' },
    data:  { name: 'EXTERNAL_COMPANY' },
  }).catch(() => { /* ignore */ });

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
    { name: 'Director board',              code: 'BOD', department: 'SQD' },
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

  // Admin-configurable file-upload policy (Rule 10). Seeded from the defaults in
  // src/constants/fileUpload.ts (mirrors CLAUDE_HANDOVER.md §3.5). Idempotent —
  // `update: {}` never clobbers an Admin's customised value.
  await prisma.systemSetting.upsert({
    where:  { key: FILE_UPLOAD_CONFIG_KEY },
    update: {},
    create: {
      key:         FILE_UPLOAD_CONFIG_KEY,
      value:       JSON.stringify(DEFAULT_FILE_UPLOAD_CONFIG),
      description: 'Allowed file types and size limits for uploads (per-category + total per record).',
    },
  });
  console.log('✅ System settings seeded');

  // ── NOTIFICATION EVENT CONFIG ────────────────────────────────────────────────
  // Seed the configurable event classes at their defaults (enabled, no CC).
  // Defaults are also merged at read time, so this is purely to populate the
  // Settings → Notifications panel on first load.
  const notificationEventKeys = [
    'TASK_ASSIGNED',
    'TASK_SUBMITTED',
    'TASK_REVIEWED',
    'FINDING_CREATED',
    'ESCALATION_QUEUED',
    'FEED_ACTIVITY_TASK',
    'FEED_ACTIVITY_WP',
  ];
  await Promise.all(
    notificationEventKeys.map((eventKey) =>
      prisma.notificationEventConfig.upsert({
        where:  { eventKey },
        update: {},
        create: { eventKey, enabled: true, ccManagers: false },
      })
    )
  );
  console.log(`✅ Notification event config seeded (${notificationEventKeys.length})`);

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
    // ── BOD ─────────────────────────────────────────────────────────────────
    { employeeId: 'VAE00071', name: 'Lê Viết Thành',           role: 'Director', division: 'BOD', phone: '0868325588', password: 'Abc@12345' },
    { employeeId: 'VAE99999', name: 'Eve Admin',               role: 'Admin',    division: 'BOD', password: 'Abc@12345' },
    { employeeId: 'VAE00048', name: 'Hà Tiến Dũng',            role: 'Senior Advisor', division: 'BOD', password: 'Abc@12345' },

    // ── QCH ─────────────────────────────────────────────────────────────────
    { employeeId: 'VAE00483', name: 'Vũ Hồng Hải',             role: 'Manager',  division: 'QCH', phone: '0912233470', password: 'Abc@12345' },
    { employeeId: 'VAE02285', name: 'Lê Xuân Anh',             role: 'Manager',  division: 'QCH', phone: '0983801230', password: 'Abc@12345' },
    { employeeId: 'VAE00057', name: 'Chu Thế Cường',           role: 'Staff',    division: 'QCH', phone: '0983012228', password: 'Abc@12345' },
    { employeeId: 'VAE02207', name: 'Lê Viết Dũng',            role: 'Staff',    division: 'QCH', phone: '0982455985', password: 'Abc@12345' },
    { employeeId: 'VAE02250', name: 'Hoàng Đức Lâm',           role: 'Staff',    division: 'QCH', phone: '0987999545', password: 'Abc@12345' },
    { employeeId: 'VAE02244', name: 'Nguyễn Gia Quỳnh',        role: 'Staff',    division: 'QCH', phone: '0979707986', password: 'Abc@12345' },
    { employeeId: 'VAE02424', name: 'Lê Ngọc Hưng',            role: 'Staff',    division: 'QCH', phone: '0948680570', password: 'Abc@12345' },
    { employeeId: 'VAE02431', name: 'Nguyễn Quốc Đức',         role: 'Staff',    division: 'QCH', phone: '0915071214', password: 'Abc@12345' },
    { employeeId: 'VAE00560', name: 'Đào Văn Đức',             role: 'Staff',    division: 'QCH', phone: '0988456890', password: 'Abc@12345' },
    { employeeId: 'VAE00534', name: 'Đinh Thanh Mạnh',         role: 'Staff',    division: 'QCH', phone: '0982217580', password: 'Abc@12345' },
    { employeeId: 'VAE02562', name: 'Nguyễn Đăng Minh',        role: 'Staff',    division: 'QCH', phone: '0936208235', password: 'Abc@12345' },
    { employeeId: 'VAE02205', name: 'Bùi Ngọc Đức',            role: 'Staff',    division: 'QCH', phone: '0912535966', password: 'Abc@12345' },
    { employeeId: 'VAE02690', name: 'Trần Thanh Long',         role: 'Manager',  division: 'QCH', phone: '0902274888', password: 'Abc@12345' },
    { employeeId: 'VAE02142', name: 'Nguyễn Văn Trọng',        role: 'Staff',    division: 'QCH', phone: '0869368368', password: 'Abc@12345' },
    { employeeId: 'VAE02705', name: 'Bùi Hoài Nam',            role: 'Staff',    division: 'QCH', phone: '0914282004', password: 'Abc@12345' },
    { employeeId: 'VAE00870', name: 'Tô Quang Hoàn',           role: 'Staff',    division: 'QCH', phone: '0902174567', password: 'Abc@12345' },
    { employeeId: 'VAE02682', name: 'Vũ Ngọc Duy',             role: 'Staff',    division: 'QCH', phone: '0904001216', password: 'Abc@12345' },
    { employeeId: 'VAE03594', name: 'Kim Anh Tú',              role: 'Staff',    division: 'QCH', phone: '0395295696', password: 'Abc@12345' },
    { employeeId: 'VAE03073', name: 'Trần Mạnh Hùng',          role: 'Staff',    division: 'QCH', phone: '0969393626', password: 'Abc@12345' },

    // ── QCS ─────────────────────────────────────────────────────────────────
    { employeeId: 'VAE02576', name: 'Võ Lục Nguyên Thông',     role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE00713', name: 'Trương Quảng Phú',        role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE01191', name: 'Trần Phương Nam',         role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE01202', name: 'Trần Phương',             role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE01267', name: 'Phạm Vương Quý',          role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE00087', name: 'Nguyễn Thế Khôi',         role: 'Manager',  division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE04091', name: 'Nguyễn Thái Thành',       role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE01363', name: 'Nguyễn Minh Việt',        role: 'Manager',  division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE00739', name: 'Nguyễn Khoa',             role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE00089', name: 'Nguyễn Công Toàn',        role: 'Manager',  division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE00098', name: 'Lê Thu Vân',              role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE02483', name: 'Lê Thanh Nga',            role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE02729', name: 'Hồ Nguyễn Bảo Phương',   role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE03546', name: 'Đỗ Ngọc Quỳnh Như',      role: 'Staff',    division: 'QCS', password: 'Abc@12345' },
    { employeeId: 'VAE02578', name: 'Đỗ Hoàng Tuấn',          role: 'Staff',    division: 'QCS', password: 'Abc@12345' },

    // ── QA ──────────────────────────────────────────────────────────────────
    { employeeId: 'VAE02566', name: 'Trần Thị Kim Tú',         role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE00061', name: 'Trần Quốc Hải',           role: 'Manager',  division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE00548', name: 'Trần Quang Anh',          role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE03740', name: 'Phạm Thanh Tùng',         role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE00051', name: 'Nguyễn Việt Hồng',        role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE01514', name: 'Nguyễn Thị Thanh Thiêm', role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE00053', name: 'Nguyễn Minh Phương',      role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE04093', name: 'Nguyễn Hữu Đức',         role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE03211', name: 'Nguyễn Đức Dinh',         role: 'Manager',  division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE03215', name: 'Lê Văn Sơn',              role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE04092', name: 'Lê Huy Phúc',             role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE02442', name: 'Đoàn Văn Chung',          role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE03209', name: 'Đỗ Trường Sơn',           role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE03200', name: 'Đình Xuân Đài',           role: 'Staff',    division: 'QA',  password: 'Abc@12345' },
    { employeeId: 'VAE02294', name: 'Bùi Thị Nhuận',           role: 'Staff',    division: 'QA',  password: 'Abc@12345' },

    // ── KS ──────────────────────────────────────────────────────────────────
    { employeeId: 'VAE00049', name: 'Trương Kỳ Long',          role: 'Manager',  division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE02279', name: 'Trịnh Xuân Thắng',        role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE03267', name: 'Trần Minh Khôi',          role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE02918', name: 'Trần Hữu Tiến',           role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE03741', name: 'Trần Đình Dương',         role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE03991', name: 'Nguyễn Tiến Sơn',         role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE02676', name: 'Nguyễn Hùng Thắng',       role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE02960', name: 'Nguyễn Hoàng Anh',        role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE04004', name: 'Nguyễn Duy Khánh',        role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE03742', name: 'Nguyễn Đức Đông',         role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE00420', name: 'Nguyễn Đăng Tùng',        role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE02679', name: 'Lỗ Quang Nam',            role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
    { employeeId: 'VAE03210', name: 'Đỗ Hồng Hà',              role: 'Staff',    division: 'KS',  password: 'Abc@12345' },
  ];

  // Hash all unique passwords upfront to avoid re-hashing duplicates
  const uniquePasswords = [...new Set(userData.map(u => u.password))];
  const hashCache: Record<string, string> = {};
  for (const pwd of uniquePasswords) {
    hashCache[pwd] = await bcrypt.hash(pwd, 10);
  }

  let created = 0;
  for (const u of userData) {
    // Re-running the seed (e.g. every deploy.sh redeploy) must NOT touch an
    // existing user's credentials — only the first-ever insert sets the seed
    // password. Without this, anyone who already changed their password gets
    // silently reset to the default on the next redeploy.
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

  // ── AVIATION DATA ──────────────────────────────────────────────────────────
  type AviationData = {
    operators:          { iataCode: string; name: string }[];
    authorities:        { code: string; fullName: string }[];
    aircraftTypes:      string[];
    authorizationTypes: { code: string; description: string; category: string }[];
    registrations: {
      registration:     string;
      description:      string | null;
      serialNumber:     string | null;
      status:           string;
      aircraftTypeCode: string | null;
      operatorCode:     string | null;
      authorityCode:    string | null;
    }[];
  };

  const aviationData: AviationData = JSON.parse(
    readFileSync(path.join(__dirname, 'data', 'aviationData.json'), 'utf-8')
  );

  await Promise.all(
    aviationData.operators.map(o =>
      prisma.operator.upsert({ where: { iataCode: o.iataCode }, update: { name: o.name }, create: o })
    )
  );
  console.log(`✅ Operators seeded (${aviationData.operators.length})`);

  await Promise.all(
    aviationData.authorities.map(a =>
      prisma.authority.upsert({ where: { code: a.code }, update: { fullName: a.fullName }, create: a })
    )
  );
  console.log(`✅ Authorities seeded (${aviationData.authorities.length})`);

  await Promise.all(
    aviationData.aircraftTypes.map(code =>
      prisma.aircraftType.upsert({ where: { code }, update: {}, create: { code } })
    )
  );
  console.log(`✅ Aircraft types seeded (${aviationData.aircraftTypes.length})`);

  await Promise.all(
    aviationData.authorizationTypes.map(t =>
      prisma.authorizationType.upsert({
        where:  { code: t.code },
        update: { description: t.description, category: t.category },
        create: t,
      })
    )
  );
  console.log(`✅ Authorization types seeded (${aviationData.authorizationTypes.length})`);

  // Build sets of known codes for null-guarding orphan FK references
  const knownOperators  = new Set(aviationData.operators.map(o => o.iataCode));
  const knownAuthorities = new Set(aviationData.authorities.map(a => a.code));
  const knownAcTypes    = new Set(aviationData.aircraftTypes);

  for (const r of aviationData.registrations) {
    await prisma.aircraftRegistration.upsert({
      where:  { registration: r.registration },
      update: {
        description:      r.description,
        serialNumber:     r.serialNumber,
        status:           r.status,
        aircraftTypeCode: r.aircraftTypeCode && knownAcTypes.has(r.aircraftTypeCode) ? r.aircraftTypeCode : null,
        operatorCode:     r.operatorCode  && knownOperators.has(r.operatorCode)   ? r.operatorCode  : null,
        authorityCode:    r.authorityCode && knownAuthorities.has(r.authorityCode) ? r.authorityCode : null,
      },
      create: {
        registration:     r.registration,
        description:      r.description,
        serialNumber:     r.serialNumber,
        status:           r.status,
        aircraftTypeCode: r.aircraftTypeCode && knownAcTypes.has(r.aircraftTypeCode) ? r.aircraftTypeCode : null,
        operatorCode:     r.operatorCode  && knownOperators.has(r.operatorCode)   ? r.operatorCode  : null,
        authorityCode:    r.authorityCode && knownAuthorities.has(r.authorityCode) ? r.authorityCode : null,
      },
    });
  }
  console.log(`✅ Aircraft registrations seeded (${aviationData.registrations.length})`);

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
    aircraftRegistrationCode: string | null;
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
        aircraftRegistrationCode: 'A323',
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
        aircraftRegistrationCode: 'A324',
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
        aircraftRegistrationCode: 'A325',
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
        aircraftRegistrationCode: 'A886',
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
        aircraftRegistrationCode: null,
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
        aircraftRegistrationCode: null,
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
        aircraftRegistrationCode: 'A326',
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
        aircraftRegistrationCode: 'A327',
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
          aircraftRegistrationCode: sf.aircraftRegistrationCode,
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
  console.log('   Departments    : 16');
  console.log('   Divisions      : 4  (QA, QCH, QCS, KS)');
  console.log(`   Users          : ${created}`);
  console.log('   Operators      : 45');
  console.log('   Authorities    : 13');
  console.log('   Aircraft Types : 15');
  console.log('   Registrations  : 419');
  console.log('   Auth Types     : 10');
  console.log('   Login field    : employeeId  (e.g. VAE00071)');
  console.log('   Password       : Abc@12345  (all users — must change on first login)');
  console.log('─────────────────────────────────────────────────────────');

  // ── EXCEL TEMPLATES ───────────────────────────────────────────────────────
  // Runs seed-templates.ts as a child process so it has its own Prisma client
  // (avoids pool conflicts) and its errors don't abort the main seed.
  console.log('');
  console.log('── Excel Template Seed ───────────────────────────────────');
  try {
    execSync(
      `node node_modules/ts-node/dist/bin.js prisma/seed-templates.ts`,
      { stdio: 'inherit', cwd: __dirname + '/..' }
    );
  } catch (e) {
    console.warn('⚠️  Template seed encountered an error (non-fatal). Check output above.');
  }

  // ── EXCEL TEMPLATE SETS & WP BLUEPRINTS ───────────────────────────────────
  // Must run after seed-templates.ts — resolves TemplateRef/SetRef references
  // against the templates that script just created.
  console.log('');
  console.log('── Excel Template Set & WP Blueprint Seed ────────────────');
  try {
    execSync(
      `node node_modules/ts-node/dist/bin.js prisma/seed-blueprints.ts`,
      { stdio: 'inherit', cwd: __dirname + '/..' }
    );
  } catch (e) {
    console.warn('⚠️  Template set / WP blueprint seed encountered an error (non-fatal). Check output above.');
  }
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
