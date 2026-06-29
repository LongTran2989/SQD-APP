// backend/prisma/seed-blueprints.ts
// -----------------------------------------------------------------------
// Bulk-seeds Template Sets and WP Blueprints from the same Excel file used
// by seed-templates.ts, via three additional sheets:
//   Sheet 3 ("TemplateSets")     — template-set metadata rows
//   Sheet 4 ("TemplateSetItems") — set membership rows keyed by SetRef
//   Sheet 5 ("WpBlueprints")     — WP blueprint rows (incl. auto-gen + recurrence)
//
// MUST RUN AFTER seed-templates.ts — TemplateSetItems.TemplateRef and
// WpBlueprints.AutoGenTemplateRef/AutoGenSetRef resolve against rows that
// script creates. seed.ts invokes both, in order, as separate child processes.
//
// HOW TO RUN (from inside /backend):
//   node_modules/.bin/ts-node prisma/seed-blueprints.ts
//   (this script is automatically called at the end of seed.ts, after seed-templates.ts)
//
// EXCEL FORMAT — Sheet 3 "TemplateSets":
//   SetRef | Name | Description | Division | Owner | IsActive
//
// EXCEL FORMAT — Sheet 4 "TemplateSetItems":
//   SetRef | TemplateRef | OrderIndex | DeadlineOffsetDays | EstimatedHours |
//   SkillLevel | RequiresApproval | DefaultNote
//
// EXCEL FORMAT — Sheet 5 "WpBlueprints":
//   BlueprintRef | Name | Description | Type | Division | Owner | DefaultDuration |
//   AutoGenerate | AutoGenMode | AutoGenInterval | AutoGenTemplateRef | AutoGenSetRef |
//   RecurrenceType | RecurrenceInterval | RecurrenceStartDate
//
//   Type must match an existing WpType code (CHECK/AUDIT/SURVEILLANCE/INVESTIGATION/OTHER).
//   AutoGenMode: SINGLE_SHOT | REPEAT. Exactly one of AutoGenTemplateRef/AutoGenSetRef
//   may be set when AutoGenerate=yes (no inline-list support from Excel). REPEAT mode
//   requires AutoGenTemplateRef (not AutoGenSetRef) + AutoGenInterval.
//   RecurrenceType: CALENDAR | LAST_DONE | blank. When set, RecurrenceInterval and
//   RecurrenceStartDate are required together.
//
//   Owner/Division/Type are creation-time-only: re-running this seed against an
//   existing SetRef/BlueprintRef never changes them (matches how the Template
//   seed and the API's own PUT endpoints treat owner/division/type as immutable
//   after creation).
// -----------------------------------------------------------------------

import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as XLSX from 'xlsx';
import * as path from 'path';
import 'dotenv/config';
// Side-effect import: registers the global Express.Request.user type augmentation
// (declared in auth.middleware.ts) so ts-node's program picks it up — nothing in
// this script's own import graph reaches that file otherwise.
import '../src/middleware/auth.middleware';
import { validateAutoGenConfig } from '../src/services/autoGenService';
import { resolveRecurrence } from '../src/controllers/wpBlueprint.controller';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ──────────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────────
const EXCEL_PATH = path.join(__dirname, '..', 'seed_data.xlsx');
const DEFAULT_DIVISION_CODE = 'QA'; // Fallback if Division column is empty

const COL = {
  templateSets: {
    setRef:      'SetRef',
    name:        'Name',
    description: 'Description',
    division:    'Division',
    owner:       'Owner',
    isActive:    'IsActive',
  },
  templateSetItems: {
    setRef:             'SetRef',
    templateRef:        'TemplateRef',
    orderIndex:         'OrderIndex',
    deadlineOffsetDays: 'DeadlineOffsetDays',
    estimatedHours:     'EstimatedHours',
    skillLevel:         'SkillLevel',
    requiresApproval:   'RequiresApproval',
    defaultNote:        'DefaultNote',
  },
  wpBlueprints: {
    blueprintRef:        'BlueprintRef',
    name:                'Name',
    description:         'Description',
    type:                'Type',
    division:            'Division',
    owner:               'Owner',
    defaultDuration:     'DefaultDuration',
    autoGenerate:        'AutoGenerate',
    autoGenMode:         'AutoGenMode',
    autoGenInterval:     'AutoGenInterval',
    autoGenTemplateRef:  'AutoGenTemplateRef',
    autoGenSetRef:       'AutoGenSetRef',
    recurrenceType:      'RecurrenceType',
    recurrenceInterval:  'RecurrenceInterval',
    recurrenceStartDate: 'RecurrenceStartDate',
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers (mirrors seed-templates.ts)
// ──────────────────────────────────────────────────────────────────────────────
function parseBool(val: unknown, defaultValue: boolean): boolean {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'true', '1'].includes(s)) return true;
  if (['no', 'false', '0'].includes(s)) return false;
  return defaultValue;
}

function parseTriBool(val: unknown): boolean | null {
  if (val === undefined || val === null || val === '') return null;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'true', '1'].includes(s)) return true;
  if (['no', 'false', '0'].includes(s)) return false;
  return null;
}

function parseOptionalFloat(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function parseOptionalInt(val: unknown, defaultValue: number | null): number | null {
  if (val === undefined || val === null || val === '') return defaultValue;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? defaultValue : n;
}

function trimOrNull(val: unknown): string | null {
  const s = String(val ?? '').trim();
  return s || null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sheet row types
// ──────────────────────────────────────────────────────────────────────────────
interface RawSetRow {
  setRef: string;
  name: string;
  description: string | null;
  divisionCode: string;
  employeeId: string;
  isActive: boolean;
}

interface RawSetItemRow {
  setRef: string;
  templateRef: string;
  orderIndex: number | null;
  deadlineOffsetDays: number | null;
  estimatedHours: number | null;
  skillLevel: number | null;
  requiresApproval: boolean | null;
  defaultNote: string | null;
}

interface RawBlueprintRow {
  blueprintRef: string;
  name: string;
  description: string | null;
  type: string;
  divisionCode: string;
  employeeId: string;
  defaultDuration: number | null;
  autoGenerate: boolean;
  autoGenMode: string | null;
  autoGenInterval: number | null;
  autoGenTemplateRef: string | null;
  autoGenSetRef: string | null;
  recurrenceType: string | null;
  recurrenceInterval: number | null;
  recurrenceStartDate: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sheet parsers
// ──────────────────────────────────────────────────────────────────────────────
function parseTemplateSetsSheet(ws: XLSX.WorkSheet): RawSetRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const results: RawSetRow[] = [];
  for (const row of rows) {
    const setRef = String(row[COL.templateSets.setRef] ?? '').trim();
    if (!setRef) continue;

    const name = String(row[COL.templateSets.name] ?? '').trim();
    if (!name) {
      console.warn(`  ⚠️  SetRef "${setRef}" has no Name — skipped`);
      continue;
    }

    const employeeId = String(row[COL.templateSets.owner] ?? '').trim();
    if (!employeeId) {
      console.warn(`  ⚠️  SetRef "${setRef}" has no Owner — skipped`);
      continue;
    }

    results.push({
      setRef,
      name,
      description: trimOrNull(row[COL.templateSets.description]),
      divisionCode: String(row[COL.templateSets.division] ?? '').trim() || DEFAULT_DIVISION_CODE,
      employeeId,
      isActive: parseBool(row[COL.templateSets.isActive], true),
    });
  }
  return results;
}

function parseTemplateSetItemsSheet(ws: XLSX.WorkSheet): RawSetItemRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const results: RawSetItemRow[] = [];
  for (const row of rows) {
    const setRef = String(row[COL.templateSetItems.setRef] ?? '').trim();
    const templateRef = String(row[COL.templateSetItems.templateRef] ?? '').trim();
    if (!setRef || !templateRef) continue;

    results.push({
      setRef,
      templateRef,
      orderIndex: parseOptionalInt(row[COL.templateSetItems.orderIndex], null),
      deadlineOffsetDays: parseOptionalInt(row[COL.templateSetItems.deadlineOffsetDays], null),
      estimatedHours: parseOptionalFloat(row[COL.templateSetItems.estimatedHours]),
      skillLevel: parseOptionalInt(row[COL.templateSetItems.skillLevel], null),
      requiresApproval: parseTriBool(row[COL.templateSetItems.requiresApproval]),
      defaultNote: trimOrNull(row[COL.templateSetItems.defaultNote]),
    });
  }
  return results;
}

function parseWpBlueprintsSheet(ws: XLSX.WorkSheet): RawBlueprintRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const results: RawBlueprintRow[] = [];
  for (const row of rows) {
    const blueprintRef = String(row[COL.wpBlueprints.blueprintRef] ?? '').trim();
    if (!blueprintRef) continue;

    const name = String(row[COL.wpBlueprints.name] ?? '').trim();
    if (!name) {
      console.warn(`  ⚠️  BlueprintRef "${blueprintRef}" has no Name — skipped`);
      continue;
    }

    const type = String(row[COL.wpBlueprints.type] ?? '').trim();
    if (!type) {
      console.warn(`  ⚠️  BlueprintRef "${blueprintRef}" has no Type — skipped`);
      continue;
    }

    const employeeId = String(row[COL.wpBlueprints.owner] ?? '').trim();
    if (!employeeId) {
      console.warn(`  ⚠️  BlueprintRef "${blueprintRef}" has no Owner — skipped`);
      continue;
    }

    results.push({
      blueprintRef,
      name,
      description: trimOrNull(row[COL.wpBlueprints.description]),
      type,
      divisionCode: String(row[COL.wpBlueprints.division] ?? '').trim() || DEFAULT_DIVISION_CODE,
      employeeId,
      defaultDuration: parseOptionalInt(row[COL.wpBlueprints.defaultDuration], null),
      autoGenerate: parseBool(row[COL.wpBlueprints.autoGenerate], false),
      autoGenMode: trimOrNull(row[COL.wpBlueprints.autoGenMode]),
      autoGenInterval: parseOptionalInt(row[COL.wpBlueprints.autoGenInterval], null),
      autoGenTemplateRef: trimOrNull(row[COL.wpBlueprints.autoGenTemplateRef]),
      autoGenSetRef: trimOrNull(row[COL.wpBlueprints.autoGenSetRef]),
      recurrenceType: trimOrNull(row[COL.wpBlueprints.recurrenceType]),
      recurrenceInterval: parseOptionalInt(row[COL.wpBlueprints.recurrenceInterval], null),
      recurrenceStartDate: trimOrNull(row[COL.wpBlueprints.recurrenceStartDate]),
    });
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding template sets & WP blueprints from Excel...');
  console.log(`   File: ${EXCEL_PATH}\n`);

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.readFile(EXCEL_PATH);
  } catch {
    console.error(`❌ Cannot open Excel file at:\n   ${EXCEL_PATH}`);
    process.exit(1);
  }

  const hasSets = wb.SheetNames.includes('TemplateSets');
  const hasItems = wb.SheetNames.includes('TemplateSetItems');
  const hasBlueprints = wb.SheetNames.includes('WpBlueprints');
  if (!hasSets && !hasItems && !hasBlueprints) {
    console.log('   No TemplateSets / TemplateSetItems / WpBlueprints sheets found — nothing to do.');
    return;
  }

  // Reference data, loaded once.
  const allDivisions = await prisma.division.findMany();
  const divMap = new Map(allDivisions.map((d) => [d.code, d]));

  const allUsers = await prisma.user.findMany({ where: { deletedAt: null } });
  const userMap = new Map(allUsers.map((u) => [u.employeeId, u]));

  const allTemplates = await prisma.template.findMany({
    where: { externalRef: { not: null } },
    select: { id: true, externalRef: true, status: true },
  });
  const templateRefMap = new Map(allTemplates.map((t) => [t.externalRef as string, t]));

  const allWpTypes = await prisma.wpType.findMany();
  const wpTypeCodes = new Set(allWpTypes.map((t) => t.code));

  // ── Sheet 3: TemplateSets ─────────────────────────────────────────────────
  const setRefToId = new Map<string, number>();
  let setsCreated = 0;
  let setsUpdated = 0;

  if (hasSets) {
    const setRows = parseTemplateSetsSheet(wb.Sheets['TemplateSets']!);
    console.log(`   Parsed ${setRows.length} template set row(s) from TemplateSets sheet`);

    for (const row of setRows) {
      const division = divMap.get(row.divisionCode);
      if (!division) {
        console.warn(`  ⚠️  Division code "${row.divisionCode}" not found — skipping SetRef "${row.setRef}"`);
        continue;
      }
      const owner = userMap.get(row.employeeId);
      if (!owner) {
        console.warn(`  ⚠️  Owner employeeId "${row.employeeId}" not found — skipping SetRef "${row.setRef}"`);
        continue;
      }

      const existing = await prisma.templateSet.findUnique({ where: { externalRef: row.setRef } });
      if (existing) {
        // divisionId/ownerId are creation-time-only (matches the API's PUT semantics).
        const updated = await prisma.templateSet.update({
          where: { externalRef: row.setRef },
          data: { name: row.name, description: row.description, isActive: row.isActive },
        });
        setRefToId.set(row.setRef, updated.id);
        setsUpdated++;
        console.log(`  ↻  Updated TemplateSet: [${row.setRef}] — ${row.name}`);
      } else {
        const created = await prisma.templateSet.create({
          data: {
            externalRef: row.setRef,
            name: row.name,
            description: row.description,
            divisionId: division.id,
            ownerId: owner.id,
            isActive: row.isActive,
          },
        });
        setRefToId.set(row.setRef, created.id);
        setsCreated++;
        console.log(`  ✓  Created TemplateSet: [${row.setRef}] — ${row.name}`);
      }
    }
  }

  // ── Sheet 4: TemplateSetItems ─────────────────────────────────────────────
  let itemSetsReplaced = 0;

  if (hasItems) {
    const itemRows = parseTemplateSetItemsSheet(wb.Sheets['TemplateSetItems']!);
    console.log(`   Parsed ${itemRows.length} template set item row(s) from TemplateSetItems sheet`);

    const grouped = new Map<string, RawSetItemRow[]>();
    for (const row of itemRows) {
      const arr = grouped.get(row.setRef) ?? [];
      arr.push(row);
      grouped.set(row.setRef, arr);
    }

    for (const [setRef, rows] of grouped) {
      const setId = setRefToId.get(setRef);
      if (setId === undefined) {
        console.warn(`  ⚠️  SetRef "${setRef}" in TemplateSetItems was not found/created in TemplateSets — skipping its items`);
        continue;
      }

      const usedOrders = new Set<number>();
      const resolvedItems: Prisma.TemplateSetItemCreateManyInput[] = [];
      rows.forEach((row, idx) => {
        const tmpl = templateRefMap.get(row.templateRef);
        if (!tmpl) {
          console.warn(`  ⚠️  TemplateRef "${row.templateRef}" (SetRef "${setRef}") not found — item skipped`);
          return;
        }
        if (tmpl.status !== 'Published') {
          console.warn(`  ⚠️  TemplateRef "${row.templateRef}" (SetRef "${setRef}") is not Published — item skipped`);
          return;
        }
        let orderIndex = row.orderIndex ?? idx;
        if (usedOrders.has(orderIndex)) {
          console.warn(`  ⚠️  Duplicate OrderIndex ${orderIndex} in SetRef "${setRef}" — using next available index`);
          orderIndex = Math.max(...usedOrders) + 1;
        }
        usedOrders.add(orderIndex);

        resolvedItems.push({
          setId,
          templateId: tmpl.id,
          orderIndex,
          deadlineOffsetDays: row.deadlineOffsetDays,
          estimatedHours: row.estimatedHours,
          skillLevel: row.skillLevel,
          requiresApproval: row.requiresApproval,
          defaultNote: row.defaultNote,
        });
      });

      if (resolvedItems.length === 0) {
        console.warn(`  ⚠️  No valid items resolved for SetRef "${setRef}" — leaving existing items untouched`);
        continue;
      }

      await prisma.$transaction([
        prisma.templateSetItem.deleteMany({ where: { setId } }),
        prisma.templateSetItem.createMany({ data: resolvedItems }),
      ]);
      itemSetsReplaced++;
      console.log(`  ↻  Replaced items for SetRef "${setRef}" (${resolvedItems.length} item(s))`);
    }
  }

  // ── Sheet 5: WpBlueprints ─────────────────────────────────────────────────
  let bpCreated = 0;
  let bpUpdated = 0;

  if (hasBlueprints) {
    const bpRows = parseWpBlueprintsSheet(wb.Sheets['WpBlueprints']!);
    console.log(`   Parsed ${bpRows.length} WP blueprint row(s) from WpBlueprints sheet`);

    for (const row of bpRows) {
      const division = divMap.get(row.divisionCode);
      if (!division) {
        console.warn(`  ⚠️  Division code "${row.divisionCode}" not found — skipping BlueprintRef "${row.blueprintRef}"`);
        continue;
      }
      const owner = userMap.get(row.employeeId);
      if (!owner) {
        console.warn(`  ⚠️  Owner employeeId "${row.employeeId}" not found — skipping BlueprintRef "${row.blueprintRef}"`);
        continue;
      }
      if (!wpTypeCodes.has(row.type)) {
        console.warn(`  ⚠️  Type "${row.type}" is not a known WpType code — skipping BlueprintRef "${row.blueprintRef}"`);
        continue;
      }
      if (row.defaultDuration === null || row.defaultDuration < 1) {
        console.warn(`  ⚠️  BlueprintRef "${row.blueprintRef}" has an invalid DefaultDuration — skipped`);
        continue;
      }

      let autoGenTemplateId: number | null = null;
      if (row.autoGenTemplateRef) {
        const tmpl = templateRefMap.get(row.autoGenTemplateRef);
        if (!tmpl) {
          console.warn(`  ⚠️  AutoGenTemplateRef "${row.autoGenTemplateRef}" not found — skipping BlueprintRef "${row.blueprintRef}"`);
          continue;
        }
        autoGenTemplateId = tmpl.id;
      }
      let autoGenSetId: number | null = null;
      if (row.autoGenSetRef) {
        const setId = setRefToId.get(row.autoGenSetRef);
        if (setId === undefined) {
          console.warn(`  ⚠️  AutoGenSetRef "${row.autoGenSetRef}" not found/created — skipping BlueprintRef "${row.blueprintRef}"`);
          continue;
        }
        autoGenSetId = setId;
      }

      const autoGen = await validateAutoGenConfig(prisma, {
        autoGenerate: row.autoGenerate,
        autoGenMode: row.autoGenMode,
        autoGenInterval: row.autoGenInterval,
        autoGenTemplateId,
        autoGenSetId,
        autoGenInlineSet: undefined,
      });
      if ('error' in autoGen) {
        console.warn(`  ⚠️  BlueprintRef "${row.blueprintRef}": ${autoGen.error} — skipped`);
        continue;
      }

      const recurrence = resolveRecurrence({
        recurrenceType: row.recurrenceType,
        recurrenceInterval: row.recurrenceInterval,
        recurrenceStartDate: row.recurrenceStartDate,
      });
      if ('error' in recurrence) {
        console.warn(`  ⚠️  BlueprintRef "${row.blueprintRef}": ${recurrence.error} — skipped`);
        continue;
      }

      const existing = await prisma.wpBlueprint.findUnique({ where: { externalRef: row.blueprintRef } });
      if (existing) {
        if (existing.type !== row.type) {
          console.warn(`  ⚠️  BlueprintRef "${row.blueprintRef}": Type is immutable after creation — Excel value "${row.type}" ignored (kept "${existing.type}")`);
        }
        // divisionId/ownerId/type are creation-time-only (matches the API's PUT semantics).
        await prisma.wpBlueprint.update({
          where: { externalRef: row.blueprintRef },
          data: {
            name: row.name,
            description: row.description,
            defaultDuration: row.defaultDuration,
            defaultAutoGenerate: autoGen.data.autoGenerate,
            defaultAutoGenMode: autoGen.data.autoGenMode,
            defaultAutoGenInterval: autoGen.data.autoGenInterval,
            defaultAutoGenTemplateId: autoGen.data.autoGenTemplateId,
            defaultAutoGenSetId: autoGen.data.autoGenSetId,
            defaultAutoGenInlineSet: autoGen.data.autoGenInlineSet,
            recurrenceType: recurrence.data.recurrenceType,
            recurrenceInterval: recurrence.data.recurrenceInterval,
            recurrenceStartDate: recurrence.data.recurrenceStartDate,
            nextRunAt: recurrence.data.nextRunAt,
          },
        });
        bpUpdated++;
        console.log(`  ↻  Updated WpBlueprint: [${row.blueprintRef}] — ${row.name}`);
      } else {
        await prisma.wpBlueprint.create({
          data: {
            externalRef: row.blueprintRef,
            name: row.name,
            description: row.description,
            type: row.type,
            divisionId: division.id,
            ownerId: owner.id,
            defaultDuration: row.defaultDuration,
            defaultAutoGenerate: autoGen.data.autoGenerate,
            defaultAutoGenMode: autoGen.data.autoGenMode,
            defaultAutoGenInterval: autoGen.data.autoGenInterval,
            defaultAutoGenTemplateId: autoGen.data.autoGenTemplateId,
            defaultAutoGenSetId: autoGen.data.autoGenSetId,
            defaultAutoGenInlineSet: autoGen.data.autoGenInlineSet,
            recurrenceType: recurrence.data.recurrenceType,
            recurrenceInterval: recurrence.data.recurrenceInterval,
            recurrenceStartDate: recurrence.data.recurrenceStartDate,
            nextRunAt: recurrence.data.nextRunAt,
          },
        });
        bpCreated++;
        console.log(`  ✓  Created WpBlueprint: [${row.blueprintRef}] — ${row.name}`);
      }
    }
  }

  console.log('');
  console.log('🎉 Template set & WP blueprint seed complete!');
  console.log('');
  console.log('── Summary ─────────────────────────────────────────');
  console.log(`   Template Sets created   : ${setsCreated}`);
  console.log(`   Template Sets updated   : ${setsUpdated}`);
  console.log(`   Set item groups replaced: ${itemSetsReplaced}`);
  console.log(`   WP Blueprints created   : ${bpCreated}`);
  console.log(`   WP Blueprints updated   : ${bpUpdated}`);
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
