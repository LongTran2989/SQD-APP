// backend/prisma/seed-templates.ts
// -----------------------------------------------------------------------
// Bulk-seeds audit templates from an Excel file with two sheets:
//   Sheet 1 ("Templates") — template metadata rows
//   Sheet 2 ("Fields")    — form-field rows keyed by Template ID
//
// HOW TO RUN (from inside /backend):
//   npx ts-node prisma/seed-templates.ts
//
// PREREQUISITES:
//   1. Run the main seed first: npx ts-node prisma/seed.ts
//   2. Place your Excel file at: backend/prisma/data/templates.xlsx
//
// EXCEL FORMAT — Sheet 1 "Templates":
//   ID | Title | Description | Division | Requires Approval | Allows Findings |
//   Estimated Hours | Skill Level | Type | Status
//
// EXCEL FORMAT — Sheet 2 "Fields":
//   Template ID | Label | Type | Required | Help Text | Options
//
//   Valid field types: text, textarea, number, select, radio,
//                      checkbox_group, checkbox_single, date, rich_text
//   Options column: comma-separated for select / radio / checkbox_group
//   Boolean columns: accept yes/no, true/false, or 1/0
// -----------------------------------------------------------------------

import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as XLSX from 'xlsx';
import * as crypto from 'crypto';
import * as path from 'path';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ──────────────────────────────────────────────────────────────────────────────
// Column name mappings — edit these to match your Excel headers exactly.
// ──────────────────────────────────────────────────────────────────────────────
const COL = {
  templates: {
    id:               'ID',
    title:            'Title',
    description:      'Description',
    division:         'Division',
    requiresApproval: 'Requires Approval',
    allowsFindings:   'Allows Findings',
    estimatedHours:   'Estimated Hours',
    skillLevel:       'Skill Level',
    type:             'Type',
    status:           'Status',
  },
  fields: {
    templateRef: 'Template ID',
    label:       'Label',
    type:        'Type',
    required:    'Required',
    helpText:    'Help Text',
    options:     'Options',
  },
} as const;

const EXCEL_PATH = path.resolve(__dirname, 'data', 'templates.xlsx');

// Employee ID of the user who will own all seeded templates (Director by default)
const DEFAULT_OWNER_EMPLOYEE_ID = 'VAE00071';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
interface RawTemplateRow {
  templateId:       string;
  title:            string;
  description:      string | null;
  divisionCode:     string;
  requiresApproval: boolean;
  allowsFindings:   boolean;
  estimatedHours:   number | null;
  skillLevel:       number;
  type:             string | null;
  status:           string;
}

interface FormField {
  id:        string;
  label:     string;
  type:      string;
  required:  boolean;
  helpText?: string;
  options?:  string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function parseBool(val: unknown, fallback = false): boolean {
  if (val === undefined || val === null || String(val).trim() === '') return fallback;
  const s = String(val).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

function parseOptionalFloat(val: unknown): number | null {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function parseOptionalInt(val: unknown, fallback = 0): number {
  if (val === undefined || val === null || String(val).trim() === '') return fallback;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? fallback : n;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sheet parsers
// ──────────────────────────────────────────────────────────────────────────────
function parseTemplatesSheet(ws: XLSX.WorkSheet): RawTemplateRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const results: RawTemplateRow[] = [];

  for (const row of rows) {
    const templateId = String(row[COL.templates.id] ?? '').trim();
    if (!templateId) continue;

    const title = String(row[COL.templates.title] ?? '').trim();
    if (!title) {
      console.warn(`  ⚠️  Template "${templateId}" has no Title — skipped`);
      continue;
    }

    const divisionCode = String(row[COL.templates.division] ?? '').trim().toUpperCase();
    if (!divisionCode) {
      console.warn(`  ⚠️  Template "${templateId}" has no Division — skipped`);
      continue;
    }

    const statusRaw = String(row[COL.templates.status] ?? '').trim();
    const status = statusRaw === 'Published' ? 'Published' : 'Draft';

    results.push({
      templateId,
      title,
      description:      String(row[COL.templates.description] ?? '').trim() || null,
      divisionCode,
      requiresApproval: parseBool(row[COL.templates.requiresApproval], false),
      allowsFindings:   parseBool(row[COL.templates.allowsFindings], true),
      estimatedHours:   parseOptionalFloat(row[COL.templates.estimatedHours]),
      skillLevel:       parseOptionalInt(row[COL.templates.skillLevel], 0),
      type:             String(row[COL.templates.type] ?? '').trim() || null,
      status,
    });
  }

  return results;
}

function parseFieldsSheet(ws: XLSX.WorkSheet): Map<string, FormField[]> {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const fieldMap = new Map<string, FormField[]>();

  for (const row of rows) {
    const templateRef = String(row[COL.fields.templateRef] ?? '').trim();
    if (!templateRef) continue;

    const label = String(row[COL.fields.label] ?? '').trim();
    if (!label) continue;

    const fieldType = String(row[COL.fields.type] ?? '').trim().toLowerCase() || 'text';

    const optionsRaw = String(row[COL.fields.options] ?? '').trim();
    const options = optionsRaw
      ? optionsRaw.split(',').map(o => o.trim()).filter(Boolean)
      : undefined;

    const helpText = String(row[COL.fields.helpText] ?? '').trim() || undefined;

    const field: FormField = {
      id:       crypto.randomUUID(),
      label,
      type:     fieldType,
      required: parseBool(row[COL.fields.required], false),
      ...(helpText && { helpText }),
      ...(options && options.length > 0 && { options }),
    };

    const existing = fieldMap.get(templateRef) ?? [];
    existing.push(field);
    fieldMap.set(templateRef, existing);
  }

  return fieldMap;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding templates from Excel...');
  console.log(`   File: ${EXCEL_PATH}\n`);

  // Load Excel file
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(EXCEL_PATH);
  } catch {
    console.error(`❌ Cannot open Excel file at:\n   ${EXCEL_PATH}`);
    console.error('   Place your templates.xlsx there and re-run.');
    process.exit(1);
  }

  if (wb.SheetNames.length < 2) {
    console.error('❌ Excel must have at least 2 sheets: Sheet 1 = Templates, Sheet 2 = Fields');
    process.exit(1);
  }

  console.log(`   Sheet 1 (Templates): "${wb.SheetNames[0]}"`);
  console.log(`   Sheet 2 (Fields):    "${wb.SheetNames[1]}"\n`);

  const templateRows = parseTemplatesSheet(wb.Sheets[wb.SheetNames[0]!]!);
  const fieldMap     = parseFieldsSheet(wb.Sheets[wb.SheetNames[1]!]!);

  console.log(`   Parsed ${templateRows.length} template row(s) from Sheet 1`);
  const totalFields = [...fieldMap.values()].reduce((s, arr) => s + arr.length, 0);
  console.log(`   Parsed ${totalFields} field row(s) from Sheet 2\n`);

  // Load divisions
  const divisions = await prisma.division.findMany();
  const divMap = new Map(divisions.map(d => [d.code, d.id]));

  // Load default owner
  const owner = await prisma.user.findUnique({
    where: { employeeId: DEFAULT_OWNER_EMPLOYEE_ID },
  });
  if (!owner) {
    console.error(`❌ Default owner employeeId "${DEFAULT_OWNER_EMPLOYEE_ID}" not found in DB.`);
    console.error('   Run the main seed first: npx ts-node prisma/seed.ts');
    process.exit(1);
  }

  // Upsert templates
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of templateRows) {
    const divisionId = divMap.get(row.divisionCode);
    if (!divisionId) {
      console.warn(`  ⚠️  Template "${row.templateId}" — unknown division "${row.divisionCode}" (valid: ${[...divMap.keys()].join(', ')}) — skipped`);
      skipped++;
      continue;
    }

    const fields = fieldMap.get(row.templateId) ?? [];
    if (fields.length === 0) {
      console.warn(`  ⚠️  Template "${row.templateId}" has no matching fields in Sheet 2 — seeding with empty formSchema`);
    }

    const isPublished = row.status === 'Published';
    const existing = await prisma.template.findUnique({ where: { templateId: row.templateId } });

    const baseData = {
      title:            row.title,
      description:      row.description,
      requiresApproval: row.requiresApproval,
      allowsFindings:   row.allowsFindings,
      estimatedHours:   row.estimatedHours,
      skillLevel:       row.skillLevel,
      type:             row.type,
      status:           row.status,
      formSchema:       fields as object[],
      divisionId,
      ownerId:          owner.id,
    };

    await prisma.template.upsert({
      where: { templateId: row.templateId },
      update: {
        ...baseData,
        ...(isPublished && { draftSchema: Prisma.DbNull }),
        ...(isPublished && !existing?.publishedAt && { publishedAt: new Date() }),
      },
      create: {
        ...baseData,
        templateId:  row.templateId,
        draftSchema: Prisma.DbNull,
        publishedAt: isPublished ? new Date() : null,
      },
    });

    if (existing) {
      updated++;
      console.log(`  ↻  Updated: ${row.templateId} — ${row.title}`);
    } else {
      created++;
      console.log(`  ✓  Created: ${row.templateId} — ${row.title} (${fields.length} fields)`);
    }
  }

  console.log('');
  console.log('🎉 Template seed complete!');
  console.log('');
  console.log('── Summary ─────────────────────────────────────────');
  console.log(`   Created : ${created}`);
  console.log(`   Updated : ${updated}`);
  if (skipped > 0) {
    console.log(`   Skipped : ${skipped}`);
  }
  console.log('────────────────────────────────────────────────────');
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
