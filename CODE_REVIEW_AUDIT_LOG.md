# Code Review & Security Audit Log
*Running log of all `/code-review`, `/security-review`, and manual audit sessions.
Each entry records: date, branch, scope, findings (severity + status), and any deferred flags.*

---

## How to use this document

- **Add an entry** every time a `/code-review` or `/security-review` is accepted by the user.
- Each finding carries a status: ✅ Fixed | ⏭ Deferred (reason noted) | ✔ Accepted-as-is (intentional).
- Cross-reference `CLAUDE_HANDOVER.md` §2 for the feature narrative; this file is the authoritative list of **what was reviewed, what was found, and what remains open**.
- Always update this file **before** closing a session in which a review was accepted.

---

## Session: 2026-06-23 — Database Architecture Review + Remediation (Phases 1–5) + Post-Phase-5 Code Review

**Branch:** `claude/relaxed-lamport-sst3dn` (commits for Phases 1–5 + the review-fix commit).
**Scope:** A senior-architect review of `schema.prisma` + the data-access layer, then a phased remediation, then a high-effort `/code-review` of the resulting diff. Two parts below.
**Tests after fixes:** Backend 595/595 (was 582; +13). Frontend `tsc --noEmit` clean, `next build` ✓, lint net-improved (123→121 problems; residual `set-state-in-effect` are the pre-existing project pattern).

### Part A — Architecture review findings (remediated across Phases 1–5)

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| B1 | **High (active 500)** | `dashboard.controller.ts` `getFeed` | Selected the non-existent `Finding.findingId` column; findings DO write `scope:'FINDING'` feed posts (`findingService`), so the dashboard feed threw `PrismaClientValidationError` for any user with a reported finding. No dashboard test existed. | ✅ Fixed (Phase 1) — drop the bad select; new `dashboard.controller.test.ts` reproduces + guards. |
| P1 | High (perf) | `dashboard.controller.ts` `getSummary` | 8+ independent `count()` queries run serially per role branch. | ✅ Fixed (Phase 2) — `Promise.all` per cluster. |
| P2 | Low (perf) | `task.controller.ts` `taskInclude()` | Proposed narrowing `timeBooking` JSON. | ✔ Accepted-as-is / **not done** — verified it would strip `assigneeEntry`/`collaborators` that `TimeBookingPanel` reads on the detail page (shared 21-site helper incl. `getTaskById`). |
| I1 | Medium (perf) | `Finding` model | Only one composite index; hot status/division/reporter reads fell back to seq scans. | ✅ Fixed (Phase 3) — 3 composites (all trailing `deletedAt`) + migration `20260623000000`. |
| D1 | Medium (integrity) | `Task/Finding/WorkPackage.status`, `Finding.severity` | Free-text status/severity, app-validated only; schema comments already drifted (e.g. dead `'Approved'`). | ✅ Fixed (Phase 4a) — CHECK constraints (migration `20260623000100`) + dead-`'Approved'` cleanup (9 read-filters) + comment fixes + proof test. |
| D2 | Low (hardening) | `FindingLink` | No DB guard against a self-referential link. | ✅ Fixed (Phase 4a) — `CHECK (fromFindingId <> relatedFindingId)`; app already enforced it (`findingLink.controller.ts:64`), so belt-and-suspenders. |
| B2 | Medium (compliance/UX) | `Finding` model | No human-readable business code (unlike Task/WP/Template); root cause of the B1 confusion. | ✅ Fixed (Phase 4b) — `Finding.findingId` (`FND-000001`, advisory-locked global sequence) + backfill migration `20260623000200` + wired into create path, feed label, 5 frontend display sites. |
| — | High (scale) | `getTasks`/`getMyTasks`/`getUnassignedTasks` | Unbounded list scans; frontend pulled the whole table to filter/count client-side. | ✅ Fixed (Phase 5) — server-side pagination `{tasks,total,page,pageSize}` + `/tasks/stats`, `/tasks/assignees`, `/tasks/options`; tasks page reworked; pickers bounded. |

### Part B — Post-Phase-5 `/code-review` (high effort, recall-biased)

User triaged: fix #1, #4, #5, #6; accept #3; #2 is a deploy-pipeline question (flagged, not code).

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| PR5-1 | Medium (regression) | `work-packages/[id]/page.tsx`, `CapaPanel.tsx` | Slim/bounded task pickers (cap 100, no search) could not reach tasks beyond the first page. | ✅ Fixed — `SearchableSelect` gains optional `onQueryChange`; CapaPanel re-queries `getTaskOptions(search)` (debounced); WP "Add existing task" modal gains a search box that refetches `getTaskList({search})`. |
| PR5-2 | Medium (deploy) | `migrations/20260623000100…` | CHECK constraints + `findingId` backfill live only in raw migration SQL, which `db push` never applies; if prod is provisioned via `db push` (like the test setup; no `migrate deploy` script / `migration_lock.toml`), D1 integrity + backfill silently don't ship. | ✅ **Resolved (2026-06-23)** — investigated with a throwaway PG cluster: discovered the migration history could not rebuild from empty at all (`0_init` covered 23/45 tables; an `ALTER "CapaAction"` sorted before its `CREATE`). User confirmed pre-prod → **squashed to a clean baseline**: `0_init` (45 tables from `schema.prisma`) + `…000100` (the 5 CHECK constraints, the only non-schema-expressible objects; runtime `findingId` needs no DB sequence — `generateFindingId` uses `pg_advisory_xact_lock` + max-query). Added `migration_lock.toml`, `migrate:deploy`/`migrate:dev`/`migrate:status` scripts, and `prisma/migrations/README.md`. Validated: `migrate deploy` on empty → clean (2 migrations, 5 constraints, "up to date"); `migrate diff` → no drift. Deploy via `migrate deploy` against a fresh DB. |
| PR5-3 | Low (removed behavior) | `task.controller.ts` `buildTaskFilters` | Server search matches taskId + template title only; the old client search also matched `schemaSnapshot[0].label`. | ✔ Accepted-as-is — fuzzy extra; matching JSON field labels server-side isn't worth the complexity. |
| PR5-4 | Low-med (staleness) | `tasks/page.tsx` | Tab badges fetched once on mount; only refreshed on a self-assign failure. | ✅ Fixed — `getTaskStats`/`getTaskAssignees` also refresh on tab navigation. |
| PR5-5 | Low (efficiency) | `tasks/page.tsx` | Filter change while page>1 fired a wasted request for the stale page (+ empty flash) before the reset effect. | ✅ Fixed — render-time "adjust state when a value changes" (`prevFiltersKey` in state) snaps page to 1 before the fetch runs. |
| PR5-6 | Low (UX) | `tasks/page.tsx` | Empty-state always showed "No tasks found"; the "adjust filters" hint was dead. | ✅ Fixed — `hasActiveFilters` distinguishes empty scope from filtered-to-zero. |

**Note:** `CLAUDE_HANDOVER.md` updated to **rev 18** (2026-06-24) after the user verified the branch locally (595/595, build clean, DB CHECK constraint confirmed at runtime): new §2 entry (Phases 1–5 + pagination + squash), Test Suite count, gotchas #56–58, §12.5 deploy steps, and a new **§12.8 "Pre-deploy items to MONITOR & RECTIFY"** (most important: the test-DB/prod CHECK-constraint parity gap). `CLAUDE.md` master-user line corrected (employeeId `VAE00071` / `Abc@12345`). **Deploy flag (PR5-2): RESOLVED** — migration history squashed to a clean baseline + `migrate deploy` workflow wired and validated (see PR5-2 row above and `backend/prisma/migrations/README.md`).

---

## Session: 2026-06-22 — Quick-View Enrichment + Back-to-Finding Code Review

**Branch reviewed:** `claude/nice-darwin-nwyj81` (commit `251ebad` — `GET /tasks/:id/related-findings`, task quick-view enrichment, reusable finding quick-view drawer, CAPA-aware back-link, +7 tests).
**Scope:** xhigh-effort `/code-review` of the `HEAD~1..HEAD` diff (9 files). 6 findings. User triaged: fix #1 (correctness) + #5 (Rule 2), then directed "fix all maintainability and performance" → also #3 (perf) + #4 (maintainability); #2 and #6 accepted-as-is.
**Tests after fixes:** Backend 582/582 (was 579; +3 covering the lightweight summary endpoint). Frontend `tsc --noEmit` clean, `next build` ✓, changed files ESLint-clean (the residual `set-state-in-effect` at `tasks/[id]/page.tsx:87` is the pre-existing `loadTask()` pattern, untouched).

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| QV-1 | Medium (regression) | `tasks/[id]/page.tsx` back-link | Back-link was sourced only from the async, error-swallowed `relatedFindings` fetch, so a follow-up task lost the link that `task.parentFinding` already provided synchronously — on any transient `getRelatedFindings` failure, and flashed it in late on every load. | ✅ Fixed — `relatedFindings[0] ?? task.parentFinding ?? linkedFindings[0] ?? null`: keeps CAPA coverage primary, falls back to in-hand data. |
| QV-2 | Low (coupling) | `RaiseFindingPanel.tsx` | Now calls `useQuickView()`, which throws if the panel is rendered outside a `QuickViewProvider`. | ✔ Accepted-as-is — both call sites are under the dashboard layout (provider mounted); consuming the QuickView context is the established pattern for every quick-view consumer (decoupling via props would make this the lone exception), and crash-on-misuse is the standard React context contract. |
| QV-3 | Low (perf + side-effect) | `FindingQuickViewPanel.tsx` → `getFindingById` | The lightweight preview fetched the full detail payload (RCA/CAPA/links/responseActions/**trend**) and, worse, triggered `ensureDueDateBreachLogged` — a **write/audit side-effect on a GET** — on every preview / duplicate-peek. | ✅ Fixed — new side-effect-free `GET /findings/:id/summary` (lean projection, no trend, no breach logging); drawer + `getFindingSummary` consume it. +3 tests (S01–S03). |
| QV-4 | Low (maintainability) | `quickview/*Panel.tsx` | `Row` + `formatDate` were copy-pasted across the 3 drawers, and the "latest activity" list was duplicated between the Task and Finding panels. | ✅ Fixed — extracted `quickview/shared.tsx` (`QvRow`, `formatQvDate`, `QvFeed`); all three panels now consume it. |
| QV-5 | Very low (Rule 2) | `task.controller.ts` `getRelatedFindings` | `followUpTasks: { some: { id } }` relation filter omitted `deletedAt: null` (Rule 2 — "no exceptions"). Not exploitable (the id is a verified-live task and only Findings are returned), but a literal breach. | ✅ Fixed — `{ some: { id, deletedAt: null } }`. |
| QV-6 | Info (behavior) | `tasks/[id]/page.tsx` back-link | Primary related finding is chosen by ascending id, so a task that is both a follow-up of A and CAPA-linked to an older B points "Back to Finding #B". | ✔ Accepted-as-is — still a valid related finding and "(+N more)" flags the rest; parent-first ordering would reintroduce the chance of linking a soft-deleted parent that the related-findings query correctly excludes. |

**Note:** `CLAUDE_HANDOVER.md` §2/§8 feature-status + handover update for the WS5 quick-view feature (and this review) is pending the user's confirmation that the feature is complete (Rule 12); it will be folded in then.

---

## Session: 2026-06-21 — Finding Workflow Hardening (P1–P4) Code Review

**Branch reviewed:** `claude/nice-darwin-nwyj81` (commits `6facc70`, `263eef1`, `6343051`, `b7847fb` — the severity-configurable closed loop, SLA due dates, proactive overdue alerts, stuck-finding surface, CAPA-link simplification, and schema/feed cleanup).
**Scope:** High-effort `/code-review` of the P1–P4 diff (scoped to the 4 commits; the unrelated PR #47 files in `main...HEAD` were excluded). User triaged: apply #1, #2, #3, #5; keep #4.
**Tests after fixes:** Backend 566/566 (was 553; +13 covering duplicate handling, detail enrichment, invalid dueDate). Frontend `tsc --noEmit` clean; new components ESLint-clean (the only residual `set-state-in-effect` warnings are the pre-existing project-wide pattern).

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| CR-1 | Medium (soft-delete leak, Rule 2) | `finding.controller.ts` `notifyFindingOverdue` | The overdue notifier re-queried the finding with `findUnique({ where: { id } })` — **no `deletedAt: null`** — so a soft-deleted finding could still fire reviewer notifications. | ✅ Fixed — re-query removed entirely; the notifier now takes the already-loaded `{ id, targetDivisionId, description }` from the soft-delete-filtered parent reads (`getFindingById` / `listFindings`). |
| CR-2 | Low (robustness) | `finding.controller.ts` `reviewFinding` | A malformed `dueDate` string produced a truthy `Invalid Date` that bypassed the SLA auto-fill + mandatory checks, then threw `RangeError` at `.toISOString()` → 500. | ✅ Fixed — `isNaN(parsedDueDate.getTime())` → 400. Regression test F24b. |
| CR-3 | Low (efficiency) | `finding.controller.ts` `ensureDueDateBreachesLogged` | The batch breach loop re-queried each finding inside `notifyFindingOverdue` despite already holding the rows. | ✅ Fixed — folded into CR-1: loaded rows passed through, per-finding round-trip removed. |
| CR-4 | Info (behavior change) | `findingService.ts` `logFindingAuditAndActivity` | P4 moved the FINDING-scope feed write inside the business `$transaction` (previously a best-effort, swallowed call), so a feed-post failure now rolls back the operation. | ✔ Accepted-as-is — correct per Rule 3 (atomic dual-write); `createFeedPost` is a plain insert + best-effort NOTIFY, so it only fails on a real DB error, where rollback is the audit-safe outcome. This change is what fixed RCA/CAPA/Link events silently missing from the finding timeline. |
| CR-5 | Low (type completeness) | `frontend/src/types/index.ts` `NotificationType` | The frontend union omitted `FINDING_OVERDUE` (added to the backend union in P2), leaving the types out of sync. | ✅ Fixed — added `'FINDING_OVERDUE'`. |

**Follow-up work shipped in the same session (user-requested, not review findings):** raise-time duplicate detection (`GET /findings/duplicate-candidates`) + raiser mark-as-duplicate (`duplicateOfFindingId` parks the new finding as a `Dismissed` `DUPLICATE` of an active same-division canonical); post-raise detail enrichment (`PUT /findings/:id/details`, reporter/assignee/reviewer); follow-up-task quick-view drawer + history-independent "Back to Finding" link. Pending user confirmation before `CLAUDE_HANDOVER.md` feature-status update (Rule 12).

---

## Session: 2026-06-21 — Doc/Code Consistency Audit + Soft-Delete Filter Investigation

**Branch reviewed:** `claude/adoring-faraday-cwqbne` (working tree).
**Scope:** Manual audit. (1) Doc-vs-code consistency check of `CLAUDE.md`, `CLAUDE_HANDOVER.md`, `BUSINESS_WORKFLOW.md` against schema, constants, `package.json`, and installed `node_modules`. (2) Follow-up investigation of two soft-delete questions raised during that audit: Rule 2's model coverage, and whether `AuditLog` is soft-deletable. Code touched: `backend/src/controllers/{datasource,wp,wpBlueprint,finding}.controller.ts` + `backend/prisma/schema.prisma` (comment-only).
**Tests after fixes:** Backend `tsc --noEmit` clean for all four edited controllers (the only errors are pre-existing `exactOptionalPropertyTypes` issues in `notification.test.ts`, confirmed present before this session and untouched). **Jest suite could NOT be run in this environment — the global `beforeAll` DB setup (`$queryRaw` table-wipe) times out at 5s for every suite, including files this session never touched (`auth.test.ts` reproduces it identically) → environmental, not a regression. User must run `cd backend && npm test` locally to confirm green before merge.** Schema edit is comment-only → no migration / `prisma generate` needed.
**Method:** Two Explore passes mapping every model's `deletedAt` field + soft-delete writes + read-filter coverage across schema and controllers → direct read of each suspect call site → user triage (fix / note-only).

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| D-1 | Low (correctness / soft-delete leak, Rule 2) | `datasource.controller.ts:16`, `wp.controller.ts:57`, `wpBlueprint.controller.ts:101`, `finding.controller.ts:238` & `:311` | `Department` is soft-deletable (`referenceData.controller.ts:76` sets `deletedAt`) and `listDepartments` filters correctly, but 5 reads did NOT filter `deletedAt: null` — soft-deleted departments leaked into the picker datasource and could be referenced by new WPs, blueprints, and finding response actions. | ✅ Fixed — added `deletedAt: null`; the 3 `findUnique` lookups converted to `findFirst` (a non-unique filter is invalid on `findUnique`). Same nullable return type, no caller change. |
| D-2 | Info (false alarm) | `AuditLog` (`schema.prisma`) | An earlier note suspected `AuditLog` carried a `deletedAt` (immutability concern). Investigation: the model has NO `deletedAt` field; it is never `.update()`/`.delete()`'d in production — the only deletes are test-cleanup `deleteMany` in `__tests__/`. `AuditLog` is genuinely append-only. | ✔ Accepted-as-is — no action; earlier flag was a buggy-`awk` misread, corrected. |
| D-3 | Low (dead field) | `FindingResponseAction.deletedAt` (`schema.prisma`) | Field exists but is fully vestigial: rows are only ever `create`d — never soft-deleted, never physically deleted, and no read filters on it. Implies soft-delete semantics that aren't wired up. | ⏭ Deferred — left in place with an explanatory schema comment (append-only today; if a delete path is ever added, add `deletedAt: null` to every read per Rule 2). Safe to drop in a future schema cleanup; removing now needs a migration for no current benefit. |
| DOC-1 | N/A (doc accuracy) | `CLAUDE.md`, `CLAUDE_HANDOVER.md`, `BUSINESS_WORKFLOW.md` | Stale/incorrect claims: Next.js 15→actually **16**; Prisma v7→actually **v6**; top-line status stuck at "Phase 6 (Findings)" while Phase 7 (Privileges) + many workstreams shipped; DB-driven privileges framed as future though implemented; role list missing `Senior Advisor` (6 roles, not 5); Task "10-status" → actually **9**; contradictory test counts (423 vs 150). | ✅ Fixed — versions/status/roles/status-count corrected; **Rule 2 reframed to be schema-driven** ("any model with a `deletedAt` field… currently User, Task, Finding, WorkPackage, Attachment, CapaAction, Department") instead of a hardcoded 4-name list — this reframe is what surfaced D-1. |

**Notes / still open:** `Task`/`Finding`/`WorkPackage` have NO delete handler yet — their `deletedAt` + read-filtering is forward-looking/defensive (correct). `CapaAction` soft-delete is fully consistent (all 13 reads filter, incl. `workload.controller.ts:355`). The single remaining open item is D-3 (vestigial field, deferred). Nothing production-blocking.

---

## Session: 2026-06-20 — Personnel Analytics Tab Filter/Sort Review

**Branch reviewed:** `claude/gallant-thompson-y1gn85`.
**Scope:** Diff `043eb73...HEAD` covering `backend/src/controllers/workload.controller.ts`, `backend/src/__tests__/workload.test.ts`, `frontend/src/api/workloadApi.ts`, `frontend/src/app/dashboard/analytics/PersonnelTab.tsx` — the personnel name-filter + column-sort feature, plus the carryover Hours Logged/CAPA/Overdue-Rejected/Active-lists refinements from the prior session.
**Tests after fixes:** Backend `tsc --noEmit` clean. `npm run test -- workload.test.ts` → 19/19 passing. Full backend suite → 536/537 passing (1 pre-existing unrelated `templateSet.test.ts` failure, confirmed present before this session's changes). Frontend `tsc --noEmit` clean; ESLint shows only the same 2 pre-existing unrelated `react-hooks/set-state-in-effect` errors (line numbers shifted, not new).
**Method:** Medium effort — manual line-by-line and cross-file review across correctness, codebase-convention/reuse, and test-fragility angles, deduped to high-confidence findings.

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| H-1 | High (accessibility) | `PersonnelTab.tsx` `SortableTh` | `onClick` was placed directly on a bare `<th>` — not focusable or keyboard-activatable, failing WCAG keyboard-only navigation. The codebase's own convention (`app/dashboard/tasks/page.tsx`) wraps sortable header labels in a `<button>`. | ✅ Fixed — header label now wrapped in a `<button type="button" onClick={...}>` inside the `<th>`, matching the existing convention |
| M-1 | Medium (test fragility) | `workload.test.ts` "Personnel Detail" describe block | Relied only on `beforeAll`/`afterAll` cleanup; exact-match (`toEqual`) assertions on row counts/lists were order-dependent and fragile to future test insertions in the same block. | ✅ Fixed — added a `beforeEach` that deletes `timeEntry`/`task`/`workPackageAssignment`/`workPackage` rows before every test in the block |

---

## Session: 2026-06-19 — PR #37 "Generalized Auto-Generate Work Packages + Template Sets + WP Blueprints" Review

**Branch reviewed:** `claude/determined-shannon-efxjwm` (PR #37 → `TEST_P1`). Fixes implemented on `claude/pr37-security-performance-review-2dlqmo` (fast-forwarded to the PR tip, then fixes committed on top).
**Scope:** Full diff `TEST_P1...claude/determined-shannon-efxjwm` — `backend/prisma/schema.prisma` + migration `20260617000000_generalize_autogen_wp` (TemplateSet/TemplateSetItem/WpBlueprint models), `backend/src/controllers/{dashboard,wp,wpBlueprint,templateSet}.controller.ts`, `backend/src/services/autoGenService.ts`, `backend/src/routes/{templateSet,wpBlueprint}.routes.ts`, frontend dashboard widgets, `master-calendar/page.tsx`, `TemplateSetForm.tsx`, `WpBlueprintForm.tsx`.
**Tests after fixes:** Backend `tsc --noEmit` clean (pre-existing unrelated errors in `notification.test.ts` confirmed present before this session's changes too — not introduced by this review). Frontend `tsc --noEmit` clean, `next build` clean, `npm run lint` shows only pre-existing errors/warnings in files not touched by this session (confirmed via `git stash` diff). **Jest suite (target ~499) could not be run in this remote environment — no `DATABASE_URL`/Postgres available — user must verify locally before merge.**
**Method:** 4 parallel finder agents (RBAC/data-leakage, performance/N+1, frontend stability, general code quality) → independent verification pass against exact source lines → user triage (explicit fix/accept/recommend-only list) → fixes implemented exactly per triage.

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| C-1 | Critical (performance) | `schema.prisma` / `recurrenceService.ts` cron candidate query | `WpBlueprint` had no index covering the nightly cron's `{isActive, recurrenceType, nextRunAt}` filter — full table scan on every cron run, worsening linearly as blueprints accumulate. | ✅ Fixed — `@@index([isActive, recurrenceType, nextRunAt])` added; migration `20260619000000_add_autogen_indexes` |
| H-1 | High (RBAC/data leakage) | `dashboard.controller.ts` `getOngoingWorks` | Group Leader fell through to the unscoped "else" branch — saw ALL divisions' WPs/Tasks/Blueprints instead of being scoped like Manager. Staff/Manager were also not scoped on the Blueprint query (Staff got no `bpWhere.divisionId` at all). | ✅ Fixed — Group Leader now scoped alongside Manager for WP/Task; Staff + Group Leader + Manager all scope `bpWhere.divisionId` |
| H-2 | High (RBAC/data leakage) | `wp.controller.ts` `updateWorkPackage` | `wp:edit` privilege is granted unconditionally to Manager role with no division qualifier (`constants/privileges.ts`) — a Manager in Division A could update autoGen config (and other fields) on a Division B Work Package. | ✅ Fixed — `isManager` now additionally requires Director/Admin OR `req.user.divisionId === wp.divisionId` |
| H-3 | High (performance) | `schema.prisma` `TemplateSet` | List/filter queries on `TemplateSet` filter by `divisionId`/`isActive` with no covering index — sequential scan as the table grows. | ✅ Fixed — `@@index([divisionId, isActive])` added |
| H-4 | High (performance) | `schema.prisma` `WpBlueprint` | Division-scoped blueprint listing (`bpWhere.divisionId` in dashboard + blueprint controller) had no covering index beyond the PK. | ✅ Fixed — `@@index([divisionId, isActive])` added (same migration as C-1) |
| M-1 | Medium (RBAC, by design) | `templateSet.controller.ts` / `wpBlueprint.controller.ts` list+detail routes | List/detail endpoints are open to any authenticated user regardless of division ("transparency model", explicit route comments). | ✔ Accepted-as-is — intentional design, consistent with existing transparency-model precedent (DEF-6) |
| M-2 | Medium (correctness) | `wpBlueprint.controller.ts` `launchBlueprint` | `new Date(timeframeFrom/To)` on a malformed string produces `Invalid Date`; the subsequent `fromDate >= toDate` comparison evaluates to `false` for `NaN` operands, silently passing invalid input through instead of rejecting it. | ✅ Fixed — explicit `Number.isNaN(...)` guard returns 400 before the comparison |
| M-3 | Medium (performance) | `dashboard.controller.ts` `getOngoingWorks` | Three `findMany` calls (WP/Task/Blueprint) had no `take`/`orderBy` — unbounded result sets returned and sorted entirely in JS as the dataset grows. | ✅ Fixed — `take: 200` + `orderBy` added to all three |
| M-4 | Medium (performance) | `dashboard.controller.ts` `getOngoingWorks` | Two `feedPost.findMany` calls fetched ALL feed posts for the (now-unbounded) WP/Task id sets before slicing to top-5 per entity in JS. | ✅ Fixed — `take: 200` cap added; safe now that the outer WP/Task sets are bounded by M-3 |
| M-5 | Medium (RBAC, by design) | `autoGenService.ts` `validateAutoGenConfig` | Doesn't verify the referenced template's division matches the WP's/blueprint's division. | ✔ Accepted-as-is — Published templates are globally visible/usable by design (existing pattern, not new with this PR) |
| M-6 | Medium (by design) | `templateSet.controller.ts` `validateItems` | Docstring claims division validation; code only checks template existence/Published-status. | ✔ Accepted-as-is — consistent with M-5; templates are a global resource |
| M-7 | Medium (frontend bug) | `master-calendar/page.tsx` `filteredAndSortedWorks` | `filtered.sort(...)` mutates `works` state in place by reference when no filters are active (`filtered === works`), violating React state immutability. | ✅ Fixed — `[...filtered].sort(...)` |
| M-8 | Medium (frontend anti-pattern) | `TemplateSetForm.tsx` | Reorderable item rows keyed by array index (`key={i}`) — React reconciles by position, not identity, so focus/input state can jump to the wrong row on reorder. | ✅ Fixed — stable `_key: crypto.randomUUID()` added to `ItemRow`, used as the `key` prop |
| M-9 | Medium (type safety) | `WpBlueprintForm.tsx` | `setSelectedAutoGenTemplate(bp.defaultAutoGenTemplate as unknown as Template)` — unsafe cast; the API only returns `{id, templateId, title}`, not the full `Template` shape. | ✅ Fixed — state narrowed to `{id: number; templateId: string; title: string} \| null`; cast removed; unused `Template` import dropped |
| L-1 | Low (performance) | `schema.prisma` `WorkPackage.blueprintId` | New FK with no index — `_count: { instances }` queries would seq-scan. | ✅ Fixed — folded into the C-1 migration: `@@index([blueprintId])` |
| L-2 | Low (performance, speculative) | — | Speculative secondary index suggestion with no confirmed query pattern yet. | ⏭ Deferred — add only if a real query shape emerges |
| L-3 | Low (architecture) | `autoGenService.ts` | Serial (not batched) task spawn for SINGLE_SHOT sets — inherent to the current design. | ⏭ Deferred — monitor; not a regression |
| L-4 | Low (correctness) | `wpBlueprint.controller.ts` | A separate NaN-date path returns 500 instead of 400 in one minor branch. | ⏭ Deferred — cosmetic status-code nit, not a functional bug |
| L-5 | Low (cleanup) | `dashboard.controller.ts` `getOngoingWorks` | Leftover stream-of-consciousness comment block ("We removed status filter... Wait, the API still receives statusFilter..."). | ✅ Fixed — removed (folded into the H-1/M-3/M-4 edit) |
| L-6 | Low (robustness) | `TemplateSetForm.tsx` data-load `useEffect` | No unmount guard — a slow request resolving after the modal closes could call `setState` on an unmounted component. | ✅ Fixed (opportunistic, file already open for M-8) — added `cancelled` guard pattern matching the rest of the codebase |
| L-7 | Low | — | Missing effect dependency, harmless due to remount behavior. | ⏭ Deferred — self-correcting, no observed bug |
| L-8 | Low | — | Redundant type cast elsewhere, no behavior impact. | ⏭ Deferred — cosmetic |
| L-9 | Low (robustness) | `WpBlueprintForm.tsx` data-load `useEffect` | Same missing-unmount-guard pattern as L-6. | ✅ Fixed (opportunistic, file already open for M-9) — `cancelled` guard added |
| L-10 | Low | — | Unnecessary `as any` elsewhere in the diff. | ⏭ Deferred — cosmetic, no behavior impact |
| L-11 | Low | — | Self-correcting effect race condition. | ⏭ Deferred — not observed to cause a real bug |
| L-12 | Low | — | `meta: any` field on the dashboard unified feed item. | ⏭ Deferred — would require a discriminated-union refactor disproportionate to the finding |
| L-13 | Low (performance) | — | Unmemoized filter recomputation. | ⏭ Deferred — dataset sizes involved are small; revisit if profiling shows otherwise |
| L-14 | Low (repo hygiene) | repo root / `backend/` / `frontend/` | Accidentally committed debug/junk artifacts: `diff.txt` (13.6k-line dump), `merge_tree.txt`, `temp_seed_templates.ts`, `backend/{check_org.js,check_privileges.ts,find_invalid_task.ts,list_users.ts,test_has_privilege.ts,update_invalid_task.ts}`, `backend/grep.exe.stackdump`, `frontend/grep.exe.stackdump`, `frontend/src/grep.exe.stackdump`. Verified no secrets (only test-fixture patterns like `JWT_SECRET="test_secret_do_not_use_in_prod"`). | ✅ Fixed — all removed via `git rm` |

**Low-item production-readiness recommendation (per explicit user request):** L-1, L-5, L-14 were folded into the "Fix" set above because they were trivial and in files already being touched. L-6/L-9 were also folded in opportunistically (same files open for M-8/M-9, low cost, matches an existing pattern elsewhere in the codebase). The remaining Low items (L-2, L-3, L-4, L-7, L-8, L-10, L-11, L-12, L-13) are cosmetic, self-correcting, or speculative — **none are production-blocking**; safe to defer past this merge and revisit opportunistically.

---

## Session: 2026-06-18 — Generalized Auto-Generate WP Foundation (P1–P3) Code Review (high effort)

**Branch:** `claude/determined-shannon-efxjwm`
**Scope:** Foundation-only auto-generate WP work (commit `eaaa522`) — `backend/prisma/schema.prisma` + migration `20260617000000_generalize_autogen_wp`, `backend/src/services/autoGenService.ts` (new, replaces deleted `wpCheckService.ts`), `backend/src/controllers/wp.controller.ts`, `backend/src/index.ts` (cron wiring), `backend/src/__tests__/autoGen.test.ts` (new), `backend/src/__tests__/wp.test.ts`.
**Tests after all fixes:** 473 / 473 passing (21 suites). `tsc --noEmit` clean for all touched files (pre-existing unrelated errors in `scripts/importTemplates.ts` and `notification.test.ts` untouched).
**Method:** 4 parallel finder agents → verify pass against exact source lines. 9 findings ranked (1 High, 4 Medium, 4 Low) + 2 minor notes. User accepted fixes #1/#3/#4/#5/#6/#7; #2 deferred to the P4 frontend follow-up; #8/#9 left as optional cleanup (not applied).

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| AG-1 | High (reliability) | `autoGenService.ts` `fireAutoGenForWp` | `$transaction` had no explicit `timeout`, so a SINGLE_SHOT WP spawning many tasks via looped `createTaskService` calls could exceed Prisma's default 5s interactive-transaction timeout and abort mid-batch. | ✅ Fixed — explicit `{ timeout: 30000 }` |
| AG-2 | Medium (scope) | `wp.controller.ts` / frontend | New `autoGen*` fields are accepted by the WP create/update API but have no form UI yet. | ⏭ Deferred — P4 (WP form UI) is explicitly out of scope for this foundation phase per the approved plan |
| AG-3 | Medium (correctness) | `autoGenService.ts` `validateAutoGenConfig` (interval) + `parseInlineSet` (templateId/orderIndex/deadlineOffsetDays/estimatedHours/skillLevel) | Numeric checks used `typeof === 'number'` / `Number.isInteger`, so JSON-body numerics arriving as strings (e.g. `"7"`) were silently rejected or dropped to `null` instead of treated as `7`. | ✅ Fixed — added `coerceInt`/`coerceNum` helpers, applied to both validators; new tests cover string-typed `autoGenInterval` and inline-set numerics |
| AG-4 | Medium (silent failure) | `autoGenService.ts` `resolveItems` (inline-set branch) | A malformed `autoGenInlineSet` resolved to `[]` with no signal, so a WP with bad inline JSON would silently never fire, forever. | ✅ Fixed — `resolveItems` now returns `{ items, error? }`; `fireAutoGenForWp` writes a WP-scope `SYSTEM_EVENT` FeedPost + `WP_AUTO_GEN_FAILED` AuditLog entry (dual-write, Rule 3) and surfaces the error in `warnings` each run, without stamping `autoGenFiredAt`, so a fix to the data lets it fire normally |
| AG-5 | Medium (consistency) | `wp.controller.ts` `getWorkPackageById` vs `autoGenService.ts` `calendarDateUtc` | The on-demand REPEAT catch-up gate used `computedStatus === 'In Progress'`, computed from server-local midnight (`computeWpStatus`), while the authoritative timeframe check inside `fireAutoGenForWp` uses `APP_TIMEZONE`-anchored calendar dates — the two clocks could disagree near a day boundary if the server's local TZ ≠ `APP_TIMEZONE`. | ✅ Fixed — gate now only excludes `Closed`/`Inactive` (stored `status`, not derived); the timeframe decision is left solely to `fireAutoGenForWp`'s single authoritative clock |
| AG-6 | Low (defensive) | `autoGenService.ts` `fireAutoGenForWp` (REPEAT branch) | `const interval = wp.autoGenInterval ?? 1;` only guarded `null`/`undefined`, not a stored `0` (blocked by API validation today, but reachable via a direct DB upsert per DEF-5-style admin paths). A `0` would fire every cron run. | ✅ Fixed — `Math.max(1, wp.autoGenInterval ?? 1)`; new test asserts API validation rejects `autoGenInterval: 0` |
| AG-7 | Low (robustness) | `autoGenService.ts` `runAutoGenCron` | The top-level `workPackage.findMany` candidate query wasn't wrapped in try/catch; a DB hiccup at cron time would reject the `void runAutoGenCron(prisma)` promise in `index.ts` with no per-WP isolation. | ✅ Fixed — wrapped in try/catch, logs and returns `{ processed: 0, fired: 0 }` on failure |
| AG-8 | Low (cleanup) | `autoGenService.ts` `computeDeadline` | `if (!offsetDays) return new Date(timeframeTo);` treats a stored `0` offset the same as `null` (harmless today — both mean "no offset") and doesn't validate against an offset that would push the deadline past `timeframeTo`. | ✔ Accepted-as-is — no current input path produces a meaningful difference; revisit if offset validation is tightened |
| AG-9 | Low (cleanup) | `autoGenService.ts` `resolveWpWatchers`/`createNotifications` post-commit block | Hardcoded to the module-level `prisma` client rather than the `client` parameter passed into `fireAutoGenForWp`. | ✔ Accepted-as-is — correct today (post-commit notification must run outside the just-committed transaction anyway); would only matter if `fireAutoGenForWp` were ever called with a non-default `PrismaClient` instance (e.g. a second connection pool) |

---

## Session: 2026-06-16 — File Upload Infrastructure Code Review (high effort)

**Branch:** `claude/file-upload-infrastructure-28r4m5`
**Scope:** The File Upload feature only (commits `f49fac5` + `a8480b2`) — `backend/src/services/attachmentService.ts`, `controllers/attachment.controller.ts`, `routes/attachment.routes.ts`, `services/storage/*`, `constants/fileUpload.ts`, `constants/privileges.ts`, `frontend/src/components/ui/FileUploadField.tsx`, `api/attachmentApi.ts`, `FILE_UPLOAD_DEV_GUIDE.md`, `deploy.sh`.
**Tests after all fixes:** 444 / 444 passing (19 suites). Frontend `tsc`/lint/`next build` clean.
**Method:** 8 finder angles → verify pass. All 10 surviving findings fixed (user accepted "apply all fixes").

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| FU-1 | High (bug) | `FileUploadField.tsx` | Mount load-effect called `emit(list)` → `onChange` → `handleDataChange`, marking the task form **dirty on view** (even in read-only statuses) and overwriting saved `TaskData`. | ✅ Fixed — `emit` only after an upload/delete, never on the initial read |
| FU-2 | Medium (doc) | `FILE_UPLOAD_DEV_GUIDE.md` | Guide claimed downloads "re-check RBAC on every download"; `download`/`list` actually require only authentication. | ✅ Fixed — doc rewritten to describe the transparency model honestly + name the single seam (`assertEntityExists`) to tighten later |
| FU-3 | Medium (altitude) | `attachmentService.ts` | Delete RBAC used a hardcoded `['Director','Admin','Manager']` array, bypassing the Phase-7 privilege matrix; not Admin-configurable. | ✅ Fixed — new `attachment:delete_any` `PrivilegeKey` (default D/A/M) resolved via `hasPrivilege` |
| FU-4 | Medium (efficiency) | `attachmentApi.ts` | `getUploadConfig()` fetched once per `FileUploadField` mount → N identical requests on a multi-file-field form. | ✅ Fixed — module-scope cached Promise (retryable on failure) |
| FU-5 | Medium (efficiency/VPS) | `attachment.routes.ts` / `LocalDiskAdapter.ts` | `multer.memoryStorage()` buffered whole files in RAM; adapter then wrote to disk → peak RAM = Σ concurrent uploads on the small VPS. | ✅ Fixed — `diskStorage` temp file + `putFile` (rename, EXDEV copy fallback); controller `unlink`s temp in `finally`; `getStream` drops the extra `access()` syscall |
| FU-6 | Low (security) | `attachmentService.ts` | MIME type trusted from client `req.file.mimetype` (spoofable). | ✅ Mitigated/Documented — download forces `Content-Disposition: attachment` (no inline render → not an XSS vector); doc now states the allow-list is advisory, not content-sniffed |
| FU-7 | Low (correctness) | `attachmentService.ts` | Non-transactional existence/quota check; orphan object if the process dies between `putFile` and the tx. | ✔ Accepted-as-is — acknowledged race for an internal tool; documented in the dev guide |
| FU-8 | Low (cleanup) | `attachment.controller.ts` | Upload response hand-spread the 9 public fields already enumerated by `PUBLIC_SELECT`. | ✅ Fixed — shared `toPublic()` projector |
| FU-9 | Low (cleanup) | `fileUpload.ts` | `ALL_BUCKETS` was a parallel literal of `ENTITY_BUCKET`'s values. | ✅ Fixed — derived via `new Set(Object.values(ENTITY_BUCKET))` |
| FU-10 | Low (cleanup) | `FileUploadField.tsx` | Redundant `error` state alongside the toast (never auto-cleared); `formatBytes` rounded differently from the backend. | ✅ Fixed — dropped `error` state (toast only); frontend `formatBytes` rounding aligned to backend |

**Rule-10 follow-up (noted, not a regression):** `FILE_UPLOAD_CONFIG` is seeded + read per request and is now clamped to the 100 MB hard ceiling, but there is still **no write endpoint** — limits are only changeable via a direct DB upsert until a settings-panel `PUT` is added. Tracked as DEF-5 below.

| ID | Priority | Item | Reason for deferral |
|----|----------|------|---------------------|
| DEF-5 | Low | No `PUT` endpoint for `FILE_UPLOAD_CONFIG`; "Admin-configurable" (Rule 10) currently means a manual DB upsert. | Settings-panel endpoint is a follow-up feature, not a review bug. Default policy + clamp behave correctly meanwhile. |
| DEF-6 | Low | `download`/`list` are auth-only (no per-entity scope), consistent with the app's transparency model. If finding/task/WP visibility is ever tightened, attachments won't follow until a scope check is added at `assertEntityExists`. | Matches current product design (`buildFindingScope → {}`); revisit only if visibility is locked down. |

---

## Session: 2026-06-14 — Task Slice Code Review + Security Review

**Branch:** `claude/exciting-rubin-hqkxma`
**Scope:** Full task management vertical slice — `frontend/src/`, `backend/src/controllers/task.controller.ts`, `backend/src/utils/privilegeAccess.ts`
**Tests after all fixes:** 423 / 423 passing (17 suites)

---

### Part A — Frontend Code Review (10 bugs)

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| FE-1 | Medium | `taskApi.ts` | `decideDeadlineExtension` used wrong decision strings `'approved'/'denied'` instead of the backend-authoritative `'approve'/'deny'`. Every approve/deny call was rejected with 400. | ✅ Fixed — aligned to backend literals |
| FE-2 | Medium | `TaskActionBar.tsx` | `computeCanRate` read `assignedToUser.role.name` but the API returns role as a flat string, not a nested object. Director rating was always broken. | ✅ Fixed — `rawRole?.name ?? rawRole` extraction |
| FE-3 | Medium | `TaskActionBar.tsx` | `ratingValue` state could be stale after a new task loaded (didn't reset when `task.rating` prop changed). | ✅ Fixed — render-time state adjustment pattern (React 18+) |
| FE-4 | Low | `TaskActionBar.tsx` | `getUsers()` was fetched unconditionally on mount regardless of role, causing unnecessary N+1 API calls for roles that never see a user-picker. | ✅ Fixed — gated to roles that can see user-picker actions |
| FE-5 | Low | `TaskActionBar.tsx` | `getUsers()` fetch errors were swallowed silently — user saw an empty dropdown with no feedback. | ✅ Fixed — caught + surfaced via `toast.error` |
| FE-6 | Low | `TaskActionBar.tsx` | Dead guard `if (task.status === 'Inactive') return null` at line 65 — `Inactive` never reaches `TaskActionBar` (filtered upstream). | ✅ Fixed — removed dead branch |
| FE-7 | Medium | `TaskActionBar.tsx` | `computeIsReviewer()` was a client-side re-implementation of reviewer RBAC that was already out of date with Phase 7 privilege rules. Kept diverging silently. | ✅ Fixed — removed entirely; uses server-computed `task.isReviewer` |
| FE-8 | Low | `TaskCreateForm.tsx` | `setSubmitting(false)` was only in the `catch` block — if `onSaved()` threw, the form froze in a permanent "submitting" state. | ✅ Fixed — moved to `finally` |
| FE-9 | Low | `TaskFormPanel.tsx` | `field.options` array was in the `DynamicSelect` useEffect dependency array — a new array reference on every render caused repeated datasource refetches. | ✅ Fixed — removed `field.options` from deps |
| FE-10 | Low | `CreateTaskModal.tsx` | No Escape key or backdrop-click handler — WCAG 2.1.2 requires dismissible components to be closeable without the mouse. | ✅ Fixed — added `keydown` listener + backdrop `onClick` |

**Architectural improvements (3 items, planned then implemented same session):**

| # | Item | Status |
|---|------|--------|
| ARCH-1 | Shared source of truth for task API contract literals (`TASK_STATUSES`, `FINAL_TASK_STATUSES`, `REVIEW_ACTIONS`, `DEADLINE_DECISIONS`) with a guard test (`contractSync.test.ts`) to prevent frontend/backend drift | ✅ Done — `frontend/src/constants/taskStatus.ts` mirrors `backend/src/constants/taskStatus.ts`; guard test added |
| ARCH-2 | Server-compute the `isReviewer` flag and include it in all task API responses via `enrichTask()` helper | ✅ Done — `task.controller.ts:enrichTask()` appends `isReviewer` to every task response |
| ARCH-3 | Remove the duplicated client-side reviewer predicate that was out of sync with backend Phase 7 privilege checks | ✅ Done — `computeIsReviewer()` removed from `TaskActionBar.tsx`; all `canX` derivations now consume `task.isReviewer` |

---

### Part B — Backend Code Review (10 bugs in `task.controller.ts`)

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| BE-1 | Medium | `generateTaskId` included `deletedAt: null` filter, so the sequence counter skipped soft-deleted IDs — creating a new task in a division where a task was soft-deleted could collide with or reuse an old `taskId`. | ✅ Fixed — removed `deletedAt` filter |
| BE-2 | Medium | Non-atomic dual-write: 9 status-change handlers (`assignTask`, `selfAssignTask`, `submitTask`, `reviewTask`, `postRejectionAction`, `inactivateTask`, `reactivateTask`, `setDeadline`, `transferIssuerRights`) did `task.update` + `logAuditAndActivity` as two separate writes — a crash between them would leave one without the other. | ✅ Fixed — all wrapped in `prisma.$transaction` |
| BE-3 | Medium | Non-atomic `saveTaskData`: `taskData.upsert` + `task.update` + `logAuditAndActivity` were three separate writes. | ✅ Fixed — wrapped in `prisma.$transaction` |
| BE-4 | High | Missing division-scope check on reassignment in `reassignTaskService` and `postRejectionAction` reassign branch — cross-division reassignment was possible without `task:assign_any`. | ✅ Fixed — mirrors `assignTask`'s canonical lock |
| BE-5 | Medium | `setDeadline` accepted non-date strings (e.g. `"banana"`) — `new Date("banana")` is `Invalid Date`, `task.update` with that → Prisma 500. No guard existed. | ✅ Fixed — `isNaN(newDeadline.getTime())` → 400 |
| BE-6 | Low | `reactivateTask` fallback status was always `'Assigned'` regardless of whether the task had an assignee. A previously-Unassigned task would be reactivated to `'Assigned'`. | ✅ Fixed — `task.assignedToUserId ? 'Assigned' : 'Unassigned'` fallback |
| BE-7 | Low | `parseInt` without `parseTaskId` helper in 16 handlers — non-numeric route params (`/tasks/abc/...`) reached Prisma as `NaN` → 500 instead of a clean 400. `assignTask` also had a missing radix. | ✅ Fixed — `parseTaskId` helper added; all sites migrated |
| BE-8 | Medium | `decideDeadlineExtension` read-modify-write had no row lock — concurrent approve/deny calls could read the same stale `deadlineExtensions` blob, silently losing one write. | ✅ Fixed — `SELECT id FROM "Task" WHERE id = $id FOR UPDATE` inside transaction |
| BE-9 | Low | `transferIssuerRights` had no `Inactive` state block — the comment in the plan called it out but it was missing. | ✅ Fixed — added guard alongside the `FINAL_TASK_STATUSES` check |
| BE-10 | Low | `inactivateTask` accepted whitespace-only reasons (`reason: "   "`). `saveTaskData` had a dead `isFirstSave` branch that always ran the same path. | ✅ Fixed — whitespace trim check; dead branch collapsed |

---

### Part C — Security Review (`task.controller.ts` ↔ `privilegeAccess.ts`)

| # | Severity | Area | Finding | Status |
|---|----------|------|---------|--------|
| SEC-1 | **HIGH** | Privilege escalation | `createTaskService` gated the assignee division lock on `role === 'Manager'` only. The WP-assignment create bypass (Group Leader/Staff) could assign a task to a user in another division at creation. | ✅ Fixed — gated on `hasPrivilege(actor, 'task:assign_any')`, mirroring `assignTask`. Regression test T04c added. |
| SEC-2 | Medium | RBAC — issuer transfer | `transferIssuerRights` allowed transfer to any non-deleted user. Since `issuerId === userId` grants reviewer rights, handing issuer to a Staff/Group Leader gave them unintended review access. | ✅ Fixed — restricted to Manager/Director targets only. Role fetched from DB, not JWT. Regression test T54a added. |
| SEC-3 | Low | Input validation | `reassignTask` used raw `parseInt(req.params.id)` instead of `parseTaskId` → non-numeric id reached Prisma as `NaN` → 500. | ✅ Fixed — now uses `parseTaskId` + 400 guard |
| SEC-4 | Low | Input validation | `decideDeadlineExtension` bounds check (`< 0 || >= length`) passed a float index (e.g. `0.5`) — `extensions[0.5]` is `undefined`, `.decision` → 500. | ✅ Fixed — `Number.isInteger(extensionIndex)` required; 400 if not |
| SEC-5 | Medium | Storage / DoS | Dynamic form fields (`text`, `textarea`, `rich_text`) had no cap at any layer. `saveTaskData` accepted arbitrary JSON payloads with zero size validation. | ✅ Fixed — backend: 512 KB serialized cap + 100k chars per string value. Frontend: `maxLength` UX guardrail on text/textarea. |
| SEC-6 | Medium | Storage / DoS | Free-text controller inputs were unbounded: `title`, `reason` (reassign/inactivate/reopen/deadline), `comment` (review), `content` (comment). Only `issuanceNote` was already capped. | ✅ Fixed — `title` 300, `reason` 2000, `comment`/`content` 5000. Shared `lengthError()` helper. |
| SEC-7 | Medium | Division scope | Manager can create a task targeting a division other than their own. | ✔ Accepted-as-is — Intentional: a Manager in Div A can plant an Unassigned task targeting Div B, then use the org feed or escalation to notify Div B's Manager to assign it. |
| SEC-8 | Info | IDOR | All mutating endpoints re-fetch the task with `deletedAt: null` and run RBAC checks before acting. A spoofed ID hits those gates, not data. | ✔ Confirmed safe |
| SEC-9 | Info | Transparent model | `getTaskById`, `getTaskActivity`, and `postTaskComment` allow any authenticated user to read/comment on any task across divisions. | ✔ Accepted-as-is — Intentional. Documented in code as "Transparent viewing/commenting model". |

---

### Part C — Deferred / Flags for Future Review

| ID | Priority | Item | Reason for deferral |
|----|----------|------|---------------------|
| DEF-1 | Low | Rich text stored as HTML via Tiptap. Currently rendered via `EditorContent` (not `dangerouslySetInnerHTML`), so XSS is constrained to what the editor produces. If HTML is ever rendered elsewhere (migrations, CSV import, other components), it must be sanitised with DOMPurify before display. | No immediate risk; requires a concrete new rendering path to act on. See Gotcha #22 in `CLAUDE_HANDOVER.md`. |
| DEF-2 | Low | No keyboard navigation in `SearchableSelect` — fails WCAG keyboard-only requirements. | Internal tool; address before any external/accessibility audit. See Gotcha #21 in `CLAUDE_HANDOVER.md`. |
| DEF-3 | Low | `transferIssuerRights` has no division-scope check on the new issuer target (only role is checked). A Manager could hand issuer rights to a Director in another division. | Low risk: Director-scope is intentionally global. Revisit if the product ever requires division-locked issuer assignment. |
| DEF-4 | Info | `task:assign_div` privilege holders can currently use `assignTask` to assign into their own division but there is no check that the task itself is targeted at that division. A `task:assign_div` Manager could assign to themselves on a task targeted at another division. | Boundary condition; needs product confirmation before locking. |

---

## Earlier Reviews (referenced in `CLAUDE_HANDOVER.md §2`)

| Date | Branch | Scope | Summary |
|------|--------|-------|---------|
| 2026-06-13 | `claude/sqd-app-sse-notifications-yj7n32` | SSE realtime + Notification system | `/security-review` + high-effort `/code-review`. Findings: per-recipient write isolation, 429 cap before handshake, exhaustive dispatch, `unref()` purge interval, dead-socket pruning, `markRead` response. All fixed. 396 tests green. |
| 2026-06-09 | `claude/compassionate-gauss-335xa3` | Finding Response Actions + Standalone Findings | `/security-review` + `/code-review`. Findings: RBAC (H-1), state machine (H-2), DoS cap (H-3), input validation (M-1, L-2, L-3), audit accuracy (L-1), N+1 pre-validation. All fixed. 322 tests green. |
| 2026-06-10 | `claude/vigilant-mendel-3sajt0` | Phase 8 Time-Booking Workflow Refinements | `/code-review`. Findings: LOGGABLE_STATUSES constant, `In Review` banner copy. All fixed. No new tests (UX-only changes). |
| 2026-06-12 | `claude/exciting-darwin-gyohuf` | Phase 7 Deferred Items (User Management, Settings, Taxonomy) | `/security-review` + `/code-review`. Findings: session revocation on credential change (H1), route-level privilege guard (M1), default password not disclosed in UI (M2), whitespace-only name validation (M3), max-length on taxonomy inputs (L1), numeric divisionId validation (L2), Prisma singleton (L3). All fixed. |
| 2026-05-29 | Pre-Phase-5 | Auth controller | Manual audit. 5 findings (updatePassword, enumeration, rate limiting, JWT fallback, plaintext token). All fixed in `claude/amazing-ritchie-soasus`. See §11 of `CLAUDE_HANDOVER.md`. |
