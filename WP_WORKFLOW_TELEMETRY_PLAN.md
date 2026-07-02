# WP Workflow & Telemetry — Implementation Plan

**Status:** Planning artifact (approved for build, phase-by-phase). No code written yet.
**Branch:** `claude/wp-workflow-telemetry-planning-me7odu`
**Author context:** Response to showcase feedback on the WP + Task workflow (assignment effort, WP grouping, same-blueprint variants, cross-division help, and telemetry depth).

This document is the **source of truth** for the workstream. It is written to be handed to a
fresh Claude Code session for implementation. It respects every rule in `CLAUDE.md`
(soft-delete filter, dual-write, draft encapsulation, schema snapshots, RBAC, test DB
isolation, `prisma generate`, handover updates) and the transparency/RBAC model in
`BUSINESS_WORKFLOW.md` + `CLAUDE_HANDOVER.md`.

---

## 1. The feedback being addressed

1. **Too much manual work assigning staff to their jobs** (per-task assignment).
2. **Too much work creating/assigning staff to a WP** — even auto-generated/routine WPs require a
   manager to re-assign staff on every run.
3. **WPs serving one general purpose** (FAA renewal, supplement, …) — how to link them. Is WP-in-WP
   a good idea?
4. **WPs from the same Blueprint but of different nature** (Blueprint A → FAA vs EASA) — group,
   filter, and count them individually even when spawned from one blueprint.
5. **A WP in Div A needs help from staff in Div B** — the most elegant, systematic way.
6. **Telemetry is present but not analysis-grade** — a full inventory of collected data + new
   analyses (tasks by division/status/week; manhours per WP; manhours per WP-type; etc.).

---

## 2. Decisions locked (from the planning discussion)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Reduce assignment effort | **a + b + c**: default roster on Blueprint/WP; auto-assign generated tasks (strategy); bulk-assign UI |
| Q2 | Link WPs of one purpose | **Program/Campaign entity**, **many-to-many** (a WP can be in several programs), **Party-driven auto-membership** |
| Q3 | Same-blueprint variants | **Both**: structured **Party** dimension (authority/operator/contractor/…) **and** lightweight free **Tags** |
| Q4 | Div A WP needs Div B staff | **WP membership = a WP-scoped execution grant.** The Div B manager adds their staff to the WP; those members then self-claim / can be assigned that WP's tasks *as if* Div A staff, **inside that WP only**. No manual task creation, no per-task assignment by the manager. Guest-consent subsystem and the review-config flag are **dropped**. |
| Q4-followup | Who reviews/rates/adjusts a Div-A task done by Div-B staff | **Div A, always** — review/rate follow the task's `targetDivisionId` (= Div A). Membership never grants review (SoD intact; assignee can't review own task). The Div B manager "oversees" via the WP feed + roster (transparency). **No config flag.** |
| Q4-followup | Where do logged hours count | **Both axes, derived, no new column**: *work division* (WP owner) for cost/WP/program rollups; *home division* (person) for capacity/utilization. Surface a cross-division contribution view |
| Q4-risk | WP-owner consent for external helpers | A Div B manager can already add own-division staff to any WP (verified — `assignUserToWp` compares target-vs-actor division only). Accept + **log the cross-division join** (WP `SYSTEM_EVENT` + roster shows home division). Optional future `WorkPackage.acceptsExternalHelpers` flag (default on); **no approval flow now**. |
| Q2-followup | More party types | **Generalized Party model** (`PartyType` lookup + `Party` + `WorkPackageParty`), replacing ad-hoc `authority`/`customer` strings (kept for back-compat) |
| Q2-followup | Program chat | **Yes** — add a `PROGRAM` scope to the existing unified `FeedPost` feed. Discussion/mentions/attachments/pinning; **not** on the escalation ladder initially |
| Q2-followup | Tags vs Parties | Tags = free labels (Renewal, Supplement, Q1-2026); Parties = real external entities |

### Operator vs Customer (clarification that motivates the Party model)
`Operator` is a validated reference model (IATA code, delete-blocked while aircraft reference it).
`customer` is an **unvalidated free string** on `WorkPackage`/`WpBlueprint` synced from the Google
Sheet. They describe the same real-world entity two different ways. The Party model unifies them:
`Operator` → `partyType=OPERATOR` reference data; a WP links to a real Party instead of retyping a
string. The `customer`/`authority`/`acRegistration` columns are **retained** (back-compat, sheet
sync) and back-filled into Parties.

---

## 3. Telemetry inventory (what is collected today)

Reference for Phase 0. All derivable from existing columns/relations.

**Task** — `taskId`, `status` (9-state), `rating`, `estimatedHours` vs actuals, `skillLevel`,
`deadline` + `deadlineExtensions` (JSON), `inactivationLog`, `rejectionReason`, `createdAt`,
`completedAt`, `updatedAt`, `issuerId`, `assignedToUserId`, `wpId`, `targetDivisionId`,
`parentFindingId`, `requiresApproval` / `requiresDirectorApproval`, `assignmentType`
(currently always `INDIVIDUAL` — dormant), form answers (`TaskData.data`).

**Time (two tables)** — `TimeBooking` (1:1 final task: `totalHours`, `estimatedHours`,
`overBudgetReason`/`Note`, `assigneeEntry`, `collaborators`); **`TimeEntry`** (append-only, every
session/revision: `sessionHours`, `sessionNotes`, `collaboratorEntries`, `loggedByUserId`,
`loggedAt`). `TimeEntry` is the real manhours ledger. Joins to `Task.wpId`.

**WorkPackage** — `wpId`, `name`, `type`, `divisionId`, `timeframeFrom`/`To`, `status`, `closedAt`,
`isRoutine`, `blueprintId`, autoGen config + `autoGenFiredAt`, `authority`/`customer`/
`acRegistration`, `targetDepartmentId`, `creatorId`. **`WorkPackageAssignment`** — WP↔user
membership + `createdAt`.

**Finding** — `findingId`, `severity`, `status`, `eventType`, `departmentId`, `ataChapterId`,
`aircraftRegistrationCode`, `regulatoryReference`, `dueDate`, `createdAt`, `closedAt`,
`reportedByUserId`, `closedByUserId`, `targetDivisionId`. Plus **RCA** (method, cause code,
5-Whys/MEDA factors), **CAPA** (type, status, owner, `verifiedAt`, waived), **HazardTags**,
**ResponseActions** (CAR/NCR/QN/…).

**Template** — `estimatedHours`, `skillLevel`, `type`, `revision`, `requiresApproval`,
`allowsFindings`.

**Event streams** — `AuditLog` (every status change: `actionType`/`entityType`/`entityId`/
`performedByUserId`/`timestamp`/`details` — enables time-in-status & cycle-time). `FeedPost`
(communication volume by scope). `EscalationFlag` (target scope, action, status, timestamps).
`Notification` (type, `readAt` read-receipts).

**User** — `divisionId`, `roleId`, `aircraftAuths`, `jobAuths`.

**Gaps (all computable, none built):** WP-level manhours rollup; WP-type/blueprint/tag/program
rollup; division throughput time-series; assignment latency; time-in-status.

---

## 4. Phase 0 — Analytics quick wins (NO schema change)

Front-loaded because it is fast, low-risk, high-value, and validates the data before we add
structure. Read-only endpoints; RBAC mirrors the existing `analytics.controller` (`analytics:view`,
Managers pinned to own division, Director/Admin optional `?divisionId`).

### Endpoints
1. `GET /api/analytics/wp/:id/rollup`
   - Manhours = `SUM(TimeEntry.sessionHours)` over tasks where `Task.wpId = :id` (`deletedAt: null`).
   - Task status mix, % complete (final / total), budget vs actual (Σ `estimatedHours` vs Σ actual),
     cycle time (`createdAt`→`closedAt`), findings raised (source tasks in WP).
2. `GET /api/analytics/throughput`
   - Tasks **created** and **reaching final state** per week, grouped by `targetDivisionId` × `status`.
   - Params: `from`, `to`, `divisionId`, `granularity` (week/month). Answers *"last week, how many
     tasks by Div A and their statuses."*
3. `GET /api/analytics/assignment-latency`
   - From `AuditLog`: median/avg time from task creation (`Unassigned`) → first `Assigned`/`In
     Progress`. Grouped by division/WP. **Quantifies the pt-1/2 pain.**
4. `GET /api/analytics/time-in-status`
   - From `AuditLog` status-change events: avg dwell per status. Surfaces the review/assignment
     bottleneck.
5. **Cross-division contribution** (can be part of `wp/:id/rollup` and throughput): hours where
   `TimeEntry.loggedBy.divisionId != Task.wp.divisionId`, split "lent to / borrowed from".

### Notes
- Use Prisma `groupBy` where possible; raw SQL (`$queryRaw`, parameterized) for `AuditLog`
  time-in-status if needed (JSON `details` inspection).
- No writes → no dual-write obligation. Pure reads.
- Frontend: extend `/dashboard/analytics` with WP-rollup drill-in + a throughput chart
  (see `dataviz` skill for chart standards).

### Tests
`analytics.wp.test.ts`, `analytics.throughput.test.ts` — seed a division with tasks across statuses
+ time entries (incl. a cross-division collaborator) and assert rollup math, RBAC 403 for
non-`analytics:view`, and division scoping.

---

## 5. Phase 1 — Assignment effort (Q1 a + b + c)

### 1a. Default staff roster on Blueprint/WP
**Schema:**
```prisma
model WpBlueprintAssignee {
  id          Int         @id @default(autoincrement())
  blueprintId Int
  blueprint   WpBlueprint @relation(fields: [blueprintId], references: [id], onDelete: Cascade)
  userId      Int
  user        User        @relation(fields: [userId], references: [id])
  createdAt   DateTime    @default(now())
  @@unique([blueprintId, userId])
  @@index([blueprintId])
}
```
- `WorkPackage` create/launch accepts an optional initial `assigneeUserIds[]`.
- `recurrenceService.fireRecurrenceForBlueprint` and `wpBlueprint.launchBlueprint` populate
  `WorkPackageAssignment` from the blueprint roster **inside the same transaction** as WP creation.
- **RBAC:** roster members validated against the blueprint's division. Cross-division members are
  added the same way a Div B manager adds their own staff today (see Phase 3 — WP-scoped execution
  grant). Reuse `hasCrossDivisionReach` for the owner-side path.
- **Dual-write:** WP creation already dual-writes; add roster info to `auditDetails` +
  `systemEventContent`.

### 1b. Auto-assign generated tasks (strategy)
**Schema (autoGen config extension):**
- `WorkPackage.autoAssignStrategy String?` — `NONE` (default, current pool behaviour) | `SPECIFIC` |
  `ROUND_ROBIN` | `LEAST_LOADED`.
- `WorkPackage.autoAssignUserId Int?` — for `SPECIFIC`.
- Optional per-item override on `TemplateSetItem.autoAssignStrategy` / `autoAssignUserId`.
- Blueprint mirrors: `defaultAutoAssignStrategy`, `defaultAutoAssignUserId`.

**Service (`autoGenService.ts`):**
- Candidate pool = WP roster (`WorkPackageAssignment`); fallback = division staff.
- `ROUND_ROBIN` — persist `WorkPackage.lastAssignedUserId` (do **not** use spawn-count modulo — the roster is mutable and modulo skips/double-assigns when members are added/removed). Pick the next roster member by id after `lastAssignedUserId`, wrapping; update the cursor after each spawn.
- `LEAST_LOADED` — reuse the active-task/estimated-hours calc from `workload.controller`
  (extract a shared `computeUserLoad(userIds)` helper — no duplicate query logic).
- On assign: set `assignedToUserId`, `status = 'Assigned'`, dual-write (`createTaskService` already
  does), notify assignee (existing `TASK_ASSIGNED` path).
- **`NONE` stays the default** so current behaviour and all existing tests are unchanged unless a
  strategy is explicitly configured. **DEF-7 note:** skill/competency is still NOT enforced (no
  `User` competency field); `LEAST_LOADED`/`ROUND_ROBIN` pick within the roster only.

### 1c. Bulk assign
- `POST /api/work-packages/:id/assign-bulk` `{ userIds: number[] }` — same RBAC as `assignUserToWp`,
  per-user division validation, skip duplicates, one AuditLog summary row.
- `POST /api/tasks/bulk-assign` `{ taskIds: number[], assignedToUserId }` — same RBAC as single
  assign (`createTaskService`/reassign guards), per-task validation, atomic in one `$transaction`,
  dual-write per task.
- Frontend: multi-select on the Tasks list + WP detail roster.

### Tests
`autoGen.test.ts` (+ strategy cases: NONE keeps pool; SPECIFIC assigns; ROUND_ROBIN rotates;
LEAST_LOADED picks lowest load; empty roster falls back). `wp.test.ts` (roster carry-over on launch/
recurrence). `task.test.ts` (bulk-assign RBAC + cross-division block). Blueprint roster CRUD in
`wpBlueprint.test.ts`.

---

## 6. Phase 2a — Party dimension (grouping backbone)

**Schema:**
```prisma
model PartyType {
  id        Int      @id @default(autoincrement())
  code      String   @unique // AUTHORITY | OPERATOR | CUSTOMER | CONTRACTOR | SUBCONTRACTOR | SUPPLIER | ...
  label     String
  isActive  Boolean  @default(true)
  parties   Party[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Party {
  id          Int       @id @default(autoincrement())
  name        String
  code        String?   // e.g. IATA code for operators, ICAO for authorities
  partyTypeId Int
  partyType   PartyType @relation(fields: [partyTypeId], references: [id])
  isActive    Boolean   @default(true)
  wpLinks     WorkPackageParty[]
  programs    Program[] @relation("ProgramDefiningParty")
  deletedAt   DateTime? // soft-delete (compliance reference) — Rule 2 applies
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@unique([partyTypeId, name])
  @@unique([partyTypeId, code]) // prevent duplicate formal-code refs (IATA/ICAO); nulls don't collide in Postgres
  @@index([partyTypeId, isActive, deletedAt])
}

model WorkPackageParty {
  id        Int         @id @default(autoincrement())
  wpId      Int
  wp        WorkPackage @relation(fields: [wpId], references: [id], onDelete: Cascade)
  partyId   Int
  party     Party       @relation(fields: [partyId], references: [id])
  createdAt DateTime    @default(now())
  @@unique([wpId, partyId])
  @@index([partyId])
}
```
- **`Party` carries `deletedAt`** → **Rule 2 obligation**: every Party read filters `deletedAt: null`
  (pickers, existence checks, rollups).
- **Migration/back-compat:** keep `WorkPackage.authority`/`customer`/`acRegistration` as the **raw
  input / audit trail**. Seed default `PartyType` rows; back-fill existing `Operator` records as
  `partyType=OPERATOR` Parties and link WPs whose `customer`/`authority` match. **Google-Sheet sync
  is match-and-link, never auto-create:** on sync, if a `Party` matches the sheet string, link it via
  `WorkPackageParty`; if none matches (e.g. a typo), keep the raw string only and do **not** create a
  Party (avoids duplicate/garbage parties + sync errors). Deprecate the string columns later once the
  UI is the primary entry point.
- **RBAC:** Party/PartyType CRUD behind an admin/reference privilege (mirror
  `referenceData.controller` pattern). WP↔Party linking follows WP edit rights.

**Endpoints:** `GET/POST/PUT/DELETE /api/parties`, `GET /api/party-types` (+ admin CRUD),
`POST/DELETE /api/work-packages/:id/parties`.

**Tests:** `party.test.ts` (CRUD, soft-delete filter, RBAC), WP-link tests, back-fill migration
verified on a scratch DB (non-destructive).

---

## 7. Phase 2 — Programs + feed + tags + rollups (Q2, Q3)

### Program (many-to-many, Party-driven auto-membership)
```prisma
model Program {
  id              Int      @id @default(autoincrement())
  name            String
  description     String?
  status          String   @default("Open") // Open | In Progress | Closed | Inactive (CHECK-constrained). MANUAL — never derived from member WPs.
  ownerId         Int
  owner           User     @relation("ProgramOwner", fields: [ownerId], references: [id])
  // Optional: a Party whose linked WPs auto-populate this program (e.g. Program "EASA" ↔ Party EASA)
  definingPartyId Int?
  definingParty   Party?   @relation("ProgramDefiningParty", fields: [definingPartyId], references: [id])
  wpLinks         WorkPackageProgram[]
  deletedAt       DateTime? // Rule 2
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([status, deletedAt])
}

model WorkPackageProgram {
  id        Int         @id @default(autoincrement())
  wpId      Int
  wp        WorkPackage @relation(fields: [wpId], references: [id], onDelete: Cascade)
  programId Int
  program   Program     @relation(fields: [programId], references: [id], onDelete: Cascade)
  auto      Boolean     @default(false) // true = auto-suggested via defining party; false = manual
  createdAt DateTime    @default(now())
  @@unique([wpId, programId])
  @@index([programId])
}
```
- **Auto-membership:** when a WP is linked to Party P and a Program has `definingPartyId = P`, suggest/
  auto-create the `WorkPackageProgram` row (`auto: true`). Manager can confirm/remove. Manual links
  set `auto: false`.
- A WP can belong to **many** programs (EASA-by-authority ∩ HVN-by-operator ∩ Contractor-X).
- **Status is manual** (Open/In Progress/Closed/Inactive) — a program may stay Open for admin wrap-up
  after all WPs close, or close early with WPs still open. The frontend shows a **derived progress
  indicator** ("3 of 5 WPs Closed") from the `WorkPackageProgram` rollup — display only, never the
  source of the status field.
- **RBAC:** Program CRUD — Director/Admin global; Managers for programs they own / in their division
  (reuse `canManageDivision` pattern). Because a program spans divisions, membership edits check WP
  edit rights per WP.

### Program chat (new `FeedPost` scope)
- Add `PROGRAM` to the scope enum + `feedService.buildFeedPostScope` / `canPostToFeed`.
- `scopeId = programId`. Reuses comments, @mentions, `#CODE` links, attachments, pinning unchanged.
- **Posting RBAC:** program owner + linked-WP participants post; all authenticated read
  (transparency). **Escalation ladder: PROGRAM excluded initially** (spans divisions/WPs — no clean
  linear placement). Revisit later if needed.
- Watcher resolution for notifications: program owner + members.

### Tags (lightweight, free labels)
```prisma
model WpTag {
  id        Int      @id @default(autoincrement())
  label     String   @unique
  createdAt DateTime @default(now())
  wpLinks   WorkPackageTag[]
}
model WorkPackageTag {
  id     Int         @id @default(autoincrement())
  wpId   Int
  wp     WorkPackage @relation(fields: [wpId], references: [id], onDelete: Cascade)
  tagId  Int
  tag    WpTag       @relation(fields: [tagId], references: [id])
  @@unique([wpId, tagId])
  @@index([tagId])
}
```
- No reference-data management overhead; tags created on first use. Filter/group/count by tag.

### Rollup analytics (answers pt 4 & 6)
- `GET /api/analytics/program/:id/rollup` — status, Σ manhours, WP count, cycle time across member
  WPs (spans divisions).
- `GET /api/analytics/blueprint/:id/instances` — blueprint X → N instances, grouped by
  authority/party/tag, each with status + manhours (the exact pt-4 ask).
- Extend WP filters with `partyId`, `tagId`, `programId`, `authority`.

### Tests
`program.test.ts` (CRUD, many-to-many, auto-membership, RBAC, soft-delete filter), feed
`PROGRAM`-scope tests (post RBAC, read transparency), tag tests, rollup math tests.

---

## 8. Phase 3 — Cross-division help via WP-scoped execution grant (Q4)

**Model: WP membership *is* the execution grant.** A Div B manager adds their staff to a Div A WP
(a single action — the same self-service path that already works today). Those members then **see,
self-claim, and can be assigned that WP's tasks as if they were Div A staff — but only inside that
WP.** The manager oversees + delegates; the staff claim the actual tasks. No manual task creation, no
per-task assignment by the manager.

**This replaces the guest-consent subsystem AND the earlier "multi-division tasks in a WP" idea.** It
is smaller and safer: **no schema change, no config flag**, and it *preserves* the invariant
`task.targetDivisionId == wp.divisionId` (tasks stay single-division; only the labor pool widens).

### Verified starting point
- `assignUserToWp` (`wp.controller.ts:679`) compares the target user's division to **the actor's**
  division, not the WP's — so a **Div B manager can already self-join any WP and add their own Div B
  staff** to its roster. That mechanic exists; what's missing is that roster membership does not yet
  grant *execution* rights on the WP's (Div-A-targeted) tasks.
- Execution is division-locked in exactly three places → the whole change surface:
  1. `buildUnassignedScope` (`:403`) — Unassigned visibility is `targetDivisionId === own division`.
  2. `selfAssignTask` (`:1283`) — claim requires `targetDivisionId === own division` (non-Director).
  3. Assignee locks — `createTaskService` (`:815`), `assignTask` (`:1169`), `reassignTask` — require
     `assignee.divisionId === actor.divisionId` (or `task:assign_any`).

### The change (backend only, NO schema, NO flag)
A user U may execute a task T (`T.wpId = W`) when `U.divisionId === T.targetDivisionId` **OR**
`U ∈ members(W)`. Apply that predicate in the three sites:
1. `buildUnassignedScope` — add `userId` to its args; widen to
   `OR: [{ targetDivisionId: own }, { wp: { assignments: { some: { userId } } } }]` (both branches
   keep `deletedAt: null`, `status: 'Unassigned'`).
2. `selfAssignTask` — allow the claim when caller is a member of `task.wp` (live query), else keep the
   division rule.
3. Assignee locks — allow an assignee who is a member of the task's WP (so the Div A manager/issuer
   can hand a task directly to a Div B member, and reassign among members).
- **Unchanged:** task creation, WP-division checks, and — critically — **review/rate/reassign-rights**.
  Removal from the WP revokes execution instantly (all three are live membership queries).

### Governance — resolves with NO config flag
- **Review / rate always follow `T.targetDivisionId` = Div A** (`canReviewTask` unchanged). Membership
  never grants review; the assignee still can't review/rate their own task (SoD intact). The Div B
  manager "oversees" via the WP feed + roster (transparency), which needs no new right.
- **Hour adjustment** stays as today (assignee + Admin + Director) — the Div B staffer revises their
  own booking; no manager-level cross-division change needed.

### Hours attribution (no new column — derived)
- **Cost / WP / program rollups** aggregate by **work division** (`Task.wp.divisionId`).
- **Capacity / utilization** aggregate by **home division** (`TimeEntry.loggedBy.divisionId`).
- Every division metric in the UI is **explicitly labeled** "hours spent ON div X's work" vs "hours
  worked BY div X's people". Cross-division contribution view (Phase 0) shows the delta.

### Owner-side consent (the one design decision)
Because membership now carries execution rights, a Div A WP owner could find Div B staff claiming
their tasks (a Div B manager can add own-division staff to any WP today). **Recommendation: accept +
log the cross-division join prominently** — dual-write a WP `SYSTEM_EVENT` on join and show each
member's home division in the roster. SoD is untouched (no review rights transfer), so the only
exposure is "who may claim my WP's tasks", which the transparency model already tolerates; Div A sees
it and can remove. **No approval flow now.** *Optional future:* a `WorkPackage.acceptsExternalHelpers`
boolean (default `true`) lets an owner lock a sensitive WP — one column, add only if asked.

### Tests
`task.test.ts` — a WP member from another division can view + self-claim + be assigned the WP's tasks;
a non-member from another division still gets 403 on all three; removal from the WP revokes claim/
visibility. `task.test.ts` review matrix — the Div B assignee cannot review/rate (SoD); the Div A
manager/issuer can. Hours attribution assertions (work-division vs home-division). No new migration.

---

## 9. Cross-cutting compliance (every phase)

- **Rule 1 (plan-first):** this doc + a per-phase file list before coding; migrations described &
  confirmed reversible.
- **Rule 2 (soft-delete):** `Party`, `Program` carry `deletedAt` → every read filters
  `deletedAt: null`, including pickers, existence checks, and rollups. **Use the existing manual-filter
  pattern + targeted `deletedAt` tests — do NOT introduce a Prisma Client Extension / `$use`
  middleware to auto-inject the filter.** Verified: the codebase (`lib/prisma.ts`) uses a plain shared
  client with the pg adapter and **zero** extensions/middleware anywhere; a one-off extension for two
  models would create a dual paradigm, risk the pg-adapter interaction, and give false safety
  elsewhere (`$use` is deprecated in Prisma 6). Manual filtering + tests is the discipline that caught
  the D-1 leak; keep it uniform.
- **Rule 3 (dual-write):** every status change / significant event → `AuditLog` **and** a `FeedPost`
  `SYSTEM_EVENT` (task/WP/program scope as appropriate). Config-only mutations (tags, party CRUD)
  write a lightweight `AuditLog` row only, consistent with the TemplateSet/Blueprint precedent.
- **Rule 8 (test DB):** all tests run against `sqd_qa_test_db`; suite green before & after each phase.
- **Rule 9:** `npx prisma generate` after every `schema.prisma` change.
- **Rule 12/13:** update `CLAUDE_HANDOVER.md` (+ `CODE_REVIEW_AUDIT_LOG.md` after any review) on
  completion of each phase.
- **Migrations:** additive + reversible; back-fills verified non-destructive on a scratch DB before
  the column drop (mirror the P1 auto-gen migration approach). CHECK constraints for new status
  columns (`Program.status`) via raw SQL migration (Prisma can't express CHECK), following
  `20260623000100_add_status_check_constraints`.
- **RBAC:** division-scope stays hardcoded (Phase 7 design); new privileges only where a genuinely
  new capability appears (e.g. `program:manage`, `party:manage`). Reuse `hasCrossDivisionReach`,
  `canManageDivision`, `canReviewTask` — do not re-hand-roll role-string checks.

### Suggested new privilege keys
`program:manage`, `party:manage` (Director/Admin default). **Phase 3 adds no new privilege** — it
reuses existing `wp:assign` (a manager adding their own staff to a WP) and widens task-execution RBAC
by WP membership. `settings:*` unaffected.

---

## 10. Recommended build sequence & dependencies

```
Phase 0  (analytics, no schema)         ──► ship first, standalone, low risk
Phase 1  (assignment a/b/c)             ──► depends on nothing; high user value
Phase 2a (Party dimension)              ──► backbone for 2
Phase 2  (Programs + feed + tags)       ──► depends on 2a
Phase 3  (WP-scoped execution grant)    ──► RBAC-only, no schema; independent of 1 & 2
```
One phase per PR. Each phase must leave the full backend suite green and `tsc`/lint/`next build`
clean before the next starts.

---

## 11. Execution recommendation — fresh session, model & effort

**Yes — create a kickoff prompt that points to this file and run it in a fresh Claude Code session,
one phase at a time.** Rationale: this workstream is large, schema-heavy, migration-and-RBAC-
sensitive, and spread across many files; a fresh session per phase keeps context focused and the
diff reviewable.

**Model:** **Opus 4.8** (`claude-opus-4-8`) — the schema design, migration back-fills, RBAC
predicates, and dual-write invariants are exactly where the most capable model pays off. Do **not**
drop to a smaller model for the schema/RBAC phases (0 is the only phase where a lighter model would
be acceptable, and even there the AuditLog time-in-status query benefits from Opus).

**Reasoning effort:** **High** for Phases 2a, 2, 3 (schema + migration + RBAC + cross-division
governance). **Medium** is acceptable for Phase 0 and the mechanical UI parts of Phase 1, but
**High** is the safe default across the board given the non-negotiable rules.

**Prerequisite (do once, before Phase 0):** merge this planning branch into `main` so
`WP_WORKFLOW_TELEMETRY_PLAN.md` lives on `main`. Every phase branches off `main`; if the plan isn't
there, a phase branch can't read it.

**Per-phase order (branch → work → review → PR → auto-merge on green):**
1. **Branch** off the latest `main` — `claude/wp-phase-<N>-<slug>`.
2. **Work** the checkpoints (C0–C5); full backend suite + `tsc`/lint/`next build` green.
3. **`/code-review`** (high) on the diff → fix accepted findings → **re-run tests green** → log to
   `CODE_REVIEW_AUDIT_LOG.md` (C6).
4. **Open the PR** — clean and already self-reviewed; body carries the review summary + test counts.
   Update `CLAUDE_HANDOVER.md` + the §13 ledger.
5. **Auto-merge into `main`** — only if the **MERGE GATE** below fully passes; otherwise STOP and
   report instead of merging. Squash-merge, delete the branch, then stop (do not start the next phase).

**MERGE GATE (all must hold, or STOP and ask the human):**
- Full backend Jest suite green **re-run immediately before merge** (not a stale earlier run).
- `tsc --noEmit` + frontend lint + `next build` clean.
- `/code-review` completed and **every HIGH/critical finding resolved** — an unresolvable HIGH is a
  hard STOP (never merge over it).
- PR is **mergeable with no conflicts** against `main`. If it has drifted, rebase onto `origin/main`
  and re-run the suite; if conflicts can't be cleanly resolved, STOP.
- Any CI checks configured on the PR are green.
- The Rule-1 plan for this phase was explicitly approved by the human (that gate is never skipped).

### Reusable kickoff prompt — paste the SAME text into every fresh session
It self-locates the next incomplete phase from the §13 ledger, so you never edit it. It also knows
how to **resume a half-finished phase** after a context loss.
```
Read WP_WORKFLOW_TELEMETRY_PLAN.md in the repo root, plus CLAUDE.md, CLAUDE_HANDOVER.md
(sections 1,2,3,6,10) and BUSINESS_WORKFLOW.md.

Open the §13 EXECUTION LEDGER in WP_WORKFLOW_TELEMETRY_PLAN.md and find the FIRST phase whose
status is not DONE. That is your phase. Work ONLY that phase — do not begin the next one.

BRANCH: `git fetch origin main`, then create/switch to a phase branch off the latest main:
`git checkout -B claude/wp-phase-<N>-<slug> origin/main` (<N> = phase number, <slug> = short name).
If you are RESUMING and that branch already exists with your commits, stay on it instead of
recreating it.

ESTABLISH STATE (handles a resume after lost context):
- `git log --oneline -20` and `git status` → which §13 checkpoints are already committed.
- `cd backend && npm test` → confirm the current baseline is green before adding anything.
- If the phase is partly done, CONTINUE from the first unchecked checkpoint — do NOT restart or
  redo committed work.

PLAN (Rule 1) — before writing any new code: list every file you will change and the exact
schema/endpoint/RBAC changes, and wait for my approval. For any schema change, describe the
migration and confirm it is reversible + non-destructive (verify back-fills on a scratch DB).

BUILD: honor every NON-NEGOTIABLE RULE in CLAUDE.md (soft-delete filter on any deletedAt model — and
do NOT add a Prisma Client Extension for it, see §9; dual-write AuditLog + FeedPost SYSTEM_EVENT;
prisma generate; test DB = sqd_qa_test_db). Reuse existing helpers (hasCrossDivisionReach,
canManageDivision, canReviewTask, validateAutoGenConfig, createTaskService,
createWorkPackageService) — do not re-hand-roll RBAC checks. Commit at each §13 checkpoint (small
commits survive context loss). The full backend Jest suite plus `tsc`/lint/`next build` must pass.

REVIEW BEFORE PR: run `/code-review` (high) on the diff, fix accepted findings, re-run the suite to
green, and log findings to CODE_REVIEW_AUDIT_LOG.md (Rule 13).

OPEN PR (only after the review is clean): update CLAUDE_HANDOVER.md and mark the phase DONE in the
§13 ledger (commit those to the phase branch). Push the branch and open a PR into main via the
GitHub tools; the PR body summarizes the change, the code-review outcome, and before/after test
counts.

AUTO-MERGE — check the §11 MERGE GATE and merge ONLY if every item passes:
- backend Jest suite re-run green RIGHT NOW; `tsc --noEmit` + frontend lint + `next build` clean;
- `/code-review` done with every HIGH/critical finding resolved (an unresolvable HIGH = hard STOP);
- PR mergeable with no conflicts vs origin/main (if drifted, rebase onto origin/main and re-run the
  suite; if conflicts won't resolve cleanly, STOP);
- any PR CI checks green; and the Rule-1 plan for this phase was approved by me.
If ALL pass: squash-merge the PR into main via the GitHub tools and delete the phase branch. If ANY
fails: do NOT merge — leave the PR open, post a short comment on what's blocking, and tell me.

Then STOP. Do not start the next phase (paste this prompt again in a fresh session for it).
```

---

## 12. Decisions resolved from the external audit + review (2026-07-02)
- **Phase 3 model** → **WP-scoped execution grant** (membership grants claim/assign inside that WP).
  Guest-consent subsystem + `ALLOW_ASSIGNEE_DIVISION_REVIEW` flag **dropped**. RBAC-only, no schema.
- **Round-robin** → persist `WorkPackage.lastAssignedUserId`, pick next-by-id (not spawn-modulo).
- **Party sheet sync** → match-and-link only; keep raw string; never auto-create on a typo.
  Added `@@unique([partyTypeId, code])`.
- **Program status** → manual field + derived progress indicator (display only).
- **Soft-delete** → keep the manual-filter + test pattern; **no Prisma Client Extension** (see §9).

### Still open (decide at build time)
- Phase 3 owner-side control: ship accept-and-log now; add optional `WorkPackage.acceptsExternalHelpers`
  flag only if an owner-lock is requested.
- Whether/when to deprecate the `WorkPackage.authority`/`customer` string columns once the Party UI is
  the primary entry point.
- Program status transitions: which roles may move a Program to Closed/Inactive.

---

## 13. Execution ledger & resumability

**How the workflow runs:** paste the §11 reusable prompt into a fresh session. It reads the ledger
below, picks the first phase that is not `DONE`, and works only that one. Because progress lives in
**this committed file + git history**, a session that loses context mid-phase can resume: it reads
the ledger, runs `git log --oneline` + `npm test` to see which checkpoints are already committed, and
continues from the first unchecked box. **The builder updates this ledger as it goes** (tick
checkpoints; set the phase to `DONE` at the end) and commits it — that is what makes the state durable.

### Phase status
| Phase | Title | Status | PR |
|-------|-------|--------|----|
| 0  | Analytics quick wins (no schema) | TODO | — |
| 1  | Assignment effort (a/b/c)        | TODO | — |
| 2a | Party dimension                  | TODO | — |
| 2  | Programs + feed + tags + rollups | TODO | — |
| 3  | WP-scoped execution grant        | TODO | — |

*(Statuses: `TODO` → `IN PROGRESS` → `DONE`. Update on every session.)*

### Per-phase checkpoint template (each box = one commit)
Every phase follows the same ordered checkpoints. Commit at each so no work is lost to a context
reset. Not every box applies to every phase (e.g. Phase 0 and Phase 3 have no migration) — skip
inapplicable ones and note why.

- [ ] **C0 Branch + baseline** — `git checkout -B claude/wp-phase-<N>-<slug> origin/main`; `npm test`
      green recorded; Rule-1 file list posted and approved.
- [ ] **C1 Schema + migration** — `schema.prisma` change, reversible migration, `npx prisma generate`,
      back-fill verified non-destructive on a scratch DB. *(skip if no schema change)*
- [ ] **C2 Service/core logic** — services + shared helpers (e.g. `computeUserLoad`), unit-testable.
- [ ] **C3 Controller + routes** — endpoints, RBAC gates (reuse existing helpers), dual-write (Rule 3).
- [ ] **C4 Frontend** — API client, components, pages; `tsc`/lint/`next build` clean. *(skip if backend-only)*
- [ ] **C5 Tests** — new Jest suites; full backend suite green; test-DB = `sqd_qa_test_db`.
- [ ] **C6 Self-review (BEFORE PR)** — `/code-review` (high) on the diff; fix accepted findings;
      **re-run the suite to green**; log to `CODE_REVIEW_AUDIT_LOG.md` (Rule 13).
- [ ] **C7 PR + auto-merge + close-out** — update `CLAUDE_HANDOVER.md` (§2 status, test count,
      gotchas) + set this phase `DONE` in the ledger; push branch; open a PR into `main` (body =
      change summary + review outcome + before/after test counts). Then check the §11 **MERGE GATE**
      and, only if every item passes, **squash-merge the PR into `main`** and delete the branch. If
      any gate item fails (red tests, unresolved HIGH finding, conflicts, red CI), do **NOT** merge —
      leave the PR open, comment what's blocking, and stop for the human.

### Resuming after a context loss (what the fresh session does)
1. Read this plan (esp. the phase's section + this ledger).
2. Check out the phase branch if it already exists (`git branch --list 'claude/wp-phase-*'`); else
   create it off `origin/main`.
3. `git log --oneline -20` + `git status` → identify the last committed checkpoint.
4. `cd backend && npm test` → confirm the current green baseline.
5. Continue from the first unchecked checkpoint — never redo committed work.

### If a phase feels too big for one session
Split it at the checkpoint boundaries into separate branches/PRs (e.g. Phase 1 → 1a default-roster,
1b auto-assign, 1c bulk-assign; Phase 2 → Programs, then feed scope, then tags/rollups). Each
sub-PR still runs C0→C7. Update the ledger with sub-rows if you do this.
