# Finding Expansion — Developer Onboarding Guide

> **Who this is for:** a developer picking up the RCA / CAPA / Links / Trend features for the first time.
> **What it covers:** architecture, data model, every file created or modified, the RBAC design, request flows, non-obvious gotchas, and how to run tests.
> **Companion docs:** `FINDING_WORKFLOW.md` (canonical state-machine reference), `CLAUDE_HANDOVER.md` Phase 6.x section (design decisions log), `FINDING_EXPANSION_USER_GUIDE.md` (end-user perspective), `BUSINESS_WORKFLOW.md` (business rules).

---

## 1. The big idea (one paragraph)

A **Finding** starts as a bare compliance record (Phase 6 core). The expansion pack adds three analytical layers on top of it, all compute-on-read or append-only: a structured **Root Cause Analysis** (`RcaInvestigation` + children), **Corrective/Preventive Actions** (`CapaAction` + `CapaTaskLink` many-to-many), and **cross-finding traceability** (`FindingLink`). A fourth layer, the **trend engine** (`trendService.ts`), is pure read — no stored clusters, no background jobs. One principle drove every design decision: *every write path dual-writes to `AuditLog` (compliance) and the source task's `FeedPost` (operational feed) in the same `$transaction`.*

---

## 2. Architecture at a glance

```
                      ┌───────────────────────────────────────────────────┐
  Browser (Next.js)   │  FindingDetailPage
                      │    ├── RcaPanel          (GET/PUT /:id/rca, why-steps, factors)
                      │    ├── CapaPanel          (GET/PUT/POST/DELETE /:id/capa/…)
                      │    ├── FindingLinksPanel  (GET/POST/DELETE /:id/links/…)
                      │    └── TrendBanner        (isRecurring on GET /:id)
                      └──────────────┬────────────────────────────────────┘
                      api/findingApi.ts  (axios → http://localhost:5000/api)
  ────────────────────────────────────┼───────────────────────────────────
  Backend (Express 5) routes/finding.routes.ts · routes/taxonomy.routes.ts
                      controllers/rca.controller.ts
                      controllers/capa.controller.ts
                      controllers/findingLink.controller.ts
                      controllers/taxonomy.controller.ts
                      services/trendService.ts
                      services/findingService.ts   (dual-write, close-gate, PV hook)
                      utils/findingAccess.ts        (all RBAC predicates)
                      constants/findingExpansion.ts (controlled vocabularies)
  ────────────────────────────────────┼───────────────────────────────────
  PostgreSQL (Prisma)  Finding · RcaInvestigation · RcaWhyStep · RcaContributingFactor
                       CapaAction · CapaTaskLink
                       FindingLink
                       AtaChapter · CauseCode · HazardTag · FindingHazardTag
                       AuditLog · FeedPost
```

---

## 3. Data model

> Canonical version lives in `backend/prisma/schema.prisma`. The summary below covers only the expansion-pack models.

### `RcaInvestigation` (1:1 with Finding)

- `findingId` — unique FK
- `method`: `'MEDA' | 'FIVE_WHYS' | 'OTHER'` — drives which sub-entity type is valid
- `summary`: optional free-text narrative
- `status`: `'Draft' | 'Complete'` — must be `Complete` before finding can close
- `causeCodeId` — FK to `CauseCode`; **required to reach `Complete`; used by the trend engine**
- `conductedByUserId` — last editor; updated on every upsert

### `RcaWhyStep` (child of RcaInvestigation)

- Only valid when `method = 'FIVE_WHYS'`
- `orderIndex Int` — 0-indexed; saved as `deleteMany + createMany` to replace the ladder atomically
- `question String` (required), `answer String?`

### `RcaContributingFactor` (child of RcaInvestigation)

- Only valid when `method = 'MEDA'`
- `category` — one of `RCA_MEDA_CATEGORIES` (10 Boeing MEDA strings)
- `detail String?`, `isPrimary Boolean`
- Saved as `deleteMany + createMany`

### `CapaAction` (1:N with Finding, soft-deleted)

- `findingId`, `type`: `'CORRECTIVE' | 'PREVENTIVE'`
- `status`: `'Open' | 'In Progress' | 'Completed' | 'Verified' | 'Waived'`
  - `Verified` / `Waived` are **terminal** — blocked from `updateCapa`; only reachable via dedicated endpoints
- `ownerUserId Int?`, `deadline DateTime?`
- `verifiedByUserId Int?`, `verifiedAt DateTime?`, `waivedReason String?`
- `deletedAt DateTime?` — **soft delete** (aviation compliance mandate)
- `createdByUserId`

### `CapaTaskLink` (junction: CapaAction ↔ Task | WorkPackage)

- `capaId`, `role`: `'EXECUTION' | 'EFFECTIVENESS' | 'SUPPORTING'`
- `taskId Int?`, `wpId Int?` — exactly one non-null
- **Hard deleted** (junction rows are not compliance records — noted in comment)

### `FindingLink` (directional self-reference on Finding)

- `fromFindingId`, `relatedFindingId`, `linkType`: `'DUPLICATE' | 'RELATED' | 'CAUSED_BY'`
- Unique on `(fromFindingId, relatedFindingId, linkType)` — checked in code, not a DB constraint
- `note String?`, `createdByUserId`

### Taxonomy models

- `AtaChapter` — `code`, `name`, `isActive`
- `CauseCode` — `code`, `name`, `group`, `isActive`
- `HazardTag` — `name`, `isActive`
- `FindingHazardTag` — join table, hard deleted on taxonomy update (replaced wholesale)

---

## 4. RBAC — one file, three predicates

All access logic lives in **`backend/src/utils/findingAccess.ts`**. Nothing outside this file implements its own access rule — controllers call into it.

### `buildFindingScope(user)` → `Prisma.FindingWhereInput`

Returns `{}` — all authenticated users can see all findings. Read access is open; mutation access is enforced per endpoint. Kept as a function (not inlined) so the scope can be narrowed back in one place if policy changes.

### `canAccessFinding(client, user, findingId)` → `Promise<boolean>`

Runs `findFirst` using `buildFindingScope`. Now always returns `true`, but kept for backward compatibility and as the canonical way to express "can this user see this finding?" — the day scope narrows, callers are already correct.

> **Do NOT use `canAccessFinding` as a mutation gate.** It always returns `true`. For Manager-scoped mutations, use `assertManagerDivisionScope` (below).

### `assertManagerDivisionScope(client, user, findingId)` → `Promise<boolean>`

The mutation scope gate. Returns `true` immediately for Directors. For Managers, queries Prisma for the finding with a three-condition OR:

```typescript
OR: [
  { targetDivisionId: user.divisionId },
  { followUpTasks: { some: { deletedAt: null, targetDivisionId: user.divisionId } } },
  { followUpTasks: { some: { deletedAt: null, assignedToUser: { is: { divisionId: user.divisionId } } } } },
]
```

Used in: `dismissFinding`, `updateSeverity`, `updateTaxonomy` (finding.controller), `createFindingLink`, `deleteFindingLink` (findingLink.controller).

### `canEditAnalysis(user, finding, managerMayEdit, capaLinkedUserIds?)` → `boolean`

Synchronous. Returns `true` when:
- role is `Director`
- user is the reporter (`reportedByUserId`)
- user is assigned to any follow-up task
- user is assigned to a task linked via CapaTaskLink (`capaLinkedUserIds`)
- role is `Manager` **and** `managerMayEdit` is `true` (pass `true` at all current call sites — Managers are globally allowed to edit analysis)

Used in: `createCapa`, `updateCapa`, `verifyCapa`, `waiveCapa`, `deleteCapa`, `addCapaLink`, `removeCapaLink`, `upsertRca`, `saveWhySteps`, `saveFactors`.

### `extractCapaLinkedUserIds(capaActions[])` → `number[]`

Shared utility: flattens `capaActions → linkedItems → task → assignedToUserId`. Call with `finding.capaActions` — the argument is the array, not the finding object.

### `FINDING_REVIEWER_ROLES`

`['Manager', 'Director']` — the roles that may take high-stakes mutations (dismiss, severity, links, verify, waive). Imported by all four controllers.

---

## 5. Request flows

### 5.1 RCA upsert (`PUT /api/findings/:id/rca`)

1. Load finding via `loadFindingForRca(id)` — includes `capaActions.linkedItems.task.assignedToUserId` for the `canEditAnalysis` check.
2. Derive `capaLinkedUserIds = extractCapaLinkedUserIds(finding.capaActions)`.
3. `canEditAnalysis(req.user!, finding, true, capaLinkedUserIds)` → 403 if false.
4. Validate `method` ∈ `RCA_METHODS`; validate `status` ∈ `RCA_STATUSES` if provided.
5. If `causeCodeId` supplied, verify it exists in `CauseCode`.
6. If `status = 'Complete'`, ensure an effective `causeCodeId` is set (either incoming or already on the existing RCA).
7. `$transaction`: `rcaInvestigation.upsert` → `logFindingAuditAndActivity(RCA_UPDATED)`.

### 5.2 Why-steps replace (`PUT /api/findings/:id/rca/why-steps`)

Same RBAC path. Additional guards:
- RCA must exist (400 if not).
- `finding.rca.method` must be `'FIVE_WHYS'` (400 if MEDA or OTHER).
- `steps` must be an array; each element needs a `question`.
- `$transaction`: `deleteMany` existing steps → `createMany` new ones → `logFindingAuditAndActivity(RCA_UPDATED)`.
- Returns the newly created steps (ordered by `orderIndex`).

### 5.3 CAPA create (`POST /api/findings/:id/capa`)

1. `loadFindingForCapa(id)` — same capaActions select as `loadFindingForRca`.
2. `extractCapaLinkedUserIds` + `canEditAnalysis`.
3. Validate `type` ∈ `CAPA_TYPES`, `description` non-empty.
4. `$transaction`: `capaAction.create` → `logFindingAuditAndActivity(CAPA_CREATED)`.

### 5.4 CAPA verify (`PUT /api/findings/:id/capa/:capaId/verify`)

1. Role check: `FINDING_REVIEWER_ROLES`.
2. `loadFindingForCapa(id)` → `canEditAnalysis`.
3. Load CAPA including its `linkedItems` (task + WP status fields).
4. Guard: at least one EFFECTIVENESS link exists.
5. Guard: all EFFECTIVENESS links are in `Closed` / WP `Closed` state.
6. `$transaction`: `capaAction.update(Verified + verifiedByUserId + verifiedAt)` → `logFindingAuditAndActivity(CAPA_VERIFIED)`.

### 5.5 Finding link create (`POST /api/findings/:id/links`)

1. Role check: `FINDING_REVIEWER_ROLES`.
2. Validate `linkType`, `relatedFindingId ≠ id`.
3. `assertManagerDivisionScope(prisma, req.user!, id)` → 403 for uninvolved Managers.
4. Verify source finding exists (`findUnique`).
5. Verify related finding exists.
6. Dedup guard: `findFirst({fromFindingId: id, relatedFindingId, linkType})` → 400 if exists.
7. `$transaction`: `findingLink.create` → `logFindingAuditAndActivity(FINDING_LINKED)`.

### 5.6 Trend compute (on every `GET /api/findings/:id`)

`getFindingById` calls `computeTrendForSignature(sig)` where `sig` is built from the already-loaded finding fields — no extra DB round-trip:

```typescript
const trendInfo = await computeTrendForSignature({
  findingId: finding.id,
  departmentId: finding.departmentId,
  ataChapterId: finding.ataChapterId ?? null,
  causeCodeId: finding.rca?.causeCode?.id ?? null,
  hazardTagIds: finding.hazardTags.map((h) => h.hazardTagId),
});
```

Inside `computeTrendForSignature`:
- Return `empty (signatureStrength: 'none')` if any core dim is null.
- Two-path count based on `hazardTagIds.length`:
  - `> 0` → count with `hazardTags: { some: { hazardTagId: { in: hazardTagIds } } }` → `signatureStrength: 'strong'`
  - `= 0` → count on `baseWhere` only → `signatureStrength: 'partial'`
- `isRecurring = matchCount >= TREND_THRESHOLD (3)`
- `baseWhere` always ORs the subject finding in (`OR: [{createdAt ≥ cutoff}, {id: findingId}]`) so an old finding still participates in its own count.

---

## 6. The dual-write pattern

Every mutation calls `logFindingAuditAndActivity(client, findingId, sourceTaskId, actionType, userId, content, details?)` from `services/findingService.ts`. This always runs inside the same `$transaction` as the mutation:

```typescript
await prisma.$transaction(async (tx) => {
  const result = await tx.capaAction.create({ data: { … } });
  await logFindingAuditAndActivity(
    tx,                              // ← pass the tx, never the module-level prisma
    finding.id,
    finding.sourceTaskId,            // ← null OK; feed write is skipped when null
    FINDING_EXPANSION_ACTIONS.CAPA_CREATED,
    userId,
    `… content …`,
    { … details … }
  );
  return result;
});
```

Inside `logFindingAuditAndActivity`:
1. Always writes `AuditLog` (entityType `'Finding'`, entityId `String(findingId)`).
2. Only writes `FeedPost (SYSTEM_EVENT)` when `sourceTaskId` is non-null — `createFeedPost(client, …)` from `feedService.ts`.

**Never call one without the other. Never pass the module-level `prisma` inside a `$transaction`.**

---

## 7. Close gate (`evaluateCloseGate`)

`services/findingService.ts → evaluateCloseGate(findingId)`. Called from `closeFinding` after role + status checks:

```
Gate 1: finding.rca.status must be 'Complete'   (if an RCA exists)
Gate 2: every capaAction where type='CORRECTIVE' must have status='Verified'
        (PREVENTIVE CAPAs are not checked — they do not block closure)
```

Returns `{ ok: boolean; reason?: string }`. If `ok = false`, the controller returns 400 with the `reason` string.

---

## 8. Pending Verification auto-trigger

`services/findingService.ts → checkAndTriggerPendingVerification(finishedTaskId, userId)`.

Called from `task.controller.ts` after any task reaches a final status (`Closed | Rejected | Terminated`):

1. Load the task → check `parentFindingId`.
2. If no `parentFindingId`, return.
3. Load the finding's follow-up tasks.
4. If finding is already `Pending Verification` or `Closed`, return.
5. If zero follow-up tasks, return.
6. If **all** non-deleted follow-up tasks are in final statuses → `$transaction`: `finding.update(status: 'Pending Verification')` + dual-write `PENDING_VERIFICATION`.

**The function is wrapped in `try/catch` and never rethrows.** If it fails, the task action still completes. A finding may silently stay `In Progress` — this is the deliberate tradeoff. The Findings list has an `/admin/stuck` endpoint to surface these.

---

## 9. File inventory

### Backend — new files

| File | Responsibility |
|---|---|
| `controllers/rca.controller.ts` | `getRca`, `upsertRca`, `saveWhySteps`, `saveFactors` |
| `controllers/capa.controller.ts` | `listCapa`, `createCapa`, `updateCapa`, `verifyCapa`, `waiveCapa`, `deleteCapa`, `addCapaLink`, `removeCapaLink` |
| `controllers/findingLink.controller.ts` | `getFindingLinks`, `createFindingLink`, `deleteFindingLink` |
| `controllers/taxonomy.controller.ts` | `listAtaChapters`, `upsertAtaChapter`, `listCauseCodes`, `upsertCauseCode`, `listHazardTags`, `upsertHazardTag` |
| `services/trendService.ts` | `computeTrend`, `computeTrendForSignature`, `TrendInfo`, `TrendSignature` interfaces |
| `constants/findingExpansion.ts` | All controlled vocabularies and the `FINDING_EXPANSION_ACTIONS` audit-string map |
| `routes/taxonomy.routes.ts` | `/api/taxonomy/{ata-chapters,cause-codes,hazard-tags}` |

### Backend — modified files

| File | Change |
|---|---|
| `utils/findingAccess.ts` | `buildFindingScope` → `{}` (open); added `assertManagerDivisionScope`, `extractCapaLinkedUserIds`; `canEditAnalysis` param renamed `hasAccess` → `managerMayEdit`, added `capaLinkedUserIds?` param |
| `controllers/finding.controller.ts` | Removed local `FINDING_REVIEWER_ROLES` (now imported); `getFindingById` removed `canAccessFinding` gate; `dismissFinding` / `updateSeverity` / `updateTaxonomy` inline scope blocks replaced with `assertManagerDivisionScope` |
| `services/findingService.ts` | Added `evaluateCloseGate`, `checkAndTriggerPendingVerification`; `as any` → `as Prisma.InputJsonValue` |
| `prisma/schema.prisma` | Added `RcaInvestigation`, `RcaWhyStep`, `RcaContributingFactor`, `CapaAction`, `CapaTaskLink`, `FindingLink`, `AtaChapter`, `CauseCode`, `HazardTag`, `FindingHazardTag` |
| `index.ts` | Registered `/api/taxonomy` routes |

### Frontend — new files

| File | Responsibility |
|---|---|
| `components/findings/RcaPanel.tsx` | RCA header form + method-specific sub-panels (why-steps / factors) |
| `components/findings/CapaPanel.tsx` | Two-column CAPA list (Corrective / Preventive); inline verify / waive / link management |
| `components/findings/FindingLinksPanel.tsx` | Outgoing + incoming link display; create / delete controls |
| `components/findings/TrendBanner.tsx` | Amber recurrence alert (strong / partial badge) |

### Frontend — modified files

| File | Change |
|---|---|
| `api/findingApi.ts` | RCA, CAPA, link, and taxonomy API functions added |
| `types/index.ts` | `RcaInvestigation`, `CapaAction`, `CapaTaskLink`, `FindingLink`, `TrendInfo`, `FindingDetail` interfaces added; `FindingStatus` includes `'Dismissed'` |
| `app/dashboard/findings/[id]/page.tsx` | Integrates all four new panels; passes `trendInfo` to `TrendBanner` |

---

## 10. Naming and code conventions

- **No Prisma enums** — all status / type / method values are TypeScript string literals, validated in application code against `as const` arrays. `RCA_METHODS`, `CAPA_TYPES`, `CAPA_STATUSES`, `LINK_TYPES` etc. are the single sources of truth.
- **`extractCapaLinkedUserIds` takes the array, not the finding.** Call as `extractCapaLinkedUserIds(finding.capaActions)`. The function accepts `{ linkedItems: { task: { assignedToUserId: number | null } | null }[] }[]` — the common shape loaded by both `loadFindingForCapa` and `loadFindingForRca`.
- **`managerMayEdit` is always `true` at current call sites.** This reflects the current policy (Managers can globally edit analysis). Do not replace it with a scope query — if the policy is to change, update `canEditAnalysis` centrally in `findingAccess.ts`.
- **`assertManagerDivisionScope` handles the Director short-circuit itself.** Do not wrap it with `if (role === 'Manager')` — call it unconditionally after the `FINDING_REVIEWER_ROLES` check and let it return `true` for Directors.
- **Soft delete (Rule 2):** all queries on `Finding`, `CapaAction`, `Task`, `User`, `WorkPackage` include `{ deletedAt: null }`. `CapaTaskLink` is hard-deleted; `FindingLink` has no `deletedAt`.
- **Dual write (Rule 3):** every state change writes both `AuditLog` and `FeedPost`. Use `logFindingAuditAndActivity`, never a raw `auditLog.create`. Pass the tx client, never the module-level `prisma`.
- **`$transaction` for every multi-write path.** Even single-table writes that dual-log must be wrapped.
- **`loadFindingForCapa` and `loadFindingForRca` always load `capaActions.linkedItems.task.assignedToUserId`.** This powers `extractCapaLinkedUserIds` without an extra round-trip. Keep the select in sync if `CapaTaskLink` gains new linked-entity types (e.g. WorkPackage assignees).
- **Route ordering matters.** `/admin/stuck` is registered before `/:id` in `finding.routes.ts` — Express 5 would otherwise try to parse `'stuck'` as an integer ID.

---

## 11. Gotchas that will bite you

1. **`canAccessFinding` always returns `true`.** Do not use it as a mutation gate. For Manager-scoped mutations, use `assertManagerDivisionScope`. If you need to add a new mutation endpoint, follow the pattern in `dismissFinding` — role check first, then `assertManagerDivisionScope`, then load the full finding.

2. **`extractCapaLinkedUserIds` argument is `capaActions`, not `finding`.** The old local copies in `capa.controller` and `rca.controller` accepted the full `finding` object. The shared function in `findingAccess.ts` accepts the array directly. Passing the wrong thing is a runtime TypeError, not a type error (TypeScript structural typing may let it pass).

3. **The trend engine requires a completed RCA with a cause code.** `causeCodeId` is pulled from `finding.rca?.causeCode?.id` (or `finding.rca?.causeCodeId` depending on the select). If the RCA has no cause code, `computeTrendForSignature` returns `signatureStrength: 'none'` and `isRecurring: false` — no banner shows. This is correct behavior, not a bug.

4. **`saveWhySteps` and `saveFactors` are full replacements.** Both do `deleteMany + createMany` inside the same transaction. This means concurrent edits will silently overwrite each other — last writer wins. This is acceptable for the current scale.

5. **CAPA soft-delete vs. CapaTaskLink hard-delete.** `deleteCapa` sets `deletedAt` on the `CapaAction` row (compliance mandate). `removeCapaLink` physically deletes the `CapaTaskLink` row (junction rows are not compliance records — explicitly noted in the controller comment). Do not soft-delete `CapaTaskLink`.

6. **`checkAndTriggerPendingVerification` is best-effort.** The `try/catch` swallows errors. If a Finding silently stays `In Progress` after all tasks close, use `GET /api/findings/admin/stuck` to find it, then `PUT /:id/force-pending-verification` or `PUT /:id/advance` to recover it manually.

7. **The `upsertRca` Complete guard uses `effectiveCauseCodeId`.** If the client sends no `causeCodeId` but the RCA already has one, the guard reads the existing value from `finding.rca?.causeCodeId`. Both the incoming value and the already-persisted value are checked — do not short-circuit on "no causeCodeId in body" alone.

8. **`CAPA_STATUSES` blocks `Verified` and `Waived` in `updateCapa`.** This is intentional — those transitions have additional business logic (verification evidence, waive reason). The controller explicitly checks for them and returns 400.

9. **Run `npx prisma generate` after any schema change (Rule 9).** The expansion models are all new — a stale client will treat `prisma.rcaInvestigation` as `undefined`.

---

## 12. How to run and test

```cmd
REM Backend (port 5000)
cd backend && npm run dev

REM Frontend (port 3000)
cd frontend && npm run dev

REM Backend tests — ALWAYS sqd_qa_test_db (Rule 8); 307 must pass
cd backend && npm run test:setup && npm run test
cd backend && npm run test -- findingExpansion.test.ts   REM expansion suite only
cd backend && npm run test -- finding.test.ts            REM core finding suite

REM Frontend type-check
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

### Test suites

| Suite | Groups | Tests |
|---|---|---|
| `finding.test.ts` | 14 groups (F01–F14, Admin) | Core lifecycle: raise, review, tasks, advance, close, dismiss, severity, taxonomy, visibility |
| `findingExpansion.test.ts` | 16 groups (R01–R08, C01–C14, LR01–LR04, TR01–TR02, C-SEC-1–C-SEC-5c) | RCA, CAPA (including verify/waive/links/close-gate), finding links, trend, Manager scope guards |

The expansion suite uses shared helpers defined at the top of the file (`createFinding`, `reviewFinding`, `loginAs`, `linkTwoFindings`, etc.) to avoid test-setup boilerplate. Read those helpers before writing new tests.

---

## 13. API endpoint reference

All routes are under `/api/findings/:id` and require a valid JWT (`Bearer <token>`).

### Finding lifecycle (finding.controller.ts)
| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/api/findings` | All | `?status=`, `?severity=`, `?divisionId=`, `?reportedBy=`, `?taskId=` query params |
| `POST` | `/api/findings` | All | `allowsFindings` gate on source task's template |
| `GET` | `/api/findings/admin/stuck` | Manager / Director | Findings stuck `In Progress` with all follow-ups final |
| `GET` | `/api/findings/:id` | All | Returns `trendInfo` embedded |
| `PUT` | `/api/findings/:id/review` | Manager / Director | Sets severity, dueDate, optional ATA + hazard tags |
| `POST` | `/api/findings/:id/tasks` | Manager / Director | Generate follow-up tasks |
| `PUT` | `/api/findings/:id/advance` | Manager / Director | Manual advance (no follow-up tasks path) |
| `PUT` | `/api/findings/:id/force-pending-verification` | Manager / Director | Recovery for stuck findings |
| `PUT` | `/api/findings/:id/severity` | Manager / Director (own-div) | Updates severity with audit reason |
| `PUT` | `/api/findings/:id/dismiss` | Manager / Director (own-div) | Requires reason; terminal |
| `PUT` | `/api/findings/:id/taxonomy` | Manager / Director (own-div) | Updates ataChapterId + hazardTagIds |
| `PUT` | `/api/findings/:id/close` | Manager / Director | Runs `evaluateCloseGate` first |

### RCA (rca.controller.ts)
| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/:id/rca` | All | Returns null if no RCA |
| `PUT` | `/:id/rca` | `canEditAnalysis` | Upsert header; validates causeCodeId and Complete guard |
| `PUT` | `/:id/rca/why-steps` | `canEditAnalysis` | Full replacement; FIVE_WHYS only |
| `PUT` | `/:id/rca/factors` | `canEditAnalysis` | Full replacement; MEDA only |

### CAPA (capa.controller.ts)
| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/:id/capa` | All | Ordered by type then id |
| `POST` | `/:id/capa` | `canEditAnalysis` | Creates new CAPA action |
| `PUT` | `/:id/capa/:capaId` | `canEditAnalysis` | Update description / status / owner / deadline; blocks Verified / Waived |
| `PUT` | `/:id/capa/:capaId/verify` | Manager / Director + `canEditAnalysis` | Needs EFFECTIVENESS link in Closed state |
| `PUT` | `/:id/capa/:capaId/waive` | Manager / Director + `canEditAnalysis` | PREVENTIVE only; requires waivedReason |
| `POST` | `/:id/capa/:capaId/links` | `canEditAnalysis` | Body: `{ role, taskId? }` or `{ role, wpId? }` |
| `DELETE` | `/:id/capa/:capaId/links/:linkId` | Manager / Director + `canEditAnalysis` | Hard delete |
| `DELETE` | `/:id/capa/:capaId` | Manager / Director + `canEditAnalysis` | Soft delete |

### Finding Links (findingLink.controller.ts)
| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/:id/links` | All | Returns `{ outgoing, incoming }` |
| `POST` | `/:id/links` | Manager / Director (own-div) | Body: `{ relatedFindingId, linkType, note? }` |
| `DELETE` | `/:id/links/:linkId` | Manager / Director (own-div) | Outgoing links only |

### Taxonomy (taxonomy.controller.ts)
| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/api/taxonomy/ata-chapters` | All | `?activeOnly=true` |
| `POST / PUT` | `/api/taxonomy/ata-chapters/:id?` | Admin / Director | Upsert |
| `GET` | `/api/taxonomy/cause-codes` | All | `?activeOnly=true` |
| `POST / PUT` | `/api/taxonomy/cause-codes/:id?` | Admin / Director | Upsert |
| `GET` | `/api/taxonomy/hazard-tags` | All | `?activeOnly=true` |
| `POST / PUT` | `/api/taxonomy/hazard-tags/:id?` | Admin / Director | Upsert |

---

## 14. Where to look next

- **Business rules / workflow** → `FINDING_WORKFLOW.md` (the canonical state-machine reference; supersedes older inline comments).
- **RBAC matrix in plain language** → `FINDING_EXPANSION_USER_GUIDE.md` §8.
- **Design decisions log** → `CLAUDE_HANDOVER.md` Phase 6.x section.
- **Schema source of truth** → `backend/prisma/schema.prisma`.
- **Controlled vocabularies** → `backend/src/constants/findingExpansion.ts` (single file; all string unions + the audit-string map).
- **Deferred / out of scope** → `violatorIds` multi-select against the external personnel DB (Phase 7+); admin-configurable `TREND_THRESHOLD`/`TREND_WINDOW_DAYS` (Phase 7 `PrivilegeConfig`); Findings analytics dashboard (Phase 7+).
