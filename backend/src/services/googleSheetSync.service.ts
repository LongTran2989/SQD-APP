// ─── Google Sheet WP Sync service ───────────────────────────────────────────
//
// On-demand, manual sync from the MCC's public Google Sheet maintenance schedule
// into SQD-APP Work Packages. A Manager/Director/Admin triggers a preview (diff
// against existing WPs), reviews it, then confirms execution.
//
// Compliance notes (CLAUDE.md):
//  - Rule 2: every WorkPackage read includes `deletedAt: null`.
//  - Rule 3: every reschedule dual-writes AuditLog + a WP SYSTEM_EVENT feed post.
//    `logWpSystemEvent` in wp.controller is PRIVATE/non-exported, so we call
//    `createFeedPost` from feedService directly for the SYSTEM_EVENT side.
//  - WP status is read from the STORED `status` field only ('Open'/'In Progress'
//    are both stored as 'Open'; only 'Closed'/'Inactive' are terminal). We never
//    call computeWpStatus() here.
//  - Creation mirrors `launchBlueprint` (wpBlueprint.controller.ts) exactly:
//    re-validate the blueprint autogen config, create via createWorkPackageService
//    (which dual-writes internally), then fire auto-gen when in-window.

import { prisma } from '../lib/prisma';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { createWorkPackageService } from '../controllers/wp.controller';
import { fireAutoGenForWp, validateAutoGenConfig, calendarDateUtc, AutoGenColumns } from '../services/autoGenService';
import { createFeedPost } from '../services/feedService';

// ─── Zod schema for a raw CSV row ────────────────────────────────────────────
// Keys match the Google Sheet header columns verbatim. Optional descriptive
// columns default to '' so a missing column never fails validation.
// Date/time cells are accepted as string OR number: when the CSV exporter (or
// xlsx's CSV reader) interprets a cell as a date/number it arrives as an Excel
// serial number, not text — parseSheetDatetime handles both shapes.
const DateTimeCell = z.union([z.string(), z.number()]);
const SheetRowSchema = z.object({
  'WP No.': z.coerce.string().min(1),
  'WP Desc.': z.coerce.string().optional().default(''),
  'WP Status Name': z.coerce.string(),
  'Station': z.coerce.string(),
  'TAT': z.coerce.number().nonnegative(),
  'Start Date': DateTimeCell,
  'Start Time': DateTimeCell,
  'End Date': DateTimeCell,
  'End Time': DateTimeCell,
  'A/C Reg.': z.coerce.string().optional().default(''),
  'Customer': z.coerce.string().optional().default(''),
});
type SheetRow = z.infer<typeof SheetRowSchema>;

// ─── Exported types (controller + tests) ─────────────────────────────────────

export interface ValidatedRow {
  wpNo: string; // source: WP No.
  description: string; // source: WP Desc.
  station: string; // 'HAN' | 'SGN'
  tatDays: number; // determines blueprint: <=2 → PC-EQ, >2 → CHECK
  timeframeFrom: Date; // UTC
  timeframeTo: Date; // UTC
  acRegistration: string;
  customer: string;
}

export interface PreviewItem {
  wpNo: string;
  description: string;
  station: string;
  tatDays: number;
  acRegistration: string;
  customer: string;
  timeframeFrom: Date;
  timeframeTo: Date;
  // For toUpdate — the existing WP's current dates (for the diff display).
  currentTimeframeFrom?: Date;
  currentTimeframeTo?: Date;
  // DB id of the matched WP, used to re-query it in executeSync.
  existingWpId?: number;
}

export interface PreviewData {
  toCreate: PreviewItem[];
  toUpdate: PreviewItem[];
  collisions: PreviewItem[]; // matched Closed/Inactive WPs
  noChange: PreviewItem[];
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { wpNo: string; reason: string }[];
}

export interface SyncOptions {
  // key = wpNo. Absent or 'skip' → ignore the collision; 'create-new' → create
  // a uniquely-suffixed (-REV2..) WP for it.
  collisionDecisions: Record<string, 'skip' | 'create-new'>;
}

// Station → Division code. HAN is QC Hanoi, SGN is QC Saigon.
const STATION_TO_DIVISION_CODE: Record<string, string> = { HAN: 'QCH', SGN: 'QCS' };

// ─── Date parsing ────────────────────────────────────────────────────────────
// The sheet stores wall-clock UTC. We combine the date + time columns into a UTC
// Date WITHOUT applying any timezone offset (the spec is explicit: times are
// already UTC; do not double-shift). Both 'DD/MM/YYYY' and 'YYYY-MM-DD' date
// formats are accepted because the live sheet's exact format is unconfirmed.
// Extracts the calendar date (Y/M/D) from a date cell that is either an Excel
// serial number or a 'DD/MM/YYYY' / 'YYYY-MM-DD' string. SSF conversion is
// locale- and timezone-independent (no Date construction in local time).
function parseDatePart(value: string | number): { year: number; month: number; day: number } | null {
  if (typeof value === 'number') {
    const c = XLSX.SSF.parse_date_code(value);
    if (!c || !c.y) return null;
    return { year: c.y, month: c.m, day: c.d };
  }
  const d = value.trim();
  const iso = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  if (dmy) return { year: Number(dmy[3]), month: Number(dmy[2]), day: Number(dmy[1]) };
  return null;
}

// Extracts H/M/S from a time cell that is either an Excel day-fraction number or
// an 'HH:mm[:ss]' string.
function parseTimePart(value: string | number): { hh: number; mm: number; ss: number } | null {
  if (typeof value === 'number') {
    const c = XLSX.SSF.parse_date_code(value);
    if (!c) return null;
    return { hh: c.H, mm: c.M, ss: c.S };
  }
  const tm = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!tm) return null;
  return { hh: Number(tm[1]), mm: Number(tm[2]), ss: tm[3] ? Number(tm[3]) : 0 };
}

function parseSheetDatetime(dateVal: string | number, timeVal: string | number): Date | null {
  const dp = parseDatePart(dateVal);
  const tp = parseTimePart(timeVal);
  if (!dp || !tp) return null;
  const { year, month, day } = dp;
  const { hh, mm, ss } = tp;

  if (month < 1 || month > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 59) {
    return null;
  }

  const ms = Date.UTC(year, month - 1, day, hh, mm, ss);
  const date = new Date(ms);
  // Guard against rollover (e.g. 31/02 → March): the parsed parts must round-trip.
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

// ─── 1. Fetch + parse + validate + filter ────────────────────────────────────
export async function fetchAndParseSheet(url: string): Promise<ValidatedRow[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s
  let csvText: string;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Google Sheet fetch failed: HTTP ${res.status}`);
    csvText = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const wb = XLSX.read(csvText, { type: 'string' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName]!;
  const rawRows: unknown[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const out: ValidatedRow[] = [];
  for (const raw of rawRows) {
    const parsed = SheetRowSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[SheetSync] Skipping row — schema validation failed:', parsed.error.issues?.[0]?.message);
      continue;
    }
    const row: SheetRow = parsed.data;

    // Trigger-scope filters (all must hold).
    if (row.Station !== 'HAN' && row.Station !== 'SGN') continue;
    if (!row['WP No.'].includes('CHK')) continue;
    if (row['WP Status Name'] !== 'In Preparation') continue;

    const timeframeFrom = parseSheetDatetime(row['Start Date'], row['Start Time']);
    const timeframeTo = parseSheetDatetime(row['End Date'], row['End Time']);
    if (!timeframeFrom || !timeframeTo) {
      console.warn(`[SheetSync] Skipping row "${row['WP No.']}" — unparseable date/time.`);
      continue;
    }
    if (timeframeFrom.getTime() >= timeframeTo.getTime()) {
      console.warn(`[SheetSync] Skipping row "${row['WP No.']}" — Start is not before End.`);
      continue;
    }

    out.push({
      wpNo: row['WP No.'].trim(),
      description: row['WP Desc.'] ?? '',
      station: row.Station,
      tatDays: row.TAT,
      timeframeFrom,
      timeframeTo,
      acRegistration: row['A/C Reg.'] ?? '',
      customer: row.Customer ?? '',
    });
  }
  return out;
}

// ─── 2. Diff against existing WPs ────────────────────────────────────────────
function toPreviewItem(row: ValidatedRow, extra: Partial<PreviewItem> = {}): PreviewItem {
  return {
    wpNo: row.wpNo,
    description: row.description,
    station: row.station,
    tatDays: row.tatDays,
    acRegistration: row.acRegistration,
    customer: row.customer,
    timeframeFrom: row.timeframeFrom,
    timeframeTo: row.timeframeTo,
    ...extra,
  };
}

export async function getPreviewData(rows: ValidatedRow[]): Promise<PreviewData> {
  const result: PreviewData = { toCreate: [], toUpdate: [], collisions: [], noChange: [] };
  if (rows.length === 0) return result;

  const wpNos = rows.map((r) => r.wpNo);
  // Rule 2: deletedAt: null on every WP read. A soft-deleted WP with the same
  // name is intentionally treated as "not found" → toCreate.
  const existing = await prisma.workPackage.findMany({
    where: { name: { in: wpNos }, deletedAt: null },
    select: { id: true, name: true, status: true, timeframeFrom: true, timeframeTo: true },
  });
  const existingMap = new Map(existing.map((wp) => [wp.name, wp]));

  for (const row of rows) {
    const match = existingMap.get(row.wpNo);

    if (!match) {
      result.toCreate.push(toPreviewItem(row));
      continue;
    }

    // STORED status only — 'Open'/'In Progress' both store as 'Open'.
    if (match.status === 'Closed' || match.status === 'Inactive') {
      result.collisions.push(toPreviewItem(row, { existingWpId: match.id }));
      continue;
    }

    const fromChanged = match.timeframeFrom.getTime() !== row.timeframeFrom.getTime();
    const toChanged = match.timeframeTo.getTime() !== row.timeframeTo.getTime();
    if (fromChanged || toChanged) {
      result.toUpdate.push(
        toPreviewItem(row, {
          existingWpId: match.id,
          currentTimeframeFrom: match.timeframeFrom,
          currentTimeframeTo: match.timeframeTo,
        })
      );
    } else {
      result.noChange.push(toPreviewItem(row, { existingWpId: match.id }));
    }
  }
  return result;
}

// ─── 3. Execute ──────────────────────────────────────────────────────────────

const fmtDate = (d: Date): string => new Date(d).toISOString();

// Coerces a value that may arrive as a string (the frontend round-trips the
// preview through JSON, so Dates become ISO strings) into a real Date.
function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

// Finds a free WP name for a collision by appending -REV2..-REV9. Honours Rule 2.
async function findAvailableName(baseName: string): Promise<string | null> {
  for (let rev = 2; rev <= 9; rev++) {
    const candidate = `${baseName}-REV${rev}`;
    const taken = await prisma.workPackage.findFirst({
      where: { name: candidate, deletedAt: null },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return null;
}

export async function executeSync(
  previewData: PreviewData,
  actor: { userId: number },
  options: SyncOptions
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  // Resolve both blueprints from env-configured names. Fail fast (clear 500) so
  // we never silently create malformed/orphaned WPs.
  const chkName = process.env.SHEET_CHK_BLUEPRINT_NAME;
  const pcEqName = process.env.SHEET_PC_EQ_BLUEPRINT_NAME;
  if (!chkName) throw new Error('SHEET_CHK_BLUEPRINT_NAME is not configured');
  if (!pcEqName) throw new Error('SHEET_PC_EQ_BLUEPRINT_NAME is not configured');
  const chkBp = await prisma.wpBlueprint.findFirst({ where: { name: chkName, isActive: true } });
  if (!chkBp) throw new Error(`CHK Blueprint not found or inactive: "${chkName}"`);
  const pcEqBp = await prisma.wpBlueprint.findFirst({ where: { name: pcEqName, isActive: true } });
  if (!pcEqBp) throw new Error(`PC-EQ Blueprint not found or inactive: "${pcEqName}"`);

  // Re-validate each blueprint's autogen config (a referenced template/set may
  // have been archived since the blueprint was saved). Mirrors launchBlueprint.
  const blueprints = [chkBp, pcEqBp].map((bp) => ({ bp, autoGen: null as null | { data: AutoGenColumns } }));
  for (const entry of blueprints) {
    const v = await validateAutoGenConfig(prisma, {
      autoGenerate: entry.bp.defaultAutoGenerate,
      autoGenMode: entry.bp.defaultAutoGenMode,
      autoGenInterval: entry.bp.defaultAutoGenInterval,
      autoGenTemplateId: entry.bp.defaultAutoGenTemplateId,
      autoGenSetId: entry.bp.defaultAutoGenSetId,
      autoGenInlineSet: entry.bp.defaultAutoGenInlineSet ?? undefined,
    });
    if ('error' in v) {
      throw new Error(`Blueprint "${entry.bp.name}" auto-generate config is no longer valid: ${v.error}`);
    }
    entry.autoGen = v;
  }
  const chkAutoGen = blueprints[0]!.autoGen!.data;
  const pcEqAutoGen = blueprints[1]!.autoGen!.data;

  // Shared create routine for toCreate + accepted collisions.
  const createOne = async (item: PreviewItem, name: string): Promise<void> => {
    const divisionCode = STATION_TO_DIVISION_CODE[item.station];
    if (!divisionCode) throw new Error(`No division mapping for station "${item.station}"`);
    const division = await prisma.division.findFirst({ where: { code: divisionCode }, select: { id: true } });
    if (!division) throw new Error(`Division not found for station "${item.station}" (code ${divisionCode})`);

    const useBp = item.tatDays <= 2 ? pcEqBp : chkBp;
    const autoGenData = item.tatDays <= 2 ? pcEqAutoGen : chkAutoGen;

    const wp = await createWorkPackageService(prisma, actor, {
      name,
      type: useBp.type,
      divisionId: division.id,
      timeframeFrom: asDate(item.timeframeFrom),
      timeframeTo: asDate(item.timeframeTo),
      typeFields: {
        acRegistration: item.acRegistration || useBp.acRegistration,
        customer: item.customer || useBp.customer,
        authority: useBp.authority,
        targetDepartmentId: useBp.targetDepartmentId,
      },
      autoGenData,
      blueprintId: useBp.id,
      isRoutine: false,
      auditActionType: 'WP_SYNC_CREATED',
      auditDetails: { wpNo: name, station: item.station, source: 'GoogleSheetSync' },
      systemEventContent: `Work Package "${name}" created via Google Sheet Sync.`,
    });

    if (wp.autoGenerate) {
      const today = calendarDateUtc(new Date());
      const from = calendarDateUtc(wp.timeframeFrom);
      if (today >= from) {
        await fireAutoGenForWp(wp.id);
      }
    }
    result.created++;
  };

  // ── toCreate ──
  for (const item of previewData.toCreate ?? []) {
    try {
      await createOne(item, item.wpNo);
    } catch (err) {
      result.errors.push({ wpNo: item.wpNo, reason: err instanceof Error ? err.message : 'Create failed' });
    }
  }

  // ── collisions accepted as new ──
  for (const item of previewData.collisions ?? []) {
    if (options.collisionDecisions[item.wpNo] !== 'create-new') {
      result.skipped++;
      continue;
    }
    try {
      const name = await findAvailableName(item.wpNo);
      if (!name) {
        result.errors.push({ wpNo: item.wpNo, reason: 'No available -REV name (2-9 all taken)' });
        continue;
      }
      await createOne(item, name);
    } catch (err) {
      result.errors.push({ wpNo: item.wpNo, reason: err instanceof Error ? err.message : 'Collision create failed' });
    }
  }

  // ── toUpdate (reschedule) ──
  for (const item of previewData.toUpdate ?? []) {
    try {
      if (item.existingWpId == null) {
        result.errors.push({ wpNo: item.wpNo, reason: 'Missing existingWpId — cannot reschedule' });
        continue;
      }
      const newFrom = asDate(item.timeframeFrom);
      const newTo = asDate(item.timeframeTo);
      if (newFrom.getTime() >= newTo.getTime()) {
        result.errors.push({ wpNo: item.wpNo, reason: 'Start is not before End — reschedule rejected' });
        continue;
      }

      // Race-condition guard: re-query the specific WP (Rule 2). If it was
      // closed/inactivated/soft-deleted since the preview, skip it.
      const fresh = await prisma.workPackage.findFirst({
        where: { id: item.existingWpId, deletedAt: null },
        select: { id: true, timeframeFrom: true, timeframeTo: true, status: true },
      });
      if (!fresh || fresh.status === 'Closed' || fresh.status === 'Inactive') {
        result.errors.push({ wpNo: item.wpNo, reason: 'WP was closed/inactivated since preview — skipped' });
        result.skipped++;
        continue;
      }

      await prisma.workPackage.update({
        where: { id: item.existingWpId },
        data: { timeframeFrom: newFrom, timeframeTo: newTo },
      });

      // Rule 3 — dual write: AuditLog + WP SYSTEM_EVENT feed post.
      await prisma.auditLog.create({
        data: {
          actionType: 'WP_SYNC_RESCHEDULED',
          entityType: 'WorkPackage',
          entityId: String(item.existingWpId),
          performedByUserId: actor.userId,
          details: {
            wpNo: item.wpNo,
            from: { old: fresh.timeframeFrom.toISOString(), new: newFrom.toISOString() },
            to: { old: fresh.timeframeTo.toISOString(), new: newTo.toISOString() },
            source: 'GoogleSheetSync',
          },
        },
      });
      await createFeedPost(prisma, {
        type: 'SYSTEM_EVENT',
        scope: 'WP',
        scopeId: item.existingWpId,
        content: `Schedule updated via Google Sheet Sync: ${fmtDate(newFrom)} → ${fmtDate(newTo)}.`,
        metadata: { performedByUserId: actor.userId, source: 'GoogleSheetSync' },
      });
      result.updated++;
    } catch (err) {
      result.errors.push({ wpNo: item.wpNo, reason: err instanceof Error ? err.message : 'Reschedule failed' });
    }
  }

  return result;
}
