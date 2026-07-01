# Google Sheet WP Sync — Final Implementation Plan (Claude Code Ready)

**Document Status:** FINAL — Approved for Claude Code execution.
**Audited by:** Antigravity (Claude) — 2026-06-30
**Codebase version:** Post-Phase 7. All non-negotiable rules from `CLAUDE.md` apply.

---

## Part 1: Resolved Open Questions (With Recommendations)

---

### Q1: Blueprint Resolution Strategy

**Decision (Recommended):** Use **blueprint name strings in `.env`**, resolved at runtime via a DB lookup.

```env
SHEET_CHK_BLUEPRINT_NAME="CHK Blueprint"
SHEET_PC_EQ_BLUEPRINT_NAME="PC-EQ Blueprint"
```

**Why:** Integer IDs diverge between dev and prod environments silently. A name string is self-documenting and portable. If the blueprint name doesn't match an active record, the sync service throws an explicit, readable error immediately, not a cryptic FK violation.

**Implementation:** At the start of `executeSync()`, resolve both blueprints:
```typescript
const chkBp = await prisma.wpBlueprint.findFirst({
  where: { name: process.env.SHEET_CHK_BLUEPRINT_NAME, isActive: true }
});
if (!chkBp) throw new Error(`CHK Blueprint not found or inactive: "${process.env.SHEET_CHK_BLUEPRINT_NAME}"`);
```
This fails fast with a 500 error and a clear log message, preventing silent bad data creation.

---

### Q2: Google Sheet CSV URL Format

**Decision (Recommended):** Store the URL in `.env` as `GOOGLE_SHEET_CSV_URL`. The spec locks this to a public CSV export URL (no OAuth).

```env
GOOGLE_SHEET_CSV_URL="https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=SHEET_GID"
```

**Node version is v24.15.0** — native `fetch()` is available globally. No `node-fetch` package needed.

**Implementation:** Use native `fetch()` with a timeout via `AbortController`:
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
const res = await fetch(url, { signal: controller.signal });
clearTimeout(timeout);
if (!res.ok) throw new Error(`Google Sheet fetch failed: HTTP ${res.status}`);
const csvText = await res.text();
```

**CSV parsing:** Use the already-installed `xlsx` package's CSV reading function (`xlsx.read(csvText, { type: 'string' })`) — it handles edge cases like quoted commas and multi-line cells. Despite the security note in the audit (ISSUE-5), for a **trusted, known-format internal CSV URL** this risk is acceptable for V1. The audit flag is documented as `DEF-7` in `CODE_REVIEW_AUDIT_LOG.md` post-feature.

---

### Q3: `divisionId` Resolution

**Decision (Recommended):** Use **DB lookup by division `code` at sync time**, not env vars.

```typescript
const divisionMap: Record<string, string> = { 'HAN': 'QCH', 'SGN': 'QCS' };
const divisionCode = divisionMap[row.station];
const division = await prisma.division.findFirst({ where: { code: divisionCode } });
if (!division) throw new Error(`Division not found for station: ${row.station}`);
```

**Why:** Division IDs are auto-incremented and would diverge between dev/prod. Division `code` is a stable, seeded business identifier. This pattern mirrors how other services resolve division context (the blueprint controller does the same). No additional env vars needed.

---

### Q4: WP `creatorId` on Sync-Created WPs

**Decision (Recommended):** Use the **logged-in manager's `userId`** (`req.user!.userId`) — identical to the `launchBlueprint` pattern.

This is the correct choice because:
1. It creates a clear human accountability chain in the `AuditLog`.
2. It's consistent with how blueprint launches work today.
3. The `creatorId` determines who can later manage the WP (edit, close) — a named manager is appropriate.

The `userId` is threaded from `req.user!.userId` in the controller down to `executeSync(previewData, { userId: req.user!.userId })`.

---

### Q5: `WP No.` Format and `-REV2` Suffix

**Decision (Recommended):** The `-REV2` appendment is acceptable for V1 as-is. The preview modal makes this **explicit to the user** before they confirm, so ops teams are informed.

**Additional safeguard:** If a WP named `VN-CHK-001-REV2` also already exists as Closed/Inactive, the service appends `-REV3`, iterating up to `-REV9`. Beyond that, it returns an error for that row. This is defensive and handles edge cases without breaking the sync.

---

## Part 2: Full Audit Findings (Verified)

| Issue | Severity | Resolution |
| :--- | :--- | :--- |
| ISSUE-1: WP status is partially computed | 🔴 Critical | Use stored `status` field only — `status: { notIn: ['Closed', 'Inactive'] }` |
| ISSUE-2: Route `/api/sync/` is too generic | ⚠️ Warning | Rename to `/api/sheet-sync/` |
| ISSUE-3: Blueprint env var IDs are fragile | ⚠️ Warning | Use name-string lookup (resolved in Q1) |
| ISSUE-4: Actor `userId` not threaded | ⚠️ Warning | Pass `actor: { userId }` explicitly (resolved in Q4) |
| ISSUE-5: `xlsx` security concern | ⚠️ Warning | Acceptable for V1 (trusted URL); log as DEF-7 |
| ISSUE-6: No DB unique constraint on WP name | 📋 Tech Debt | V2 item. V1 uses pre-create DB check in same transaction. |
| ISSUE-7: `MANAGER_ROLES` includes 'Staff' | 📋 Tech Debt | Fix in same file edit as the sync button addition. |
| ISSUE-8 (NEW): `logWpSystemEvent` is PRIVATE | 🔴 Critical | Cannot be imported. Sync service must use `createFeedPost` directly from `feedService.ts`. |
| ISSUE-9 (NEW): `zod` is NOT in `package.json` | 🔴 Critical | Must install: `npm install zod` in `/backend` before writing validation code. |

---

## Part 3: Architecture & Precise Implementation Spec

### File Map

| Action | Path |
| :--- | :--- |
| NEW | `backend/src/services/googleSheetSync.service.ts` |
| NEW | `backend/src/controllers/googleSheetSync.controller.ts` |
| NEW | `backend/src/routes/googleSheetSync.routes.ts` |
| MODIFY | `backend/src/index.ts` |
| MODIFY | `backend/.env` (add 3 vars) |
| NEW | `frontend/src/api/sheetSyncApi.ts` |
| NEW | `frontend/src/components/SheetSyncModal.tsx` |
| MODIFY | `frontend/src/app/dashboard/master-calendar/page.tsx` |

---

### 3.1 Backend: `googleSheetSync.service.ts`

#### Imports Required
```typescript
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { createWorkPackageService, CreateWorkPackageInput } from '../controllers/wp.controller';
import { fireAutoGenForWp, validateAutoGenConfig, calendarDateUtc } from '../services/autoGenService';
import { createFeedPost } from '../services/feedService';
```

> [!IMPORTANT]
> `logWpSystemEvent` is a **private, non-exported** function in `wp.controller.ts`. The sync service **CANNOT import it**. Use `createFeedPost` directly from `feedService.ts` with `{ type: 'SYSTEM_EVENT', scope: 'WP', scopeId: wp.id }` for the dual-write requirement.

#### Zod Schema (Define once at module top level)
```typescript
const SheetRowSchema = z.object({
  'WP No.': z.string().min(1),
  'WP Desc.': z.string().optional().default(''),
  'WP Status Name': z.string(),
  'Station': z.string(),
  'TAT': z.coerce.number().nonnegative(),
  'Start Date': z.string().min(1),
  'Start Time': z.string().min(1),
  'End Date': z.string().min(1),
  'End Time': z.string().min(1),
  'A/C Reg.': z.string().optional().default(''),
  'Customer': z.string().optional().default(''),
});
type SheetRow = z.infer<typeof SheetRowSchema>;
```

#### Type Definitions (export all for controller/test use)
```typescript
export interface ValidatedRow {
  wpNo: string;           // source: WP No.
  description: string;    // source: WP Desc.
  station: string;        // 'HAN' | 'SGN'
  tatDays: number;        // determines blueprint: <=2 → PC-EQ, >2 → CHECK
  timeframeFrom: Date;    // UTC Date
  timeframeTo: Date;      // UTC Date
  acRegistration: string;
  customer: string;
}

export interface PreviewItem {
  wpNo: string;
  description: string;
  station: string;
  timeframeFrom: Date;
  timeframeTo: Date;
  // For toUpdate — the existing WP's current dates
  currentTimeframeFrom?: Date;
  currentTimeframeTo?: Date;
  existingWpId?: number;  // DB id of matched WP, for re-query in executeSync
}

export interface PreviewData {
  toCreate: PreviewItem[];
  toUpdate: PreviewItem[];
  collisions: PreviewItem[];  // matched Closed/Inactive WPs
  noChange: PreviewItem[];
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { wpNo: string; reason: string }[];
}

export interface SyncOptions {
  collisionDecisions: Record<string, 'skip' | 'create-new'>; // key = wpNo
}
```

#### Function: `fetchAndParseSheet(url: string): Promise<ValidatedRow[]>`

```
1. Native fetch(url) with 15-second AbortController timeout.
2. If !res.ok: throw Error with HTTP status code in message.
3. const csvText = await res.text()
4. Parse with xlsx: const wb = XLSX.read(csvText, { type: 'string' });
   const ws = wb.Sheets[wb.SheetNames[0]!];
   const rows: unknown[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
5. For each row: attempt SheetRowSchema.safeParse(row).
   - If failure: log warning and skip (don't throw; other rows may be valid).
6. Filter passing rows:
   - row.Station === 'HAN' || row.Station === 'SGN'
   - row['WP No.'].includes('CHK')
   - row['WP Status Name'] === 'In Preparation'
7. Combine date+time strings into UTC Date objects:
   - parseSheetDatetime(dateStr: string, timeStr: string): Date
   - Format expected: date = 'DD/MM/YYYY' or 'YYYY-MM-DD' (inspect real sheet)
   - The spec says "Google Sheet timestamp is in UTC" — store directly.
   - Validate timeframeFrom < timeframeTo; skip row with warning if not.
8. Return ValidatedRow[].
```

> [!IMPORTANT]
> Step 7 timezone note: the spec states Google Sheet times are already UTC. Do NOT apply any timezone offset. Just `new Date(combinedIsoString)`. The `calendarDateUtc()` helper from autoGenService is for calendar-date comparisons, not for shifting the stored value.

#### Function: `getPreviewData(rows: ValidatedRow[]): Promise<PreviewData>`

```
1. Extract all wpNos from rows: const wpNos = rows.map(r => r.wpNo)
2. Single DB query — CRITICAL: deletedAt: null ALWAYS:
   const existing = await prisma.workPackage.findMany({
     where: { name: { in: wpNos }, deletedAt: null },
     select: { id: true, name: true, status: true, timeframeFrom: true, timeframeTo: true }
   });
   const existingMap = new Map(existing.map(wp => [wp.name, wp]));

3. For each ValidatedRow:
   const match = existingMap.get(row.wpNo);

   if (!match) → toCreate

   // CRITICAL: Use STORED status field only.
   // 'Open' and 'In Progress' are stored as 'Open' in DB; only 'Closed'/'Inactive' are terminal.
   if (match.status === 'Closed' || match.status === 'Inactive') → collision

   // Date comparison: compare UTC timestamps
   const fromChanged = match.timeframeFrom.getTime() !== row.timeframeFrom.getTime();
   const toChanged = match.timeframeTo.getTime() !== row.timeframeTo.getTime();
   if (fromChanged || toChanged) → toUpdate (include existingWpId = match.id)

   else → noChange

4. Return PreviewData.
```

#### Function: `executeSync(previewData: PreviewData, actor: { userId: number }, options: SyncOptions): Promise<SyncResult>`

```
Setup:
  Resolve both blueprints from DB (fail fast if inactive):
    const chkBp = await prisma.wpBlueprint.findFirst({
      where: { name: process.env.SHEET_CHK_BLUEPRINT_NAME, isActive: true }
    });
    const pcEqBp = await prisma.wpBlueprint.findFirst({
      where: { name: process.env.SHEET_PC_EQ_BLUEPRINT_NAME, isActive: true }
    });
    if (!chkBp) throw error; if (!pcEqBp) throw error;

  Validate BOTH blueprints' autoGen config via validateAutoGenConfig(prisma, {...}).
  If 'error' in result: throw error. (Mirrors launchBlueprint lines 427-438.)

FOR EACH toCreate item:
  1. Resolve divisionId via DB: prisma.division.findFirst({ where: { code: divisionCode } })
     divisionCode = station === 'HAN' ? 'QCH' : 'QCS'
  2. Select blueprint: tatDays <= 2 ? pcEqBp : chkBp
  3. Build autoGenData from blueprint:
     const autoGenData = autoGenValidation.data  // result from validateAutoGenConfig above
  4. Call createWorkPackageService(prisma, actor, {
       name: item.wpNo,
       type: blueprint.type,          // e.g. 'CHECK'
       divisionId: division.id,
       timeframeFrom: item.timeframeFrom,
       timeframeTo: item.timeframeTo,
       typeFields: {
         acRegistration: item.acRegistration || blueprint.acRegistration,
         customer: item.customer || blueprint.customer,
         authority: blueprint.authority,
         targetDepartmentId: blueprint.targetDepartmentId,
       },
       autoGenData,
       blueprintId: blueprint.id,
       isRoutine: false,
       auditActionType: 'WP_SYNC_CREATED',
       auditDetails: { wpNo: item.wpNo, station: item.station, source: 'GoogleSheetSync' },
       systemEventContent: `Work Package "${item.wpNo}" created via Google Sheet Sync.`,
     });
  5. If wp.autoGenerate:
     const today = calendarDateUtc(new Date());
     const from = calendarDateUtc(wp.timeframeFrom);
     if (today >= from) await fireAutoGenForWp(wp.id);
  6. Wrap each creation in try/catch; push to errors[] if it fails (don't abort whole sync).

FOR EACH collision where collisionDecisions[item.wpNo] === 'create-new':
  1. Generate unique name: try suffixes -REV2, -REV3 ... -REV9
     const resolvedName = await findAvailableName(item.wpNo); // helper
  2. Proceed exactly as toCreate above, but with name = resolvedName.

FOR EACH toUpdate item:
  1. RACE CONDITION GUARD — re-query the specific WP:
     const fresh = await prisma.workPackage.findUnique({
       where: { id: item.existingWpId, deletedAt: null }
     });
     if (!fresh || fresh.status === 'Closed' || fresh.status === 'Inactive') {
       errors.push({ wpNo: item.wpNo, reason: 'WP was closed/inactivated since preview — skipped' });
       skipped++;
       continue;
     }
  2. Validate timeframeFrom < timeframeTo (should already be guaranteed, but double-check).
  3. Update dates:
     await prisma.workPackage.update({
       where: { id: item.existingWpId },
       data: { timeframeFrom: item.timeframeFrom, timeframeTo: item.timeframeTo }
     });
  4. DUAL WRITE — Rule 3 MANDATORY:
     a. AuditLog:
        await prisma.auditLog.create({ data: {
          actionType: 'WP_SYNC_RESCHEDULED',
          entityType: 'WorkPackage',
          entityId: String(item.existingWpId),
          performedByUserId: actor.userId,
          details: {
            wpNo: item.wpNo,
            from: { old: fresh.timeframeFrom, new: item.timeframeFrom },
            to: { old: fresh.timeframeTo, new: item.timeframeTo },
            source: 'GoogleSheetSync',
          }
        }});
     b. WP Feed (SYSTEM_EVENT via createFeedPost — NOT logWpSystemEvent, it's private):
        await createFeedPost(prisma, {
          type: 'SYSTEM_EVENT',
          scope: 'WP',
          scopeId: item.existingWpId,
          content: `Schedule updated via Google Sheet Sync: ${fmtDate(item.timeframeFrom)} → ${fmtDate(item.timeframeTo)}.`,
          metadata: { performedByUserId: actor.userId, source: 'GoogleSheetSync' }
        });
  5. Wrap each update in try/catch; push to errors[] if it fails.

Return SyncResult { created, updated, skipped, errors }.
```

---

### 3.2 Backend: `googleSheetSync.controller.ts`

```typescript
import { Request, Response } from 'express';
import { fetchAndParseSheet, getPreviewData, executeSync, SyncOptions } from '../services/googleSheetSync.service';

// GET /api/sheet-sync/preview
export const getPreview = async (req: Request, res: Response): Promise<void> => {
  try {
    const url = process.env.GOOGLE_SHEET_CSV_URL;
    if (!url) {
      res.status(500).json({ message: 'GOOGLE_SHEET_CSV_URL is not configured' });
      return;
    }
    const rows = await fetchAndParseSheet(url);
    const preview = await getPreviewData(rows);
    res.json(preview);
  } catch (error) {
    console.error('[SheetSync] Preview error:', error);
    res.status(500).json({ message: error instanceof Error ? error.message : 'Preview failed' });
  }
};

// POST /api/sheet-sync/execute
export const executeSyncHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { previewData, collisionDecisions } = req.body;
    if (!previewData) {
      res.status(400).json({ message: 'previewData is required' });
      return;
    }
    const options: SyncOptions = { collisionDecisions: collisionDecisions ?? {} };
    const result = await executeSync(previewData, { userId }, options);
    res.json(result);
  } catch (error) {
    console.error('[SheetSync] Execute error:', error);
    res.status(500).json({ message: error instanceof Error ? error.message : 'Sync execution failed' });
  }
};
```

> [!NOTE]
> The frontend sends `previewData` back to the server in the execute call body. This avoids a second expensive external HTTP fetch while still allowing the server to apply the collision decisions. The server applies the race-condition re-query on the specific `toUpdate` WPs before touching anything.

---

### 3.3 Backend: `googleSheetSync.routes.ts`

```typescript
import { Router } from 'express';
import { getPreview, executeSyncHandler } from '../controllers/googleSheetSync.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();
router.use(authenticateJWT);
router.get('/preview', requirePrivilege('wp:create'), getPreview);
router.post('/execute', requirePrivilege('wp:create'), executeSyncHandler);
export default router;
```

---

### 3.4 Backend: `index.ts` Modification

Add alongside existing imports:
```typescript
import sheetSyncRoutes from './routes/googleSheetSync.routes';
```
Add alongside existing `app.use(...)` lines (after line 83, before health check):
```typescript
app.use('/api/sheet-sync', sheetSyncRoutes);
```

---

### 3.5 Backend: `.env` Additions

Add these three variables:
```env
GOOGLE_SHEET_CSV_URL="https://docs.google.com/spreadsheets/d/REPLACE_WITH_REAL_ID/export?format=csv&gid=0"
SHEET_CHK_BLUEPRINT_NAME="CHK Blueprint"
SHEET_PC_EQ_BLUEPRINT_NAME="PC-EQ Blueprint"
```

---

### 3.6 Frontend: `sheetSyncApi.ts`

```typescript
import { apiClient } from './client';
import { PreviewData, SyncResult, SyncOptions } from './sheetSyncTypes';

export const getSheetSyncPreview = (): Promise<PreviewData> =>
  apiClient.get('/sheet-sync/preview').then(r => r.data);

export const executeSheetSync = (
  previewData: PreviewData,
  collisionDecisions: Record<string, 'skip' | 'create-new'>
): Promise<SyncResult> =>
  apiClient.post('/sheet-sync/execute', { previewData, collisionDecisions }).then(r => r.data);
```

---

### 3.7 Frontend: `SheetSyncModal.tsx`

#### State machine
```
'idle' → (user clicks SYNC button) →
'fetching-preview' → (GET /preview completes) →
'preview' → (user reviews, sets collision decisions, clicks Confirm) →
'executing' → (POST /execute completes) →
'result' → (user closes modal) →
'idle'
```

#### UI Sections

| Section | Badge Color | Condition | Per-row extras |
| :--- | :--- | :--- | :--- |
| New Work Packages | Green | `toCreate.length > 0` | Shows WP No., station, blueprint type (TAT-derived), dates |
| To Reschedule | Amber | `toUpdate.length > 0` | Shows current dates + new dates (diff highlighted) |
| Collisions | Red | `collisions.length > 0` | Skip / "Create as {wpNo}-REV2" toggle per row |
| No Changes | Grey | `noChange.length > 0` | Collapsed by default — just a count |

#### Result view

After execute, show:
- ✅ Created: X new Work Packages
- 🔄 Updated: Y reschedules
- ⏭️ Skipped: Z (collisions ignored)
- If `errors.length > 0`: show scrollable error list per WP No.

#### Access control (mirroring backend)
```typescript
const canSync = user && ['Manager', 'Director', 'Admin'].includes(user.role);
```

---

### 3.8 Frontend: `master-calendar/page.tsx` Modifications

**Change 1 — Fix pre-existing bug (ISSUE-7):**
```diff
- const MANAGER_ROLES = ['Manager', 'Director', 'Admin', 'Staff'];
+ const MANAGER_ROLES = ['Manager', 'Director', 'Admin'];
```

**Change 2 — State for modal:**
```typescript
const [syncModalOpen, setSyncModalOpen] = useState(false);
```

**Change 3 — Button in page header:**
Add inside the header `<div className="flex items-center gap-3 flex-wrap">` block alongside the existing filter dropdowns:
```tsx
{['Manager', 'Director', 'Admin'].includes(user.role) && (
  <button
    onClick={() => setSyncModalOpen(true)}
    className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
  >
    <RefreshCw className="w-4 h-4" />
    SYNC CHECK SCHEDULE
  </button>
)}
```

**Change 4 — Modal mount:**
```tsx
{syncModalOpen && (
  <SheetSyncModal onClose={() => setSyncModalOpen(false)} />
)}
```

---

## Part 4: Installation Prerequisites

Before writing any code, Claude Code must run (in order):

```cmd
cd backend && npm install zod
```

No other packages are needed:
- `xlsx` — already installed (`^0.18.5`)
- Native `fetch` — Node v24.15.0, available globally
- `zod` — NOT in `package.json`, must be installed

---

## Part 5: Compliance Checklist (CLAUDE.md)

| Rule | Verification |
| :--- | :--- |
| Rule 1: Plan first, wait for approval | ✅ This plan. |
| Rule 2: `deletedAt: null` on ALL WP reads | ✅ `findMany({ where: { name: { in: ... }, deletedAt: null } })` + re-query with `deletedAt: null` |
| Rule 3: Dual write — AuditLog AND SYSTEM_EVENT | ✅ Both explicitly called for each `toUpdate`. For `toCreate`, `createWorkPackageService` handles both internally. |
| Rule 8: Test DB isolation | ✅ Service is unit-testable. No cron job. |
| Rule 9: Prisma generate | N/A — No schema changes in V1. |
| Rule 11: cmd syntax only in docs | ✅ |
| Rule 12: Update CLAUDE_HANDOVER.md | 📋 Do after user confirms complete. |
| Rule 13: Update CODE_REVIEW_AUDIT_LOG.md | 📋 Log DEF-7 (xlsx) and ISSUE-7 fix after completion. |

---

## Part 6: Verification Plan

### 6.1 Automated Tests
**New file:** `backend/src/__tests__/googleSheetSync.service.test.ts`

Scenarios to test:
1. `fetchAndParseSheet` — mock `fetch` to return a CSV string with mix of valid/invalid rows. Assert skipped count correct.
2. `getPreviewData` — seed DB with WPs in various states (Open, Closed, Inactive). Assert each input row is classified correctly (`toCreate`, `toUpdate`, `collision`, `noChange`).
3. `getPreviewData` — WP with same name but `deletedAt` set must be treated as "not found" (`toCreate`). ← Critical Rule 2 test.
4. `executeSync` — toUpdate: assert `AuditLog` written with `actionType: 'WP_SYNC_RESCHEDULED'`, assert `FeedPost` written with `scope: 'WP'`.
5. `executeSync` — race condition: WP in `toUpdate` becomes `Closed` between preview and execute. Assert it's skipped with error entry.
6. `executeSync` — toCreate: assert `createWorkPackageService` called with correct `blueprintId`, `divisionId`, `type`.
7. `executeSync` — blueprint inactive: assert fast-fail with clear error message.

### 6.2 Manual Verification Steps
1. Set `GOOGLE_SHEET_CSV_URL` in `.env`. Click "SYNC CHECK SCHEDULE". Verify modal opens and shows a spinner then preview table.
2. Modify a start/end date in the real Google Sheet for an existing "Open" WP. Trigger sync. Verify "To Reschedule" section. Click Confirm. Verify DB updated and `AuditLog` row exists with `actionType: 'WP_SYNC_RESCHEDULED'`.
3. Close a WP in SQD-APP. Add a sheet row with the same `WP No.`. Trigger sync. Verify "Collisions" section appears.
4. Select "Create as -REV2" for a collision row and confirm. Verify a new WP exists with `-REV2` suffix.
5. Two-session race test: open preview in two browser tabs simultaneously. Confirm in tab 1 first. Then confirm in tab 2. Verify tab 2 sync gracefully skips already-processed rows and reports them in the error section.

---

## Part 7: Deferred to V2

- Admin UI for blueprint-to-check-type mapping (replaces env vars).
- Rate-limit `/api/sheet-sync/preview` — it makes an external HTTP call; a rapid-fire user could abuse it.
- DB unique index on `(divisionId, name, deletedAt)` for `WorkPackage` as a TOCTOU hardening measure.
- Upgrade or replace `xlsx` with `csv-parse` to resolve DEF-7.
- Batch `fireAutoGenForWp` calls (currently sequential per WP; could be parallelized for large syncs).
