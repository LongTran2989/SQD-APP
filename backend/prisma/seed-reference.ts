// backend/prisma/seed-reference.ts
// -----------------------------------------------------------------------
// Bulk-seeds reference/taxonomy data from seed_data.xlsx, in dependency
// order: WpTypes, SystemSettings, NotificationEventConfig, EventTypes,
// AtaChapters, HazardTags, CauseCodes, Operators, Authorities, AircraftTypes,
// AuthorizationTypes, AircraftRegistrations (these last four feed
// registrations' FK references), then Privileges (references Role rows
// seeded by seed.ts itself).
//
// MUST RUN AFTER seed-org.ts (Divisions) and seed.ts's own Role seeding —
// the Privileges sheet resolves against Role rows. Runs before
// seed-templates.ts.
//
// HOW TO RUN (from inside /backend):
//   node_modules/.bin/ts-node prisma/seed-reference.ts
//   (this script is automatically called from seed.ts, after seed-org.ts)
//
// EXCEL FORMAT:
//   WpTypes                 — Code | Description
//   SystemSettings           — Key | Value | Description
//   NotificationEventConfig — EventKey | Enabled | CcManagers
//   EventTypes               — Code | Description
//   AtaChapters              — Code | Title
//   HazardTags               — Label | Description
//   CauseCodes               — GroupCode | GroupName | CauseCode | CauseName
//   Operators                — IataCode | Name
//   Authorities              — Code | FullName
//   AircraftTypes            — Code
//   AuthorizationTypes       — Code | Description | Category
//   AircraftRegistrations    — Registration | Description | SerialNumber |
//                               Status | AircraftTypeCode | OperatorCode |
//                               AuthorityCode
//   Privileges                — Key | Group | Label | <one boolean column per
//                               RoleName, e.g. Director | Admin | Manager |
//                               Group Leader | Staff | Senior Advisor>
//
//   WpTypes / SystemSettings / NotificationEventConfig / Privileges are
//   create-only (never overwrite an existing row) — see the GUIDE sheet.
// -----------------------------------------------------------------------

import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as XLSX from 'xlsx';
import * as path from 'path';
import 'dotenv/config';
import { PRIVILEGE_KEYS, ROLE_NAMES, PrivilegeKey, RoleName, PrivilegeMap } from '../src/constants/privileges';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXCEL_PATH = path.join(__dirname, '..', 'seed_data.xlsx');

function parseBool(val: unknown, defaultValue: boolean): boolean {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'true', '1'].includes(s)) return true;
  if (['no', 'false', '0'].includes(s)) return false;
  return defaultValue;
}

function sheetRows(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

function str(row: Record<string, unknown>, col: string): string {
  return String(row[col] ?? '').trim();
}

async function seedWpTypes(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('WpTypes')) return;
  const rows = sheetRows(wb.Sheets['WpTypes']!);
  let count = 0;
  for (const row of rows) {
    const code = str(row, 'Code');
    if (!code) continue;
    const description = str(row, 'Description') || null;
    await prisma.wpType.upsert({
      where: { code },
      update: {},
      create: { code, description },
    });
    count++;
  }
  console.log(`✅ WP Types seeded (${count})`);
}

async function seedSystemSettings(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('SystemSettings')) return;
  const rows = sheetRows(wb.Sheets['SystemSettings']!);
  let count = 0;
  for (const row of rows) {
    const key = str(row, 'Key');
    if (!key) continue;
    const value = str(row, 'Value');
    const description = str(row, 'Description') || null;
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value, description },
    });
    count++;
  }
  console.log(`✅ System settings seeded (${count})`);
}

async function seedNotificationEventConfig(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('NotificationEventConfig')) return;
  const rows = sheetRows(wb.Sheets['NotificationEventConfig']!);
  let count = 0;
  for (const row of rows) {
    const eventKey = str(row, 'EventKey');
    if (!eventKey) continue;
    await prisma.notificationEventConfig.upsert({
      where: { eventKey },
      update: {},
      create: {
        eventKey,
        enabled: parseBool(row['Enabled'], true),
        ccManagers: parseBool(row['CcManagers'], false),
      },
    });
    count++;
  }
  console.log(`✅ Notification event config seeded (${count})`);
}

async function seedEventTypes(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('EventTypes')) return;
  const rows = sheetRows(wb.Sheets['EventTypes']!);
  let count = 0;
  for (const row of rows) {
    const code = str(row, 'Code');
    if (!code) continue;
    const description = str(row, 'Description') || null;
    await prisma.eventType.upsert({
      where: { code },
      update: { description },
      create: { code, description },
    });
    count++;
  }
  console.log(`✅ Event types seeded (${count})`);
}

async function seedAtaChapters(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('AtaChapters')) return;
  const rows = sheetRows(wb.Sheets['AtaChapters']!);
  let count = 0;
  for (const row of rows) {
    const code = str(row, 'Code');
    if (!code) continue;
    const title = str(row, 'Title');
    if (!title) {
      console.warn(`  ⚠️  AtaChapter "${code}" has no Title — skipped`);
      continue;
    }
    await prisma.ataChapter.upsert({
      where: { code },
      update: { title },
      create: { code, title },
    });
    count++;
  }
  console.log(`✅ ATA chapters seeded (${count})`);
}

async function seedHazardTags(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('HazardTags')) return;
  const rows = sheetRows(wb.Sheets['HazardTags']!);
  let count = 0;
  for (const row of rows) {
    const label = str(row, 'Label');
    if (!label) continue;
    const description = str(row, 'Description') || null;
    await prisma.hazardTag.upsert({
      where: { label },
      update: { description },
      create: { label, description },
    });
    count++;
  }
  console.log(`✅ Hazard tags seeded (${count})`);
}

async function seedCauseCodes(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('CauseCodes')) return;
  const rows = sheetRows(wb.Sheets['CauseCodes']!);
  let count = 0;
  for (const row of rows) {
    const code = str(row, 'CauseCode');
    if (!code) continue;
    const name = str(row, 'CauseName');
    const groupCode = str(row, 'GroupCode');
    const groupName = str(row, 'GroupName');
    if (!name || !groupCode || !groupName) {
      console.warn(`  ⚠️  CauseCode "${code}" is missing required fields — skipped`);
      continue;
    }
    await prisma.causeCode.upsert({
      where: { code },
      update: { name, groupCode, groupName },
      create: { code, name, groupCode, groupName },
    });
    count++;
  }
  console.log(`✅ Cause codes seeded (${count})`);
}

async function seedOperators(wb: XLSX.WorkBook): Promise<Set<string>> {
  const known = new Set<string>();
  if (!wb.SheetNames.includes('Operators')) return known;
  const rows = sheetRows(wb.Sheets['Operators']!);
  let count = 0;
  for (const row of rows) {
    const iataCode = str(row, 'IataCode');
    if (!iataCode) continue;
    const name = str(row, 'Name');
    if (!name) {
      console.warn(`  ⚠️  Operator "${iataCode}" has no Name — skipped`);
      continue;
    }
    await prisma.operator.upsert({
      where: { iataCode },
      update: { name },
      create: { iataCode, name },
    });
    known.add(iataCode);
    count++;
  }
  console.log(`✅ Operators seeded (${count})`);
  return known;
}

async function seedAuthorities(wb: XLSX.WorkBook): Promise<Set<string>> {
  const known = new Set<string>();
  if (!wb.SheetNames.includes('Authorities')) return known;
  const rows = sheetRows(wb.Sheets['Authorities']!);
  let count = 0;
  for (const row of rows) {
    const code = str(row, 'Code');
    if (!code) continue;
    const fullName = str(row, 'FullName');
    if (!fullName) {
      console.warn(`  ⚠️  Authority "${code}" has no FullName — skipped`);
      continue;
    }
    await prisma.authority.upsert({
      where: { code },
      update: { fullName },
      create: { code, fullName },
    });
    known.add(code);
    count++;
  }
  console.log(`✅ Authorities seeded (${count})`);
  return known;
}

async function seedAircraftTypes(wb: XLSX.WorkBook): Promise<Set<string>> {
  const known = new Set<string>();
  if (!wb.SheetNames.includes('AircraftTypes')) return known;
  const rows = sheetRows(wb.Sheets['AircraftTypes']!);
  let count = 0;
  for (const row of rows) {
    const code = str(row, 'Code');
    if (!code) continue;
    await prisma.aircraftType.upsert({
      where: { code },
      update: {},
      create: { code },
    });
    known.add(code);
    count++;
  }
  console.log(`✅ Aircraft types seeded (${count})`);
  return known;
}

async function seedAuthorizationTypes(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('AuthorizationTypes')) return;
  const rows = sheetRows(wb.Sheets['AuthorizationTypes']!);
  let count = 0;
  for (const row of rows) {
    const code = str(row, 'Code');
    if (!code) continue;
    const description = str(row, 'Description') || null;
    const category = str(row, 'Category') || null;
    await prisma.authorizationType.upsert({
      where: { code },
      update: { description, category },
      create: { code, description, category },
    });
    count++;
  }
  console.log(`✅ Authorization types seeded (${count})`);
}

async function seedAircraftRegistrations(
  wb: XLSX.WorkBook,
  knownOperators: Set<string>,
  knownAuthorities: Set<string>,
  knownAcTypes: Set<string>
) {
  if (!wb.SheetNames.includes('AircraftRegistrations')) return;
  const rows = sheetRows(wb.Sheets['AircraftRegistrations']!);
  let count = 0;
  for (const row of rows) {
    const registration = str(row, 'Registration');
    if (!registration) continue;
    const description = str(row, 'Description') || null;
    const serialNumber = str(row, 'SerialNumber') || null;
    const status = str(row, 'Status') || 'Active';
    const aircraftTypeCodeRaw = str(row, 'AircraftTypeCode') || null;
    const operatorCodeRaw = str(row, 'OperatorCode') || null;
    const authorityCodeRaw = str(row, 'AuthorityCode') || null;

    const aircraftTypeCode = aircraftTypeCodeRaw && knownAcTypes.has(aircraftTypeCodeRaw) ? aircraftTypeCodeRaw : null;
    const operatorCode = operatorCodeRaw && knownOperators.has(operatorCodeRaw) ? operatorCodeRaw : null;
    const authorityCode = authorityCodeRaw && knownAuthorities.has(authorityCodeRaw) ? authorityCodeRaw : null;

    await prisma.aircraftRegistration.upsert({
      where: { registration },
      update: { description, serialNumber, status, aircraftTypeCode, operatorCode, authorityCode },
      create: { registration, description, serialNumber, status, aircraftTypeCode, operatorCode, authorityCode },
    });
    count++;
  }
  console.log(`✅ Aircraft registrations seeded (${count})`);
}

async function seedPrivilegesFromSheet(wb: XLSX.WorkBook) {
  if (!wb.SheetNames.includes('Privileges')) return;
  const rows = sheetRows(wb.Sheets['Privileges']!);

  const roles = await prisma.role.findMany({ where: { name: { in: ROLE_NAMES } } });
  const roleMap = new Map(roles.map((r) => [r.name as RoleName, r]));

  // Build a permissions map per role from the sheet (Key column x RoleName columns).
  const permsByRole = new Map<RoleName, PrivilegeMap>();
  for (const roleName of ROLE_NAMES) permsByRole.set(roleName, {});

  for (const row of rows) {
    const key = str(row, 'Key');
    if (!key) continue;
    if (!PRIVILEGE_KEYS.includes(key as PrivilegeKey)) {
      console.warn(`  ⚠️  Privileges sheet: unknown key "${key}" — skipped`);
      continue;
    }
    for (const roleName of ROLE_NAMES) {
      if (!(roleName in row)) continue;
      const granted = parseBool(row[roleName], false);
      permsByRole.get(roleName)![key as PrivilegeKey] = granted;
    }
  }

  let count = 0;
  for (const roleName of ROLE_NAMES) {
    const role = roleMap.get(roleName);
    if (!role) continue;
    const permissions = permsByRole.get(roleName)!;
    if (Object.keys(permissions).length === 0) continue;
    await prisma.privilegeConfig.upsert({
      where: { roleId: role.id },
      update: {}, // never clobber an existing (customised) config
      create: { roleId: role.id, permissions: permissions as Prisma.InputJsonValue },
    });
    count++;
  }
  console.log(`✅ Privilege configs seeded (${count})`);
}

async function main() {
  console.log('🌱 Seeding reference data from Excel...');
  console.log(`   File: ${EXCEL_PATH}\n`);

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(EXCEL_PATH);
  } catch {
    console.error(`❌ Cannot open Excel file at:\n   ${EXCEL_PATH}`);
    process.exit(1);
  }

  await seedWpTypes(wb);
  await seedSystemSettings(wb);
  await seedNotificationEventConfig(wb);
  await seedEventTypes(wb);
  await seedAtaChapters(wb);
  await seedHazardTags(wb);
  await seedCauseCodes(wb);
  const knownOperators = await seedOperators(wb);
  const knownAuthorities = await seedAuthorities(wb);
  const knownAcTypes = await seedAircraftTypes(wb);
  await seedAuthorizationTypes(wb);
  await seedAircraftRegistrations(wb, knownOperators, knownAuthorities, knownAcTypes);
  await seedPrivilegesFromSheet(wb);

  console.log('');
  console.log('🎉 Reference data seed complete!');
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
