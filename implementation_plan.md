# Finding Response Actions + Standalone Findings — Final Implementation Plan
*All design decisions locked. Codebase verified. Ready for implementation.*

---

## Confirmed Codebase Facts (Pre-implementation Check)

| Question | Answer |
|---|---|
| `Template.type` safe to repurpose? | ✅ Yes — freeform string, no validation, no filtering logic exists |
| `GET /api/datasources/departments` exists? | ✅ Yes — returns `{ value: string, label: string }[]` |
| `RaiseFindingPanel` `taskId` currently | Required prop on line 14 — must be made optional |
| Findings list page header right side | Empty — perfect slot for "Raise Finding" button (line 80–85) |
| `Finding.sourceTaskId` in schema | Already `Int?` (nullable) — no schema change needed for standalone |

---

## Part A — Finding Response Actions

### A1. Corrected Type Table

| Type | Target dept | Tasks per action | Multi-dept? | RCA/CAPA back | Director approval |
|---|---|---|---|---|---|
| IR | 1 dept | 1 | No | ✅ (internal SQD) | ❌ |
| CAR | 1 dept | 1 per dept | No | ✅ (external dept) | ❌ |
| NCR | 1 dept | 1 per dept | No | ✅ (external dept) | ❌ |
| QR | 1 dept | 1 per dept | No | ❌ (QR *is* the CAPA) | ❌ |
| QN | Multi-dept | 1 total | Yes | ❌ | ✅ Director only |
| Dissemination | Multi-dept | 1 total | Yes | ❌ | ❌ |

**All six types require at least one target department.**

### A2. Template Design

`Template.type String?` is repurposed to categorize templates by response action type. Admins set `type = 'CAR'` (etc.) when creating response-action templates. The `GenerateFollowUpModal` filters templates by `t.type === row.responseActionType` when a type is selected. When no type is selected, all templates are shown (backward-compatible).

---

## Schema Changes (Phase 1)

### [MODIFY] `backend/prisma/schema.prisma`

**A. Add to `Task` model** (after `issuanceNote`):
```prisma
responseActionType       String?  // CAR | NCR | QN | QR | IR | Dissemination
requiresDirectorApproval Boolean  @default(false)
```

**B. Add reverse relation to `Task`** (in relations block):
```prisma
responseAction FindingResponseAction? @relation("TaskResponseAction")
```

**C. Add to `Finding` model** (after `linksTo`):
```prisma
responseActions FindingResponseAction[] @relation("FindingResponseActions")
```

**D. Add to `User` model** (after other reverse relations):
```prisma
createdResponseActions FindingResponseAction[] @relation("FindingResponseActionCreatedBy")
```

**E. New model** (add in Findings Expansion section after `FindingLink`):
```prisma
// Response action raised from a Finding. Created atomically with the generated Task.
// Soft-deleted (never physically removed). targetDepartmentIds: null for IR is NOT valid
// (all types require at least one dept); always a JSON int-array.
// procedureRef: provision for Change Management phase (QN procedure doc reference).
model FindingResponseAction {
  id        Int     @id @default(autoincrement())
  findingId Int
  finding   Finding @relation("FindingResponseActions", fields: [findingId], references: [id], onDelete: Cascade)

  type   String // CAR | NCR | QN | QR | IR | Dissemination
  taskId Int?   @unique
  task   Task?  @relation("TaskResponseAction", fields: [taskId], references: [id])

  targetDepartmentIds Json    // int[] — always populated (all 6 types require a dept target)
  procedureRef        String? // Provision: procedure doc reference for Change Management phase
  note                String? // Optional Manager note

  createdByUserId Int
  createdByUser   User @relation("FindingResponseActionCreatedBy", fields: [createdByUserId], references: [id])

  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([findingId])
  @@index([type])
}
```

> [!IMPORTANT]
> Run in order on **both** `sqd_qa_db` and `sqd_qa_test_db`:
> 1. `npx prisma generate`
> 2. `npx prisma db push`
>
> `Finding.sourceTaskId` is already nullable — no change needed for standalone findings.

---

## Constants (Phase 1, same commit)

### [MODIFY] `backend/src/constants/findingExpansion.ts`

Add after `LINK_TYPES`:
```typescript
// ─── Response Action Types ─────────────────────────────────────────────────────
export const RESPONSE_ACTION_TYPES = [
  'CAR', 'NCR', 'QN', 'QR', 'IR', 'Dissemination'
] as const;

// All types require at least one target department.
export const REQUIRES_TARGET_DEPT_TYPES = RESPONSE_ACTION_TYPES; // alias for readability

// CAR/NCR/QR/IR: one task per department. QN/Dissemination: one task for all depts.
export const MULTI_DEPT_SINGLE_TASK_TYPES = ['QN', 'Dissemination'] as const;

// QN tasks require Director-only review. Always derived server-side, never from client.
export const DIRECTOR_APPROVAL_TYPES = ['QN'] as const;

export type ResponseActionType = (typeof RESPONSE_ACTION_TYPES)[number];
```

Add to `FINDING_EXPANSION_ACTIONS`:
```typescript
RESPONSE_ACTION_CREATED: 'RESPONSE_ACTION_CREATED',
```

---

## Backend — Finding Controller (Phase 2)

### [MODIFY] `backend/src/controllers/finding.controller.ts`

#### Change 1 — `CreateFindingParams` interface

Make `taskId` optional, add `targetDivisionId`:
```typescript
export interface CreateFindingParams {
  taskId?: number | null;          // now optional
  targetDivisionId?: number | null; // required when taskId is absent
  eventType: string;
  departmentId: number;
  description: string;
  fieldId?: string | null;
  aircraftRegistration?: string | null;
  regulatoryReference?: string | null;
  ataChapterId?: number | null;
  hazardTagIds?: number[];
}
```

#### Change 2 — `createFindingService` function body

Replace the existing task-load block with a conditional:
```typescript
// Resolve source and division.
let resolvedDivisionId: number | null = null;

if (taskId) {
  // Task-originated path (existing behaviour).
  const task = await client.task.findUnique({
    where: { id: taskId, deletedAt: null },
    select: { id: true, targetDivisionId: true, template: { select: { allowsFindings: true } } }
  });
  if (!task) throw new HttpError(404, 'Source task not found');
  if (!task.template?.allowsFindings) {
    throw new HttpError(400, "This task's template does not allow findings to be raised");
  }
  resolvedDivisionId = task.targetDivisionId ?? null;
} else {
  // Standalone path — targetDivisionId required.
  if (!targetDivisionId) {
    throw new HttpError(400, 'targetDivisionId is required when raising a finding without a source task');
  }
  const division = await client.division.findUnique({
    where: { id: targetDivisionId },
    select: { id: true }
  });
  if (!division) throw new HttpError(400, 'Division not found');
  resolvedDivisionId = targetDivisionId;
}
```

In `client.finding.create` data, update:
```typescript
sourceTaskId: taskId ?? null,
targetDivisionId: resolvedDivisionId,
```

In `logFindingAuditAndActivity` call, pass `taskId ?? null` as `sourceTaskId`:
```typescript
await logFindingAuditAndActivity(
  client,
  created.id,
  taskId ?? null,   // ← was task.id (always present before)
  'CREATED',
  actor.userId,
  `Finding #${created.id} raised by ${reporterName}`,
  { findingId: created.id, eventType, sourceTaskId: taskId ?? null }
);
```

#### Change 3 — `createFinding` HTTP handler

Destructure `targetDivisionId` from `req.body` and pass it through:
```typescript
const { taskId, targetDivisionId, fieldId, eventType, ... } = req.body;
// Pass both to service:
createFindingService(tx, { userId }, { taskId, targetDivisionId, ... })
```

#### Change 4 — `generateFollowUpTasks` — validation

Import new constants at top:
```typescript
import {
  RESPONSE_ACTION_TYPES,
  REQUIRES_TARGET_DEPT_TYPES,
  MULTI_DEPT_SINGLE_TASK_TYPES,
  DIRECTOR_APPROVAL_TYPES,
  FINDING_EXPANSION_ACTIONS
} from '../constants/findingExpansion';
```

In the pre-validation loop, after existing WP checks:
```typescript
if (entry.responseActionType != null) {
  if (!RESPONSE_ACTION_TYPES.includes(entry.responseActionType)) {
    res.status(400).json({ message: `Invalid responseActionType: '${entry.responseActionType}'` });
    return;
  }
  // All types require target departments.
  if (!Array.isArray(entry.targetDepartmentIds) || entry.targetDepartmentIds.length === 0) {
    res.status(400).json({ message: `responseActionType '${entry.responseActionType}' requires at least one targetDepartmentId` });
    return;
  }
  // Validate dept IDs exist in DB.
  const deptCount = await prisma.department.count({ where: { id: { in: entry.targetDepartmentIds } } });
  if (deptCount !== entry.targetDepartmentIds.length) {
    res.status(400).json({ message: 'One or more targetDepartmentIds not found' });
    return;
  }
  // CAR/NCR/QR/IR: exactly one dept per row (multi-dept = multiple rows).
  if (!(['QN', 'Dissemination'] as string[]).includes(entry.responseActionType)) {
    if (entry.targetDepartmentIds.length !== 1) {
      res.status(400).json({ message: `'${entry.responseActionType}' requires exactly one targetDepartmentId per task row` });
      return;
    }
  }
}
```

#### Change 5 — `generateFollowUpTasks` — task creation

In `tx.task.create` data object, add:
```typescript
responseActionType: entry.responseActionType ?? null,
requiresDirectorApproval: entry.responseActionType != null &&
  (DIRECTOR_APPROVAL_TYPES as readonly string[]).includes(entry.responseActionType),
```

After `tx.task.create`, still inside the loop, inside `$transaction`:
```typescript
if (entry.responseActionType != null) {
  await tx.findingResponseAction.create({
    data: {
      findingId: finding.id,
      type: entry.responseActionType,
      taskId: created.id,
      targetDepartmentIds: entry.targetDepartmentIds as Prisma.InputJsonValue,
      note: entry.note ?? null,
      procedureRef: entry.procedureRef ?? null,
      createdByUserId: userId,
    }
  });

  await logFindingAuditAndActivity(
    tx, finding.id, finding.sourceTaskId,
    FINDING_EXPANSION_ACTIONS.RESPONSE_ACTION_CREATED,
    userId,
    `Response action ${entry.responseActionType} created → Task ${created.taskId} by ${actorName}`,
    { findingId: finding.id, responseActionType: entry.responseActionType,
      taskId: created.taskId, taskDbId: created.id,
      targetDepartmentIds: entry.targetDepartmentIds }
  );
}
```

#### Change 6 — `getFindingById` — extend selects

In `followUpTasks` select block, add:
```typescript
responseActionType: true,
requiresDirectorApproval: true,
```

After `linksTo` in the main `include`, add:
```typescript
responseActions: {
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
  include: {
    task: { select: { id: true, taskId: true, status: true } },
    createdByUser: { select: { id: true, name: true } }
  }
},
```

In `res.json(...)`, after building `followUpTasks`, resolve department names:
```typescript
// Gather all dept IDs across all response actions, resolve once.
const allDeptIds = (finding.responseActions ?? [])
  .flatMap((ra) => (ra.targetDepartmentIds as number[]) ?? []);
const uniqueDeptIds = [...new Set(allDeptIds)];
const deptMap: Record<number, string> = {};
if (uniqueDeptIds.length > 0) {
  const depts = await prisma.department.findMany({
    where: { id: { in: uniqueDeptIds } },
    select: { id: true, name: true }
  });
  depts.forEach((d) => { deptMap[d.id] = d.name; });
}

// Attach resolved dept names to each responseAction.
const responseActions = (finding.responseActions ?? []).map((ra) => ({
  ...ra,
  targetDepartments: ((ra.targetDepartmentIds as number[]) ?? []).map((id) => ({
    id,
    name: deptMap[id] ?? `Dept ${id}`
  }))
}));
```

Pass `responseActions` and the extended `followUpTasks` (with `responseActionType`, `requiresDirectorApproval`) in the final `res.json(...)`.

---

## Backend — Task Controller (Phase 3)

### [MODIFY] `backend/src/controllers/task.controller.ts`

#### Change 1 — `taskInclude()` or equivalent select

Add to the select:
```typescript
responseActionType: true,
requiresDirectorApproval: true,
```

#### Change 2 — `reviewTask` — Director-only gate

After loading the task and before the general RBAC check:
```typescript
if (task.requiresDirectorApproval && role !== 'Director') {
  res.status(403).json({
    message: 'This task requires Director approval. Only a Director may review or approve it.'
  });
  return;
}
```

> [!IMPORTANT]
> This gate intentionally blocks Managers (even the Issuer) from approving QN tasks. The Issuer exception does NOT apply when `requiresDirectorApproval = true`. Only `role === 'Director'` may review.

---

## Backend — Tests (Phase 4)

### [MODIFY] `backend/tests/finding.test.ts`

Add test group **F-RAC (Response Action Creation)** with 15 tests:

| # | Scenario | Expected |
|---|---|---|
| RAC-01 | IR with 1 `targetDepartmentId` | 201, task `responseActionType='IR'`, `requiresDirectorApproval=false`, `FindingResponseAction` row created |
| RAC-02 | CAR with 1 dept | 201, action row linked, dept stored |
| RAC-03 | QN with 3 depts (multi-dept) | 201, one task, action row with 3 dept IDs |
| RAC-04 | Two rows: CAR + QN in one call | 201, two tasks, two action rows, correct types |
| RAC-05 | QN: `requiresDirectorApproval=true` | Director can review (200); Manager cannot (403) |
| RAC-06 | QN Director rejection → Follow-up Required → resubmit | Normal rejection flow works |
| RAC-07 | `responseActionType: 'INVALID'` | 400 |
| RAC-08 | Any type with no `targetDepartmentIds` | 400 |
| RAC-09 | CAR with 2 `targetDepartmentIds` (must be 1) | 400 |
| RAC-10 | `targetDepartmentIds` with non-existent IDs | 400 |
| RAC-11 | No `responseActionType` (backward-compat) | 201, `responseActionType=null`, no `FindingResponseAction` row |
| RAC-12 | `GET /api/findings/:id` includes `responseActions` | Array present with `type`, `targetDepartments[]`, linked task status |
| RAC-13 | `GET /api/findings/:id` followUpTasks include new fields | `responseActionType`, `requiresDirectorApproval` present |
| RAC-14 | `GET /api/tasks/:id` for a QN follow-up | `responseActionType='QN'`, `requiresDirectorApproval=true` |
| RAC-15 | `RESPONSE_ACTION_CREATED` appears in audit log | Dual-write verified |

**Target: existing baseline (307) + 15 new = 322 passing.**

---

## Part B — Standalone Finding Raise

### B1. Backend (Phase 2, same controller change)

Already covered in Change 1–3 of `finding.controller.ts` above. `taskId` becomes optional; `targetDivisionId` required when absent. No new endpoint — same `POST /api/findings`.

### B2. Frontend Types + API (Phase 5)

#### [MODIFY] `frontend/src/types/index.ts`

1. Add union type (after `FindingLinkType`):
```typescript
export type ResponseActionType = 'CAR' | 'NCR' | 'QN' | 'QR' | 'IR' | 'Dissemination';
```

2. Add to `Task`:
```typescript
responseActionType: ResponseActionType | null;
requiresDirectorApproval: boolean;
```

3. Add to `FindingFollowUpTask`:
```typescript
responseActionType: ResponseActionType | null;
requiresDirectorApproval: boolean;
```

4. Add `FindingResponseAction` interface (after `FindingLinkRecord`):
```typescript
export interface ResolvedDepartment { id: number; name: string; }

export interface FindingResponseAction {
  id: number;
  findingId: number;
  type: ResponseActionType;
  taskId: number | null;
  task: { id: number; taskId: string; status: TaskStatus } | null;
  targetDepartmentIds: number[];
  targetDepartments: ResolvedDepartment[]; // resolved by backend
  procedureRef: string | null;
  note: string | null;
  createdByUserId: number;
  createdByUser: { id: number; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
```

5. Add to `FindingDetail`:
```typescript
responseActions: FindingResponseAction[];
```

#### [MODIFY] `frontend/src/api/findingApi.ts`

Update `RaiseFindingPayload`:
```typescript
export interface RaiseFindingPayload {
  taskId?: number;           // now optional
  targetDivisionId?: number; // required when taskId absent
  eventType: string;
  departmentId: number;
  description: string;
  aircraftRegistration?: string;
  regulatoryReference?: string;
  fieldId?: string;
  ataChapterId?: number;
  hazardTagIds?: number[];
}
```

Extend `FollowUpTaskInput`:
```typescript
export interface FollowUpTaskInput {
  templateId: number;
  title: string;
  wpId?: number;
  createNewWp?: boolean;
  newWpName?: string;
  responseActionType?: ResponseActionType;
  targetDepartmentIds?: number[]; // required for all types when responseActionType is set
  note?: string;
  procedureRef?: string;
}
```

Import `ResponseActionType` from `'../types'`.

### B3. Frontend — Standalone Raise Finding (Phase 6)

#### [MODIFY] `frontend/src/components/findings/RaiseFindingPanel.tsx`

**Change `Props`:**
```typescript
interface Props {
  taskId?: number;          // optional — absent = standalone
  onClose: () => void;
  onRaised: () => void;
}
```

**Add division state** (when no `taskId`):
```typescript
const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
const [targetDivisionId, setTargetDivisionId] = useState('');

useEffect(() => {
  getDatasource('departments').then(setDepartments).catch(() => {});
  listAtaChapters(true).then(setAtaChapters).catch(() => {});
  listHazardTags(true).then(setHazardTags).catch(() => {});
  if (!taskId) {
    getDivisionsApi().then(setDivisions).catch(() => {}); // import getDivisions from taskApi
  }
}, [taskId]);
```

**Add division validation:**
```typescript
if (!taskId && !targetDivisionId) return toast.error('Division is required');
```

**Update submit payload:**
```typescript
await raiseFinding({
  ...(taskId ? { taskId } : { targetDivisionId: Number(targetDivisionId) }),
  eventType: resolvedEventType,
  ...
});
```

**Add division picker UI** (shown only when `!taskId`, placed at top of form before Event Type):
```tsx
{!taskId && (
  <div>
    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
      Division <span className="text-red-400">*</span>
    </label>
    <select value={targetDivisionId} onChange={(e) => setTargetDivisionId(e.target.value)}
      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 ...">
      <option value="">Select division…</option>
      {divisions.map((d) => (
        <option key={d.value} value={d.value}>{d.label}</option>
      ))}
    </select>
  </div>
)}
```

#### [MODIFY] `frontend/src/app/dashboard/findings/page.tsx`

Add state + import:
```typescript
import RaiseFindingPanel from '../../../components/findings/RaiseFindingPanel';
import { PlusCircle } from 'lucide-react';

const [showRaisePanel, setShowRaisePanel] = useState(false);
```

In the page header `<div>` right side (currently empty — line 84):
```tsx
<button
  onClick={() => setShowRaisePanel(true)}
  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors"
>
  <PlusCircle className="w-4 h-4" />
  Raise Finding
</button>
```

Below the return, render the panel conditionally:
```tsx
{showRaisePanel && (
  <RaiseFindingPanel
    onClose={() => setShowRaisePanel(false)}
    onRaised={() => { setShowRaisePanel(false); fetchFindings(); }}
  />
)}
```

### B4. Frontend — GenerateFollowUpModal (Phase 7)

#### [MODIFY] `frontend/src/components/findings/GenerateFollowUpModal.tsx`

**`RowDraft` additions:**
```typescript
interface RowDraft {
  _key: number;
  templateId: number | '';
  title: string;
  wpMode: WpMode;
  wpId: number | '';
  newWpName: string;
  responseActionType: ResponseActionType | '';
  targetDepartmentIds: number[];
}
```

Update `emptyRow()` to include `responseActionType: '', targetDepartmentIds: []`.

**Fetch departments on mount** (use existing `getDatasource`):
```typescript
const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
// In useEffect:
getDatasource('departments').then(setDepartments).catch(() => {});
```

**Template filtering when type selected:**
```typescript
// In the template dropdown, filter by type when responseActionType is set:
const filteredTemplates = row.responseActionType
  ? templates.filter((t) => t.type === row.responseActionType)
  : templates;
```

**UI additions** (between Template picker and Title):

Response Action Type select:
```tsx
<div>
  <label>Response Action Type</label>
  <select value={row.responseActionType}
    onChange={(e) => updateRow(row._key, {
      responseActionType: e.target.value as ResponseActionType | '',
      targetDepartmentIds: [],
      templateId: '',  // reset template on type change
    })}>
    <option value="">(None — generic follow-up)</option>
    <option value="IR">IR — Investigation Report (internal)</option>
    <option value="CAR">CAR — Corrective Action Request</option>
    <option value="NCR">NCR — Non-Conformance Report</option>
    <option value="QR">QR — Quality Request (CAPA)</option>
    <option value="QN">QN — Quality Notice (Director approval required)</option>
    <option value="Dissemination">Dissemination — Sharing / Notification</option>
  </select>
  {/* Inline contextual helper */}
  {row.responseActionType && (
    <p className="mt-1 text-xs text-slate-400">
      {row.responseActionType === 'IR' && 'Internal SQD investigation. RCA/CAPA entered directly.'}
      {['CAR','NCR'].includes(row.responseActionType) && 'External: target dept investigates and returns RCA/CAPA. One row per department.'}
      {row.responseActionType === 'QR' && 'Quality Request is itself the corrective action. One row per department.'}
      {row.responseActionType === 'QN' && 'Notice to selected departments. Requires Director approval before issue. Select all target departments below.'}
      {row.responseActionType === 'Dissemination' && 'Sharing finding with relevant parties. Select all target departments below.'}
    </p>
  )}
</div>
```

Department picker (shown when any type is selected):
```tsx
{row.responseActionType && (
  <div>
    <label>Target Department(s) *
      {['CAR','NCR','QR','IR'].includes(row.responseActionType) && ' (one per row for multiple depts)'}
    </label>

    {/* CAR / NCR / QR / IR — single select */}
    {!['QN','Dissemination'].includes(row.responseActionType) && (
      <select
        value={row.targetDepartmentIds[0] ?? ''}
        onChange={(e) => updateRow(row._key, {
          targetDepartmentIds: e.target.value ? [Number(e.target.value)] : []
        })}>
        <option value="">Select department…</option>
        {departments.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>
    )}

    {/* QN / Dissemination — multi-checkbox */}
    {['QN','Dissemination'].includes(row.responseActionType) && (
      <div className="max-h-40 overflow-y-auto border rounded-lg p-2 space-y-1">
        {departments.map((d) => (
          <label key={d.value} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox"
              checked={row.targetDepartmentIds.includes(Number(d.value))}
              onChange={(e) => {
                const id = Number(d.value);
                const ids = e.target.checked
                  ? [...row.targetDepartmentIds, id]
                  : row.targetDepartmentIds.filter((x) => x !== id);
                updateRow(row._key, { targetDepartmentIds: ids });
              }} />
            {d.label}
          </label>
        ))}
      </div>
    )}
  </div>
)}
```

**Validation additions in `handleGenerate`:**
```typescript
if (r.responseActionType) {
  if (r.targetDepartmentIds.length === 0) {
    return toast.error(`Select at least one department for ${r.responseActionType}`);
  }
  if (['CAR','NCR','QR','IR'].includes(r.responseActionType) && r.targetDepartmentIds.length > 1) {
    return toast.error(`${r.responseActionType}: add one row per department`);
  }
}
```

**Payload mapping:**
```typescript
const payload: FollowUpTaskInput[] = rows.map((r) => ({
  templateId: Number(r.templateId),
  title: r.title.trim(),
  ...(r.wpMode === 'existing' ? { wpId: Number(r.wpId) } : {}),
  ...(r.wpMode === 'new' ? { createNewWp: true, newWpName: r.newWpName.trim() } : {}),
  ...(r.responseActionType ? {
    responseActionType: r.responseActionType,
    targetDepartmentIds: r.targetDepartmentIds,
  } : {}),
}));
```

### B5. Frontend — Finding Detail + Task Detail UI (Phase 8)

#### New component — `ResponseActionBadge`

Add to `frontend/src/components/findings/FindingBadges.tsx` (or a new `ResponseActionBadge.tsx`):
```typescript
const RESPONSE_ACTION_STYLES: Record<string, string> = {
  IR:            'bg-blue-100 text-blue-700',
  CAR:           'bg-amber-100 text-amber-700',
  NCR:           'bg-amber-100 text-amber-700',
  QR:            'bg-orange-100 text-orange-700',
  QN:            'bg-purple-100 text-purple-700',
  Dissemination: 'bg-green-100 text-green-700',
};

export function ResponseActionBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${RESPONSE_ACTION_STYLES[type] ?? 'bg-slate-100 text-slate-600'}`}>
      {type}
    </span>
  );
}
```

#### [MODIFY] `frontend/src/app/dashboard/findings/[id]/page.tsx`

In the follow-up tasks section, augment each task row:
```tsx
{task.responseActionType && <ResponseActionBadge type={task.responseActionType} />}
{task.requiresDirectorApproval && (
  <span className="text-xs text-purple-600 font-medium">Director approval required</span>
)}
{/* Target departments from responseActions */}
{(() => {
  const ra = finding.responseActions?.find((a) => a.taskId === task.id);
  if (!ra || !ra.targetDepartments?.length) return null;
  return (
    <span className="text-xs text-slate-500">
      → {ra.targetDepartments.map((d) => d.name).join(', ')}
    </span>
  );
})()}
```

#### [MODIFY] `frontend/src/app/dashboard/tasks/[id]/page.tsx`

After the `issuanceNote` DetailRow:
```tsx
{task.responseActionType && (
  <DetailRow label="Response Action">
    <ResponseActionBadge type={task.responseActionType} />
  </DetailRow>
)}
{task.requiresDirectorApproval && (
  <div className="mt-2 flex items-center gap-2 rounded-lg bg-purple-50 border border-purple-200 px-3 py-2 text-sm text-purple-700">
    <ShieldCheck className="w-4 h-4 flex-shrink-0" />
    This task requires Director approval before it can be closed.
  </div>
)}
```

---

## File Change Summary

| # | File | Phase | Change |
|---|---|---|---|
| 1 | `backend/prisma/schema.prisma` | 1 | New `FindingResponseAction` model; `responseActionType`, `requiresDirectorApproval` on Task; reverse relations |
| 2 | `backend/src/constants/findingExpansion.ts` | 1 | `RESPONSE_ACTION_TYPES`, `MULTI_DEPT_SINGLE_TASK_TYPES`, `DIRECTOR_APPROVAL_TYPES`, audit string |
| 3 | `backend/src/controllers/finding.controller.ts` | 2 | Standalone finding (optional taskId + targetDivisionId); response action generation; extended getFindingById |
| 4 | `backend/src/controllers/task.controller.ts` | 3 | Director-only gate; new fields in taskInclude |
| 5 | `backend/tests/finding.test.ts` | 4 | 15 new tests (RAC-01 → RAC-15) |
| 6 | `frontend/src/types/index.ts` | 5 | `ResponseActionType`, `FindingResponseAction`, `ResolvedDepartment`; extend Task, FindingFollowUpTask, FindingDetail |
| 7 | `frontend/src/api/findingApi.ts` | 5 | Optional taskId in `RaiseFindingPayload`; extend `FollowUpTaskInput` |
| 8 | `frontend/src/components/findings/RaiseFindingPanel.tsx` | 6 | `taskId` optional; division picker for standalone |
| 9 | `frontend/src/app/dashboard/findings/page.tsx` | 6 | "Raise Finding" button; wire standalone panel |
| 10 | `frontend/src/components/findings/GenerateFollowUpModal.tsx` | 7 | Response action type select; template filtering; dept picker; validation |
| 11 | `frontend/src/components/findings/FindingBadges.tsx` | 8 | `ResponseActionBadge` component |
| 12 | `frontend/src/app/dashboard/findings/[id]/page.tsx` | 8 | Type badge + dept display on follow-up task rows |
| 13 | `frontend/src/app/dashboard/tasks/[id]/page.tsx` | 8 | `responseActionType` DetailRow; Director approval banner |

**Total: 13 files. 1 new model. 0 new endpoints.**

---

## CLAUDE_HANDOVER.md Update (after completion)

- Add `FindingResponseAction` model to OBJECT F and Section 6 schema table
- Add `Task.responseActionType`, `Task.requiresDirectorApproval` to OBJECT C
- Document Director-only reviewer gate in Section 3.3 RBAC
- Document `createFinding` now accepts standalone (no taskId) path
- Note known deferral: per-dept QN tracking deferred to Change Management phase
- Note security rule: `requiresDirectorApproval` derived server-side from `responseActionType` — never trusted from client
- Note Template.type is now used for response action type categorization
- Update test count to 322 (307 + 15)
