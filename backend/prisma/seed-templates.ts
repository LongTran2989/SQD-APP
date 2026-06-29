// backend/prisma/seed-templates.ts
// -----------------------------------------------------------------------
// Bulk-seeds audit templates from an Excel file with two sheets:
//   Sheet 1 ("Templates") — template metadata rows
//   Sheet 2 ("FormFields") — form-field rows keyed by TemplateRef
//
// HOW TO RUN (from inside /backend):
//   node_modules/.bin/ts-node prisma/seed.ts
//   (this script is automatically called at the end of seed.ts)
//
// EXCEL FORMAT — Sheet 1 "Templates":
//   TemplateRef | Title | Description | Type | RequiresApproval | AllowsFindings |
//   SkillLevel | EstimatedHours | Division
//
// EXCEL FORMAT — Sheet 2 "FormFields":
//   TemplateRef | FieldId | Type | Label | Required | HelpText | DataSource | Options
//
//   Valid field types: text, textarea, number, select, radio,
//                      checkbox_group, checkbox_single, date, rich_text, file_upload
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
// Config
// ──────────────────────────────────────────────────────────────────────────────
const EXCEL_PATH = path.join(__dirname, '..', 'seed_data.xlsx');
const DEFAULT_OWNER_EMPLOYEE_ID = 'VAE02690'; // Manager Trần THanh Long Director Lê Viết Thành
const DEFAULT_DIVISION_CODE = 'QA'; // Fallback if Division column is empty

// Column name mappings — edit these to match your Excel headers exactly.
const COL = {
  templates: {
    templateRef: 'TemplateRef',
    title: 'Title',
    description: 'Description',
    requiresApproval: 'RequiresApproval',
    allowsFindings: 'AllowsFindings',
    estimatedHours: 'EstimatedHours',
    skillLevel: 'SkillLevel',
    type: 'Type',
    division: 'Division',
  },
  fields: {
    templateRef: 'TemplateRef',
    fieldId: 'FieldId',
    type: 'Type',
    label: 'Label',
    required: 'Required',
    helpText: 'HelpText',
    dataSource: 'DataSource',
    options: 'Options',
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
interface RawTemplateRow {
  templateRef: string;
  title: string;
  description: string | null;
  requiresApproval: boolean;
  allowsFindings: boolean;
  estimatedHours: number | null;
  skillLevel: number;
  type: string | null;
  divisionCode: string; // From Division column, defaults to QA
}

interface FormField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  helpText?: string;
  dataSource?: string;
  options?: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function parseBool(val: unknown, defaultValue: boolean): boolean {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'true', '1'].includes(s)) return true;
  if (['no', 'false', '0'].includes(s)) return false;
  return defaultValue;
}

function parseOptionalFloat(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function parseOptionalInt(val: unknown, defaultValue: number): number {
  if (val === undefined || val === null || val === '') return defaultValue;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? defaultValue : n;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sheet parsers
// ──────────────────────────────────────────────────────────────────────────────
function parseTemplatesSheet(ws: XLSX.WorkSheet): RawTemplateRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const results: RawTemplateRow[] = [];

  for (const row of rows) {
    const templateRef = String(row[COL.templates.templateRef] ?? '').trim();
    if (!templateRef) continue;

    const title = String(row[COL.templates.title] ?? '').trim();
    if (!title) {
      console.warn(`  ⚠️  TemplateRef "${templateRef}" has no Title — skipped`);
      continue;
    }

    const divisionCode = String(row[COL.templates.division] ?? '').trim() || DEFAULT_DIVISION_CODE;

    results.push({
      templateRef,
      title,
      description: String(row[COL.templates.description] ?? '').trim() || null,
      requiresApproval: parseBool(row[COL.templates.requiresApproval], false),
      allowsFindings: parseBool(row[COL.templates.allowsFindings], true),
      estimatedHours: parseOptionalFloat(row[COL.templates.estimatedHours]),
      skillLevel: parseOptionalInt(row[COL.templates.skillLevel], 0),
      type: String(row[COL.templates.type] ?? '').trim() || null,
      divisionCode,
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
      ? optionsRaw.split(',').map((o) => o.trim()).filter(Boolean)
      : undefined;

    const helpText = String(row[COL.fields.helpText] ?? '').trim() || undefined;
    const dataSource = String(row[COL.fields.dataSource] ?? '').trim() || undefined;

    const field: FormField = {
      id: String(row[COL.fields.fieldId] || crypto.randomUUID()),
      label,
      type: fieldType,
      required: parseBool(row[COL.fields.required], false),
      ...(helpText && { helpText }),
      ...(dataSource && { dataSource }),
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
    console.error('   Place your seed_data.xlsx there and re-run.');
    process.exit(1);
  }

  if (!wb.SheetNames.includes('Templates') || !wb.SheetNames.includes('FormFields')) {
    console.error('❌ Excel must contain "Templates" and "FormFields" sheets');
    process.exit(1);
  }

  const templateRows = parseTemplatesSheet(wb.Sheets['Templates']!);
  const fieldMap = parseFieldsSheet(wb.Sheets['FormFields']!);

  const totalFields = [...fieldMap.values()].reduce((s, arr) => s + arr.length, 0);
  console.log(`   Parsed ${templateRows.length} template row(s) from Templates sheet`);
  console.log(`   Parsed ${totalFields} field row(s) from FormFields sheet\n`);

  // Load all divisions at once into a map (code → division row)
  const allDivisions = await prisma.division.findMany();
  const divMap = new Map(allDivisions.map((d) => [d.code, d]));

  // Load default owner
  const owner = await prisma.user.findUnique({
    where: { employeeId: DEFAULT_OWNER_EMPLOYEE_ID },
  });
  if (!owner) {
    console.error(`❌ Default owner employeeId "${DEFAULT_OWNER_EMPLOYEE_ID}" not found in DB.`);
    console.error('   Run the main seed first: node_modules/.bin/ts-node prisma/seed.ts');
    process.exit(1);
  }

  // Per-division: find the current max sequence so we can continue numbering
  const seqMap = new Map<string, number>(); // divisionCode → current maxSeq
  for (const div of allDivisions) {
    const existingTemplates = await prisma.template.findMany({
      where: { templateId: { startsWith: `${div.code}-` } },
      select: { templateId: true },
    });
    let maxSeq = 0;
    for (const t of existingTemplates) {
      const parts = t.templateId.split('-');
      const seq = parseInt(parts[parts.length - 1] ?? '', 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
    seqMap.set(div.code, maxSeq);
  }

  // Upsert templates
  let created = 0;
  let updated = 0;

  for (const row of templateRows) {
    const division = divMap.get(row.divisionCode);
    if (!division) {
      console.warn(`  ⚠️  Division code "${row.divisionCode}" not found in DB — skipping TemplateRef "${row.templateRef}"`);
      continue;
    }

    const fields = fieldMap.get(row.templateRef) ?? [];
    if (fields.length === 0) {
      console.warn(`  ⚠️  TemplateRef "${row.templateRef}" has no matching fields in FormFields sheet — seeding with empty formSchema`);
    }

    // Check if a template with this externalRef already exists (idempotent upsert key)
    const existing = await prisma.template.findUnique({
      where: { externalRef: row.templateRef },
    });

    const nowPublished = new Date();

    if (existing) {
      // Update the existing template
      await prisma.template.update({
        where: { externalRef: row.templateRef },
        data: {
          title: row.title,
          description: row.description,
          requiresApproval: row.requiresApproval,
          allowsFindings: row.allowsFindings,
          skillLevel: row.skillLevel,
          estimatedHours: row.estimatedHours,
          type: row.type,
          status: 'Published',
          publishedAt: existing.publishedAt ?? nowPublished,
          formSchema: fields as object[],
          draftSchema: Prisma.JsonNull,
        },
      });
      updated++;
      console.log(`  ↻  Updated: ${existing.templateId} — ${row.title} (${fields.length} fields)`);
    } else {
      // Create new template with next sequence for this division
      const currentSeq = seqMap.get(division.code) ?? 0;
      const nextSeq = currentSeq + 1;
      seqMap.set(division.code, nextSeq);
      const newTemplateId = `${division.code}-${String(nextSeq).padStart(3, '0')}`;

      await prisma.template.create({
        data: {
          templateId: newTemplateId,
          externalRef: row.templateRef,
          title: row.title,
          description: row.description,
          status: 'Published',
          publishedAt: nowPublished,
          requiresApproval: row.requiresApproval,
          allowsFindings: row.allowsFindings,
          skillLevel: row.skillLevel,
          estimatedHours: row.estimatedHours,
          type: row.type,
          divisionId: division.id,
          ownerId: owner.id,
          formSchema: fields as object[],
          draftSchema: Prisma.JsonNull,
        },
      });
      created++;
      console.log(`  ✓  Created: ${newTemplateId} [${row.templateRef}] — ${row.title} (${fields.length} fields)`);
    }
  }

  console.log('');
  console.log('🎉 Template seed complete!');
  console.log('');
  console.log('── Summary ─────────────────────────────────────────');
  console.log(`   Created : ${created}`);
  console.log(`   Updated : ${updated}`);
  console.log('────────────────────────────────────────────────────');
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
