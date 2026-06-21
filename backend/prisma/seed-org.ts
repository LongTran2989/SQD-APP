// backend/prisma/seed-org.ts
// -----------------------------------------------------------------------
// Bulk-seeds Departments, Divisions, Users, and the GENERIC-ADHOC system
// template from seed_data.xlsx. Runs before seed-reference.ts (which needs
// Divisions to exist) and before seed-templates.ts (which needs a Division +
// a Director user to seed against).
//
// HOW TO RUN (from inside /backend):
//   node_modules/.bin/ts-node prisma/seed-org.ts
//   (this script is automatically called at the start of seed.ts)
//
// EXCEL FORMAT — Sheet "Departments":
//   Name
//
// EXCEL FORMAT — Sheet "Divisions":
//   Code | Name | Department
//
// EXCEL FORMAT — Sheet "Users":
//   EmployeeId | Name | Role | Division | Phone | Password
//
//   Role must match an existing Role name (Director/Admin/Manager/Group
//   Leader/Staff/Senior Advisor — seeded by seed.ts before this script runs).
//   Division must match an existing Division code (seeded earlier in this
//   same script).
//
//   On conflict (existing EmployeeId): Name/Phone/Division/Role are updated
//   so a typo is fixable pre-prod. Password and ForcePasswordChange are NEVER
//   touched after first creation — re-running this seed must never reset a
//   user's real password back to the sheet default.
// -----------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as XLSX from 'xlsx';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXCEL_PATH = path.join(__dirname, '..', 'seed_data.xlsx');

const COL = {
  departments: { name: 'Name' },
  divisions: { code: 'Code', name: 'Name', department: 'Department' },
  users: {
    employeeId: 'EmployeeId',
    name: 'Name',
    role: 'Role',
    division: 'Division',
    phone: 'Phone',
    password: 'Password',
  },
};

interface RawDepartmentRow {
  name: string;
}

interface RawDivisionRow {
  code: string;
  name: string;
  departmentName: string;
}

interface RawUserRow {
  employeeId: string;
  name: string;
  role: string;
  divisionCode: string;
  phone: string | null;
  password: string;
}

function parseDepartmentsSheet(ws: XLSX.WorkSheet): RawDepartmentRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const results: RawDepartmentRow[] = [];
  for (const row of rows) {
    const name = String(row[COL.departments.name] ?? '').trim();
    if (!name) continue;
    results.push({ name });
  }
  return results;
}

function parseDivisionsSheet(ws: XLSX.WorkSheet): RawDivisionRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const results: RawDivisionRow[] = [];
  for (const row of rows) {
    const code = String(row[COL.divisions.code] ?? '').trim();
    if (!code) continue;
    const name = String(row[COL.divisions.name] ?? '').trim();
    if (!name) {
      console.warn(`  ⚠️  Division code "${code}" has no Name — skipped`);
      continue;
    }
    const departmentName = String(row[COL.divisions.department] ?? '').trim();
    if (!departmentName) {
      console.warn(`  ⚠️  Division code "${code}" has no Department — skipped`);
      continue;
    }
    results.push({ code, name, departmentName });
  }
  return results;
}

function parseUsersSheet(ws: XLSX.WorkSheet): RawUserRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const results: RawUserRow[] = [];
  for (const row of rows) {
    const employeeId = String(row[COL.users.employeeId] ?? '').trim();
    if (!employeeId) continue;
    const name = String(row[COL.users.name] ?? '').trim();
    if (!name) {
      console.warn(`  ⚠️  EmployeeId "${employeeId}" has no Name — skipped`);
      continue;
    }
    const role = String(row[COL.users.role] ?? '').trim();
    if (!role) {
      console.warn(`  ⚠️  EmployeeId "${employeeId}" has no Role — skipped`);
      continue;
    }
    const divisionCode = String(row[COL.users.division] ?? '').trim();
    if (!divisionCode) {
      console.warn(`  ⚠️  EmployeeId "${employeeId}" has no Division — skipped`);
      continue;
    }
    const password = String(row[COL.users.password] ?? '').trim();
    if (!password) {
      console.warn(`  ⚠️  EmployeeId "${employeeId}" has no Password — skipped`);
      continue;
    }
    const phone = String(row[COL.users.phone] ?? '').trim() || null;

    results.push({ employeeId, name, role, divisionCode, phone, password });
  }
  return results;
}

async function main() {
  console.log('🌱 Seeding org data (Departments / Divisions / Users) from Excel...');
  console.log(`   File: ${EXCEL_PATH}\n`);

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(EXCEL_PATH);
  } catch {
    console.error(`❌ Cannot open Excel file at:\n   ${EXCEL_PATH}`);
    process.exit(1);
  }

  for (const sheet of ['Departments', 'Divisions', 'Users']) {
    if (!wb.SheetNames.includes(sheet)) {
      console.error(`❌ Excel must contain a "${sheet}" sheet`);
      process.exit(1);
    }
  }

  // ── DEPARTMENTS ──────────────────────────────────────────────────────────
  const departmentRows = parseDepartmentsSheet(wb.Sheets['Departments']!);
  console.log(`   Parsed ${departmentRows.length} department row(s)`);

  const departments = await Promise.all(
    departmentRows.map((d) =>
      prisma.department.upsert({
        where: { name: d.name },
        update: { name: d.name },
        create: { name: d.name },
      })
    )
  );
  const deptMap = new Map(departments.map((d) => [d.name, d]));
  console.log(`✅ Departments seeded (${departments.length})`);

  // ── DIVISIONS ────────────────────────────────────────────────────────────
  const divisionRows = parseDivisionsSheet(wb.Sheets['Divisions']!);
  console.log(`   Parsed ${divisionRows.length} division row(s)`);

  const divisions = [];
  for (const d of divisionRows) {
    const department = deptMap.get(d.departmentName);
    if (!department) {
      console.warn(`  ⚠️  Department "${d.departmentName}" not found — skipping Division "${d.code}"`);
      continue;
    }
    const division = await prisma.division.upsert({
      where: { code: d.code },
      update: { name: d.name, departmentId: department.id },
      create: { name: d.name, code: d.code, departmentId: department.id },
    });
    divisions.push(division);
  }
  const divMap = new Map(divisions.map((d) => [d.code, d]));
  console.log(`✅ Divisions seeded (${divisions.length})`);

  // ── ROLES (read-only lookup — Roles are seeded by seed.ts, not here) ─────
  const roles = await prisma.role.findMany();
  const roleMap = new Map(roles.map((r) => [r.name, r]));

  // ── USERS ────────────────────────────────────────────────────────────────
  const userRows = parseUsersSheet(wb.Sheets['Users']!);
  console.log(`   Parsed ${userRows.length} user row(s)`);

  const uniquePasswords = [...new Set(userRows.map((u) => u.password))];
  const hashCache: Record<string, string> = {};
  for (const pwd of uniquePasswords) {
    hashCache[pwd] = await bcrypt.hash(pwd, 10);
  }

  let created = 0;
  let updated = 0;
  for (const u of userRows) {
    const division = divMap.get(u.divisionCode);
    if (!division) {
      console.warn(`  ⚠️  Division code "${u.divisionCode}" not found — skipping EmployeeId "${u.employeeId}"`);
      continue;
    }
    const role = roleMap.get(u.role);
    if (!role) {
      console.warn(`  ⚠️  Role "${u.role}" not found — skipping EmployeeId "${u.employeeId}"`);
      continue;
    }

    const existing = await prisma.user.findUnique({ where: { employeeId: u.employeeId } });
    if (existing) {
      // Credentials are intentionally never touched here — only the first-ever
      // insert sets the seed password. Re-running this seed must not reset a
      // user's real password back to the sheet default.
      await prisma.user.update({
        where: { employeeId: u.employeeId },
        data: {
          name: u.name,
          phone: u.phone,
          divisionId: division.id,
          roleId: role.id,
        },
      });
      updated++;
    } else {
      await prisma.user.create({
        data: {
          employeeId: u.employeeId,
          name: u.name,
          ...(u.phone !== null && { phone: u.phone }),
          passwordHash: hashCache[u.password]!,
          forcePasswordChange: true,
          divisionId: division.id,
          roleId: role.id,
        },
      });
      created++;
    }
  }
  console.log(`✅ Users seeded (${created} created, ${updated} updated)`);

  // ── GENERIC AD-HOC TASK TEMPLATE ─────────────────────────────────────────
  // System-seeded template that backs the "Quick Task" flow. Tasks are created
  // from this template by stable slug (GENERIC-ADHOC), never by numeric PK.
  // Must stay Published and non-archiving. Minimal formSchema (single free-text
  // instruction field) so ad-hoc tasks need no template builder.
  const adHocOwner = await prisma.user.findUnique({ where: { employeeId: 'VAE00071' } });
  const qaDivision = divMap.get('QA');
  if (adHocOwner && qaDivision) {
    await prisma.template.upsert({
      where: { templateId: 'GENERIC-ADHOC' },
      update: {
        status: 'Published',
        requiresApproval: false,
      },
      create: {
        templateId: 'GENERIC-ADHOC',
        title: 'Generic Ad-Hoc Task',
        description: 'System template for ad-hoc / Quick Tasks. Do not delete.',
        status: 'Published',
        publishedAt: new Date(),
        requiresApproval: false,
        allowsFindings: true,
        skillLevel: 0,
        formSchema: [{ id: 'instruction', type: 'textarea', label: 'Instruction / Note' }],
        ownerId: adHocOwner.id,
        divisionId: qaDivision.id,
      },
    });
    console.log('✅ Generic Ad-Hoc Task template seeded (GENERIC-ADHOC)');
  } else {
    console.warn('⚠️  Director VAE00071 or QA division not found — skipped Generic Ad-Hoc template seed');
  }

  console.log('');
  console.log('🎉 Org data seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
