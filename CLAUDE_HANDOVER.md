# SQD-APP: Claude Code Project Handover
*Last updated: 2026-06-28 (rev 20). Supersedes all previous versions.*

> **rev 20 (2026-06-28):** **Work Assignment Workflow security/hardening pass** on branch `claude/review-work-assignment-workflow-jrw9md` — a manual review of the Task + Work Package assignment workflow (`task.controller.ts`, `wp.controller.ts`, `autoGenService.ts`, task/WP routes, privilege model) and remediation of the accepted findings. Closes two **segregation-of-duties** holes (a task performer could review — WAW-1 — or rate — WAW-5 — their own work; an extension requester could decide their own request — WAW-8) and three **division-scope escalations** (Manager could create a WP — WAW-2 — or a task — WAW-3 — or link a task to a WP — WAW-7 — across divisions; the WP-assign div check was role-string-gated — WAW-4). Plus past-deadline validation (WAW-10), per-user rate limits on all mutating task/WP routes (WAW-11), `createTask` now honours `title` (WAW-12), and `updateWorkPackageStatus` div scope (WAW-6). **No schema migration, no new privilege keys** (division checks stay hardcoded per Phase 7 design). Skill-gating (WAW-9) deferred as **DEF-7** (needs a `User` competency field). Transparency reads (WAW-13) accepted-as-is. A follow-up `/code-review` of the diff fixed 4 more items (WAW-R1..R4): a shared rate-limit bucket split (autosave gets its own), a null-`targetDivisionId` link regression, a timezone-safe deadline check (UTC epoch-days), and extraction of a shared `hasCrossDivisionReach` helper used by all 5 division-scope sites. **Backend 635/635** (was 621; +14). See `CODE_REVIEW_AUDIT_LOG.md` 2026-06-28 (Work Assignment Workflow Review + follow-up) and §8 gotcha #59.

> **rev 19 (2026-06-28):** **Feed Features workstream (Phases A–H)** on branch `claude/feed-features-audit-iac2uw` — a hardening + capability expansion of the unified `FeedPost` feed, built from `FEED_FEATURES_AUDIT.md` against `FEED_IMPROVEMENT_PLAN.md`. Shipped: comment length cap + per-user write rate-limit + disseminate validation (A); **keyset pagination + type filters** with the cursor on an `X-Next-Cursor` header (B); **scoped SSE feed signals** to watchers instead of broadcast (C); **soft-hide + pinning** (D); **@mentions** with notifications (E); inline **`#CODE` entity hyperlinks** (E.2); **attachments in comments** via a new `FEED_POST` attachment entity type (F); **acknowledgement / read-receipts** (G); **feed search + opt-in daily digest** (H). Then an accepted high-effort `/code-review` (8 fixes, 1 accepted-as-is, 1 deferred — see `CODE_REVIEW_AUDIT_LOG.md` 2026-06-28). **Backend 621/621**, frontend `tsc --noEmit` + lint clean — verified end-to-end against a live Postgres + backend + Next.js stack (login, pagination header, mentions, #links, attachments upload/download, pinning, hide, ack, search). Schema: `FeedPost` gains moderation columns + a new `FeedPostAcknowledgement` model (additive). See OBJECT H, §6, and `FEED_IMPROVEMENT_PLAN.md` for the per-phase detail.
>
> **rev 18 (2026-06-24):** Task-list server-side pagination + new `/tasks/stats|assignees|options` endpoints; `Finding.findingId` business code (`FND-000001`); DB integrity hardening (CHECK constraints, Finding indexes); post-review picker/UX fixes; **migration history squashed to a clean replayable baseline** (was unshippable). Backend **595/595**, frontend build clean — verified locally on a real DB (incl. the DB-level CHECK constraint rejection). **⚠️ Read §12.8 "Pre-deploy items to MONITOR & RECTIFY" before going to prod** — most importantly the test-DB/prod schema-application parity gap. Also folds in the Quick-View Enrichment + Back-to-Finding feature (582/582) and its clean `/security-review` from `claude/nice-darwin-nwyj81`.

---

## 1. PROJECT OVERVIEW

SQD-APP is an aviation maintenance Quality Assurance (QA) and Quality Control (QC) web application. It enables administrators and inspectors to create dynamic audit templates, assign tasks, conduct inspections, record findings, and track work packages.

**Stack:**
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS v4, Zustand (Auth state), Lucide Icons
- **Backend**: Node.js, Express 5, TypeScript, Prisma ORM v6 (`@prisma/adapter-pg`), PostgreSQL
- **Testing**: Jest + Supertest (Backend integration)

---

## 2. CURRENT IMPLEMENTATION STATUS

### Completed
- **Feed Features workstream — Phases A–H** (2026-06-28 — branch `claude/feed-features-audit-iac2uw`)
  > Audit-driven hardening + capability expansion of the unified `FeedPost` feed. Started from `FEED_FEATURES_AUDIT.md` (full feed file-map + weakness/vuln list), executed via `FEED_IMPROVEMENT_PLAN.md`. **Backend 621/621; frontend `tsc`+lint clean; verified live end-to-end.** Then an accepted high-effort `/code-review` (`CODE_REVIEW_AUDIT_LOG.md`, 2026-06-28 session — F1–F9 fixed, F7 accepted-as-is, F10 deferred).
  >
  > - **A — Hardening:** shared `commentLengthError` (`MAX_COMMENT_LEN=5000`) now enforced on **every** comment path (the generic `postFeedComment` was previously uncapped); new per-user `createMutationRateLimiter` (30/min, keyed on `userId`) on feed comment/flag + task-activity writes; `DISSEMINATE` `taggedDivisionIds` validated against real Divisions (`Number.isInteger` + existence).
  > - **B — Pagination + filters:** `getFeed`/`getTaskActivity` are **keyset-paginated** (`?limit` default 30/max 100, `?before` cursor, `?types` filter). **Response body stays an array; the next-page cursor rides the `X-Next-Cursor` response header** (CORS-exposed) — backward-compatible with array-consuming callers. Client filters are client-side (`FeedFilterBar`).
  > - **C — Scoped realtime (M1):** `createFeedPost` resolves TASK/WP/FINDING watchers at emit time and the realtime `feed` signal fans out only to them (`publishToUser`); DIVISION/ORG stay broadcasts. New `resolveFindingWatchers`. Overflow → broadcast fallback.
  > - **D — Soft-hide + pinning:** `FeedPost` gains `hiddenAt/hiddenByUserId/hiddenReason` + `pinnedAt/pinnedByUserId`. Director/Admin hide/unhide (excluded from **every** feed read; `?includeHidden=true` for Director/Admin review); pin/unpin on WP/DIV/ORG comments only (RBAC = `canPostToFeed`); `GET /feeds/pinned/:scope/:scopeId?`. COMMENT-only, dual-write AuditLog + SYSTEM_EVENT.
  > - **E — @mentions:** chip-based picker (`GET /users/mention-search`); ids stored in `metadata.mentions`, resolved to names on read; new `FEED_MENTION` notification (author never self-notified).
  > - **E.2 — `#CODE` entity links:** read-time resolution of `#<Task.taskId | WorkPackage.wpId | Finding.findingId>` → `{type,id}`; client linkifies to the detail route (XSS-safe React elements; `hasOwnProperty` guard so `#toString`/`#__proto__` can't hit the prototype chain).
  > - **F — Comment attachments:** new `FEED_POST` attachment entity type (bucket `sqd-feed`) reusing the existing `StorageAdapter`/`Attachment` model (no migration); reads surface `attachments[]`; composer post-then-upload.
  > - **G — Acknowledgement:** new `FeedPostAcknowledgement` model (unique per user+post, idempotent); `POST /feeds/posts/:id/ack`; dual-write AuditLog + SYSTEM_EVENT on first ack only; reads return `ackCount`+`acknowledged`. Hidden comments cannot be acked.
  > - **H — Search + digest:** `GET /feeds/search?q=&scope=&scopeId=` (COMMENT bodies, hidden excluded, keyset); opt-in daily `FEED_DIGEST` (preferences `feedDigest`, cron 07:00, COMMENT-only counts).
- **DB Architecture Hardening (Phases 1–5) + Task-List Pagination + Migration Squash** (2026-06-23/24 — branch `claude/relaxed-lamport-sst3dn`)
  > A senior-architect review of `schema.prisma` + data-access, a phased remediation, a post-review `/code-review`, and a migration-history rebuild. **Verified locally against a real DB: backend 595/595, frontend `next build` clean (24 routes), and the new DB-level CHECK constraint confirmed rejecting a bad status (Postgres `23514`).** Full finding-by-finding log in `CODE_REVIEW_AUDIT_LOG.md` (2026-06-23 session).
  >
  > **Phase 1 — Dashboard feed crash (High, active 500):** `getFeed` selected the non-existent `Finding.findingId` column at the time (findings DO emit `scope:'FINDING'` feed posts), so the dashboard feed threw for any user with a reported finding. Fixed; added `dashboard.controller.test.ts`.
  >
  > **Phase 2 — Dashboard perf:** `getSummary`'s 8+ serial `count()` queries parallelised with `Promise.all` per cluster.
  >
  > **Phase 3 — Finding indexes:** 3 composite indexes (all trailing `deletedAt`) for the hot status/division/reporter reads (migration folded into the baseline).
  >
  > **Phase 4 — Data integrity (the only new *runtime* behavior):** DB-level **CHECK constraints** on `Task.status`, `Finding.status`, `Finding.severity` (nullable), `WorkPackage.status`, and a `FindingLink` self-reference guard — Prisma cannot express CHECK in `schema.prisma`, so they live in raw SQL in migration `20260623000100_add_status_check_constraints`. Also added **`Finding.findingId`** human-readable business code (`FND-000001`, org-wide). Allocation is **app-side** in `generateFindingId` (`finding.controller.ts`) using `pg_advisory_xact_lock` + a max-query — **no DB sequence object is needed at runtime** (verified: sequence is contiguous across server restarts). Wired into the create path, feed label, and 5 frontend display sites.
  >
  > **Phase 5 — Task-list server-side pagination (High, scale):** `getTasks`/`getMyTasks`/`getUnassignedTasks` previously pulled the whole table to filter/count in the browser. Now server-paginated (`{tasks,total,page,pageSize}`, `pageSize` clamped ≤100, page/size defaulted on bad input) with new `GET /tasks/stats` (tab badges), `/tasks/assignees`, and `/tasks/options` (slim, bounded pickers). Tasks page reworked; single-fetch on filter change; pickers gained server-side search (`SearchableSelect.onQueryChange`).
  >
  > **Post-Phase-5 `/code-review` (PR5-1…6):** picker server-search (#1), tab-badge refresh on navigation (#4), eliminate double-fetch via render-time page reset (#5), empty-state copy (#6) — all fixed; search field-label narrowing (#3) accepted-as-is.
  >
  > **Migration squash (2026-06-23, pre-prod, one-time):** the prior 12-folder history could **not** rebuild from empty (`0_init` created 23/45 tables; an `ALTER "CapaAction"` sorted before its `CREATE`) — discovered by replaying it on a throwaway PG cluster. With the app confirmed pre-production, squashed to **`0_init`** (full schema from `schema.prisma`, 45 tables) + **`20260623000100_add_status_check_constraints`** (the 5 CHECK constraints — the only non-schema-expressible objects). Added `migration_lock.toml` (was missing — `migrate deploy`/`diff` couldn't run without it), `migrate:dev`/`migrate:deploy`/`migrate:status` npm scripts, and `backend/prisma/migrations/README.md`. Validated: `migrate deploy` on empty → clean (2 migrations, 5 constraints, "schema is up to date"); `migrate diff` → no drift. **Deploy via `migrate deploy` against a fresh DB.** See §12.7 for the standing pre-prod items this introduces (esp. test-DB constraint coverage).
- **Quick-View Enrichment + Reliable Back-to-Finding** (✅ **COMPLETE**, 2026-06-22 — branch `claude/nice-darwin-nwyj81`, commits `251ebad` then `1ecd3de`)
  > New `GET /api/tasks/:id/related-findings` endpoint dedupes a task's findings across the source/follow-up/CAPA relations (`task.controller.ts::getRelatedFindings`). Task quick-view drawer (`TaskQuickViewPanel`) enriched with issuer, clickable related-finding badges, latest-activity feed, and a "Report" link when `taskData` is non-empty. New reusable Finding quick-view drawer (`FindingQuickViewPanel`) wired into `QuickViewProvider` (`openFinding`, mutually exclusive with `openTask`/`openWp`) and into `RaiseFindingPanel`'s duplicate-candidate previews. Full task-page back-link made CAPA-aware. +7 backend tests (572→579).
  > **`/code-review` (xhigh) on the diff surfaced 6 findings** — user agreed to fix #1 (real regression) plus, on explicit instruction ("fix all maintainability and performance related issues also"), #3 and #5; #2 and #6 accepted-as-is. Applied in `1ecd3de`:
  > - **QV-1 (back-link reliability, fixed):** the task-detail page's back-to-finding link had come to depend solely on the async, error-swallowed `getRelatedFindings` fetch. Restored a fallback chain — `relatedFindings[0] ?? task.parentFinding ?? linkedFindings[0] ?? null` — so a slow/failed fetch never drops a link the task already had synchronously.
  > - **QV-3 (performance, fixed):** the finding-preview drawer had been reusing the heavy `getFindingById` endpoint, which carries hidden write side-effects (`ensureDueDateBreachLogged` fires on every GET) and a large include tree (RCA/CAPA/links/trend) inappropriate for a frequent, lightweight preview. Added a new minimal, side-effect-free `GET /api/findings/:id/summary` (`finding.controller.ts::getFindingSummary`) and switched the drawer to it. +3 tests (579→582).
  > - **QV-4 (maintainability, fixed):** extracted `frontend/src/components/quickview/shared.tsx` (`QvRow`, `formatQvDate`, `QvFeed`) to remove near-identical Row/date/feed JSX duplicated across the Task/WP/Finding quick-view panels; all three refactored to consume it.
  > - **QV-5 (Rule-2 compliance, fixed):** the new `getRelatedFindings` follow-up-task relation filter was missing `deletedAt: null` — added.
  > - **QV-2 (accepted-as-is):** `RaiseFindingPanel` now depends on `useQuickView()` — dashboard-only by design, no standalone-route usage exists.
  > - **QV-6 (accepted-as-is):** the back-link picks the lowest-id related finding, not necessarily the original parent — a parent-first rule would risk linking a soft-deleted parent; still always a valid related finding.
  > Backend **582/582** passing (was 579 going in; one transient run showed a Prisma DB-connection teardown flake unrelated to the code — re-run came back clean). Frontend `tsc --noEmit` clean, `next build` clean.
  > **`/security-review` (3-phase) run on the cumulative branch diff back to merge-base `519563d`:** no HIGH/MEDIUM-confidence exploitable vulnerabilities found. Verified authz on all new/changed mutation endpoints (`PUT /findings/:id/details`, `PUT /findings/:id/due-date`, `POST /findings` with `duplicateOfFindingId`, the CAPA link refactor), confirmed all new read endpoints (`GET /tasks/:id/related-findings`, `GET /findings/:id/summary`, `GET /findings/duplicate-candidates`) are consistent with the documented transparent-viewing model, no SQL injection (parameterized `$queryRaw` only), no XSS sinks in new components, all `:id` params NaN-guarded. Logged in `CODE_REVIEW_AUDIT_LOG.md`.
- **Doc/Code consistency audit + `Department` soft-delete fix** (2026-06-21 — branch `claude/adoring-faraday-cwqbne`)
  > Audited `CLAUDE.md`/`CLAUDE_HANDOVER.md`/`BUSINESS_WORKFLOW.md` against the code and fixed stale claims: Next.js 15→**16**, Prisma v7→**v6**, the "Phase 6 (Findings)" status line, "DB-driven privileges = future Phase 7" (actually shipped), missing `Senior Advisor` role (6 roles, not 5), Task "10-status"→**9**, and contradictory test counts (423 vs 150). **Rule 2 reframed to be schema-driven** (any model with a `deletedAt` field) instead of a hardcoded 4-name list — and that reframe surfaced a real bug: **`Department` soft-delete leak (D-1, Low)** — 5 reads in `datasource`/`wp`/`wpBlueprint`/`finding` controllers didn't filter `deletedAt: null`, so retired departments leaked into the picker datasource and could be referenced by new WPs/blueprints/finding response actions → **fixed** (added the filter; `findUnique`→`findFirst` where a non-unique filter was required). Also confirmed `AuditLog` is append-only (no `deletedAt`; earlier concern was a false alarm) and flagged `FindingResponseAction.deletedAt` as vestigial (schema-commented, deferred). Full detail in `CODE_REVIEW_AUDIT_LOG.md` (2026-06-21 session). Backend `tsc --noEmit` clean for all edited files. **Jest suite NOT runnable in this environment — global `beforeAll` DB setup times out for every suite incl. untouched `auth.test.ts` (environmental) → run `cd backend && npm test` locally to confirm green before merge.**
- **Generalized Auto-Generate Work Packages — P1–P6** (✅ **COMPLETE through P6**, 2026-06-17→2026-06-18 — branch `claude/determined-shannon-efxjwm`, NOT yet merged to `main`)
  > **499 backend tests passing (baseline 453 → 469 after P1–P3 → 499 after P6, +30 net new across the whole workstream). Backend `tsc --noEmit` clean. Frontend `tsc`/lint/`next build` clean (lint delta: zero new in P4, +1 in P5, +1 in P6 — both the same pre-existing `useEffect(fetchX, [fetchX])` list-page pattern, not a regression).**
  >
  > **PR #37 review (2026-06-19, logged in `CODE_REVIEW_AUDIT_LOG.md`):** full P1–P6 diff reviewed for RBAC/data-leakage, performance/N+1, frontend stability, and code quality. 11 fixes applied on `claude/pr37-security-performance-review-2dlqmo` (fast-forwarded onto the PR tip): missing `WpBlueprint`/`TemplateSet`/`WorkPackage.blueprintId` indexes (C-1/H-3/H-4/L-1, migration `20260619000000_add_autogen_indexes`); Group Leader division-scoping gap + missing Staff blueprint scoping in `getOngoingWorks` (H-1); cross-division Manager edit gap on `updateWorkPackage` (H-2); unbounded `findMany`/`feedPost.findMany` result sets in `getOngoingWorks` (M-3/M-4); `Invalid Date` bypass in `launchBlueprint` (M-2); in-place `.sort()` mutation on Master Calendar state (M-7); index-as-key on the reorderable `TemplateSetForm` rows (M-8); unsafe `as unknown as Template` cast in `WpBlueprintForm` (M-9); plus opportunistic unmount guards (L-6/L-9) and repo-hygiene cleanup of accidentally-committed debug scripts (L-14). Three findings (M-1, M-5, M-6 — open template/template-set visibility across divisions) accepted as intentional, consistent with the existing "transparency model" precedent (DEF-6). Backend `tsc --noEmit` and frontend `tsc`/lint/`next build` re-verified clean after fixes; **the Jest suite could not be re-run in the fix session's remote environment (no `DATABASE_URL`) — re-run locally before merging to `TEST_P1`.**

  Replaces the special-cased CHECK-work-package auto-task path with a generic auto-generate model any WP type can opt into, then builds reusable template-set and blueprint config on top of it. Split into phases; **P7 (recurrence automation + Master Calendar) is planned but not yet built** — see §7.

  **P1 — Schema + migration** (commit `eaaa522`):
  - `WorkPackage` gained `autoGenerate Boolean`, `autoGenMode String?` (`'SINGLE_SHOT'|'REPEAT'`), `autoGenInterval Int?`, `autoGenTemplateId Int?`, `autoGenSetId Int?`, `autoGenInlineSet Json?`, `autoGenFiredAt DateTime?` (sole idempotency source of truth), plus `blueprintId Int?` + `isRoutine Boolean @default(false)` (both reserved for P6/P7 — see gotcha #42). `checkTemplateId` dropped.
  - New models: `TemplateSet` + `TemplateSetItem` (reusable ordered template lists, `isActive` soft-disable), `WpBlueprint` (reusable WP template, `isActive` soft-disable, inert until P6).
  - The migration backfills existing CHECK WPs onto `REPEAT`/`interval=1`/`autoGenTemplateId=checkTemplateId` **before** dropping the old column — verified non-destructive against a scratch DB.

  **P2 — `autoGenService.ts`** (replaces `wpCheckService.ts`):
  - `fireAutoGenForWp` — read→decide→spawn→stamp in one `$transaction` that `SELECT ... FOR UPDATE`-locks the `WorkPackage` row and re-reads `autoGenFiredAt` inside the lock, closing the cron-vs-on-demand double-fire race.
  - Spawns reuse `createTaskService` (system actor) — eliminates a second taskId generator and its soft-delete collision bug.
  - `SINGLE_SHOT` partial failure = skip-and-warn (an archived/missing template/set item is skipped; the batch continues; `autoGenFiredAt` still advances so the batch never retries).
  - `validateAutoGenConfig(client, input)` — the single source of truth for autogen validation, reused by WP create/update, TemplateSet create/update, and WpBlueprint create/update/launch: exactly one of template/set/inline source; `REPEAT` ⇒ single-template + positive interval; sources must be Published (template) / active (set).
  - `wp.controller.ts`'s on-demand catch-up path is `REPEAT`-only (never fires a `SINGLE_SHOT` op on page load).

  **P3 — Cron**: nightly `runAutoGenCron` at `00:05` in `APP_TIMEZONE` (same timezone anchors the service's date math), gated to non-test like other startup jobs.

  **P1–P3 code review** (commit `8f5b3d5`, 2026-06-18, logged in `CODE_REVIEW_AUDIT_LOG.md`): 9 findings fixed — explicit transaction timeout for `SINGLE_SHOT` batches, numeric coercion for string-typed JSON inputs, a visible warning (not a silent permanent no-op) on malformed `autoGenInlineSet`, a unified clock for the on-demand `REPEAT` catch-up gate, a guard against a stored `autoGenInterval` of `0`, try/catch around the cron's candidate query.

  **P4 — WP form UI** (commit `ed72c71`): `WorkPackageForm.tsx` gained an "Automatic Task Generation" section (toggle → mode select → template picker → REPEAT interval input); WP detail page replaced the old "Check Template" row with an auto-generate summary (mode/interval/source/last-fired). Frontend `WorkPackage`/`WorkPackageDetail` types and `wpApi.ts` payloads updated to match (`checkTemplateId` removed). Decision: single-template-only source in this phase (saved-set source added in P5).

  **P5 — TemplateSet CRUD + UI** (commit `f754965`): `templateSet.controller.ts` (mirrors the controller-local-helper style of the codebase: `canManageDivision`, `MAX_NAME_LEN`/`MAX_TEXT_LEN`, `validateItems`), `templateSet.routes.ts` mounted at `/api/template-sets`. `WorkPackageForm.tsx` extended with an `autoGenSource: 'TEMPLATE'|'SET'` toggle (SINGLE_SHOT only) and a saved-set picker that reloads on division change. New `/dashboard/template-sets` management page + Sidebar entry. **RBAC: Managers restricted to their own division; Director/Admin global** — this `canManageDivision` pattern is reused verbatim by P6's `WpBlueprint` controller.

  **P6 — WpBlueprint CRUD + manual launch** (commit `fcf8ff0`): exposes the previously-inert `WpBlueprint` model.
  - **`createWorkPackageService` extraction** (`wp.controller.ts`) — the `wpId` sequence generation + `tx.workPackage.create` + dual-write (`AuditLog` + `logWpSystemEvent`) that lived inline in the `createWorkPackage` HTTP handler was extracted into an exported service (same precedent as `createTaskService`), parameterised by `auditActionType`/`auditDetails`/`systemEventContent` so the existing create endpoint and the new launch endpoint share one code path. Request-layer validation (required fields, `wpType` lookup, `resolveWpTypeFields`, timeframe ordering, `validateAutoGenConfig`) stays in each call site. Verified regression-safe: `wp.test.ts` (33 tests) re-run immediately after the extraction, before any blueprint code was written.
  - **`wpBlueprint.controller.ts`** (new) — CRUD (`list`/`getById`/`create`/`update`/`disable`) plus `launchBlueprint` (`POST /:id/launch`): loads the active blueprint, re-validates its autogen defaults via `validateAutoGenConfig` (a referenced template/set may have been archived since save), applies `name`/`timeframeFrom`/`timeframeTo` overrides (defaulting to blueprint name / today / today+`defaultDuration`), and calls `createWorkPackageService` with `blueprintId`, `isRoutine: false`, `auditActionType: 'BLUEPRINT_LAUNCHED'`. Mounted at `/api/wp-blueprints`, behind `requirePrivilege('wp:create')`.
  - **P6 deliberately ignores `recurrenceType`/`recurrenceInterval` in every create/update body** — they are always persisted `null`. Recurrence automation is P7's job (see gotcha #42).
  - Frontend: `WpBlueprintForm.tsx` (reuses the P4/P5 autogen-source UI; duration instead of a timeframe block; no recurrence fields), `LaunchBlueprintDialog.tsx` (editable name + timeframe, read-only autogen summary), `/dashboard/wp-blueprints` list page (Launch/Edit/Disable actions gated by `canManageDivision`), Sidebar entry.
  - **Tests** (`wpBlueprint.test.ts`, 15 tests): CRUD validation/RBAC, soft-disable, launch (no-override defaults, name/timeframe overrides, recurrence-in-body ignored, `BLUEPRINT_LAUNCHED` audit row, disabled-blueprint 404, cross-division/Staff 403).

  **Locked design decisions carried through all six phases:**
  - `isRoutine` on `WorkPackage`: always `false` for P6 manual launches; reserved `true` for P7 auto-launches (lets dashboards/analytics distinguish one-off vs recurring-series WPs).
  - Soft-disable (`isActive: boolean`) for `TemplateSet`/`WpBlueprint`, **not** Rule-2 soft-delete (`deletedAt`) — they are config artifacts referenced by FK (`WorkPackage.autoGenSetId`/`blueprintId`, both `ON DELETE SET NULL`), not one of the four Rule-2 entities.
  - Config mutations (TemplateSet/WpBlueprint create/update/disable) write only a lightweight `AuditLog` row — no `TaskActivity`/`FeedPost`, since they are not task-scoped (distinct from Rule 3, which still applies in full to WP creation/launch itself).

- **Configurable Notification Events Panel** (✅ **COMPLETE**, 2026-06-16 — branch `claude/zealous-bohr-3g1ch9`)
  > **439 backend tests passing (+9 new in `notificationConfig.test.ts`). Backend `tsc --noEmit` clean (production code; pre-existing `notification.test.ts` strict-optional warnings only). Frontend `tsc`/ESLint clean for all new/changed files. Additive `NotificationEventConfig` model + reversible migration. Developer notes appended to `REALTIME_DEV_GUIDE.md` §§ 3.5, 7, 8.**

  Admin/Director-configurable panel inside **Settings → Notifications** to control which notification event classes fire and whether all Managers in the recipient's division are CC'd. Enforced at the single `createNotifications` chokepoint with no changes to any trigger call site.

  **New privilege key:** `settings:notifications` — granted to Director and Admin by default. Visible in the Privileges matrix (additive row). Does **not** carry an Admin floor (unlike `settings:privileges`).

  **New DB model (`NotificationEventConfig`):** `eventKey String @id`, `enabled Boolean @default(true)`, `ccManagers Boolean @default(false)`, `updatedAt DateTime @updatedAt`, `updatedById Int?` (FK→User `ON DELETE SET NULL`). Not soft-delete protected (config artifact). Migration `backend/prisma/migrations/20260616000000_add_notification_event_config/`.

  **7 configurable event keys** (maps `Notification.type` to independent knobs; `FEED_ACTIVITY` is split by `linkScope`):
  `TASK_ASSIGNED`, `TASK_SUBMITTED`, `TASK_REVIEWED`, `FINDING_CREATED`, `ESCALATION_QUEUED`, `FEED_ACTIVITY_TASK`, `FEED_ACTIVITY_WP`.

  **Backend (new files):**
  - `services/notificationConfigService.ts` — `NOTIFICATION_EVENT_CATALOG` (7 items, labels/descriptions/group), `getEventConfigMap` (60s in-memory read cache, fail-open: returns all-enabled defaults on any DB error), `getAllConfigs` (GET endpoint), `upsertConfig` (validates key, upserts, clears cache, dual-writes `NOTIFICATION_CONFIG_UPDATED` AuditLog — **no FeedPost**, not task-scoped). Cache disabled under test (`NODE_ENV==='test'`).
  - `controllers/notificationConfig.controller.ts` — `GET /` returns catalog + current values; `PUT /:eventKey` validates `{enabled:boolean, ccManagers:boolean}` body.
  - `routes/notificationConfig.routes.ts` — both routes behind `requirePrivilege('settings:notifications')`.

  **Backend (modified):**
  - `services/notificationService.ts` — `createNotifications` chokepoint now: (1) loads config map, (2) filters out inputs whose event class is `enabled:false`, (3) for surviving inputs with `ccManagers:true`, batch-resolves Manager-role users in the recipient's division and appends synthetic CC inputs. CC expansion is best-effort (fail-safe: errors yield no CC, base notifications still send). Synthetic inputs flow through the existing exclude + de-dup loop, so the actor is excluded even if they are a Manager.
  - `constants/privileges.ts` — new key + catalog entry + Director/Admin grants.
  - `index.ts` — mounts `app.use('/api/settings/notification-config', notificationConfigRoutes)`.
  - `prisma/seed.ts` — seeds 7 default rows (idempotent upsert).

  **Frontend (new files):**
  - `api/notificationConfigApi.ts` — `getNotificationConfig()`, `updateNotificationConfig(key, body)`.
  - `components/settings/NotificationConfigSettings.tsx` — table with one row per event class: label, description, **Enabled** checkbox, **CC division managers** checkbox (disabled when event is off). Save button shows dirty count; per-row updates sent sequentially. Admin/Director guard with lock screen. Privilege-based events (`FINDING_CREATED`, `ESCALATION_QUEUED`) show a note linking to the Privileges tab.
  - `types/index.ts` — `NotificationEventCatalogItem`, `NotificationEventConfig` interfaces.

  **Frontend (modified):**
  - `app/dashboard/settings/page.tsx` — `SettingsTab` union + `Bell` tab (show: `isAdminDirector`), `resolveTab` guard for `'notifications'`, tab content render.

  **Boundary (intentional):** disabling `ESCALATION_QUEUED` silences the **inbox notification** only. The separate red-bell `emitRealtimeEvent({kind:'escalation'})` is a different realtime signal unaffected by this config.

  **Tests (`notificationConfig.test.ts`, 9 tests):**
  - Fail-open: no config rows → events still fire.
  - `enabled:false` → no `Notification` rows written.
  - `ccManagers:true` → all Managers in the assignee's division notified; other divisions not.
  - Actor-exclusion holds even when actor is a CC-eligible Manager.
  - `GET` returns catalog + 7 configs to authorised user.
  - `PUT` persists row + writes `NOTIFICATION_CONFIG_UPDATED` AuditLog.
  - Invalid event key → 400. Non-boolean body → 400. Staff → 403.

- **File Upload Infrastructure (Attachments)** (✅ **COMPLETE**, 2026-06-16 — branch `claude/file-upload-infrastructure-28r4m5`)
  > **444 backend tests passing (+13 new in `attachment.test.ts`). Backend `tsc --noEmit` clean (pre-existing `notification.test.ts` strict-optional warnings only). Frontend `tsc`/lint/`next build` clean. Additive, reversible schema change. Living developer manual: `FILE_UPLOAD_DEV_GUIDE.md`.**

  Implements the long-deferred `File Upload` field type and a general attachment system for Tasks, Findings, Work Packages, and Templates. **Storage decision diverged from the original §3.5 MinIO plan** — see §3.5 (rewritten) for the local-disk-behind-an-adapter rationale.

  **Storage layer (pluggable):**
  - `services/storage/StorageAdapter.ts` (interface: `ensureReady` / `putFile` / `getStream` / `remove` + `ObjectNotFoundError`), `LocalDiskAdapter.ts` (filesystem, path-traversal guarded, `rename` with `EXDEV` copy fallback), `index.ts` (`getStorage()` cached factory + `initStorage()`). Driver selected by `STORAGE_DRIVER` env (`local` default; `minio` is a documented stub). `config/storage.ts` validates `STORAGE_DRIVER` / `STORAGE_LOCAL_ROOT` (fail-fast).
  - **Downloads are proxied through the backend** (`GET /:id/download` streams from private storage) — MinIO's presigned-URL / S3 features are never needed, so no MinIO daemon runs.

  **Backend:**
  - **`Attachment` model upgraded** (additive): `bucket`, `fieldId`, `uploadedBy` relation, soft-delete `deletedAt`, `@@index([entityType, entityId, deletedAt])`. Polymorphic over `TASK | FINDING | TEMPLATE | WP`.
  - **`services/attachmentService.ts`** — validates against the active policy, enforces per-file + per-entity-total caps, streams the multipart temp file into storage (`putFile`), then atomically creates the row + **dual-writes** `AuditLog` (`ATTACHMENT_UPLOADED`/`ATTACHMENT_DELETED`) + a `SYSTEM_EVENT` `FeedPost` (TASK/WP/FINDING; TEMPLATE is audit-only). Soft-delete **retains the stored object** (evidence is a compliance record).
  - **`controllers/attachment.controller.ts` + `routes/attachment.routes.ts`** — `GET /api/attachments/config`, `GET /` (list), `POST /` (multer **diskStorage**, single file, temp-file `unlink` in `finally`), `GET /:id/download` (proxied stream), `DELETE /:id`. `toPublic()` projector never leaks `storageKey`/`bucket`. Wired in `index.ts` (+ best-effort `initStorage()` at startup).
  - **Admin-configurable limits (Rule 10):** `SystemSetting['FILE_UPLOAD_CONFIG']` (JSON), seeded from `DEFAULT_FILE_UPLOAD_CONFIG` in `constants/fileUpload.ts` (mirrors §3.5: Documents 20 MB / Images 10 MB / 50 MB per record). `loadFileUploadConfig()` reads it per request and **clamps** each `maxSizeBytes` to `ABSOLUTE_MAX_UPLOAD_BYTES` (100 MB infra ceiling).
  - **`attachment:delete_any` privilege** added to `PRIVILEGE_CATALOG` / `DEFAULT_PRIVILEGES` (default Director/Admin/Manager). Delete = uploader OR `hasPrivilege(actor, 'attachment:delete_any')` — DB-driven, not a hardcoded role array.

  **Frontend:**
  - `api/attachmentApi.ts` (upload w/ progress, list, blob download, delete; `getUploadConfig` cached at module scope). `components/ui/FileUploadField.tsx` reusable widget (toast feedback; emits attachment ids to the host form **only after upload/delete**, never on initial read).
  - **Task form:** `TemplateBuilder` gained the **File Upload** palette button + preview; `TaskFormPanel` threads `taskId` into the `file_upload` field renderer (ids stored in `TaskData`). **Finding detail** gained an **Evidence** section (`entityType="FINDING"`, disabled on Closed/Dismissed).

  **Deploy:** `deploy.sh` writes `STORAGE_*` env, creates the persistent (git-ignored) storage dir, and sets nginx `client_max_body_size 100M`.

  **Post-ship high-effort `/code-review` (2026-06-16, same branch):** 10 findings, all fixed — see `CODE_REVIEW_AUDIT_LOG.md` (session 2026-06-16). Key fixes: form-dirty-on-view bug, privilege-gated delete, disk-streaming uploads (VPS RAM), cached config fetch, honest download-auth docs. **Two deferred flags:** **DEF-5** (no `PUT` endpoint for `FILE_UPLOAD_CONFIG` yet — limits change via DB upsert), **DEF-6** (download/list are auth-only by the transparency model; add a scope check at `assertEntityExists` if visibility is ever tightened).

- **Settings Hub & UI Restructuring** (✅ **COMPLETE**, 2026-06-15 — branch `claude/settings-user-management-3661zs`)
  > **Backend `tsc --noEmit` clean. No schema change. No new backend tests (no new status-machine logic). Frontend: all modified files type-clean.**

  Consolidated scattered top-level pages (User Management, Taxonomy, Privileges) into a single tabbed Settings hub; added self-service profile editing (email + phone); extracted Quick Task as a tab inside Create Task.

  **Backend:**
  - **`PATCH /api/users/me/profile`** (new endpoint in `user.controller.ts` + `user.routes.ts`): self-service email and phone update. Validates email format (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) + uniqueness (allowing same email as current user). Phone must match `/^\d{1,12}$/` (digits only, max 12). Soft-delete guard (`where: { deletedAt: null }`). Returns `{ message, user: { id, email, phone } }`.

  **Frontend — new files:**
  - `frontend/src/components/settings/AccountSettings.tsx` — My Account tab: inline Edit/Save for email and phone; phone strips non-digits live (`v.replace(/\D/g, '').slice(0, 12)`); Change Password section; `forcePasswordChange` banner when applicable.
  - `frontend/src/components/settings/UserManagementSettings.tsx` — lifted from deleted `app/dashboard/users/page.tsx`; import paths corrected (4→2 levels); export renamed; header uses `h2`.
  - `frontend/src/components/settings/TaxonomySettings.tsx` — lifted from deleted `app/dashboard/settings/taxonomy/page.tsx`; import paths corrected; export renamed.
  - `frontend/src/components/settings/PrivilegesSettings.tsx` — lifted from deleted `app/dashboard/settings/privileges/page.tsx`; import paths corrected; export renamed; retains `window.location.reload()` on publish.
  - `frontend/src/components/tasks/QuickTaskForm.tsx` — extracted Quick Task form as a standalone component; calls `createQuickTask` from `taskApi`; navigates to task detail on success.

  **Frontend — modified files:**
  - `frontend/src/app/dashboard/settings/page.tsx` — full rewrite into a tabbed hub. Tab routing via `?tab=` query param (`useSearchParams` + `router.replace/push`). Tabs: `my-account` (all roles), `user-management` (Admin/Director), `taxonomy` (Admin/Director), `privileges` (Admin only). Default tab for Admin/Director: `user-management`; for everyone else: `my-account`. Uses `LucideIcon` type for tab icon props (avoids importing React namespace).
  - `frontend/src/app/dashboard/tasks/new/page.tsx` — added "From Template" / "Quick Task" tabs driven by `?mode=` query param. Tabs shown only when `canQuickTask && !prefilledWpId`. Quick Task tab renders `QuickTaskForm`; Template tab (or wp-prefill) renders `TaskCreateForm`.
  - `frontend/src/app/dashboard/tasks/page.tsx` — removed Quick Task button and modal entirely. Header now has a single "Create Task" button linking to `/dashboard/tasks/new`.
  - `frontend/src/components/layout/Sidebar.tsx` — removed User Management, Taxonomy, and Privileges nav items. Settings is the single entry point for all of these.
  - `frontend/src/api/userApi.ts` — added `updateMyProfile` function.
  - `frontend/src/store/authStore.ts` — added `updateProfile` action (merges `email`/`phone` into the stored user without a full re-fetch).
  - `frontend/src/types/index.ts` — added `phone?: string | null` to the `User` interface.

  **Deleted files:**
  - `frontend/src/app/dashboard/users/page.tsx`
  - `frontend/src/app/dashboard/settings/taxonomy/page.tsx`
  - `frontend/src/app/dashboard/settings/privileges/page.tsx`

  **Design decisions:**
  - Query-param tab routing (not sub-routes) keeps the Settings sidebar item always-active and avoids new route segments.
  - `LucideIcon` type (not `React.ReactNode`) for tab icons because Next.js 16 uses automatic JSX transform — importing the React namespace solely for its types is unnecessary.
  - Phone validation: digits only, max 12 — enforced identically on both backend (`/^\d{1,12}$/`) and frontend (live strip + same regex on submit).

- **Task Slice Code Review, Security Review & Architectural Improvements** (✅ **COMPLETE**, 2026-06-14 — branch `claude/exciting-rubin-hqkxma`)
  > **423 backend tests passing (+ 2 new regression tests). `tsc --noEmit` clean for all modified files. See `CODE_REVIEW_AUDIT_LOG.md` for the complete finding-by-finding record.**

  Three separate passes on the Task management vertical slice in a single session:

  **Frontend code review — 10 bugs fixed:**
  - `taskApi.ts`: `decideDeadlineExtension` used wrong decision literals (`'approved'/'denied'` → `'approve'/'deny'`).
  - `TaskActionBar.tsx`: `computeCanRate` read nested `.role.name` from a flat string; Director rating was always broken. `ratingValue` state didn't reset on prop change. `getUsers()` fetched unconditionally (N+1); errors were swallowed silently. Dead `Inactive` guard removed. Duplicated `computeIsReviewer()` removed — all `canX` derivations now use server-computed `task.isReviewer`.
  - `TaskCreateForm.tsx`: `setSubmitting(false)` moved to `finally` to prevent form freeze.
  - `TaskFormPanel.tsx`: `field.options` removed from `DynamicSelect` useEffect deps (caused repeated refetches).
  - `CreateTaskModal.tsx`: Escape key + backdrop-click handlers added (WCAG 2.1.2).

  **Three architectural improvements:**
  - `frontend/src/constants/taskStatus.ts` (now a full mirror): `TASK_STATUSES`, `FINAL_TASK_STATUSES`, `REVIEW_ACTIONS`, `DEADLINE_DECISIONS` — single source for contract literals.
  - `backend/src/controllers/task.controller.ts`: `enrichTask()` helper appends `isReviewer`, `isOverdue`, `deadlineStatus` to every task response, eliminating client-side RBAC re-derivation.
  - `backend/src/__tests__/contractSync.test.ts` (new): guard test that parses the frontend mirror as text and asserts it matches the backend authority on every CI run.

  **Backend code review — 10 bugs fixed (`task.controller.ts`):**
  Soft-delete sequence collision in `generateTaskId`; non-atomic dual-writes (9 handlers now wrapped in `prisma.$transaction`); non-atomic `saveTaskData`; missing division-scope check in reassign paths; invalid-date guard in `setDeadline`; wrong reactivation fallback status; `parseInt` → `parseTaskId` helper (systemic, 16 call sites); row-lock for `decideDeadlineExtension`; missing Inactive block in `transferIssuerRights`; whitespace-only reason + dead branch in `inactivateTask`/`saveTaskData`.

  **Security review — 6 vulnerabilities fixed:**
  - **HIGH (SEC-1):** `createTaskService` gated assignee division lock on `role === 'Manager'` — WP-bypass users (Staff/Group Leader) could assign cross-division on create. Fixed: `hasPrivilege(actor, 'task:assign_any')`. Regression test T04c.
  - **Medium (SEC-2):** `transferIssuerRights` allowed transfer to any user. Since `issuerId === userId` grants reviewer rights, this gave Staff reviewer access. Fixed: restricted to Manager/Director targets. Regression test T54a.
  - **Low (SEC-3/4):** `reassignTask` used raw `parseInt` (NaN → 500); float `extensionIndex` bypassed bounds check (undefined.decision → 500). Both fixed.
  - **Medium (SEC-5/6):** Dynamic form fields (`text`/`textarea`/`rich_text`) and free-text controller inputs were completely unbounded. Fixed: 512 KB payload cap + 100k per field value; `title` 300, `reason` 2000, `comment`/`content` 5000. Frontend `maxLength` UX guardrail.
  - **Confirmed intentional:** Manager cross-division task planting (by design — uses org feed/escalation path); transparent view/comment model (all authenticated users).

  **`types/index.ts` fix (separate commit):** `forcePasswordChange: boolean` added to `User` interface — the field was returned in auth responses and used in two components but missing from the type.

- **Realtime: SSE Live Notifications + Notification Center + Manual Refresh** (✅ **COMPLETE**, 2026-06-13 — branch `claude/sqd-app-sse-notifications-yj7n32`, NOT yet merged to `main`)
  > **396 backend tests passing (+15 new in `notification.test.ts`). Backend `tsc --noEmit` clean (production code; pre-existing `notification.test.ts` strict-optional warnings only). Additive `Notification` model + reversible migration. Living developer manual: `REALTIME_DEV_GUIDE.md`.**
  - **What it does:** pushes lightweight **signals** (never payloads) to the browser over one SSE stream; the client refetches via the existing REST endpoints so all RBAC scoping and the dual-write are reused untouched. Notifications are an **additive THIRD write** — they sit alongside, never replace, the `AuditLog` + `FeedPost` dual-write (Rule 3), and are best-effort (a notification failure can never roll back the business write).
  - **Cross-instance scaling via Postgres LISTEN/NOTIFY (no Redis).** `emitRealtimeEvent()` rides the caller's transaction client → the `NOTIFY` fires on COMMIT, so listeners never refetch before the new rows are visible. Every instance `LISTEN`s on the `sqd_realtime` channel; any instance's `NOTIFY` reaches all instances; each fans out to its own local SSE clients. No shared in-memory state.
  - **Backend (NEW):** `realtime/sseHub.ts` (per-user `Map<userId, Set<res>>` registry, 5-connection cap → 429, dead-socket pruning on write failure), `realtime/pgEvents.ts` (`emitRealtimeEvent` + `startRealtimeListener`; payload size guard for the 8 KB `pg_notify` limit; exhaustive `dispatch` switch), `controllers/realtime.controller.ts` (`GET /api/events/stream`), `controllers/notification.controller.ts` + `routes/notification.routes.ts` (`GET /`, `GET /unread-count`, `PATCH /:id/read`, `POST /read-all` — all scoped to `req.user.userId`), `services/notificationService.ts` (`createNotifications` with per-recipient error isolation + FEED_ACTIVITY collapse-unread; `notifyFeedWatchers`; `resolvePrivilegedUserIds`; `purgeOldNotifications` — 30-day retention sweep on read notifications).
  - **Trigger wiring (additive, best-effort, at existing dual-write sites):** task assigned/reassigned → assignee (`TASK_ASSIGNED`); task submitted → issuer (`TASK_SUBMITTED`); task reviewed → assignee (`TASK_REVIEWED`); finding created → `finding:review` holders (`FINDING_CREATED`); escalation queued → `escalation:review` holders (`ESCALATION_QUEUED`, also nudges the existing escalation bell); feed COMMENT on a TASK/WP → watchers (`FEED_ACTIVITY`, collapse-unread). All exclude the actor.
  - **Frontend (NEW):** `realtime/RealtimeProvider.tsx` (one `EventSource`, mounted in dashboard layout), `store/realtimeStore.ts` (Zustand: `unreadCount` + monotonic `feedSignals` per feed), `api/notificationApi.ts`, `components/layout/NotificationBell.tsx` (separate **inbox bell**, blue badge — the red escalation bell is untouched), `hooks/useRealtimeRefresh.ts` (drives the "N new updates" pill + tab-refocus refetch; never yanks content mid-read), `components/ui/NewUpdatesPill.tsx`. Wired into `FeedPanel`, `TaskActivityFeed`, and the task detail page.
  - **Post-ship `/security-review` + high-effort `/code-review` (2026-06-13, same branch):** all findings fixed (396 tests still green) — per-recipient write isolation in `createNotifications`; cap check moved before the 200 SSE handshake (real 429); exhaustive `dispatch` default; `unref()` on the purge interval; dead-socket pruning in the hub; `markRead` response now distinguishes a fresh mark from an already-read no-op.
- **Auth Security Hardening** (✅ **COMPLETE**, 2026-06 — branch `claude/amazing-ritchie-soasus`, NOT yet merged to `main`)
  > **6 phases, all independently green. 370 backend tests (367 passing + 3 pre-existing unrelated failures). Frontend `tsc`/`next build` clean. No schema change.**
  - Implements all of **§11** (Fixes 1/3/4/5; Fix 2 already done) plus session-lifecycle and transport hardening. See §11 for the per-fix detail and §12 for the deployment requirements introduced.
  - **Phase 1** — `config/env.ts` (JWT secret required, no fallback); constant-time login (dummy bcrypt on unknown-user path); reset tokens stored/compared as SHA-256.
  - **Phase 2** — `updatePassword` requires + verifies `oldPassword` (403/400); eliminated the `temp-auth-token` ghost in the store (later removed entirely in Phase 6).
  - **Phase 3** — `POST /api/auth/logout` clears `activeSessionId` (+ `LOGOUT` AuditLog); `resetPassword` clears the session; middleware always revalidates the account (`deletedAt`) and sources `role`/`divisionId` from the DB regardless of `ENFORCE_SINGLE_SESSION`.
  - **Phase 4** — `express-rate-limit` on `/login`, `/forgot-password`, `/reset-password` (test-safe skip).
  - **Phase 5** — `register` persists a unique `employeeId` so a created user can log in.
  - **Phase 6** — JWT delivered as an httpOnly `SameSite=Strict` cookie (header still accepted for API/tests); CORS locked to `FRONTEND_ORIGIN` with credentials; token no longer in JS-readable storage. Added `cookie-parser`.
  - **Also fixed** (unblocks the production frontend build): the two pre-existing `ReviewPanel.tsx` / `RichTextEditor.tsx` (Tiptap v3 `setContent`) type errors.
- **Phase 1 & 2** — Backend foundation, PostgreSQL schema, JWT auth, bcrypt, RBAC middleware
- **Phase 3** — Next.js app shell, sidebar (role-aware), header, auth UI (`/login`, `/update-password`, `/forgot-password`)
- **Phase 4.1** — App shell, professional light theme (Tailwind 4, slate-50 / blue-600)
- **Phase 4.2** — Password management (`forcePasswordChange` flag, reset token flow)
- **Phase 4.3** — Template Builder (COMPLETED)
  - Backend API complete (`template.controller.ts`)
  - Draft Encapsulation implemented (`draftSchema`)
  - Ownership model implemented
  - Frontend visual Form Builder complete with revision history and archive actions
- **Phase 5.0** — Database Schema Migration + Infrastructure (COMPLETED 2026-05-23)
  - All schema additions from Section 6 applied via `prisma db push` (dev + test DBs)
  - New models: `WorkPackage`, `WorkPackageAssignment`, `TaskActivity`, `TimeBooking`, `WpType`, `PrivilegeConfig`, `Attachment`
  - `Task` model expanded with `taskId`, `issuerId`, `wpId`, `schemaSnapshot`, `rating`, `deadline`, and the full task-status set (currently 9 — authority: `backend/src/constants/taskStatus.ts` `TASK_STATUSES`)
  - `AuditLog.entityId` migrated from `Int` → `String`
  - Soft delete (`deletedAt`) added to `User`, `Task`, `Finding`, `WorkPackage`
  - `Finding` expanded with Stage 2 analytical fields
  - Frontend `types/index.ts` updated with `Task`, `WorkPackage`, `TaskActivity`, `TimeBooking`, `Attachment`, `Finding` interfaces
  - Baseline migration SQL generated at `prisma/migrations/0_init/migration.sql`
  - All soft-delete filters applied across existing controllers and auth middleware
- **Phase 5.1** — Work Package Backend (COMPLETED 2026-05-23)
  - `wp.routes.ts` + `wp.controller.ts` — full CRUD for WorkPackage
  - `WpType` management endpoints (Admin only)
  - WP user assignment/removal endpoints (Manager / Director; cross-division enforced)
  - WP status computed on-the-fly: `Open` / `In Progress` / `Overdue` / `Closed` / `Inactive`
  - CHECK type on-demand Task auto-generation via `wpCheckService.ts` (reusable service, dedup guard)
  - `wp.routes.ts` registered in `backend/src/index.ts`
  - **Phase 5.1 audit fixes** (found during review, resolved before 5.2):
    - `template.controller.ts` — `prisma.task.count()` was missing `deletedAt: null` filter (soft-deleted tasks would incorrectly block template deletion)
    - `user.controller.ts` — `updateUserRole` was missing a soft-delete guard; now returns 404 if user is soft-deleted before attempting the update
- **Phase 5.2 & 5.3** — Task & Activity Feed Backend (COMPLETED 2026-05-23)
  - `task.routes.ts` + `task.controller.ts` — full CRUD, assignment, submission, review, re-rating, and inactivation status machine
  - Strict TypeScript null checks resolved (`Prisma.DbNull` applied to JSON columns)
  - Activity feed (`GET /api/tasks/:id/activity`) and comments (`POST /api/tasks/:id/activity`) implemented
  - Work Package RBAC exceptions implemented (Staff/Group Leader can create and assign tasks within their assigned WPs, scoped to their division)
- **Phase 5.4** — Task Frontend (COMPLETED)
  - Task dashboard list views and execution routing implemented.
- **Phase 5.5 Prerequisite Audit Fixes** (COMPLETED 2026-05-30)
  - Resolved 8 high-priority (🔴) findings from the external codebase audit:
    - Added `deletedAt: null` to `task.findFirst` in `wpCheckService.ts` and `generateTaskId` in `task.controller.ts` (soft-delete ID sequence fixes).
    - Fixed user enumeration vulnerability in `forgotPassword` (`auth.controller.ts`) by always returning a generic 200 OK status.
    - Restricted template creation in `template.controller.ts` to enforce that Managers can only create templates for their own division.
    - Enforced mandatory non-empty reason validation in `reassignTask` (`task.controller.ts`).
    - Fixed TypeScript implicit `any` parameter types on Prisma transaction client (`task.controller.ts`) and `computeWpStatus` input arguments (`wp.controller.ts`).
    - Removed hardcoded 'SQD' division filter in `datasource.controller.ts` (now returns all divisions per Option A).
    - Updated rating validation, error messages, and activity logging to use the **1–5** star rating scale.
- **Phase 5.5 — Work Package Frontend & Transparency** (COMPLETED 2026-05-30)
  > [!WARNING]
  > **Note:** This phase was partially revised outside of Claude Code during execution. The actual code files are the source of truth — not the original Phase 5.5 plan.
  - **Backend Permissions Relaxed (Transparency):** `wp.controller.ts` and `task.controller.ts` modified to allow all system users to view Work Packages and Tasks system-wide (removed `isWpMember` viewing restrictions). Anyone can comment on tasks. `wp.test.ts` and `task.test.ts` updated to match.
  - **Frontend List Filters (`work-packages/page.tsx`):** Implemented frontend View Filters: "My WP" (default for Staff/Manager), "Division WP", and "All WP" (default for Admin/Director).
  - **Frontend Detail View (`work-packages/[id]/page.tsx`):** Hidden action buttons (Edit, Close, Assign Users) for non-actionable viewers, cleanly separating viewing from acting. Staff assigned to a WP can still create tasks within it.
  - **CHECK WP Deadline (`wpCheckService.ts`):** Adjusted the daily auto-generated task to set its deadline to the very end of the current day (`23:59:59.999`) so it properly displays as "today" and becomes overdue exactly at midnight.
  - **Bugs Fixed:**
    - *Crash on Create Task:* Fixed `ReferenceError: Cannot access 'prefilledWpId' before initialization` in `tasks/new/page.tsx` by hoisting the URL parameter parsing above the `useEffect` hook.
    - *Date Input Validation:* Fixed an issue where date pickers allowed 5-digit years (e.g., `20023`) by globally adding `max="9999-12-31"` to all `type="date"` inputs (`TaskFormPanel.tsx`, `WorkPackageForm.tsx`, `TaskActionBar.tsx`, `TemplateBuilder.tsx`, `[id]/page.tsx`).
    - *Test DB cleanup:* Created `backend/clean.ts` to cleanly drop data without foreign key violations during CI runs.
- **Phase 5.6 — Time Booking** (COMPLETED 2026-05-31)
  - **Backend (`timebooking.controller.ts`):** `createTimeBooking` (POST) and `updateTimeBooking` (PUT) with full validation, RBAC (assignee creates; assignee + Admin + Director can update), dual audit write (AuditLog `TIME_BOOKING_CREATE`/`TIME_BOOKING_UPDATE` + TaskActivity `SYSTEM_EVENT`), soft-delete guard on task lookup, one-booking-per-task uniqueness enforcement, assignee-cannot-be-collaborator guard, `estimatedHours` snapshot on creation.
  - **Routes:** `POST /api/tasks/:id/time-booking` and `PUT /api/tasks/:id/time-booking` registered in `task.routes.ts`.
  - **Frontend (`TimeBookingPanel.tsx`):** Full form (hours + notes + collaborator management), read-only summary view with budget-vs-actual comparison badge, edit mode for existing bookings, live total preview during form entry.
  - **Integration:** `TimeBookingPanel` imported and rendered in `tasks/[id]/page.tsx` (final-state tasks only).
- **Phase 5–6 Frontend Audit Fixes** (COMPLETED 2026-06-01)
  - **Bug fixes in `TaskActionBar.tsx`:**
    - Post-rejection Reassign now calls `postRejectionAction` (was calling `reassignTask` which always returned 400 on Rejected status)
    - `computeCanRate` fixed: was reading `(task.assignedToUser as any)?.role?.name` — role is a flat string, not a nested object, so Director rating was always broken. Fixed to `?.role`.
    - `decideDeadlineExtension` now sends `extensionIndex` to the backend (was never sent; backend requires it and was returning 400 on every approve/deny action)
  - **`taskApi.ts`:** `decideDeadlineExtension` signature updated to include `extensionIndex: number` parameter
  - **UX fixes — user pickers replace raw numeric ID inputs:**
    - Assign Task: `<input type="number" placeholder="Enter user ID">` replaced with `<select>` dropdown populated from `getUsers()` datasource
    - Post-rejection Reassign: same fix
  - **New UI added to `TaskActionBar.tsx` (backend was already complete):**
    - General Reassign button — visible for reviewer on Assigned / In Progress / In Review / Follow-up Required; uses `reassignTask`; requires reason
    - Transfer Issuer Rights — visible for current issuer on non-final tasks; user dropdown excluding self
    - Set / Update Deadline — visible for reviewers on non-final non-inactive tasks; date picker
  - **`RaiseFindingPanel.tsx`:** Event Type changed from free-text input to a `<select>` with 9 standard aviation event types (`Procedural Breach`, `Equipment Fault`, `Documentation Error`, `Maintenance Error`, `Safety Observation`, `Regulatory Non-compliance`, `Training Gap`, `Communication Failure`, `Other`). "Other" reveals a free-text fallback. Phase 7 will replace this with an admin-managed list.

- **Phase 6 — Findings System** (COMPLETED 2026-06-01)
  - **Schema additions:** `Finding.departmentId Int` (required FK to Department); `Finding.category String?` (made nullable — was required but not included in the raise payload); `Task.title String?` (needed for editable follow-up task titles).
  - **Service (`findingService.ts`):** `logFindingAuditAndActivity()` (dual-write helper) and `checkAndTriggerPendingVerification()` (best-effort hook — never rethrows, wired into task.controller after reviewTask / postRejectionAction / submitTask reach final states).
  - **Backend (`finding.controller.ts` + `finding.routes.ts`):** 7 endpoints registered under `/api/findings`:
    - `POST /api/findings` — raise finding (requires taskId, eventType, departmentId, description; template must have `allowsFindings = true`; task must be non-final)
    - `GET /api/findings` — list with RBAC scoping + filters (status, severity, page, pageSize)
    - `GET /api/findings/:id` — full detail with nested sourceTask, followUpTasks, reportedByUser, department
    - `PUT /api/findings/:id/review` — set severity + dueDate; status Open → In Progress (Manager/Director only)
    - `POST /api/findings/:id/tasks` — generate follow-up tasks (atomically validated; tasks created as Unassigned, linked via `parentFindingId`)
    - `PUT /api/findings/:id/stage2` — save analytical fields (rootCause, correctiveAction, errorCode, recurrence, category)
    - `PUT /api/findings/:id/close` — close finding from Pending Verification (Manager/Director only)
  - **RBAC scoping:** Director/Admin = all findings; Manager = own division; Group Leader/Staff = own findings + follow-up task assignee.
  - **Pending Verification hook:** fires when all follow-up tasks for a finding reach a final state (Closed/Rejected/Terminated). Writes to AuditLog + source task's TaskActivity feed. Best-effort — never breaks the triggering task action.
  - **Tests (`finding.test.ts`):** 37 new tests across 8 groups. All 187 tests passing.
  - **Frontend components:** `FindingBadges.tsx` (SeverityBadge, FindingStatusBadge); `ReviewPanel.tsx` (Stage 1 review form, read-only for non-reviewers); `GenerateFollowUpModal.tsx` (multi-row task generation with template+title per row); `Stage2Form.tsx` (analytical fields, editable/read-only by role); `RaiseFindingPanel.tsx` (slide-over raise form with department datasource).
  - **Frontend pages:** `/dashboard/findings` (list with filter bar, severity + status filters); `/dashboard/findings/[id]` (two-column detail: metadata, review, follow-up tasks, stage 2, close, activity feed).
  - **Task integration:** "Raise Finding" button gated on `template.allowsFindings && non-final status`; Linked Findings section on task detail; `RaiseFindingPanel` slide-over; activity feed updated after raise.
  - **Sidebar:** Findings nav item (all roles); amber badge showing Open + In Progress count scoped to RBAC visibility.
  - **`task.controller.ts` addition:** `allowsFindings` added to `taskInclude()` so the template flag is available in task detail responses.
  - **`seed-verification.test.ts` fix:** hardcoded `ts-node.cmd` (Windows binary) replaced with platform-aware `process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node'`.
  - **Deferred (not in Phase 6):** `violatorIds` multi-select search against external personnel DB; Findings analytics/charts dashboard.

- **Task Issuance UX Improvements** (COMPLETED 2026-06-08 — branch `claude/sleepy-bell-MTJwM`)
  - **Task Instruction field (`issuanceNote`):** Optional free-text field added to task creation. Issuers can provide context or guidance specific to the task instance (e.g. scope, location, special conditions). Write-once at creation — any follow-up discussion goes through the task activity feed. Displayed prominently in `TaskDetailPanel` immediately after the Template row (hidden when null).
    - Schema: `issuanceNote String?` added to `Task` model — nullable, non-destructive.
    - Backend: `CreateTaskParams` interface + `createTaskService` + HTTP handler updated. No audit log entry (it is static context, not a status event).
    - Frontend: `Task` type, `CreateTaskPayload`, new `issuanceNote` state + textarea on `/dashboard/tasks/new`, `DetailRow` in `TaskDetailPanel`.
  - **Searchable dropdowns (`SearchableSelect` component):** New reusable combobox at `frontend/src/components/ui/SearchableSelect.tsx`. Replaces plain `<select>` elements in the task creation form for Template, Target Division (elevated roles), Assignee, and Work Package pickers. Features live text filter, highlighted active selection, "no results" state, clearable entries, closes on outside click.
  - **Division-scoped assignee list:** Assignee picker now shows **only users from the selected target division**. Changing the division auto-clears any stale assignee selection. Backend `datasource/users` endpoint updated to include `divisionId` in each returned user entry (was previously absent). `getUsers()` return type updated accordingly.
  - **Rich Text field type in Template Builder** (COMPLETED 2026-06-08):
    - New `rich_text` field type added alongside existing 8 types. Template designers add it from the "+ Rich Text" button in the field palette.
    - Editor component: `frontend/src/components/ui/RichTextEditor.tsx` — Tiptap + StarterKit. Toolbar: Bold, Italic, Bullet List, Numbered List. Read-only mode uses Tiptap's `editable: false` (no `dangerouslySetInnerHTML`).
    - Wired in: `FormFieldType` union, `TemplateBuilder` (button + live preview), `TaskFormPanel` FieldRenderer (`rich_text` case), template detail page preview, `RevisionHistoryPanel` field type label map (also completed the full label map for all existing types).
    - Stored value: HTML string produced by Tiptap, saved in `TaskData.data` like any other field value. Zero backend changes.
    - Dependency added: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` in `frontend/package.json`.

- **Phase 6.x — Finding Workflow Expansion** (COMPLETED 2026-06-07)
  > [!NOTE]
  > **Branch:** `claude/nice-bell-LZ29I` (merged to main after audit fixes)
  
  **New schema models added:**
  - `RcaInvestigation`, `RcaWhyStep`, `RcaContributingFactor` — structured root cause analysis
  - `CapaAction` with soft-delete (`deletedAt DateTime?`) — Corrective/Preventive actions
  - `CapaTaskLink` (many-to-many) — replaces flat `executionTaskId`/`effectivenessTaskId` FK columns; includes `role` (EXECUTION | EFFECTIVENESS | SUPPORTING)
  - `AtaChapter`, `CauseCode`, `HazardTag`, `FindingHazardTag` — taxonomy models
  - `FindingLink` — cross-finding traceability (DUPLICATE | RELATED | CAUSED_BY)
  - `TrendInfo` with `signatureStrength` ('strong' | 'partial' | 'none') — two-tier trend engine
  
  **New controllers:**
  - `rca.controller.ts` — RCA lifecycle (upsert header, save why-steps, save factors)
  - `capa.controller.ts` — CAPA create/update/delete (soft-delete); verify/waive; link management (`addCapaLink`, `removeCapaLink`)
  - `findingLink.controller.ts` — cross-finding link CRUD
  - `taxonomy.controller.ts` — ATA chapters, cause codes, hazard tags list + create/update (Admin/Director)
  
  **New service:** `trendService.ts` (compute-on-read recurrence detection)
  
  **Key design decisions:**
  - **Stage 2 removed** — all analytical data now captured via structured RCA + CAPA (rootCause/correctiveAction legacy fields preserved with @deprecated comments but not used)
  - **PREVENTIVE CAPAs do NOT block finding closure** — only CORRECTIVE CAPAs must be Verified; PREVENTIVE may remain Open/In Progress/Completed
  - **CAPA soft-delete enforced** (compliance mandate) — `deleteCapa` sets `deletedAt`, not physical delete
  - **CapaTaskLink many-to-many** — replaces old 1:1 relationship model; supports Task OR Work Package as either execution or effectiveness endpoint
  - **Trend engine two-tier** — "strong" signature (all 4 dims: dept+ATA+cause+hazard), "partial" (dept+ATA+cause only), "none" (any dim missing). Both strong/partial use same TREND_THRESHOLD for isRecurring
  - **Dismissed status added** — new terminal status for erroneous findings (`PUT /:id/dismiss`, Manager/Director only, requires reason)
  - **Manual advance endpoint** — `PUT /:id/advance` for findings with no follow-up tasks (admin escape hatch)
  - **Open visibility** — `buildFindingScope` returns `{}` (all authenticated users can view all findings). Mutation access enforced per endpoint.
  - **`assertManagerDivisionScope(client, user, findingId)`** — shared helper in `findingAccess.ts`; replaces 5 identical inline OR-clause blocks in `finding.controller`, `findingLink.controller`. Returns `true` immediately for Directors; Managers pass only when the finding belongs to their division via `targetDivisionId`, a follow-up task's division, or a follow-up assignee's division.
  - **`extractCapaLinkedUserIds(capaActions[])`** — shared helper in `findingAccess.ts`; previously duplicated in `capa.controller` and `rca.controller`. Call with `finding.capaActions`.
  - **`canEditAnalysis` third param** — renamed from `hasAccess` to `managerMayEdit`; pass `true` at all current call sites (Managers can globally edit RCA/CAPA). CAPA verify/waive/delete/removeCapaLink now use `canEditAnalysis` (consistent with createCapa/updateCapa/addCapaLink) instead of the dead `canAccessFinding` gate.
  
  **New audit action strings:**
  - `NO_FOLLOWUP_REQUIRED`, `SEVERITY_UPDATED`, `MANUAL_ADVANCE`, `DISMISSED`, `TAXONOMY_UPDATED`
  - `CAPA_LINK_ADDED`, `CAPA_LINK_REMOVED`
  
  **Tests:** All 307 backend tests passing. Frontend migrated to CapaTaskLink model (types, API, CapaPanel components).

- **Finding Response Actions + Standalone Findings** (✅ **COMPLETE**, 2026-06-09 — branch `claude/compassionate-gauss-335xa3`)
  > **Phases 1–8 complete. 322 backend tests passing.**

  **Backend changes:**
  - **New model `FindingResponseAction`** — created atomically with each response-action follow-up task. Stores `type` (CAR | NCR | QN | QR | IR | Dissemination), `taskId`, `targetDepartmentIds` (JSON int-array, all six types require ≥1 dept), optional `procedureRef` + `note`, `createdByUserId`, `findingId`, soft-delete `deletedAt`. Dual-writes `RESPONSE_ACTION_CREATED` to AuditLog + FeedPost.
  - **`Task` model additions** — `responseActionType String?` and `requiresDirectorApproval Boolean @default(false)`. Populated server-side when a follow-up task is generated as a response action. `requiresDirectorApproval` derived from `responseActionType ∈ DIRECTOR_APPROVAL_TYPES` — **never trusted from client**.
  - **`findingExpansion.ts` constants** — `RESPONSE_ACTION_TYPES`, `MULTI_DEPT_SINGLE_TASK_TYPES`, `DIRECTOR_APPROVAL_TYPES`, `ResponseActionType` union type, `RESPONSE_ACTION_CREATED` audit string.
  - **`finding.controller.ts` changes:**
    - `createFinding` / `createFindingService` — `taskId` now optional; standalone path requires `targetDivisionId` (division verified in DB). Same `POST /api/findings` endpoint — no new route.
    - `generateFollowUpTasks` — extended per-row validation for `responseActionType` (type check, ≥1 dept, single-dept-per-row enforcement for CAR/NCR/QR/IR), dept existence check, `FindingResponseAction` row creation, dual-write audit.
    - `getFindingById` — `followUpTasks` select extended with `responseActionType` + `requiresDirectorApproval`; `responseActions` relation included with `targetDepartments` join (single SQL JOIN — no separate dept query).
  - **`task.controller.ts` — Director-only gate in `reviewTask`:** After status check, before self-approval check: `if (task.requiresDirectorApproval && role !== 'Director') → 403`. QN tasks are blocked for all non-Directors including the Issuer. The Issuer exception does NOT apply.
  - **15 new tests (RAC-01 → RAC-15)** in `finding.test.ts`: IR/CAR/QN creation, multi-dept, Director-only gate, error paths, response action serialisation, backward-compat (no type = standard task). Baseline 307 → **322 passing**.

  **Frontend changes (Phases 5–8):**
  - `types/index.ts` — `ResponseActionType` union, `ResolvedDepartment`, `FindingResponseAction` interfaces; `Task` + `FindingFollowUpTask` extended with `responseActionType` + `requiresDirectorApproval`; `FindingDetail.responseActions` array.
  - `api/findingApi.ts` — `RaiseFindingPayload.taskId` now optional + `targetDivisionId` added; `FollowUpTaskInput` extended with `responseActionType`, `targetDepartmentIds`, `note`, `procedureRef`.
  - `RaiseFindingPanel.tsx` — `taskId` prop optional; division picker (from `getDivisionsApi`) shown when no `taskId`; conditional spread in `raiseFinding` call.
  - `findings/page.tsx` — amber "Raise Finding" button in page header; standalone `RaiseFindingPanel` (no `taskId`); refreshes list on success.
  - `GenerateFollowUpModal.tsx` — Response Action Type select per row; dept picker (single for CAR/NCR/QR/IR, multi-checkbox for QN/Dissemination); template list filtered to matching `t.type`; client-side validation; payload includes response action fields.
  - `FindingBadges.tsx` — `ResponseActionBadge` component (colour-coded per type).
  - `findings/[id]/page.tsx` — follow-up task rows show `ResponseActionBadge`, "Director approval required" text, and resolved target department names.
  - `TaskDetailPanel.tsx` — "Response Action" `DetailRow` after Instruction row; purple Director-approval banner with `ShieldCheck` icon.

  **Design decisions locked:**
  - `Template.type String?` repurposed for response-action template categorisation (Admin sets `type = 'CAR'` etc.). Modal filters templates by `t.type === responseActionType` when a type is selected.
  - Per-dept QN tracking deferred to Change Management phase.

  **Post-ship security review + code review (2026-06-09, same branch):** a `/security-review` and high-effort `/code-review` were run against the feature. Fixes applied (all 322 tests still green):
  - **RBAC (H-1):** `reviewFinding`, `generateFollowUpTasks`, `closeFinding`, `advanceFinding` now call `assertManagerDivisionScope` — previously they checked only the reviewer role, letting a Manager mutate a finding in another division.
  - **State machine (H-2):** `generateFollowUpTasks` rejects findings that are not `Open`/`In Progress` (a direct API call could otherwise attach tasks to a `Closed`/`Dismissed` finding).
  - **DoS (H-3):** follow-up generation capped at 20 rows per call (backend 400 + frontend toast).
  - **Input validation (M-1, L-2, L-3):** `targetDepartmentIds` sanitised to positive de-duplicated ints; `issuanceNote` ≤ 2000, `note` ≤ 1000, `procedureRef` ≤ 200 chars; whitespace-only task titles rejected.
  - **Audit accuracy (L-1):** `reviewFinding`'s `taxonomyChanged` no longer fires a spurious `TAXONOMY_SET` entry for an empty `hazardTagIds: []`.
  - **Efficiency:** template `formSchema`/`estimatedHours` fetched once in pre-validation (was an N+1 re-fetch per row inside the tx); validation builds a typed `prepared[]` array instead of mutating `req.body`.
  - **Schema join (dept resolution):** `targetDepartmentIds Json` column replaced with `FindingResponseActionDepartment` join table. `getFindingById` now resolves dept names via a Prisma relation include (single SQL JOIN) instead of a second `findMany` query. No API surface change — response still includes `targetDepartments: [{ id, name }]`.
  - **Reuse/cleanup:** extracted `requireReviewerRole`, `validateTaxonomyFields`, `replaceHazardTags`, `validateResponseActionEntry` helpers (see `FINDING_EXPANSION_DEV_GUIDE.md` §4).
  - **Confirmed intentional (not changed):** open finding read-visibility for all authenticated users (`buildFindingScope → {}`); any authenticated user may raise a standalone finding.

- **Phase 7 Deferred Items: User Management, Settings, Taxonomy & EventTypes** (✅ **COMPLETE**, 2026-06-12 — branch `claude/exciting-darwin-gyohuf`)
  > **7 phases + security fixes. Backend `tsc --noEmit` clean. Tests could not be verified in the remote container (no PostgreSQL). Frontend `tsc --noEmit` clean.**

  Implements all items deferred from Phase 7 (Global Privilege Management):

  **Backend:**
  - **`EventType` model** added to `schema.prisma`; `WpType` gained `isActive Boolean @default(true)`. Seeded with 9 canonical event-type values (matching the former hardcoded list).
  - **`backend/src/lib/prisma.ts`** (NEW) — single shared `PrismaClient` + `pg.Pool` singleton (globalThis-cached). Eliminated the per-module `new Pool(…) + new PrismaClient(…)` pattern that existed across **21 files** (all controllers, services, middleware, index.ts). Prevents connection-pool exhaustion.
  - **`user.controller.ts`** extended with 6 new exports: `listUsers` (paginated, searchable, OR privilege gate), `createUser` (default password `Abc@123`, `forcePasswordChange: true`), `updateUser` (soft-delete guard, conflict checks), `deleteUser` (soft-delete, self-deletion blocked), `changePassword` (verifies current, min-6, **clears `activeSessionId`**), `adminResetPassword` (**clears `activeSessionId`**). `USER_SELECT` constant never exposes `passwordHash`. All string inputs validated with `typeof` guards (returns 400, not 500, on non-string name). `divisionId` validated as numeric before DB lookup.
  - **`user.routes.ts`** rewritten: self-service routes (`/me/password`, `/me/preferences`) before parameterised routes; `requireAnyPrivilege` guard on `GET /` (defence in depth alongside controller check).
  - **`rbac.middleware.ts`** gained `requireAnyPrivilege(...keys)` — OR-variant of `requirePrivilege`, used for `GET /users`.
  - **`taxonomy.controller.ts`** extended with `listEventTypes`, `upsertEventType`, `listWpTypes`, `upsertWpType`. All 5 upsert handlers have application-level max-length guards (`MAX_CODE_LEN=64`, `MAX_TEXT_LEN=2000`) via shared `lengthError` helper.
  - **`taxonomy.routes.ts`** extended with `/event-types` and `/wp-types` CRUD routes.
  - **`wp.controller.ts` / `wp.routes.ts`** — removed `getWpTypes` and `createWpType`; those endpoints moved to taxonomy controller.

  **Frontend:**
  - **`frontend/src/app/dashboard/users/page.tsx`** (NEW) — full admin panel: paginated datatable, debounced search, "Show deleted" toggle, `RoleBadge` component, `UserFormModal` (create/edit), `ConfirmModal` (delete/reset). Access: Admin+Director; write: Admin only.
  - **`frontend/src/app/dashboard/settings/page.tsx`** (NEW) — personal profile (read-only) + Change Password form with `forcePasswordChange` banner.
  - **`frontend/src/app/dashboard/settings/taxonomy/page.tsx`** (NEW) — config-driven tabbed UI for all 5 taxonomies (WpType, EventType, ATA Chapter, Cause Code, Hazard Tag). Single `TAXONOMIES` config array + generic `UpsertModal`. Inline Enable/Disable toggle.
  - **`frontend/src/api/userApi.ts`** extended: `AdminUser`, `UserFormData`, `PaginatedUsers` interfaces; `listAdminUsers`, `createAdminUser`, `updateAdminUser`, `deleteAdminUser`, `adminResetUserPassword`, `changeMyPassword`.
  - **`frontend/src/api/taxonomyApi.ts`** extended with `updateAtaChapter`, `updateCauseCode`, `updateHazardTag`, `createEventType`, `updateEventType`, `listEventTypes`, `createWpType`, `updateWpType`.
  - **`frontend/src/types/index.ts`** — added `WpType.isActive`, `EventType` interface.
  - **`RaiseFindingPanel.tsx`** and **`EscalationActionModal.tsx`** — replace hardcoded `FINDING_EVENT_TYPES` with `listEventTypes(true)` API fetch. Fallback to hardcoded constant if API fails. `Other` appended if not in API response.
  - **`Sidebar.tsx`** — Taxonomy nav item (Admin+Director).

  **Security fixes (applied post code-review + security-review on this branch):**
  - H1: `changePassword` + `adminResetPassword` both clear `activeSessionId` (session revocation on credential change).
  - M1: `GET /users` has route-level `requireAnyPrivilege` guard; controller retains its own check as defence in depth.
  - M2: Default password `Abc@123` no longer disclosed in UI toasts or form banners.
  - M3: `createUser`/`updateUser` reject empty or whitespace-only names; validated as `typeof === 'string'` to prevent 500 on non-string input.
  - L1: Max-length guards on all taxonomy upsert string inputs.
  - L2: `divisionId` validated as numeric before division DB lookup.
  - L3: All 21 per-module Prisma instances consolidated into the shared singleton.

- **Phase 7 — Global Privilege Management** (✅ **COMPLETE**, 2026-06-12 — branch `claude/eloquent-gauss-3lonuo`)
  > **381 backend tests passing. Frontend `tsc --noEmit` and `next build` clean. No additional schema change (table was added in Phase 5.0).**

  Migrated all hardcoded RBAC role arrays to a single DB-driven `PrivilegeConfig` matrix. An Admin can now reconfigure who-can-do-what without a code change via `/settings/privileges`.

  **Architecture:**
  - **`backend/src/constants/privileges.ts`** (NEW) — single source of truth: `PRIVILEGE_CATALOG` (28 keys, 8 groups: Tasks, Templates, Work Packages, Findings, Analytics, Users, Escalation, Timebooking, Settings), `DEFAULT_PRIVILEGES` constant per role, `PRIVILEGE_ADMIN_FLOOR` (`settings:privileges` — always on for Admin), `RoleName` type.
  - **`backend/src/utils/privilegeAccess.ts`** (NEW) — `hasPrivilege(actor, key)`: Admin floor → live DB value → `DEFAULT_PRIVILEGES` fallback → `false`. The fallback is the zero-regression guarantee: no test needs to seed `PrivilegeConfig`.
  - **`backend/src/middleware/rbac.middleware.ts`** — added `requirePrivilege(key)` route middleware alongside the retained `authorizeRoles`.
  - **`backend/src/middleware/auth.middleware.ts`** — `findUnique` extended to `include: { role: { privilegeConfig: { select: { permissions: true } } } }`; resolved map attached to `req.user.permissions`. One extra join per request; no N+1.
  - **Route guards replaced:** `task.routes.ts` (`task:reopen`), `template.routes.ts` (7 keys), `wp.routes.ts` (`settings:wptype`, `wp:create`, `wp:assign`), `auth.routes.ts` (`user:create`), `user.routes.ts` (`user:manage_roles`).
  - **Controller / service calls migrated:** `task.controller.ts`, `finding.controller.ts`, `findingAccess.ts` (new `isFindingReviewer` helper), `capa.controller.ts`, `findingLink.controller.ts`, `taxonomy.controller.ts`, `analytics.controller.ts`, `wp.controller.ts`, `timebooking.controller.ts`, `escalation.controller.ts`, `services/escalationService.ts`, `services/feedService.ts`. Relationship grants (issuer exception, WP-assignment bypass), division-scope comparisons, and the `requiresDirectorApproval` Director-only safety gate are **NOT in the matrix** — they stay hardcoded.
  - **`backend/src/controllers/privilege.controller.ts`** (NEW) + **`backend/src/routes/privilege.routes.ts`** (NEW): `GET /api/settings/privileges` → `{ catalog, roles: [{ roleName, permissions }] }` (effective map = DB override ∪ defaults); `PUT /api/settings/privileges` → validates keys, enforces Admin floor, atomic `$transaction` upsert per role, writes `PRIVILEGE_CONFIG_UPDATED` AuditLog with a `{ changedKeys, before, after }` diff for compliance.
  - **`backend/src/seeds/seed-privileges.ts`** (NEW) — idempotent upsert of `DEFAULT_PRIVILEGES` into `PrivilegeConfig`. Invoked from `prisma/seed.ts` after roles are seeded. Uses `update: {}` — never clobbers customised config.
  - **Prisma schema** — added `Role ↔ PrivilegeConfig` relation back-reference (DB no-op; client-only change).

  **Frontend:**
  - `frontend/src/types/index.ts` — added `PrivilegeCatalogItem`, `PrivilegeMap`, `RolePrivileges`, `PrivilegeMatrix`.
  - `frontend/src/api/privilegeApi.ts` (NEW) — `getPrivileges()`, `publishPrivileges(roles)`.
  - `frontend/src/app/dashboard/settings/privileges/page.tsx` (NEW) — toggle matrix (rows = catalog grouped by domain, cols = roles), local draft state, `Publish Changes (n)` button with confirm dialog, Admin × `settings:privileges` cell locked on permanently, `window.location.reload()` on successful publish for cache invalidation.
  - `frontend/src/components/layout/Sidebar.tsx` — Admin-only "Privileges" nav entry with `ShieldCheck` icon.

  **Tests (`backend/src/__tests__/privilege.test.ts`, 11 tests):** GET returns catalog + per-role values; non-Admin → 403; PUT persists changes; payload stripping `settings:privileges` from Admin is floored (not rejected); unknown key or non-boolean → 400; behavioral grant/revoke; fallback with no `PrivilegeConfig` rows; audit diff written. `beforeEach` + `afterAll` wipe `PrivilegeConfig` to prevent cross-suite contamination.

  **Design decisions locked:**
  - `DEFAULT_PRIVILEGES` is the source of truth; `hasPrivilege` falls back to it per key so the existing 370 tests pass without any `PrivilegeConfig` seeds.
  - `settings:privileges` is un-revokable from Admin — the hardcoded floor in `hasPrivilege` and the PUT enforcement together prevent Admin lockout.
  - Director does NOT get the panel by default (Admin-only per product decision).
  - The matrix governs the **role dimension only**. Relationship grants, division-scope comparisons, and `requiresDirectorApproval` stay hardcoded and are explicitly excluded from the catalog.
  - Bootstrap admin: Eve Admin (`VAE99999` / `Abc@123`, role Admin, `prisma/seed.ts:180`).

- **Task / Template / Work-Package Workflow Overhaul** (✅ **COMPLETE**, 2026-06-10 — branch `claude/relaxed-lamport-vf1sim`, NOT yet merged to `main`)
  > **11 sequenced PRs (PR1–PR11). 360 backend tests (359 passing; 1 pre-existing unrelated seed failure — see below).**

  Shipped as independently-green PRs to avoid breaking the suite and to phase the destructive `isOneOff` removal:
  - **PR1 — Additive schema + migration + seed.** New columns: `User.preferences Json?`, `Template.skillLevel`, `Task.skillLevel` + `Task.requiresApproval @default(true)`, `WorkPackage.acRegistration/customer/authority` + `targetDepartmentId` (FK→Department, `onDelete: SetNull`). New Task indexes `[assignedToUserId,status,deletedAt]`, `[issuerId,status,deletedAt]`, `WorkPackage[targetDepartmentId]`. Seeded `SURVEILLANCE` WpType + idempotent **`GENERIC-ADHOC`** Generic Ad-Hoc template (Published, backs Quick Task). Migration `20260610000000_workflow_overhaul_additive`.
  - **PR2 — Removed one-off behaviour (Phase A).** Deleted auto-archive-on-assignment in create/assign/self-assign; replaced `isOneOff` with `skillLevel` across template controller + builder UI. Column retained (dropped in PR11).
  - **PR3 — Per-task approval semantics.** `Task.requiresApproval` seeded from template at creation (overridable); `submitTask` reads the **task** value. Director gate is independent and **never bypassed**: `requiresApproval=false` does not short-circuit a `requiresDirectorApproval=true` task (`requiresApproval = task.requiresApproval || task.requiresDirectorApproval`). Finding follow-up task generation also seeds `requiresApproval`/`skillLevel` from the template (keeps the CAPA close-gate working).
  - **PR4 — Tiered deadline status.** New computed `deadlineStatus` (`Due Soon` ≤72h / `Due Today` / `Overdue` / null) alongside the retained `isOverdue`. `Due Today` takes precedence over `Overdue` for the current calendar day (date-only deadlines are stored at midnight). Frontend Yellow→Orange→Red badges.
  - **PR5 — Filters, last-activity, WP re-link.** `getTasks` accepts `statuses[]`, `issuerId`, `assignedToUserId`, `startDate`, `endDate` (AND-combined with RBAC scope). Batched `lastActivityAt` (most-recent FeedPost per task — single source). `PATCH /tasks/:id/wp` links/clears `wpId` (issuer or elevated role; blocks Closed WP; dual-write). WP detail "Add Existing Task" modal.
  - **PR6 — User preferences.** `PATCH /users/me/preferences` (self-only): key allowlist (`taskColumns`, `taskFilters`), 16KB cap, top-level merge. Login returns `user.preferences`; task list column-selector persists to DB and hydrates from the store.
  - **PR7 — Template unmasking + concurrency.** No more masking Published-with-draft as `Draft`; return true status + `hasPendingChanges` (computed, not stored) + `draftSchema` (owner/Admin/Director only). Optimistic concurrency via echoed `updatedAt` → **409** on update + publish (publish check inside the tx). Publish **deep-diff** (canonical sorted-key compare) aborts a no-op republish with 400. `transferOwnership`: actor = owner or Director/Admin; new owner must be a task-creator role and (unless actor is global) in the template's division.
  - **PR8 — WP type-specific fields + assignee timeframe edits.** `resolveWpTypeFields` persists only type-relevant columns (CHECK→ac/customer/authority; AUDIT→department, validated) and clears the rest. `type` validated against `WpType.code`. Assigned users (via `WorkPackageAssignment`) may edit **only** the timeframe (route `authorizeRoles` removed — controller does full RBAC); blocked on Overdue; dual-write. Conditional form fields + Department picker (`/datasources/departments`).
  - **PR9 — Admin Re-open.** `PATCH /tasks/:id/reopen` (Admin/Director): Closed → Assigned (or Unassigned if no assignee), clears `completedAt`, **leaves TaskData/schemaSnapshot intact**, requires a reason, blocks reopen on a Closed WP, dual-write. Action bar gains the control on Closed tasks.
  - **PR10 — Quick Task.** `POST /tasks/quick` resolves `GENERIC-ADHOC` by slug, defaults `targetDivisionId` to the creator's division, reuses `createTaskService` (normal RBAC — no bypass). `createTaskService` gained an optional `title`. Prominent "Quick Task" button + modal on the task list.
  - **PR11 — Cleanup (consolidated now: pre-launch, no real data).** Dropped `Template.isOneOff` (migration `20260610010000_drop_template_isoneoff`); removed the legacy `Array.isArray(draftSchema)` fallbacks and the obsolete `normalize-draft-schemas.ts` script.

  **Locked product decisions (from the pre-build review):** reopen preserves all task data; approval seeds-from-template; `deadlineStatus` is additive (non-breaking); SSE deferred.
  **Out of scope (next phase):** SSE/live notifications — needs handshake auth, per-user event scoping, connection scaling; must never replace the dual-write.
  **Gotchas surfaced:** the seeded `GENERIC-ADHOC` template's `ownerId` FK pins a seeded user, which breaks suites that `user.deleteMany()` — any suite that seeds it must clean it up in `afterAll` (done in `seed-verification` and the PR10 block). `submitTask` reads approval from the **task**, not the template — all task-creation paths must seed `requiresApproval`/`skillLevel`.
  **Pre-existing failure (NOT introduced here):** `seed-verification.test.ts` expects login `202` (force-password-change) but commit `369d12c` set seed `forcePasswordChange: false` → returns `200`. Failed before this work began; left as-is (a product decision, not a regression).

- **Feed & Escalation System** (Phases 1–5 + post-ship UX — ✅ **COMPLETE**, 2026-06-05) — `FEED_ESCALATION_PLAN.md` is the living source of truth for this feature; OBJECT H documents the schema. Branch `claude/sqd-feed-escalation-plan-4dYZa` (NOT yet merged to `main`). End-user + developer manuals: `FEED_ESCALATION_USER_GUIDE.md` + `FEED_ESCALATION_DEV_GUIDE.md`; manual test checklist: `FEED_ESCALATION_TEST_CHECKLIST.md`.
  - **Phase 1–5** — see previous entries (schema migration, feed API, escalation core, flag lifecycle, badges/polish/docs). 260 backend tests on that branch.
  - **Post-ship UX (branch `claude/eloquent-feynman-G4thG`)** — The Escalations page (`/dashboard/escalations`) now **retains the full escalation history** (PENDING + ACTIONED + DISMISSED), not just the live pending queue:
    - **Backend (`escalation.controller.ts` `getEscalations`):** The `?status=` param was already optional; added `action`, `actionedAt`, and `reviewedBy` to the list response (reviewer name resolved in the existing user name batch — no extra query).
    - **Frontend `src/api/escalationApi.ts`:** New `getEscalations(status?)` call (no status param = full history). `getPendingEscalations()` unchanged — the **Header bell still counts PENDING only**.
    - **Frontend `src/types/index.ts` `PendingEscalation`:** Extended with `action?`, `actionedAt?`, `reviewedBy?`; `status` tightened to `EscalationFlagStatus`.
    - **Frontend `src/utils/feedHelpers.ts`:** Added `ACTION_LABEL: Record<EscalationAction, string>` (past-tense labels for history lines).
    - **Frontend `app/dashboard/escalations/page.tsx`:** Status filter dropdown (All / Pending / Actioned / Dismissed); per-status card styling (amber PENDING, green ACTIONED, slate DISMISSED) with a status badge chip; action-button cluster for PENDING rows; a "Actioned/Dismissed by … · when" summary line for final-state rows; **Pending (n) / History (n)** grouping in the ALL view.
    - **262/262 backend tests** pass (+ 2 new: history fields surfaced, status filter). Lint at baseline 70/23 (zero new). `tsc --noEmit` clean, `next build` exit 0.
  - **Phase 1 (on `main`)** — Migrated `TaskActivity` → unified **`FeedPost`** model (behavior-preserving). The Task feed is now `FeedPost where { scope:'TASK', scopeId: task.id }`; `GET/POST /api/tasks/:id/activity` unchanged. New `services/feedService.ts` → `createFeedPost()` is the single feed-write entry point. Added the `EscalationFlag` model; removed the `TaskActivity` model + `Task.activities`.
  - **Phase 2 (on `main`)** — Generic feed API for all four scopes: `GET /api/feeds/:scope/:scopeId?` + `POST /api/feeds/:scope/:scopeId?/posts` (`feed.controller.ts` + `feed.routes.ts`; two explicit routes per verb — Express 5 rejects `:param?`). RBAC helpers in `feedService.ts` (`buildFeedPostScope`, `canPostToFeed`; Admin = Director-equivalent). WP lifecycle SYSTEM_EVENTs (`logWpSystemEvent` in `wp.controller.ts`). Frontend: generic `FeedPanel` + `FeedPostItem`, Division Board + Org Feed pages, Sidebar nav.
  - **Phase 3** — Escalation core: flag a COMMENT → `EscalationFlag(PENDING)` + cards.
    - `POST /api/feeds/posts/:id/flag {targetScope}` and `GET /api/escalations?status=PENDING` (`escalation.controller.ts` + `escalation.routes.ts`). Flag route registered **before** the generic `/:scope` routes.
    - `services/escalationService.ts` → `placeEscalationCards()` encodes the whole placement matrix as ONE hierarchy rule (`TASK<WP<DIVISION<ORG`: escalation card at target, info card at each strictly-between level). 6 valid origin→target pairs incl. the user-approved `WP→Division`.
    - Cards store a truncated excerpt + denormalised deep-link fields (`sourceTaskId`/`sourceWpId`/`flagId`) — **never** a copy of the source text. Dual-write: `AuditLog('ESCALATION_RAISED')` + a source-feed SYSTEM_EVENT.
    - `GET /api/escalations` returns the viewer's **actionable** queue (Director/Admin all; Manager own-div WP/Div + all Org; Group Leader/Staff none). Everyone still SEES cards on feeds (transparency). All queries soft-delete filtered (Rule 2).
  - **Phase 4** — Flag lifecycle actions: `POST /api/escalations/:id/action {action, payload}`. Six actions — `ACKNOWLEDGE`, `DISMISS`, `RAISE_FINDING`, `CREATE_TASK`, `REASSIGN_TASK`, `DISSEMINATE` — gated by the shared `canActionFlag()` predicate. **Reuse, not re-implement:** the existing `createFinding`/`createTask`/`reassignTask` handlers were each split into an exported `…Service(client, actor, params)` core (running every write on the passed tx client + throwing a typed `HttpError` from `utils/httpError.ts`); the action endpoint opens ONE `$transaction` and calls those cores so the whole action is atomic. `DISSEMINATE` reuses the **same** flag (no second flag). Every action dual-writes `AuditLog('ESCALATION_ACTIONED')` + a target-feed SYSTEM_EVENT. Frontend: card-local `EscalationActionModal`; `getFeed` marks each card with a server-computed `canAction` so cross-division Managers see no buttons.
  - **Phase 5** — Badges, polish, dedup, docs, regression. **#21 dedup guard:** a second PENDING flag for the same `(sourcePostId, targetScope)` → **409**, enforced by an in-tx `findFirst` at `isolationLevel: Serializable` (the concurrent loser's `P2034` is mapped to 409). Re-flagging is allowed once the prior flag leaves PENDING. **#22 bell gating:** the Header bell only polls for `ESCALATION_ACTION_ROLES` (Director/Admin/Manager); badge self-refreshes via a `window 'escalations:changed'` event from the api wrappers (no 60s wait). New dedicated **`/dashboard/escalations`** page (+ Sidebar nav). **#23 + reuse:** extracted `utils/feedHelpers.ts`, `api/templateApi.getPublishedTemplates()`, `components/feed/EscalationActions.tsx`, `constants/escalationRoles.ts`. `FlagButton` tracks per-target flagged state (checkmark + disable; 409 also marks done). `getFeed` enrichment folded 3 sequential round-trips → 1 `Promise.all`.

- **Personnel Analytics Tab — Filter & Sort** (✅ **COMPLETE**, 2026-06-20 — branch `claude/gallant-thompson-y1gn85`, NOT yet merged to `main`)
  > Builds on the existing Personnel Workload/Performance tab (`/dashboard/analytics`, `PersonnelTab.tsx` + `workload.controller.ts`). This session's work: a name filter and full column sort on the personnel table, plus a `/code-review` pass with both findings fixed.
  - **Carryover refinements (same branch, prior session, included here since undocumented):** Hours Logged chart now aligns to the page's From/To filter (falls back to a trailing 12-month window when no range is set); CAPA/RCA metric is hidden from the summary cards but stays wired (kept for future re-exposure); a combined **Overdue/Rejected** performance metric (`overdueRejectedCount = rejectedCount + overdueTaskCount + overdueWpCount`, via `pastDueFilter()` intersecting "past due `now`" with the optional caller date range); the expanded personnel detail row gained **Active Tasks** / **Work Packages Assigned** lists.
  - **This session — Filter:** a "Personnel" name-search `<input>` in the filters bar (client-side, filters the existing `rows` array — no new backend endpoint).
  - **This session — Sort:** every column header in the personnel table is sortable (name, hours, performance metrics). Module-scope `sortValue()` comparator (string `localeCompare`, numeric subtraction with `?? -Infinity` for nullable fields) and a module-scope `SortableTh` component (hoisted out of `PersonnelTab` — a component defined inside another component's render body resets state on every re-render, caught by the `react-hooks/static-components` ESLint rule). `SortableTh` renders a `<button>` wrapping the header label (not a bare `<th onClick>`) so the control is keyboard-focusable/activatable, matching the existing convention in `app/dashboard/tasks/page.tsx`.
  - **Code review (medium effort, this session):** 2 findings, both fixed — (1) `SortableTh`'s original bare-`<th>` `onClick` failed keyboard accessibility, fixed by wrapping the label in a `<button>`; (2) `workload.test.ts`'s "Personnel Detail" describe block relied only on `beforeAll`/`afterAll` cleanup, making exact-match (`toEqual`) assertions order-dependent — fixed by adding a `beforeEach` that clears `timeEntry`/`task`/`workPackageAssignment`/`workPackage` before each test. See `CODE_REVIEW_AUDIT_LOG.md` for the full session entry.
  - **Tests:** 19/19 `workload.test.ts` passing; full backend suite 536/537 (1 pre-existing unrelated `templateSet.test.ts` failure, confirmed not a regression). Frontend `tsc --noEmit` clean; lint shows only the same 2 pre-existing unrelated `react-hooks/set-state-in-effect` errors.
  - **Not verified in-browser:** the backend dev server could not start in this remote container (no `.env`, only `.env.test` — missing `JWT_SECRET`), so the UI was not manually exercised in a live browser this session.

### Test Suite
- **635/635 full backend suite passing (Work Assignment Workflow hardening + follow-up review, 2026-06-28, branch `claude/review-work-assignment-workflow-jrw9md`) — verified locally against a real DB (29 suites).** 621 baseline → +14 hardening tests (11 in `task.test.ts` "Security Review Hardening": SoD review/rate, cross-division create, past-deadline create/set, foreign-div WP link, extension self-decide, title persistence, same-day deadline accepted, null-target link allowed; 3 in `wp.test.ts`: cross-division create blocked/allowed, cross-division assign blocked). 1 existing WP assign test re-worded for the privilege-generic message. Backend `tsc --noEmit` clean on changed files (pre-existing `notification.test.ts` strict-optional warnings only). No schema change.
- **595/595 full backend suite passing (DB Hardening Phases 1–5 + migration squash, 2026-06-23/24, branch `claude/relaxed-lamport-sst3dn`) — verified locally against a real DB.** Frontend `next build` clean (24 routes). ⚠️ Note: the suite runs on a `db push`'d test DB, so it does **not** exercise the 5 DB-level CHECK constraints (gotcha #60, §12.8 item 1) — DB-constraint behavior was verified separately at runtime (Postgres `23514` rejection).
- **582/582 backend tests on branch `claude/nice-darwin-nwyj81` (Quick-View Enrichment + Back-to-Finding, 2026-06-22): all 582 passing.** 572 baseline → 579 after the WS5 feature (`getRelatedFindings`, +7 tests, commit `251ebad`) → 582 after the code-review fix pass (`getFindingSummary`, +3 tests, commit `1ecd3de`). Backend `tsc --noEmit` clean. Frontend `tsc --noEmit` clean, `next build` clean.
- **19/19 `workload.test.ts` tests passing; 536/537 full backend suite (Personnel Analytics Filter/Sort, 2026-06-20, branch `claude/gallant-thompson-y1gn85`).** 1 pre-existing unrelated `templateSet.test.ts` failure (not a regression — confirmed present before this session's changes). Frontend `tsc --noEmit` clean; lint at baseline (no new errors).
- **499 backend tests on branch `claude/determined-shannon-efxjwm` (Generalized Auto-Generate WP, P1–P6, 2026-06-17→2026-06-18): all 499 passing.** 453 baseline → 469 after P1–P3 (`autoGen.test.ts`, new) → +11 in P5 (`templateSet.test.ts`) → +15 in P6 (`wpBlueprint.test.ts`) → 499. Backend `tsc --noEmit` clean. Frontend `tsc`/lint/`next build` clean for all phases. P7 (recurrence automation + Master Calendar) not yet built.
- **TEST_P1 integration (Notification Events Panel + File Upload Infrastructure, 2026-06-16): 453 backend tests** — both feature sets merged. 439 (notification panel) + 13 (file upload, `attachment.test.ts`) over a shared 431 baseline; run `npm test` to confirm the combined count after merge.
- **Configurable Notification Events Panel (branch `claude/zealous-bohr-3g1ch9`, 2026-06-16): 439 backend tests passing.** +9 new tests in `notificationConfig.test.ts` (fail-open, disable, CC managers, actor-exclude, REST guard, audit, validation). Backend `tsc --noEmit` clean for all production files; pre-existing `notification.test.ts` strict-optional warnings are unchanged. Frontend `tsc`/ESLint clean for all new/modified files.
- **444 backend tests on branch `claude/file-upload-infrastructure-28r4m5` (File Upload Infrastructure, 2026-06-16): all 444 passing (19 suites).** +13 new in `attachment.test.ts` (auth, upload + dual-write, type/size/total-quota limits, list, download bytes, soft-delete RBAC, config endpoint). Storage runs against a temp dir (`.env.test` sets `STORAGE_LOCAL_ROOT=/tmp/sqd-test-storage`). Backend `tsc --noEmit` clean (pre-existing `notification.test.ts` strict-optional warnings only). Frontend `tsc`/lint/`next build` clean. Baseline before this work was 431.
- **Settings Hub & UI Restructuring (branch `claude/settings-user-management-3661zs`, 2026-06-15):** No new backend tests (no new status-machine logic). Backend `tsc --noEmit` clean. Prior baseline is 423 tests on `claude/exciting-rubin-hqkxma` — run `npm test` locally to confirm no regressions before merging.
- **423 backend tests on branch `claude/exciting-rubin-hqkxma` (Task Slice Review, 2026-06-14): all 423 passing.** +2 new regression tests (T04c cross-division assignee on create, T54a issuer-transfer role restriction). New `contractSync.test.ts` suite validates frontend/backend literal parity. Frontend `tsc --noEmit` clean for all modified files.
- **Branch `claude/exciting-darwin-gyohuf` (Phase 7 Deferred Items, 2026-06-12): backend `tsc --noEmit` clean; tests could not be executed in the remote build container (no PostgreSQL). Run `npm test` locally against `sqd_qa_test_db` to verify baseline 381 tests still pass before merging.**
- **381 backend tests on branch `claude/eloquent-gauss-3lonuo` (Phase 7 — Global Privilege Management, 2026-06-12): all 381 passing.** +11 new tests in `privilege.test.ts`. `DEFAULT_PRIVILEGES` fallback guarantees all prior 370 tests pass without `PrivilegeConfig` seeds. Frontend `tsc --noEmit` and `next build` clean.
- **370 backend tests on branch `claude/amazing-ritchie-soasus` (Auth Security Hardening, 2026-06): 367 passing + 3 pre-existing unrelated failures** (`seed-verification` login `202` vs `200`; `task` T09 `schemaSnapshot` `fieldId`; `escalation` CREATE_TASK — all predate this branch, none in the auth flow). +18 new auth/session/rate-limit tests. **Frontend `tsc --noEmit` and `next build` are now fully clean (exit 0)** — the two long-standing `ReviewPanel.tsx`/`RichTextEditor.tsx` type errors were fixed (Next 16 build type-checks strictly). No schema change.
- **360 backend tests on branch `claude/relaxed-lamport-vf1sim` (Task/Template/WP Workflow Overhaul, 2026-06-10): 359 passing + 1 pre-existing unrelated failure** (`seed-verification` login `202` vs `200` — seed `forcePasswordChange: false` from commit `369d12c`, predates this branch). Frontend: `tsc --noEmit` clean on all changed files (two pre-existing errors in `ReviewPanel.tsx`/`RichTextEditor.tsx` untouched); lint at baseline (no new errors introduced).
- **322 integration tests passing** on branch `claude/compassionate-gauss-335xa3` (Finding Response Actions, 2026-06-09). **262** on `claude/eloquent-feynman-G4thG` (Feed & Escalation full history page, 2026-06-05). **260** on `claude/sqd-feed-escalation-plan-4dYZa` (Phases 1–5). `main` is at **211** (Feed Phases 1–2). Pre-feed baseline was **187** (Phase 6, 2026-06-01). Frontend lint at baseline **70 errors / 23 warnings (zero new)**; `tsc --noEmit` clean (except legacy `clean.ts`); `next build` exit 0.
- Run via `npm run test` inside `/backend`
- Always runs against `sqd_qa_test_db` — never the dev DB
- Test setup globally disables `ENFORCE_SINGLE_SESSION` to allow test JWTs without `activeSessionId`

---

## 3. ARCHITECTURE & KEY DECISIONS

### 3.1 Draft Encapsulation (`draftSchema`)
**Problem:** Editing a Published template was leaking draft changes to all users (single DB row).

**Solution:** `Template` has a `draftSchema` (JSON) column. When a Published template is saved as draft, the entire draft payload (title, description, formSchema, requiresApproval, allowsFindings) is written to `draftSchema` only.

**Dynamic mapping in `template.controller.ts`:**
- If requester = owner → unpack `draftSchema`, override root fields, return `status: Draft`
- If requester ≠ owner → strip `draftSchema`, return clean Published state

**Rule:** `draftSchema` must be cleared (set to null) after a successful Publish.

### 3.2 Ownership Concurrency Model
- Each Template has one `ownerId`
- Only owner (or Admin/Director) can edit or publish
- Ownership transfers to one person at a time; former owner loses rights immediately
- There is no pessimistic locking — ownership IS the lock

### 3.3 RBAC
Roles in order of privilege: `Director` > `Admin` > `Manager` > `Group Leader` > `Staff`

Admin can reconfigure which roles hold which privileges via the Global Privilege Management panel (see Section 3.4).

**Director-only gate for `requiresDirectorApproval` tasks (added 2026-06-09):** In `task.controller.ts → reviewTask`, before any other review logic, the handler checks `task.requiresDirectorApproval`. If `true` and the reviewer's `role !== 'Director'`, the request is rejected with **403 Forbidden**. This gate applies to all non-Directors — including the Issuer (the normal Issuer exception does **not** apply). Currently only QN response-action tasks set this flag. `requiresDirectorApproval` is **always derived server-side** from `responseActionType ∈ DIRECTOR_APPROVAL_TYPES` — never trusted from the client.

### 3.4 Global Privilege Management

A dedicated Admin-only panel under `/settings/privileges`. Allows granular, system-wide configuration of what each Role can do. Changes require a **confirmation/publish step** before going live — no privilege change takes effect immediately.

**Design principles:**
- All privilege rules are **system-wide** (not per-Division). The org has Director/Deputy Directors overseeing all Divisions and Managers/Deputy Managers per Division
- Every configurable action is listed as a toggleable permission per Role
- The panel stores privilege rules in a `PrivilegeConfig` DB table — the backend reads this table on each request rather than hardcoding role checks
- Default privileges reflect the rules documented in this handover. Admin can tighten or loosen them

**Examples of configurable privileges:**
- Which roles can create Tasks (currently: Team Leader, Manager, Director)
- Which roles can assign Tasks and to whom (currently: Director→anyone, Manager→same Division)
- Which roles can rate Tasks
- Which roles can archive Templates
- Which roles can create/close WPs
- Which roles can manage WpType values

**Implementation note (Phase 7 — COMPLETE):** The `PrivilegeConfig` model is live. `hasPrivilege(actor, key)` in `backend/src/utils/privilegeAccess.ts` is the single authority for all privilege checks. See §3.4a for the resolution order, Admin floor, and separation-of-concerns rules.

### 3.4a PrivilegeConfig Model (Phase 7 — COMPLETE)

The `PrivilegeConfig` model was added to the database schema in Phase 5.0 and fully activated in Phase 7 (2026-06-12).

**What it is:** A database table that stores a JSON permissions map for each Role. The `PrivilegeConfig` table holds Admin-customised overrides; the `DEFAULT_PRIVILEGES` constant in `backend/src/constants/privileges.ts` is the authoritative fallback.

**How it works (live):**
```
PrivilegeConfig {
  roleId: 3           // Manager role
  permissions: {
    "task:create": true,
    "task:assign_div": true,
    "task:assign_any": false,
    "template:archive": true,
    ...
  }
}
```

**Resolution order** (implemented in `backend/src/utils/privilegeAccess.ts → hasPrivilege`):
1. Admin floor: if `actor.role === 'Admin'` and `key ∈ PRIVILEGE_ADMIN_FLOOR` → always `true`
2. Live DB value: `actor.permissions?.[key]` if a boolean is present (loaded from `PrivilegeConfig` via `auth.middleware.ts` per-request join)
3. `DEFAULT_PRIVILEGES[role]?.[key]` — the code constant
4. `false` (fail closed)

**Why the fallback matters:** No test seeds `PrivilegeConfig`. The per-key fallback guarantees all 370 pre-Phase-7 tests pass unchanged.

**Admin floor (`PRIVILEGE_ADMIN_FLOOR = ['settings:privileges']`):** `hasPrivilege` always returns `true` for Admin on these keys regardless of the DB. The PUT endpoint also enforces the floor so even a direct API call cannot strip it. This prevents Admin lockout.

**Separation of concerns — NOT in the matrix (hardcoded):**
- Relationship grants: issuer exception (`task.controller.ts`), WP-assignment bypass (`task.controller.ts`), finding reporter/follow-up assignee/CAPA-linked editor exceptions (`findingAccess.ts`).
- Division-scope comparisons: `assertManagerDivisionScope`, `assignee.divisionId !== divisionId`.
- Safety gate: `requiresDirectorApproval` Director-only check — never configurable.

**Audit:** every PUT writes a `PRIVILEGE_CONFIG_UPDATED` AuditLog with a `{ changedKeys: [{ role, key, from, to }], before, after }` diff payload for compliance.

**Seeding:** `backend/src/seeds/seed-privileges.ts` upserts `DEFAULT_PRIVILEGES` idempotently (invoked from `prisma/seed.ts`). Uses `update: {}` so customised configs are never clobbered.

### 3.7 Soft Delete Pattern

The models `User`, `Task`, `Finding`, and `WorkPackage` now have a `deletedAt DateTime?` field.

**Rules:**
- A record is considered "deleted" when `deletedAt` is set to a timestamp.
- It is **never physically removed** from the database.
- **Every Prisma read query** on these models MUST include `where: { deletedAt: null }` in addition to any other filters. This is enforced across all controllers and the auth middleware.
- Write operations (update, create) are not affected — only reads need the filter.
- `WorkPackage` also uses soft delete for the same reasons.

**Why not physical deletion?** Aviation compliance requires an immutable record of all entities, including those that were deactivated or removed. Soft deletes preserve the audit trail.

**Current filter status (as of Phase 5.0):**

| File | Query | Filter applied |
|---|---|---|
| `auth.controller.ts` | `user.findUnique` (login) | ✅ `deletedAt: null` |
| `auth.controller.ts` | `user.findUnique` (register check) | ✅ `deletedAt: null` |
| `auth.controller.ts` | `user.findUnique` (forgotPassword) | ✅ `deletedAt: null` |
| `auth.controller.ts` | `user.findFirst` (resetPassword) | ✅ `deletedAt: null` |
| `datasource.controller.ts` | `user.findMany` (dropdown) | ✅ `deletedAt: null` |
| `template.controller.ts` | `user.findUnique` (transferOwnership) | ✅ `deletedAt: null` |
| `auth.middleware.ts` | `user.findUnique` (session check) | ✅ `deletedAt: null` |

### 3.5 File Attachments & Storage (✅ IMPLEMENTED — local-disk, NOT MinIO)

> **Decision changed (2026-06-16).** The original plan locked MinIO. The shipped implementation uses a **local-disk driver behind a pluggable `StorageAdapter`** instead. The full rationale + developer reference is in `FILE_UPLOAD_DEV_GUIDE.md`; this section is the summary of record.

**Why local-disk, not MinIO:**
- Downloads are **proxied through the backend** (`GET /api/attachments/:id/download` streams the bytes), so MinIO's headline features — the S3 API and presigned URLs — are never used. Running a separate MinIO daemon (~150–300 MB RAM) buys nothing on the small VPS.
- Storage stays fully **private** (never exposed publicly, no presigned URL that can't be revoked mid-window) — a stronger compliance posture.
- The **adapter interface preserves the original intent**: switching to MinIO / S3 / R2 later is a one-file change (implement `MinioAdapter`, set `STORAGE_DRIVER=minio`), not a rewrite. The §3.5 bucket *names* are kept as logical roots.

**Bucket (logical root) structure — `ENTITY_BUCKET` in `constants/fileUpload.ts`:**
- `sqd-templates` — attachments on Templates
- `sqd-findings` — evidence attachments on Findings
- `sqd-tasks` — attachments on Task execution **and** Work Packages

**File constraints (Admin-configurable — Rule 10).** Stored in `SystemSetting['FILE_UPLOAD_CONFIG']` (JSON), seeded from `DEFAULT_FILE_UPLOAD_CONFIG`:

| Category | Allowed types | Max size |
|---|---|---|
| Documents | PDF, DOCX, XLSX, TXT | 20MB |
| Images | JPG, PNG, WEBP | 10MB |
| Total per entity | — | 50MB |

Each `maxSizeBytes` is clamped to `ABSOLUTE_MAX_UPLOAD_BYTES` (100 MB) — a fixed infra memory/disk-safety ceiling enforced by multer + nginx, **not** the business limit. **DEF-5:** there is no `PUT` endpoint for this config yet — until a settings-panel endpoint is added, "Admin-configurable" means a direct DB upsert.

**Access pattern:** Files never served publicly. All downloads stream through the authenticated backend route (no presigned URLs). **DEF-6:** `list`/`download` are **auth-only** (no per-entity scope), consistent with the app's transparency model (`buildFindingScope → {}`, tasks/WPs viewable system-wide); add a scope check at `attachmentService.assertEntityExists` if visibility is ever tightened. **Delete** is authorized: uploader OR `attachment:delete_any` privilege.

**Implementation status (all ✅):** schema `Attachment` upgrade; `multer` (diskStorage) + local-disk adapter; `File Upload` field type in Template Builder + Task form; Finding evidence section. `minio` SDK is **not** a dependency (added only if/when the MinIO adapter is wired).

### 3.6 Audit Trail vs TaskActivity — Important Distinction

These are two separate systems that serve different purposes. **Both** are written to when significant events occur.

| | `AuditLog` | `TaskActivity` |
|---|---|---|
| **Scope** | System-wide — all entities | Per-Task only |
| **Purpose** | Compliance & regulatory record | Operational communication feed |
| **Audience** | Auditors, Admin, Directors | Task participants (assignee, issuer, managers) |
| **Content** | Every significant action across Templates, Tasks, WPs, Users, Findings | Status changes + human comments on one Task |
| **Mutability** | Immutable — never edited or deleted | Immutable entries — never edited or deleted |
| **Visibility** | Admin/Director audit screen | Inline on Task detail page |

**When an event occurs (e.g. Task inactivated):**
- Write a record to `AuditLog` (compliance trail)
- Write a `SYSTEM_EVENT` entry to `TaskActivity` (so the Task's feed shows it in context)

> **Update (Feed & Escalation, Phase 1):** `TaskActivity` is now the unified **`FeedPost`** model (the Task feed is `scope:'TASK'`). The dual-write rule is unchanged — every significant event still writes BOTH `AuditLog` and a `SYSTEM_EVENT` FeedPost. Escalations additionally dual-write `AuditLog('ESCALATION_RAISED')` + a SYSTEM_EVENT on the source feed. See **OBJECT H**.

---

## 4. OBJECT REFERENCE

---

### OBJECT A: TEMPLATE

**Purpose:** Reusable form schema. Source of all Tasks.

**Human-readable ID format:** `[DivisionCode]-[3-digit seq]` e.g. `QA-001`

**Attributes (current schema + additions needed):**

| Field | Type | Notes |
|---|---|---|
| `templateId` | String | Auto-generated, unique, immutable |
| `title` | String | |
| `description` | String? | |
| `status` | Enum | See below |
| `revision` | Int | Increments on each Publish |
| `requiresApproval` | Boolean | Controls Task close behaviour only — see note |
| `allowsFindings` | Boolean | Whether Tasks from this Template can raise Findings |
| `estimatedHours` | Float? | **ADD NOW** — nullable; future budget baseline for Time Booking |
| `formSchema` | Json | Active published field definitions |
| `draftSchema` | Json? | Pending draft — owner-only visibility |
| `divisionId` | Int | Determines templateId prefix |
| `ownerId` | Int | Only owner (or Admin/Director) can edit/publish |
| `revisedByUserId` | Int? | Last user to revise |
| `publishedAt` | DateTime? | |
| `isOneOff` | Boolean | **ADD** — default `false`. If `true`, Template is auto-deleted after first Task assignment. Task always stores a snapshot of the schema at time of generation — independent of Template existence |
| `type` | String? | **ADD** — nullable. Reserved for future classification of Templates. Admin-configurable values. No behaviour tied to this field yet |
| `revisionArchives` | Relation | Immutable snapshots of all past published schemas |

> **`requiresApproval` clarification:** This flag only affects Tasks generated from the Template. If `true`, Tasks require explicit Issuer/Manager/Director approval before closing. It has NO effect on the Template's own Draft → Publish workflow. Template publishing is always the owner's right.

**Statuses:**

| Status | Meaning |
|---|---|
| `Draft` | Being built by owner. Changes in `draftSchema`. Published state untouched |
| `Published` | Active. Generates Tasks. Previous schema archived in `TemplateRevisionArchive` |
| `Archived` | Retired. Cannot generate new Tasks. Existing Tasks unaffected |

**Status transitions:**
- `Draft` → `Published`: owner, Admin, or Director. `formSchema` must not be empty. Clears `draftSchema`.
- `Published` → edit → saves to `draftSchema` only (does not change status for other users)
- `Published` / `Draft` → `Archived`: owner, Admin, or Director

**No `Pending Approval` status on Templates.** Publishing is always the owner's direct right.

**Supported Form Field Types (Template Builder):**

| Field Type | Description | Notes |
|---|---|---|
| `Text` | Single line free text | e.g. Aircraft registration |
| `Textarea` | Multi-line free text | e.g. Observation notes |
| `Number` | Numeric input | e.g. Torque value |
| `Select` | Dropdown — pick one | Supports Dynamic Data Sources (fetch Divisions, Users, etc.) |
| `Radio` | Pick exactly one from user-defined options | e.g. Pass / Fail / N/A — most common for QA forms |
| `Checkbox Group` | Pick one or more from user-defined options | e.g. Defects observed |
| `Checkbox Single` | One true/false toggle | e.g. Completed? |
| `Date` | Date picker | e.g. Inspection date |
| `File Upload` | Upload documents/images | ✅ **Implemented 2026-06-16.** Renders `FileUploadField` (entityType `TASK`, scoped by `fieldId`). Attachment ids stored in `TaskData`. Local-disk storage — see §3.5 + `FILE_UPLOAD_DEV_GUIDE.md` |
| `Rich Text` | Formatted text with Bold, Italic, Bullet/Numbered lists | Editor powered by Tiptap/StarterKit. Stored as HTML string in `TaskData.data`. Read-only mode uses `editable: false` — no XSS surface. Added 2026-06-08 |

> **Field type history:** The original single "Checkbox" field type has been split into `Checkbox Single` (boolean toggle) and `Checkbox Group` (multi-option picker). `Radio` added for single-choice from visible options. `Rich Text` added 2026-06-08 using Tiptap. `File Upload` implemented 2026-06-16 (local-disk storage, not MinIO — see §3.5).

> **One-off Template behaviour:** When `isOneOff = true`, the Template is automatically hard-deleted from the database immediately after its first Task is assigned (not just created — assigned). The generated Task is unaffected because it stores its own immutable `schemaSnapshot` (JSON) at the moment of Task creation. This snapshot is the source of truth for rendering the Task form, regardless of whether the source Template still exists.

---

### OBJECT B: WORK PACKAGE (WP)

**Purpose:** A named container grouping related Tasks under a defined timeframe and type.

**New model — not yet in schema. Must be added in Phase 5.**

**Human-readable ID format:** `[DivisionCode]-WP-[6-digit seq]` e.g. `QA-WP-000001`

**Attributes:**

| Field | Type | Notes |
|---|---|---|
| `wpId` | String | Auto-generated, unique, immutable |
| `name` | String | |
| `type` | WpType | `CHECK`, `AUDIT`, `INVESTIGATION`, `OTHER` — Admin can add types via DB table (not hardcoded enum) |
| `divisionId` | Int | Division this WP belongs to |
| `timeframeFrom` | DateTime | Start of active period. Adjustable by creator anytime |
| `timeframeTo` | DateTime | End of active period. Adjustable by creator anytime |
| `creatorId` | Int | Creator becomes WP owner automatically |
| `assignedUsers` | Relation | Multiple users can be assigned (see rules below) |
| `checkTemplateId` | Int? | CHECK type only — Template to auto-generate daily Tasks from |
| `status` | WpStatus | Computed + manual (see below) |
| `inactivationLog` | Json? | `{ reason, inactivatedBy, inactivatedAt }` |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**WP Statuses:**

| Status | Trigger |
|---|---|
| `Open` | Current date is before `timeframeFrom` |
| `In Progress` | Current date is within `timeframeFrom` → `timeframeTo` |
| `Overdue` | `timeframeTo` has passed but linked Tasks are not all in a final state |
| `Closed` | Manually closed by creator — only when ALL linked Tasks are `Closed`, `Rejected`, or `Terminated` |
| `Inactive` | Manually set by creator. Reason required. Logged to audit trail. Reactivated by creator or Admin only |

**Assignment rules:**
- Only a **Manager** can assign users to a WP and change (add or remove) those assignments at any time, as long as the WP is not `Closed`
- Multiple users can be assigned to the same WP simultaneously
- A regular user (non-Manager, non-Director) who is assigned to a WP can create Tasks inside that WP and assign them to **any user in the same Division** — not limited to other WP members
- All other rights inside a WP (reviewing, rating, closing) remain with Manager/Director only

**WP Type — CHECK special behaviour:**
- Creator configures one Template ID at WP creation to auto-generate from daily
- Admin can set a system-wide default Template for CHECK type in system settings
- One Task is auto-generated each day from that Template at midnight **only while WP status is `In Progress`** — auto-generation does NOT occur while status is `Open` (before timeframe starts)
- Auto-generated Tasks start as `Unassigned`

**Closing rules:**
- Cannot close WP unless all linked Tasks are in `Closed`, `Rejected`, or `Terminated`
- If timeframe expires with open Tasks, WP is flagged `Overdue` — never force-closed

**Filterable attributes:** `wpId`, `name`, `type`, `division`, `status`, `timeframeFrom`, `timeframeTo`, `creatorId`, `assignedUsers`

---

### OBJECT C: TASK

**Purpose:** An executable unit of work generated from a Published Template, optionally linked to a WP.

**New human-readable ID format:** `[DivisionCode]-[6-digit seq]` e.g. `QA-000001`
(6 digits to accommodate large task volumes)

**Schema additions required (on top of current schema):**

| Field | Type | Notes |
|---|---|---|
| `taskId` | String | **ADD** — human-readable, auto-generated |
| `issuerId` | Int | **ADD** — creator becomes issuer automatically |
| `wpId` | Int? | **ADD** — optional link to Work Package |
| `deadline` | DateTime? | **ADD** |
| `deadlineExtensions` | Json? | **ADD** — array of `{ requestedBy, reason, requestedAt, decision, decidedAt }` |
| `inactivationLog` | Json? | **ADD** — `{ reason, inactivatedBy, inactivatedAt }` |
| `rejectionReason` | String? | **ADD** — formal field, not just AuditLog |
| `rating` | Int? | **ADD** — 1–5; Director rates Manager tasks; Manager rates same-Division user tasks |
| `estimatedHours` | Float? | **ADD** — inherited from Template at Task creation |
| `assignmentType` | String | **ADD** — `INDIVIDUAL` default; `GROUP`/`SCHEDULE` future |
| `schemaSnapshot` | Json | **ADD** — immutable copy of `formSchema` at the moment of Task creation. This is the form definition used to render the Task, independent of the source Template. Required to support One-off Templates and Template edits without breaking in-flight Tasks |

| `issuanceNote` | String? | **ADDED 2026-06-08** — Optional free-text context written by the issuer at creation time. Write-once. Displayed on task detail panel below the Template row. Not logged to AuditLog (static context, not a status event) |
| `responseActionType` | String? | **ADDED 2026-06-09** — one of `CAR \| NCR \| QN \| QR \| IR \| Dissemination`. Populated when the Task is generated as a formal response action from a Finding. Null for standard follow-up tasks |
| `requiresDirectorApproval` | Boolean | **ADDED 2026-06-09** — default `false`. Derived server-side from `responseActionType ∈ DIRECTOR_APPROVAL_TYPES` (currently: `QN` only). When `true`, only `role === 'Director'` may review the task. **Never trusted from the client.** The Issuer exception does NOT apply |

**Keep existing:** `templateId`, `assignedToUserId`, `targetDivisionId`, `parentFindingId`, `taskData`, `sourceFindings`, `createdAt`, `completedAt`, `updatedAt`

**Full Task Statuses:**

| Status | Meaning |
|---|---|
| `Unassigned` | Created, no assignee yet. Visible to eligible users with "PERFORM THIS TASK" button |
| `Assigned` | Assignee set. Work not yet started |
| `In Progress` | Assignee has saved at least one progress entry |
| `Overdue` | Deadline passed with no submission. Task stays open, assignee can still submit |
| `In Review` | Assignee submitted. Awaiting reviewer action |
| `Follow-up Required` | Reviewer requested revision with comment. Assignee must revise and resubmit |
| `Closed` | Approved by reviewer — or auto-closed on submit if `requiresApproval = false` |
| `Rejected` | Reviewer rejected. Reviewer must then choose: Terminate or Reassign |
| `Terminated` | Permanently closed post-rejection. No further action possible |
| `Inactive` | Manually inactivated at any stage. Read-only. Reason required. Audit trail entry created |

**Task creation flow:**
1. Issuer creates Task from a `Published` Template
2. Two options at creation:
   - **Assign immediately** → `Assigned`
   - **Create & assign later** → `Unassigned`
3. Optional: link to a WP at creation, or from inside a WP (auto-linked)

**Self-serve assignment ("PERFORM THIS TASK"):**
- Any eligible user can click this on an `Unassigned` Task
- They immediately become the assignee — no issuer confirmation needed
- Status → `Assigned`

**Rights matrix:**

| Action | Who |
|---|---|
| Create Task | Issuer (Team Leader, Manager, Director — RBAC configurable by Admin) |
| Assign Task (initial) | **Director**: any user system-wide. **Manager**: any user in same Division. **Regular user assigned to a WP**: any user in same Division (inside that WP only) |
| Reassign Task (change assignee at any stage) | Issuer + Director + Managers of same Division — reason required, all `TaskData` preserved |
| Review / Approve / Reject / Follow-up | Issuer + Director + Managers of same Division |
| Transfer issuer rights | Issuer only |
| Inactivate Task | Issuer + Admin |
| Rate Task (1–5) | **Director**: can rate Tasks where assignee is a Manager. **Manager**: can rate Tasks where assignee is a user in same Division. First-come-first-served if both act simultaneously. Rating is revisable but each revision is logged to `TaskActivity` |
| Post-rejection: Terminate or Reassign | Issuer + Director + Managers of same Division |

> **CRITICAL — Reassignment rule:** A Task can be reassigned to a different user by the Issuer, Director, or Manager of same Division at any **non-final** stage. A reason is always required. All `TaskData` already entered by the previous assignee is fully preserved and visible to the new assignee. Reassignment is **blocked** on final states: `Closed`, `Terminated`, `Rejected`. For work that needs redoing after closure, the correct approach is to either create a new Task from the same Template, or raise a Finding on the closed Task which then generates a corrective follow-up Task.

**Approval logic:**
- `requiresApproval = true` → reviewer must explicitly Approve / Reject / Follow-up
- `requiresApproval = false` → Task auto-closes on submission. Reviewer still has an optional grace window to intervene before auto-close triggers (configurable grace period — TBD, implement as a system setting)

**Post-rejection flow:**
- **Terminate** → status `Terminated`. Permanent. No further action
- **Reassign** → new assignee set. All `TaskData` preserved. Status → `Assigned`

**Inactivation (any stage):**
- Issuer or Admin only
- Reason mandatory → written to `inactivationLog` + new `AuditLog` entry
- Task is fully read-only while `Inactive`
- Reactivation by issuer or Admin only

**Deadline extension:**
- Either assignee or issuer can submit a request with a mandatory reason
- Reviewer decides: approve (new deadline set) or deny (original stands)
- Full history stored in `deadlineExtensions` JSON array on the Task

**Issuer rights transfer:**
- Transferable to one person at a time
- Revocable — former issuer loses all rights until transferred back
- This is separate from Task reassignment (assigning a new performer ≠ transferring issuer rights)

**Rating:**
- Score 1–5
- **Director** can rate Tasks where the assignee is a Manager
- **Manager** can rate Tasks where the assignee is a user in the same Division
- Only available once Task is in a final state: `Closed`, `Rejected`, or `Terminated`
- First-come-first-served if Director and Manager both attempt to rate simultaneously
- Rating is revisable after submission; each revision auto-logged as a `SYSTEM_EVENT` in `TaskActivity`

**Visibility:**
- Each user can configure their own dashboard view
- Filterable by: Division, Issuer, Assignee, Status, Rating, Deadline, WP, Template

---

### OBJECT D: TASK ACTIVITY FEED  *(superseded by `FeedPost` — see OBJECT H)*

**Purpose:** Per-Task chronological feed combining system events and human comments. This is the communication layer between reviewer and assignee.

> **⚠️ Migrated to the unified `FeedPost` model (Feed & Escalation, Phase 1).** The Task feed is now `FeedPost where { scope:'TASK', scopeId: task.id }`; the `taskId` column became polymorphic `scope` + `scopeId`. Endpoints `GET/POST /api/tasks/:id/activity` are unchanged. The attribute table below describes the historical `TaskActivity` shape — see **OBJECT H** for the live schema.

**Scope:** Each Task has its own isolated feed. There is no consolidated cross-task thread. A dashboard-level "recent activity" view may query across tasks as a read-only summary, but the source of truth is always per-Task.

**Attributes:**

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `taskId` | Int | Foreign key to Task |
| `authorId` | Int? | Null for `SYSTEM_EVENT` entries |
| `type` | String | `SYSTEM_EVENT` or `COMMENT` |
| `content` | String | Human message or system-generated description |
| `metadata` | Json? | e.g. `{ fromStatus, toStatus, extensionDecision, newDeadline }` |
| `createdAt` | DateTime | Immutable |

**Entries are immutable — never edited or deleted (audit integrity).**

**Auto-logged SYSTEM_EVENT triggers:**
- Task created / assigned / self-assigned ("PERFORM THIS TASK")
- Status transitions (with `fromStatus` → `toStatus` in metadata)
- Deadline set / extension requested / approved / denied
- Task transferred (issuer rights) / reassigned (new performer)
- Task inactivated / reactivated (with reason)
- Post-rejection decision (Terminate or Reassign)
- Rating added

**COMMENT entries written by:**
- Assignee
- Issuer
- Director
- Managers of same Division

**UI rendering pattern:**
```
[Avatar] Manager Tran                          14 May 09:55
         "Section 3 torque values are missing, please revise."

[⚙ System]  Status: In Review → Follow-up Required            14 May 09:55

[Avatar] Nguyen Van A                          14 May 11:30
         "Updated Section 3, resubmitting now."

[⚙ System]  Task resubmitted. Status: Follow-up Req → In Review  14 May 11:31
```

---

### OBJECT E: TIME BOOKING

**Purpose:** Log actual hours spent on a Task after it reaches a final state. Full traceability from individual entries to summary analytics.

**Model:** `TimeBooking` — one-to-one with Task (uniqueness enforced at DB level).
**Sub-model:** `TimeEntry` — append-only individual log entries linked to a `TimeBooking`.

**Available only when Task status is:** `In Review`, `Closed`, `Rejected`, or `Terminated` (Phase 8 extended from the original `Closed`/`Rejected`/`Terminated` only)

#### TimeBooking attributes:

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `taskId` | Int | Unique — one booking per Task |
| `assigneeEntry` | Json | `{ userId, hoursLogged, notes }` — snapshot of assignee's hours |
| `collaborators` | Json | Array of `{ userId, hoursLogged, notes }` |
| `totalHours` | Float | Computed sum of all entries |
| `estimatedHours` | Float? | Snapshot from `Task.estimatedHours` at booking creation time |
| `overBudgetReason` | String? | Required when `totalHours > estimatedHours × 1.2`; enum: `COMPLEX_TASK`, `WAIT_TIME`, `ADDITIONAL_WORK`, `OTHER` |
| `overBudgetNote` | String? | Required when `overBudgetReason = 'OTHER'`; free text |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

#### TimeEntry attributes (append-only audit log):

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `timeBookingId` | Int | FK to `TimeBooking` |
| `taskId` | Int | FK to `Task` — denormalised for query convenience |
| `userId` | Int | User who submitted this entry |
| `hoursLogged` | Float | Hours for this entry |
| `notes` | String? | Optional notes |
| `collaboratorEntries` | Json | JSONB array `[{ userId, hoursLogged, notes }]` — multi-user single submission |
| `createdAt` | DateTime | Immutable — no `updatedAt` (append-only; never mutate) |

**Rules:**
- Only the assignee can create the Time Booking and add collaborators
- Assignee cannot appear in `collaborators` (separate guard in `createTimeEntry`)
- Collaborator `userId` values must exist (DB-verified) and must not be duplicated within one entry
- `estimatedHours` on the booking is a snapshot of `Task.estimatedHours` at creation time — not retroactively updated if the Template changes its estimate later
- **Three-layer booking completeness enforcement:**
  1. **API gate:** `rateTask` returns `400` when the task has no `TimeBooking` record
  2. **UI banner:** Task detail page shows an amber warning on final-state tasks missing a booking
  3. **Analytics:** `incompleteBookings` count in `GET /api/analytics/time-booking` flags the gap
- **Over-budget threshold:** 120% (`totalHours > estimatedHours × 1.2` triggers mandatory reason)
- `overBudgetReason` validation is unconditional — invalid enum values are rejected even when the task is not over budget
- `overBudgetReason = 'OTHER'` requires a non-empty `overBudgetNote`

**Analytics endpoint:** `GET /api/analytics/time-booking` (`analytics.controller.ts`)
- RBAC: Manager sees own division only; Director/Admin see system-wide (optional `?divisionId` filter)
- Optional query params: `templateId`, `divisionId`, `from`, `to` (ISO dates — filter on `completedAt`)
- Returns three aggregates:
  - `templates[]` — per-template efficiency (avg actual hours, canonical `estimatedHours`, efficiency ratio, over-budget count, top reason)
  - `staff[]` — per-staff performance (avg rating, rated task count, avg efficiency ratio)
  - `incompleteBookings` — count of `Closed` tasks with no time booking (division-scoped; **not** filtered by `templateId`)
- `estimatedHours` in the template rows is the **canonical live template value** — not an average of per-booking snapshots (which could be mixed vintage)
- All aggregation is in JavaScript (no `$queryRaw`); DB-level indexes on Task mitigate large result sets

---

### OBJECT F: FINDING

**Purpose:** A rich structured non-conformance record raised against a Task. Findings are reviewed by Manager/Director who decide severity and whether to generate corrective follow-up Tasks. Finding data is designed to support trend analysis and regulatory reporting.

**Two-stage data model:**
- **Stage 1 — At raising time:** Reporter fills required fields immediately
- **Stage 2 — After follow-up Tasks close:** A prompt/hook brings the reporter back to the Finding to fill in analytical fields and formally close it

**Attributes (full schema — additions to current model):**

*Required at raising time (Stage 1):*

| Field | Type | Notes |
|---|---|---|
| `fieldId` | String? | Specific `formSchema` field that triggered the finding |
| `eventType` | String | **REQUIRED at raise** — type of event (e.g. Procedural Breach, Equipment Fault, Documentation Error). Admin-configurable list |
| `departmentId` | Int | **REQUIRED at raise** — department where finding occurred |
| `aircraftRegistration` | String? | **REQUIRED at raise** if applicable — aircraft registration |
| `regulatoryReference` | String? | **REQUIRED at raise** if applicable — e.g. ICAO Annex 6, EASA Part-M |
| `description` | String | Free text description of the finding |
| `severity` | String? | Set by Manager/Director during review: `Observation`, `Level 1`, `Level 2` |

*Filled after follow-up Tasks are closed (Stage 2 — prompted by system):*

| Field | Type | Notes |
|---|---|---|
| `errorCode` | String? | Standardised defect/error code for classification |
| `rootCause` | String? | Root cause analysis narrative |
| `correctiveAction` | String? | Summary of corrective action taken |
| `recurrence` | Boolean? | Is this a repeat finding? |
| `violatorIds` | Json? | Array of personnel IDs from external HR/personnel database. Supports multi-select search across 5000+ records. May include external contractors and suppliers. Displayed as read-only name labels pulled from external DB |

*System fields:*

| Field | Type | Notes |
|---|---|---|
| `status` | Enum | See below |
| `dueDate` | DateTime? | SLA deadline for resolution |
| `sourceTaskId` | Int? | Task the finding was raised on. **NULLABLE** — standalone findings (raised via the Findings page without a task) have `null` here; `targetDivisionId` is required instead |
| `targetDivisionId` | Int | Division used for RBAC scoping. Required on all findings — inferred from the source task's division when `sourceTaskId` is set; explicitly supplied for standalone findings |
| `reportedByUserId` | Int | User who raised the finding |
| `closedByUserId` | Int? | |
| `createdAt` / `closedAt` | DateTime | |

**Standalone finding raise path (added 2026-06-09):** `POST /api/findings` now accepts findings with no `taskId`. When `taskId` is omitted, `targetDivisionId` must be supplied and is verified to exist in the DB. The Findings list page has an amber "Raise Finding" button that opens the panel in this mode. The `RaiseFindingPanel` component renders a division picker when no `taskId` prop is passed.

**`FindingResponseAction` model (added 2026-06-09):** Links a `Finding` to one of its follow-up `Task`s and carries the formal response-action metadata. Created atomically when a follow-up task is generated as a response action (from `POST /api/findings/:id/tasks`).

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `findingId` | Int | FK to `Finding` |
| `type` | String | One of `CAR \| NCR \| QN \| QR \| IR \| Dissemination` |
| `taskId` | Int? | FK to the generated Task (null only in error state) |
| `targetDepartments` | `FindingResponseActionDepartment[]` | Join table rows; all six types require ≥1 dept. Replaced former `targetDepartmentIds Json` column (migrated 2026-06-09). |
| `procedureRef` | String? | Optional reference to a procedure/regulation |
| `note` | String? | Optional free-text note |
| `createdByUserId` | Int | User who triggered generation |
| `deletedAt` | DateTime? | Soft-delete (compliance mandate) |
| `createdAt` / `updatedAt` | DateTime | |

Response action constants live in `backend/src/services/findingExpansion.ts`: `RESPONSE_ACTION_TYPES`, `MULTI_DEPT_SINGLE_TASK_TYPES` (QN, Dissemination — one task for all depts), `DIRECTOR_APPROVAL_TYPES` (QN only — blocks non-Directors from reviewing the task).

**Severity definitions (set by Manager/Director, not the reporter):**

| Severity | Meaning |
|---|---|
| `Observation` | Minor note. No immediate corrective action required |
| `Level 1` | Significant finding. Corrective action required within defined timeframe |
| `Level 2` | Critical finding. Immediate corrective action required |

**Status flow:**

| Status | Meaning |
|---|---|
| `Open` | Raised, awaiting Manager/Director review |
| `In Progress` | Severity set, corrective follow-up Task(s) generated and underway |
| `Pending Verification` | All follow-up Tasks closed. Stage 2 fields not yet completed. System prompts reporter to return and fill in analytical fields |
| `Closed` | Stage 2 fields completed and signed off. Finding fully resolved |

**Who can raise a Finding:** Any user with read access to the Task.

**Who sets severity:** Manager or Director only — during their review of the Finding.

**Finding → Task conversion workflow:**
1. Reporter raises Finding, fills Stage 1 required fields
2. Manager/Director reviews Finding, sets severity
3. Manager/Director decides to generate one or more follow-up Tasks
4. Follow-up Tasks based on pre-defined regular Templates (e.g. "Non-conformity Report", "Corrective Action Request") — managed by Admin/Director
5. Follow-up Tasks are created as **`Unassigned`** — Issuer/Director/Manager assigns them (standard assignment rules)
6. One Finding can generate multiple Tasks (supported but not common)
7. Each generated Task linked to source Finding via `parentFindingId`
8. When all follow-up Tasks reach a final state → Finding status → `Pending Verification` → system prompts reporter to return
9. Reporter completes Stage 2 fields → Manager/Director signs off → Finding → `Closed`

**Future — Findings Dashboard (Phase 6+):**
Dedicated analytics view with charts and filters across severity, eventType, errorCode, department, aircraft, recurrence, time period. Deferred — implement list view first.

---

### OBJECT G: AUDIT LOG

**Current schema is functional. Suggested improvements:**

- Change `entityId Int` → `entityId String` to support future UUID migration and prevent ID-reuse collisions after soft deletes
- Extend `entityType` values to include: `WorkPackage`, `TimeBooking`, `TaskActivity`
- Add soft delete support (`deletedAt DateTime?`) to: `User`, `Task`, `Finding`, `WorkPackage`

---

### OBJECT H: UNIFIED FEED & ESCALATION (`FeedPost`, `EscalationFlag`)

**Added by the Feed & Escalation feature (Phases 1–5 — complete); expanded by the Feed Features workstream (Phases A–H, 2026-06-28 — see §2 and `FEED_IMPROVEMENT_PLAN.md`).** Replaces the former `TaskActivity` (OBJECT D). `FeedPost.scopeId` is **polymorphic — no foreign key**; a feed is located by `(scope, scopeId)`. A 5th scope, `FINDING` (`scopeId = finding.id`), backs the Finding activity feed.

**`FeedPost`**

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `type` | String | `COMMENT` \| `SYSTEM_EVENT` \| `ESCALATION_CARD` \| `INFO_CARD` |
| `scope` | String | `TASK` \| `WP` \| `DIVISION` \| `ORG` \| `FINDING` |
| `scopeId` | Int? | taskId / wpId / divisionId / findingId; **NULL for the singleton ORG feed** |
| `authorId` | Int? | NULL for SYSTEM_EVENT / auto-generated cards |
| `content` | String | Comment body, system text, or generated card headline |
| `metadata` | Json? | Phase E: `{ mentions: int[] }` for @mention ids on a COMMENT |
| `sourcePostId` | Int? | The flagged COMMENT a card references (self-relation) |
| `sourceExcerpt` | String? | Truncated snippet (≤160 + `…`) — **never the full source text** |
| `sourceTaskId` / `sourceWpId` | Int? | Denormalised deep-link (no FK — polymorphic origin) |
| `flagId` | Int? | FK to `EscalationFlag` |
| `taggedDivisionIds` | Json? | Org Feed only (int array) — used by Disseminate (Phase 4) |
| `hiddenAt`/`hiddenByUserId`/`hiddenReason` | DateTime?/Int?/String? | **Phase D** soft-hide (Director/Admin); excluded from every read unless `?includeHidden=true` |
| `pinnedAt`/`pinnedByUserId` | DateTime?/Int? | **Phase D** pin (WP/DIV/ORG COMMENT) |
| `createdAt` | DateTime | Immutable |

**`FeedPostAcknowledgement`** (Phase G) — a user's "I have read this" on a COMMENT. Immutable; idempotent.

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `feedPostId` | Int | FK → FeedPost (cascade) |
| `userId` | Int | |
| `acknowledgedAt` | DateTime | |
| | | `@@unique([feedPostId, userId])` — one per user per post |

**`EscalationFlag`** — one flag tracks an escalation through its whole lifecycle (no flag chains). Immutable; never soft-deleted.

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `sourcePostId` | Int | The original flagged comment |
| `flaggedByUserId` | Int | Any authenticated user may flag |
| `targetScope` | String | `WP` \| `DIVISION` \| `ORG` |
| `status` | String | `PENDING` (default) → `ACTIONED` / `DISMISSED` |
| `reviewedByUserId` | Int? | Set when actioned |
| `action` | String? | ACKNOWLEDGE / DISMISS / RAISE_FINDING / CREATE_TASK / REASSIGN_TASK / DISSEMINATE |
| `actionedAt` | DateTime? | |
| `linkedEntityType` / `linkedEntityId` | String? | Finding / Task created by the action |
| `createdAt` | DateTime | |

**Placement matrix (one hierarchy rule, `TASK<WP<DIVISION<ORG`):** ESCALATION_CARD at the target; INFO_CARD at every level strictly between origin and target. Valid pairs: Task→WP, WP→Division, Task→Division (info@WP), WP→Org (info@Division), Task→Org (info@WP+Division), Division→Org. Anything else (downward/same-level, ORG-comment escalation, non-COMMENT source) → **400**.

**Escalation RBAC (`canActionFlag` in `services/escalationService.ts` — single authority for both the action endpoint and the `getFeed` `canAction` flag):** Director/Admin → any flag; Manager → all ORG flags + own-division WP/DIVISION flags; Group Leader/Staff → none (they still SEE cards via feed transparency). Reading any feed is open to all; posting follows `canPostToFeed` (Task/WP all; Division own-div + Director/Admin any; Org Director/Admin/Manager).

**Dedup guard (#21):** at most ONE PENDING flag per `(sourcePostId, targetScope)`. Enforced by an in-transaction `findFirst` at `isolationLevel: Serializable` → `HttpError(409)`; the concurrent loser aborts with Prisma `P2034`, mapped to the same 409. A full `@@unique` would be wrong (re-flagging is allowed once the prior flag is DISMISSED/ACTIONED), and a *partial* unique index isn't expressible under `prisma db push` — hence the transactional guard.

**Feed capabilities (Phases A–H, 2026-06-28).** All endpoints under `/api/feeds` (+ `/api/tasks/:id/activity` for the Task feed). Per-phase detail in `FEED_IMPROVEMENT_PLAN.md`; the controller/service map is in `FEED_FEATURES_AUDIT.md`.

- **Reads are keyset-paginated (B).** `getFeed` (`GET /feeds/:scope/:scopeId?`) and `getTaskActivity` accept `?limit` (default 30, max 100), `?before=<id>` cursor, `?types=COMMENT,…` filter. **The response body is still a flat array; the next cursor is returned on the `X-Next-Cursor` response header** (exposed via CORS in `index.ts`) — old array-consumers keep working but now see only the newest page. Frontend pages "load earlier" upward; `getFeed`/`getTaskActivity` API helpers return the array, `getFeedPage`/`getTaskActivityPage` return `{posts/activities, nextCursor}`.
- **Moderation (D).** `POST /feeds/posts/:id/hide|unhide` (Director/Admin) — hidden COMMENTs are excluded from **every** read path (`getFeed`, `getTaskActivity`, dashboard feed + ongoing-works, task-list last/recent-activity); Director/Admin pass `?includeHidden=true` to review. `POST /feeds/posts/:id/pin|unpin` (WP/DIV/ORG COMMENT, RBAC = `canPostToFeed`); `GET /feeds/pinned/:scope/:scopeId?` returns the pinned strip. All dual-write AuditLog + SYSTEM_EVENT.
- **@mentions (E).** Picker via `GET /users/mention-search?q=` (auth-only). `postFeedComment`/`postTaskComment` accept `mentionUserIds` (capped at 50), store ids in `metadata.mentions`, and notify via `FEED_MENTION`. Reads resolve `mentions: [{id,name}]`.
- **`#CODE` entity links (E.2).** Reads extract `#<code>` tokens and resolve any matching `Task.taskId`/`WorkPackage.wpId`/`Finding.findingId` into `entityLinks: { code: {type,id} }`. Client `CommentContent` linkifies to the detail route (React elements only — XSS-safe; **`hasOwnProperty` guard** so `#toString`/`#__proto__` don't hit the prototype chain).
- **Attachments (F).** Files attach to a COMMENT via the existing attachment API with `entityType='FEED_POST'`, `entityId=<post.id>` (bucket `sqd-feed`); `assertEntityExists` accepts only COMMENTs. Reads surface `attachments[]`; downloads still stream through `/api/attachments/:id/download`.
- **Acknowledgement (G).** `POST /feeds/posts/:id/ack` — any authenticated user, COMMENT-only, **rejects hidden comments**, idempotent (unique constraint; P2002 → no-op). Dual-write AuditLog + SYSTEM_EVENT on the **first** ack per user only. Reads return `ackCount` + viewer `acknowledged`.
- **Search + digest (H).** `GET /feeds/search?q=&scope=&scopeId=&limit=&before=` — case-insensitive substring over COMMENT bodies, newest-first, keyset, hidden excluded. Opt-in daily digest: preference `feedDigest`, `FEED_DIGEST` notification, `buildFeedDigests` (counts **COMMENT-only** new ORG + own-Division activity), cron 07:00 `APP_TIMEZONE`.
- **Realtime scoping (C).** `createFeedPost` resolves TASK/WP/FINDING watchers at emit time so the `feed` SSE signal targets only them; DIVISION/ORG broadcast.
- **Write guards (A).** Shared `commentLengthError` (`MAX_COMMENT_LEN=5000` in `feedService`) on every comment path; per-user `createMutationRateLimiter` (30/min) on comment/flag/activity writes.

---

## 5. KEY RELATIONSHIPS

```
Template    (1) ──generates──────────────> (many) Tasks
WorkPackage (1) ──groups────────────────> (many) Tasks
WorkPackage (1) ──auto-generates (daily)─> (many) Unassigned Tasks  [CHECK type only]
Task        (1) ──has───────────────────> (1)    TaskData
Task        (1) ──has───────────────────> (1)    TimeBooking         [final state only]
Task        (1) ──has───────────────────> (many) TaskActivity entries
Task        (1) ──has───────────────────> (many) Findings
Finding     (1) ──triggers──────────────> (many) Follow-up Tasks
```

---

## 6. SCHEMA ADDITIONS SUMMARY

All changes needed before Phase 5 development begins:

| Model | Change | Detail |
|---|---|---|
| `Template` | ADD field | `estimatedHours Float?` |
| `Template` | ADD field | `isOneOff Boolean @default(false)` |
| `Template` | ADD field | `type String?` — nullable, reserved for future classification |
| `Task` | ADD field | `taskId String @unique` — `[DivCode]-[6-digit seq]` |
| `Task` | ADD field | `issuerId Int` |
| `Task` | ADD field | `wpId Int?` |
| `Task` | ADD field | `deadline DateTime?` |
| `Task` | ADD field | `deadlineExtensions Json?` |
| `Task` | ADD field | `inactivationLog Json?` |
| `Task` | ADD field | `rejectionReason String?` |
| `Task` | ADD field | `rating Int?` — score 1–5; Director rates Manager tasks; Manager rates same-Division user tasks |
| `Task` | ADD field | `estimatedHours Float?` |
| `Task` | ADD field | `assignmentType String @default("INDIVIDUAL")` |
| `Task` | EXPAND | `status` values to full task-status set (currently 9 — see `constants/taskStatus.ts`) |
| `Finding` | ADD field | `fieldId String?` |
| `Finding` | ADD field | `dueDate DateTime?` |
| `Finding` | ADD field | `closedByUserId Int?` |
| `Finding` | ADD field | `eventType String` — required at raise time |
| `Finding` | ADD field | `aircraftRegistration String?` — required at raise if applicable |
| `Finding` | ADD field | `regulatoryReference String?` — required at raise if applicable |
| `Finding` | ADD field | `errorCode String?` — Stage 2, filled after follow-up Tasks close |
| `Finding` | ADD field | `rootCause String?` — Stage 2 |
| `Finding` | ADD field | `correctiveAction String?` — Stage 2 |
| `Finding` | ADD field | `recurrence Boolean?` — Stage 2 |
| `Finding` | ADD field | `violatorIds Json?` — Stage 2; array of personnel IDs from external DB |
| `Finding` | CHANGE field | `severity` values → `Observation`, `Level 1`, `Level 2` (set by Manager/Director, not reporter) |
| `Finding` | EXPAND | `status` values: Open, In Progress, Pending Verification, Closed |
| **Phase 6 additions** | | |
| `Finding` | ADD field | `departmentId Int` — required FK to Department; separate from `targetDivisionId` (RBAC) |
| `Finding` | CHANGE field | `category String?` — made nullable (was required; raise payload does not include it) |
| `Task` | ADD field | `title String?` — nullable; used for editable follow-up task titles |
| `Task` | ADD field | `issuanceNote String?` — nullable; optional free-text context written at issuance. Added 2026-06-08 |
| `Task` | ADD field | `responseActionType String?` — one of `CAR \| NCR \| QN \| QR \| IR \| Dissemination`. Populated server-side when task is generated as a response action. Added 2026-06-09 |
| `Task` | ADD field | `requiresDirectorApproval Boolean @default(false)` — derived server-side from `responseActionType ∈ DIRECTOR_APPROVAL_TYPES`. When `true`, only Directors may review. Added 2026-06-09 |
| `Finding` | CHANGE field | `sourceTaskId Int` → `sourceTaskId Int?` (nullable) — standalone findings have no source task. Added 2026-06-09 |
| **NEW (2026-06-09)** | CREATE model | `FindingResponseAction` — links a Finding to a response-action follow-up Task; stores `type`, `taskId`, `targetDepartments` (join table), `procedureRef`, `note`, `createdByUserId`, `deletedAt` |
| **NEW (2026-06-09)** | CREATE model | `FindingResponseActionDepartment` — join table `FindingResponseAction ↔ Department`; replaces former `targetDepartmentIds Json` column; `unique(responseActionId, departmentId)` |
| `AuditLog` | CHANGE | `entityId Int` → `entityId String` |
| `User`, `Task`, `Finding` | ADD field | `deletedAt DateTime?` (soft delete) |
| **NEW** | CREATE model | `WorkPackage` |
| **NEW** | CREATE model | `WorkPackageAssignment` (join table: WP ↔ Users) |
| **NEW** | CREATE model | `TaskActivity` |
| **NEW** | CREATE model | `TimeBooking` |
| **NEW** | CREATE model | `WpType` (DB table, Admin-extensible — not hardcoded enum) |
| **NEW** | CREATE model | `PrivilegeConfig` (Phase 7 — stores Admin-configurable role permissions) |
| **NEW** | CREATE model | `Attachment` — `fileName`, `fileType`, `fileSize`, `storageKey`, `entityType`, `entityId`, `uploadedById` |
| **NEW (2026-06-16)** | CREATE model | `NotificationEventConfig` — `eventKey String @id`, `enabled Boolean`, `ccManagers Boolean`, `updatedAt DateTime`, `updatedById Int?`. Admin-configurable per-event notification switches. Not soft-delete protected. Migration `20260616000000_add_notification_event_config`. |
| **NEW (2026-06-17, P1)** | CHANGE | `WorkPackage.checkTemplateId` dropped; replaced by generic `autoGenerate Boolean`, `autoGenMode String?` (`SINGLE_SHOT\|REPEAT`), `autoGenInterval Int?`, `autoGenTemplateId Int?`, `autoGenSetId Int?`, `autoGenInlineSet Json?`, `autoGenFiredAt DateTime?` (idempotency source of truth). Migration backfills existing CHECK WPs onto `REPEAT`/`interval=1` before dropping the column. |
| **NEW (2026-06-17, P1)** | ADD field | `WorkPackage.blueprintId Int?` (FK → `WpBlueprint`, `ON DELETE SET NULL`) + `isRoutine Boolean @default(false)` — both reserved; populated starting P6/P7 only. |
| **NEW (2026-06-17, P1)** | CREATE model | `TemplateSet` + `TemplateSetItem` — reusable ordered template list (`isActive` soft-disable; items carry `orderIndex`, `deadlineOffsetDays`, `estimatedHours`, `skillLevel`, `requiresApproval`, `defaultNote`). CRUD shipped in P5. |
| **NEW (2026-06-17, P1)** | CREATE model | `WpBlueprint` — reusable WP template (`isActive` soft-disable; `defaultDuration`, `defaultAutoGen*` columns mirroring `WorkPackage.autoGen*`, type-context defaults, `recurrenceType String?`/`recurrenceInterval Int?` reserved for P7). CRUD + manual launch shipped in P6; P6 always persists `recurrenceType`/`recurrenceInterval` as `null`. |

---

## 7. PRIORITISED PHASES

### Phase 4.3 — Template Builder Frontend (COMPLETED)
- [x] Visual Form Builder UI (`/dashboard/templates/new` + `/dashboard/templates/[id]/edit`)
  - Field types: Text, Textarea, Number, Select, Radio, Checkbox Group, Checkbox Single, Date
  - `Select` fields support Dynamic Data Sources (e.g. fetch Divisions, Users)
  - `Radio` — user defines options, assignee picks exactly one (e.g. Pass / Fail / N/A)
  - `Checkbox Group` — user defines options, assignee picks one or more
  - `Checkbox Single` — single boolean toggle
  - File Upload field type: **DEFERRED to Phase 5.4** (MinIO required first)
  - Header fields: title, description, division, type (nullable), estimatedHours, requiresApproval, allowsFindings, isOneOff
  - Save as Draft vs Publish actions
  - beforeunload guardian for unsaved changes
- [x] Template List page (`/dashboard/templates`)
  - Status filter pills: All | Draft | Published | Archived
- [x] Template Detail / View page (`/dashboard/templates/[id]`)
  - Read-only for non-owners · owner sees draft state with Resume Editing button
- [x] Revision History slide-over panel
- [x] Transfer Ownership action
- [x] Archive action (owner / Admin / Director)

### Phase 5 — Task Management & Work Packages (NEXT)

#### Phase 5.0 — Schema Migration + Infrastructure (prerequisite)
- [ ] Apply all schema additions from Section 6 above
- [ ] Run `npx prisma db push` on both dev and test DBs
- [ ] Update `frontend/src/types/index.ts` with `Task`, `WorkPackage`, `TaskActivity`, `TimeBooking`, `Attachment` interfaces
- [ ] Install and configure MinIO on VPS
  - Create buckets: `sqd-templates`, `sqd-findings`, `sqd-tasks`
  - Set bucket policies (private — presigned URLs only)
- [ ] Install backend dependencies: `minio` SDK, `multer`, `multer-minio-storage`
- [ ] Build reusable upload middleware: enforce MIME types, file size limits (configurable)
- [ ] Build `GET /api/attachments/:id/url` — generate presigned download URL

#### Phase 5.1 — Work Package Backend (COMPLETED 2026-05-23)
- [x] `wp.routes.ts` + `wp.controller.ts`
- [x] CRUD for WorkPackage
- [x] `WpType` management endpoints (Admin only)
- [x] WP user assignment endpoints (Manager / Director, cross-division rules enforced)
- [x] WP status computed logic (Open / In Progress / Overdue / Closed / Inactive) — on-the-fly, no DB writes
- [x] CHECK type on-demand Task auto-generation via `backend/src/services/wpCheckService.ts`
- [x] Audit fix: `template.controller.ts` task.count missing `deletedAt: null`
- [x] Audit fix: `user.controller.ts` updateUserRole missing soft-delete guard

#### Phase 5.2 — Task Backend
- [x] `task.routes.ts` + `task.controller.ts`
- [x] Full CRUD for Task
- [x] `GET /api/tasks/my-tasks` — tasks where user is assignee or issuer
- [x] `GET /api/tasks/unassigned` — open pool for "PERFORM THIS TASK"
- [x] `PUT /api/tasks/:id/assign` — assign to user (with self-serve support)
- [x] `PUT /api/tasks/:id/data` — save TaskData progress
- [x] `PUT /api/tasks/:id/submit` — assignee submits
- [x] `PUT /api/tasks/:id/review` — reviewer action (Approve / Reject / Follow-up)
- [x] `PUT /api/tasks/:id/post-rejection` — Terminate or Reassign
- [x] `PUT /api/tasks/:id/inactive` — inactivate with reason
- [x] `PUT /api/tasks/:id/reactivate`
- [x] `PUT /api/tasks/:id/deadline` — set or extend deadline
- [x] `PUT /api/tasks/:id/transfer-issuer` — transfer issuer rights
- [x] `PUT /api/tasks/:id/rate` — rate Task (1–5); enforce Director→Manager and Manager→same-Division rules; log revisions to TaskActivity
- [x] Auto-log SYSTEM_EVENT to `TaskActivity` on every state change
- [x] RBAC enforcement: review rights = Issuer + Director + Managers of same Division

#### Phase 5.3 — TaskActivity Backend
- [x] `GET /api/tasks/:id/activity` — full chronological feed
- [x] `POST /api/tasks/:id/activity` — post a COMMENT

#### Phase 5.4 — Task Frontend
- [x] `/dashboard/tasks` — list view, tabs: Unassigned | Assigned | In Progress | In Review | Closed | All
- [x] Status filter pills (all 10 statuses)
- [x] `/dashboard/tasks/[id]` — Task execution view
  - Dynamic form rendering from `formSchema`
  - TaskActivity feed panel (right side or bottom)
  - Action buttons contextual to current status and user role
  - Deadline display + extension request UI
  - "PERFORM THIS TASK" button for `Unassigned` tasks
  - Inactivate / Reactivate controls
  - Rating UI (final state only; visible to Director for Manager assignees, Manager for same-Division assignees)


#### Phase 5.6 — Time Booking (COMPLETED 2026-05-31)
- [x] `TimeBooking` backend endpoints (`POST` + `PUT /api/tasks/:id/time-booking`)
- [x] Time Booking UI on Task detail page (available at final state only)
- [x] Collaborator addition (assignee only); budget-vs-actual comparison display

### Phase 6 — Findings System (COMPLETED 2026-06-01)
- [x] `finding.routes.ts` + `finding.controller.ts` (7 endpoints)
- [x] Stage 1 create endpoint — `POST /api/findings` (enforces eventType, departmentId, description; template `allowsFindings` gate; non-final task gate)
- [x] Manager/Director review endpoint — `PUT /api/findings/:id/review` (sets severity + dueDate; Open → In Progress)
- [x] Follow-up Task generation — `POST /api/findings/:id/tasks` (multi-row, atomically validated; tasks created as **Unassigned** — NOT auto-assigned to raiser)
- [x] `parentFindingId` linkage on generated Tasks
- [x] Stage 2 hook (`findingService.checkAndTriggerPendingVerification`) — fires from task.controller after Closed/Rejected/Terminated; best-effort, never rethrows
- [x] Stage 2 update endpoint — `PUT /api/findings/:id/stage2` (rootCause, correctiveAction, errorCode, recurrence, category)
- [x] Finding close endpoint — `PUT /api/findings/:id/close` (Manager/Director from Pending Verification)
- [x] `/dashboard/findings` — list page with severity + status filters, RBAC-scoped, paginated
- [x] `/dashboard/findings/[id]` — detail page (all 6 sections: metadata, review, follow-up tasks, stage 2, close, activity feed)
- [x] Raise Finding slide-over from Task detail page (gated on `allowsFindings` + non-final status)
- [x] Linked Findings section on Task detail page
- [x] Sidebar Findings nav item (all roles) with amber Open+In-Progress badge
- [x] `finding.test.ts` — 37 tests, 8 groups; 187 / 187 total passing
- [ ] `violatorIds` search integration — deferred (external personnel DB, 5000+ records, Phase 7+)
- [ ] Findings analytics dashboard with charts/filters — deferred (Phase 7+)

### Time Booking Enhancement (COMPLETED 2026-06-08)

Extends Phase 5.6 Time Booking with deeper audit trail, mandatory enforcement, over-budget tracking, per-entry history, and management analytics.

- [x] **`TimeEntry` model** — append-only per-entry audit log; `collaboratorEntries` JSONB; no `updatedAt` (immutable after creation)
- [x] **`overBudgetReason` / `overBudgetNote` fields** on `TimeBooking` — required when `totalHours > estimatedHours × 1.2`; enum-validated unconditionally
- [x] **`createTimeEntry` hardening** (`timebooking.controller.ts`): duplicate `userId` guard in `collaboratorEntries`, DB existence check for all collaborator IDs, unconditional `overBudgetReason` enum validation
- [x] **Efficiency ratio display** in `TaskActionBar.tsx` — actual vs estimated hours + over/under badge shown above the star-rating widget on final-state tasks
- [x] **Analytics backend** (`GET /api/analytics/time-booking`) — Manager/Director/Admin RBAC, templateId/divisionId/date filters; single-pass JS aggregation for template efficiency + staff performance; separate `incompleteBookings` count (not filtered by templateId); canonical template `estimatedHours` (not averaged snapshots); DB indexes added to Task model
- [x] **Analytics frontend** (`/dashboard/analytics`) — Template Efficiency table, Staff Performance table, incomplete-bookings amber banner; Manager/Director/Admin sidebar nav item
- [x] **DB indexes** on `Task`: `[status, deletedAt]`, `[targetDivisionId, status, deletedAt]`, `[templateId, status, deletedAt]`, `[completedAt]`

### Phase 8 — Time-Booking Workflow Refinements (COMPLETED 2026-06-10)

Branch `claude/vigilant-mendel-3sajt0` (PR #15). No new tests — changes are purely behavioural/UI. Post-ship `/code-review` was run and all findings addressed in the same branch.

**Two workflow adjustments:**

- **Allow final booking during `In Review`** — `TIME_BOOKING_ELIGIBLE_STATUSES` in `timebooking.controller.ts` (formerly a name-colliding local `FINAL_TASK_STATUSES`; renamed during a post-overhaul `/code-review` cleanup) includes `'In Review'`. This single constant gates both endpoints: `createTimeBooking` (POST) accepts `In Review` status; `createTimeEntry` (POST) blocks new session entries for the same status (correct — you cannot log new work once a task is submitted for review).
- **Keep Work Log visible after close** — `TimeEntryPanel` is now rendered for all post-assignment statuses (`task.status !== 'Unassigned' && task.status !== 'Inactive'`), so the history list persists on `Closed`/`Rejected`/`Terminated` tasks for traceability. The create form inside `TimeEntryPanel` is gated separately via a `LOGGABLE_STATUSES` constant (`Assigned` / `In Progress` / `Follow-up Required`) — final-state and `In Review` tasks show the history read-only only.

**Frontend additions:**
- `TimeBookingPanel` wrapped in `<div id="time-booking-section">` for in-page anchor navigation.
- Amber banner on `In Review` tasks without a booking: *"Submit it now so your manager can rate the task once it is approved."* (Accurate: rating happens after `Closed`, not during `In Review` — the rating gate lives in `task.controller.ts` which uses the shared `FINAL_TASK_STATUSES` constant (`constants/taskStatus.ts`) that does not include `In Review`.)
- Pre-submit reminder link added below the Save/Submit button group in `TaskActionBar.tsx` (`isEditable && isAssignee` block): *"After submitting, Please perform final time booking!"*

**Code-review fixes (same branch, post-ship):**
- `TimeEntryPanel.tsx`: `LOGGABLE_STATUSES` constant added; form gated with `isAssignee && canLogEntries` to prevent an interactive form rendering on tasks where the backend would hard-reject the POST with 400.
- `page.tsx` In Review banner copy corrected (see above — removed misleading "your manager needs this before rating").
- `timebooking.controller.ts` 400 error message updated to list "In Review, Closed, Rejected, or Terminated" (was stale after adding `In Review` to `TIME_BOOKING_ELIGIBLE_STATUSES`).

### Phase 7 — Global Privilege Management (✅ COMPLETE 2026-06-12)

- [x] **Global Privilege Management panel** (`/settings/privileges` — Admin only) — see §3.4a and the Phase 7 entry in §2 for full detail
- [x] `/dashboard/users` — Admin+Director: paginated user list, create, edit, soft-delete, password reset (branch `claude/exciting-darwin-gyohuf`)
- [x] `/dashboard/settings` — personal profile display + change-password form with `forcePasswordChange` banner (branch `claude/exciting-darwin-gyohuf`)
- [x] Admin: manage `WpType` values — moved to unified Taxonomy page (branch `claude/exciting-darwin-gyohuf`)
- [x] Admin: manage `EventType` values for Findings — DB-driven `EventType` table, seeded with 9 values; `RaiseFindingPanel` + `EscalationActionModal` now fetch from API with hardcoded-list fallback (branch `claude/exciting-darwin-gyohuf`)

### Generalized Auto-Generate Work Packages (P1–P6 ✅ COMPLETE; P7 NOT STARTED) — branch `claude/determined-shannon-efxjwm`

- [x] **P1** — Schema: generic `WorkPackage.autoGen*` columns replacing `checkTemplateId`; `TemplateSet`/`TemplateSetItem`/`WpBlueprint` models; non-destructive backfill migration.
- [x] **P2** — `autoGenService.ts` (replaces `wpCheckService.ts`): race-safe `fireAutoGenForWp`, `validateAutoGenConfig` single source of truth, SINGLE_SHOT skip-and-warn.
- [x] **P3** — Nightly `runAutoGenCron` at `00:05` `APP_TIMEZONE`.
- [x] **P1–P3 code review** — 9 findings fixed (see `CODE_REVIEW_AUDIT_LOG.md`, 2026-06-18 session).
- [x] **P4** — WP form/detail UI surfaces autogen config (single-template source).
- [x] **P5** — `TemplateSet` CRUD API + `/dashboard/template-sets` UI; WP form gains saved-set autogen source.
- [x] **P6** — `WpBlueprint` CRUD API + manual **Launch** dialog (`/dashboard/wp-blueprints`); `createWorkPackageService` extracted from `wp.controller.ts` and reused by the launch endpoint.
- [ ] **P7 (planned, not yet built)** — Recurrence automation: `WpBlueprint.recurrenceType` (`CALENDAR`/`LAST_DONE`) + `recurrenceInterval` drive a scheduler that auto-launches WPs (`isRoutine: true`); Master Calendar UI showing scheduled/past blueprint-driven WP instances.
- [ ] **Post-P7:** a single `/code-review` + `/security-review` pass covering P4–P7 together (user has explicitly deferred review until the whole workstream is done — see gotcha #42).

---

## 8. KNOWN BUGS & GOTCHAS

1. **Test DB**: Always run tests against `sqd_qa_test_db`. Load `.env.test`. Tables wiped in `beforeEach` via `test/setup.ts`. Never run against dev DB.
2. **Hydration mismatch**: Minor React warning on `/login` from browser extensions. Non-critical.
3. **No `/revisions` route**: `GET /api/templates/:id` returns nested `revisionArchives`. Do not create a separate `/revisions` endpoint — use nested data.
4. **Checkbox icon bug**: In Template Builder preview, checkmark icon sometimes fails to render on toggle. Known visual glitch, not yet fixed.
5. ~~**`AuditLog.entityId` is `Int`**~~ — **RESOLVED in Phase 5.0**: successfully migrated to `String` via `prisma db push`. No further action needed.
6. **Prisma generation**: Always run `npx prisma generate` in `/backend` after schema changes.
7. **Port conflict**: Backend must stay on `:5000`. Frontend on `:3000`.
8. **CORS**: `app.use(cors())` allows all origins — local dev only. Restrict before any deployment.
9. **`draftSchema` leak risk**: When publishing, the controller MUST set `draftSchema: null`. If this is missed, the draft will persist and be exposed to the owner on next load as if unpublished changes exist.
10. **Finding follow-up tasks are Unassigned**: The original spec in OBJECT F said "Finding raiser automatically becomes the Task assignee." The actual implementation creates follow-up tasks as `Unassigned`. An Issuer/Manager/Director must manually assign them. Do not change this without a deliberate decision.
11. **`checkAndTriggerPendingVerification` is best-effort**: The hook in `findingService.ts` is wrapped in try/catch and never rethrows. If it fails silently, a finding will remain `In Progress` even after all follow-up tasks close. This is intentional — the hook must never break the task action that triggered it.
12. **`Finding.category` is nullable**: The original Phase 5 schema had `category` as required, but the Phase 6 raise endpoint does not include it (it belongs to Stage 2 analysis). It was made nullable in Phase 6 to avoid NOT NULL violations on raise. Set it via `PUT /api/findings/:id/stage2`.
13. **`Finding.departmentId` vs `targetDivisionId`**: Two separate fields. `departmentId` is the department where the finding occurred (operational, required at raise). `targetDivisionId` is the division used for RBAC scoping. Do not conflate them.
14. **`seed-verification.test.ts` platform fix**: This test spawns `ts-node` as a child process. It now uses `process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node'`. If tests fail on Windows with "ts-node not found", confirm the `.cmd` variant is on PATH.
15. **Post-rejection Reassign vs General Reassign use different endpoints**: When a task is `Rejected`, the "Reassign" action must go through `POST /api/tasks/:id/post-rejection` with `action: 'reassign'` — NOT through `PUT /api/tasks/:id/reassign` (which blocks Rejected status). For all other non-final states, use `PUT /api/tasks/:id/reassign`. `TaskActionBar` has two separate handlers: `handlePostRejectReassign` and `handleGeneralReassign`.
16. **`decideDeadlineExtension` requires `extensionIndex`**: The backend requires the index of the pending extension within the `deadlineExtensions` JSON array. The frontend uses `getPendingExtensionIndex()` to find the first entry where `decision` is null/undefined. If an extension was already decided, it won't be found and the call is blocked client-side.
17. **`task.assignedToUser.role` is a flat string**: The user object returned in task responses has `role` as a plain string (e.g. `'Manager'`), not a nested Role object. Do not access `.role.name` — it will always be `undefined`.
18. **Event Type in Findings is now API-driven**: `RaiseFindingPanel` and `EscalationActionModal` fetch `GET /api/taxonomy/event-types?activeOnly=true` on mount. The hardcoded `FINDING_EVENT_TYPES` constant is kept as a fallback — if the API call fails the list stays populated from the constant. Admins manage event types via `/dashboard/settings/taxonomy`. The "Other" option (always appended if not in the API response) still writes a free-text value to `Finding.eventType`.

19. **`issuanceNote` is write-once by convention, not by enforcement:** The backend does not block updates to `issuanceNote` after creation — the write-once rule is enforced by the UI only (no edit control is exposed). If a future endpoint or admin tool allows Task updates, explicitly exclude `issuanceNote` from the updatable fields to preserve this intent.

20. **`datasource/users` now returns `divisionId`:** The `/datasources/users` endpoint was updated to include `divisionId` in each user entry. Any other page that calls `getUsers()` and relies on the shape `{ value, label }` is unaffected (extra field is additive). However, if a future call passes the result directly to a typed interface that rejects unknown keys, update the type. Current `getUsers()` return type in `taskApi.ts` is `{ value: string; label: string; divisionId: number | null }[]`.

21. **`SearchableSelect` has no keyboard navigation:** The current implementation (mouse/touch only) is sufficient for desktop internal tooling, but fails WCAG keyboard-only requirements. If the app is ever audited for accessibility, replace with a library that provides `aria-activedescendant` and arrow-key support (e.g. Headless UI Combobox or Radix Combobox).

22. **Rich Text stored as raw HTML:** `TaskData.data` for a `rich_text` field contains an HTML string (e.g. `<p><strong>bold</strong></p>`). Tiptap's StarterKit constrains what nodes can be produced (no `<script>`, no event handlers), so the stored HTML is safe — but only if it was written by the Tiptap editor. If data is ever imported, seeded, or written directly (migrations, scripts, CSV import), sanitise with DOMPurify or a server-side HTML sanitiser before storing, and again before rendering outside of Tiptap's `EditorContent`. Do not use `dangerouslySetInnerHTML` to display rich text values — always use `RichTextEditor` in `disabled` mode.

23. **Rich Text in read-only renders a Tiptap editor instance:** The disabled `RichTextEditor` still mounts a full Tiptap editor (with `editable: false`). For pages that show many task fields at once (e.g. a task list with inline previews), this could mount dozens of editor instances. If performance becomes an issue, replace the read-only path with a simple `dangerouslySetInnerHTML` guarded by DOMPurify (install `dompurify` + `@types/dompurify`).

24. **`npx prisma db push` required for `issuanceNote`:** The `issuanceNote String?` column was added to `schema.prisma` and the Prisma client was regenerated, but `db push` could not run in the CI environment (no DB server). Run `cd backend && npx prisma db push` against both `sqd_qa_db` and `sqd_qa_test_db` on first deployment of branch `claude/sleepy-bell-MTJwM`. The migration is non-destructive (nullable column, no default required).

25. **`npx prisma db push` required for Time Booking Enhancement:** Four `@@index` decorators were added to the `Task` model plus `overBudgetReason`/`overBudgetNote` columns on `TimeBooking`. Run `cd backend && npx prisma db push` against both `sqd_qa_db` and `sqd_qa_test_db` on first deployment of branch `claude/trusting-knuth-oshBn`. Migration is non-destructive (nullable columns; additive indexes).

26. **`incompleteBookings` must use a separate query, not a filter on the main result set:** In `analytics.controller.ts`, the incomplete-bookings count is computed via `prisma.task.count()` *before* the `templateId` filter is applied. If you ever merge them into one query, the count will be silently wrong when a `?templateId` param is supplied — it will count only tasks for that template rather than the full division.

27. **`estimatedHours` in analytics is the canonical template value, not an average of booking snapshots:** `TimeBookingAnalytics.templates[n].estimatedHours` comes from `t.template.estimatedHours` (the live `Template` record). Using the average of `TimeBooking.estimatedHours` snapshots would silently mix vintages (some tasks booked against an old estimate, others against a new one). If a template's estimate is updated, historical efficiency ratios in the analytics page will shift to reflect the new baseline — that is intentional.

28. **Manager RBAC for analytics is enforced in the DB `WHERE` clause, not post-fetch JS:** `getTimeBookingAnalytics` sets `targetDivisionId` in the Prisma `where` object before the query runs. Never add a post-fetch JS filter instead — it will silently expose data if the DB result is ever paginated or partially loaded.

29. **`TimeEntry` has no `updatedAt` and must never be mutated:** The model is intentionally append-only (immutable audit trail). Adding `updatedAt` or writing an update endpoint would break the compliance intent. If a time entry contains an error, a corrective entry should be added and the discrepancy noted in `notes`.

30. **`Template.type` is repurposed for response-action template categorisation (2026-06-09):** The `type String?` field on `Template` was originally noted as "reserved for future classification." It is now actively used to associate templates with response action types: Admin sets `type = 'CAR'`, `type = 'NCR'`, etc. `GenerateFollowUpModal` filters the template dropdown to `t.type === responseActionType` when a type is selected. Untyped templates (`type = null`) appear in the list only when no response action type is selected.

31. **`requiresDirectorApproval` is always server-derived — never trust the client:** The flag is set by `generateFollowUpTasks` based on `responseActionType ∈ DIRECTOR_APPROVAL_TYPES`. The client-side `Task` interface includes it for display purposes only (purple banner in `TaskDetailPanel`, text label in finding follow-up list). If a client somehow sends `requiresDirectorApproval: false` in a request body, the server ignores it and re-derives from `responseActionType`.

32. **Per-department QN task tracking deferred to Change Management phase:** QN (Quality Notice) tasks currently set `requiresDirectorApproval = true` and record all target departments in `FindingResponseAction.targetDepartmentIds`. Per-department completion tracking (one task per dept, tracked individually) is deferred to the Change Management phase. The current implementation creates a single task regardless of how many departments are selected for QN/Dissemination types.

33. **`FINAL_TASK_STATUSES` is now a single shared constant — but the time-booking eligibility set is deliberately DIFFERENT and separately named:** (Updated by a post-overhaul `/code-review` cleanup.) The authoritative final-state set `['Closed', 'Rejected', 'Terminated']` now lives in `backend/src/constants/taskStatus.ts` and is imported by `task.controller.ts`, `analytics.controller.ts`, `wp.controller.ts`, `finding.controller.ts`, and `findingService.ts` (which re-exports it for back-compat). The previously-duplicated module-local copies were removed. **The rating gate, WP status, and finding hooks still exclude `'In Review'`** — that invariant is unchanged. Time booking needs a BROADER set that also allows `'In Review'`; it is now a distinctly-named `TIME_BOOKING_ELIGIBLE_STATUSES` in `timebooking.controller.ts` (NOT a same-named copy), so the two sets can never be confused. Do NOT add `'In Review'` to the shared `FINAL_TASK_STATUSES`, and do NOT point `timebooking` at it. `TimeEntryPanel.tsx` has a separate frontend `LOGGABLE_STATUSES = ['Assigned', 'In Progress', 'Follow-up Required']` that gates the entry create form; it is also intentionally separate.

34. **Rating is still blocked for `In Review` tasks despite booking being allowed there:** The rating gate in `task.controller.ts` (`rateTask`) uses the shared `FINAL_TASK_STATUSES` (`constants/taskStatus.ts`) which does NOT include `'In Review'`. A manager attempting to rate an `In Review` task will get *"Task must be in a final state to be rated."* This is correct by design — the booking is created during `In Review` as preparation so it is ready the moment the task is approved/closed. The In Review banner copy reflects this: *"Submit it now so your manager can rate the task once it is approved."*

35. **`changePassword` and `adminResetPassword` revoke the user's active session**: Both endpoints now set `activeSessionId: null`. A user who changes their own password via `/settings` will be signed out of their current session and must re-authenticate. This is intentional and the correct secure behaviour, but any frontend flow that calls `changeMyPassword` should redirect to `/login` (or show an appropriate message) after a 200 response — the current session cookie is still valid for the remainder of the JWT's `exp` TTL unless the server-side check catches it first.

36. **Prisma singleton in `backend/src/lib/prisma.ts`**: All 21 former per-module `new Pool(…)` instances were replaced with this shared singleton. Do NOT add `new Pool` / `new PrismaClient` in any new controller, service, or middleware — always import `prisma` from `'../lib/prisma'` (or `'./lib/prisma'` from `index.ts`). The singleton is `globalThis`-cached so hot-reload in dev does not leak pools.

37. **`user.controller.ts` name validation uses `typeof` guard**: `createUser` checks `typeof name !== 'string'` before calling `.trim()`. This is intentional — JSON can deliver any type for a request body field, and calling `.trim()` on a non-string would previously throw a 500. All other string fields (`employeeId`, `email`, `roleName`) are currently NOT guarded this way — if you add new string fields to the user update path, add a similar `typeof` check before any string method call.

38. **`listUsers` has both route-level and controller-level privilege checks**: `GET /api/users` is gated by `requireAnyPrivilege('user:create', 'user:manage_roles')` at the route level AND the same OR-check inside the controller. Both are intentional (defence in depth). Do not remove either. If you add another OR-case to user listing, update both the route middleware and the controller guard.

39. **Sortable table headers must use a `<button>` inside the `<th>`, never a bare `<th onClick>`**: A bare `<th>` is not focusable or keyboard-activatable, failing WCAG keyboard-only navigation. The established convention (`app/dashboard/tasks/page.tsx`, and now `PersonnelTab.tsx`'s `SortableTh`) wraps the header label in a `<button type="button" onClick={...}>` and keeps the `<th>` itself free of interaction handlers. Follow this pattern for any new sortable column.

40. **New Jest `describe` blocks that mutate shared/seeded rows need a `beforeEach` cleanup, not just `beforeAll`/`afterAll`**: `workload.test.ts`'s "Personnel Detail" tests use exact-match (`toEqual`) assertions against counts of `timeEntry`/`task`/`workPackageAssignment`/`workPackage` rows. Relying on `beforeAll` seed + `afterAll` teardown alone makes those assertions fragile to test-declaration order and to any future test added to the same block. Add a `beforeEach` that deletes the mutable rows before every test in the block (see that file for the pattern) whenever a new describe block does row-count or exact-list assertions.

39. **Division-scoped user management is not enforced for `user:manage_roles`**: Any holder of `user:manage_roles` can update or delete users in any division. This is correct while `user:manage_roles` defaults to Admin-only in `DEFAULT_PRIVILEGES`. If that privilege is ever granted to Managers via `PrivilegeConfig`, they would gain cross-division reach. Similarly, `updateUser` permits changing `roleName` to any role including `Director`/`Admin`. This is intentional for Admin but must be reviewed before widening the privilege.

40. **`emitRealtimeEvent` is a no-op under `NODE_ENV==='test'` and `startRealtimeListener` is only called outside test:** This is deliberate — Jest must not hold an open `pg` LISTEN connection past the suite (open-handle leak) and tests still write the notification rows; only the `NOTIFY` is skipped. If you add a test that asserts SSE delivery, drive `publishToUser`/`publishToAll` directly or open a real `EventSource` against a running server — do not expect `pg_notify` to fire under test. `npx prisma db push` (or apply `migrations/20260613000000_add_notification`) is required against both `sqd_qa_db` and `sqd_qa_test_db` on first deploy of this branch.

41. **`Notification` is NOT a soft-delete-protected model — it is a disposable UI artifact:** Unlike `User/Task/Finding/WorkPackage`, `Notification` has no `deletedAt`; it may be physically read, mutated, and purged. `AuditLog` remains the compliance system-of-record. The FK to `User` is `onDelete: Cascade` specifically so test teardown that hard-deletes users does not FK-error. `purgeOldNotifications` (30-day sweep on read notifications) runs at startup + every 24 h via an **`unref()`'d** `setInterval` so it never blocks graceful shutdown.

42. **`WpBlueprint.recurrenceType`/`recurrenceInterval` exist in the schema but are P7's responsibility, not P6's:** `wpBlueprint.controller.ts`'s `createWpBlueprint`/`updateWpBlueprint` never read these fields from the request body — every P6 blueprint persists them as `null` regardless of what is sent. Likewise `WorkPackage.isRoutine` is hardcoded `false` everywhere in P6 (manual launch); it is reserved for P7's scheduler to set `true` on auto-launched WPs, so dashboards can later distinguish one-off vs recurring-series instances. Do not start surfacing recurrence fields in the P6 blueprint form/API without first building the P7 scheduler — a blueprint with a non-null `recurrenceType` but no cron reading it would be silently inert.

43. **`createWorkPackageService` (`wp.controller.ts`) is the only place that mints a `WorkPackage` row:** It is shared by the normal `POST /api/wp` handler and `wpBlueprint.controller.ts`'s `launchBlueprint`. Request-layer validation (required fields, `wpType` lookup, `resolveWpTypeFields`, timeframe ordering, `validateAutoGenConfig`) intentionally stays in each call site, not the service — the service only does the `$transaction` (Division `FOR UPDATE` → sequence → `workPackage.create`) and the dual-write (`AuditLog` + `logWpSystemEvent`), parameterised by `auditActionType`/`auditDetails`/`systemEventContent`. If you add a third WP-creation entry point (e.g. the future P7 auto-launch scheduler), reuse this service rather than re-deriving the sequence/dual-write logic a third time.

44. **`TemplateSet`/`WpBlueprint` use `isActive` soft-disable, not Rule-2 `deletedAt` soft-delete:** They are config artifacts referenced by FK (`WorkPackage.autoGenSetId`/`blueprintId`, both `ON DELETE SET NULL`), not one of the four Rule-2 entities (`User`/`Task`/`Finding`/`WorkPackage`). Their "delete" endpoints (`disableTemplateSet`/`disableWpBlueprint`) only ever flip `isActive: false` — never call `.delete()` on either model. Config mutations on these two models write only a lightweight `AuditLog` row (no `TaskActivity`/`FeedPost` — they are not task-scoped); this is a deliberate scoping decision distinct from Rule 3, which still applies in full to actual WP creation/launch.

42. **Notifications are best-effort and per-recipient isolated — call them AFTER the dual-write commits:** `createNotifications`/`notifyFeedWatchers` swallow their own errors so a notification failure can never roll back the business write (Rule 3). Each recipient's write is wrapped individually, so one failure does not abort the rest of the batch. Pass the **base `prisma` client** (not a tx client) at the post-commit call site so the rows are durable before the realtime signal fires. The one exception is `escalation.controller.ts`, which emits inside the flag transaction so the signal rides COMMIT — that is intentional.

43. **`emitRealtimeEvent` signals must stay tiny (`pg_notify` 8 KB limit):** Events are SIGNALS only (`{kind, userId}` or `{kind, scope, scopeId}`) — never embed payloads. `emitRealtimeEvent` guards against >7900-byte payloads (logs + skips rather than risk aborting the surrounding tx). If you add a new event kind, keep it to identifiers and add a `dispatch` case in `pgEvents.ts` — the switch has an exhaustive `default` that logs dropped/unknown kinds, so a forgotten case is visible in logs rather than silent.

45. **`transferIssuerRights` is restricted to Manager/Director targets (2026-06-14):** Since `issuerId === userId` grants reviewer rights via `isReviewer()`, the endpoint now validates the target user's role from the DB before accepting the transfer. Handing issuer rights to Staff/Group Leader is rejected with 403. If you add a new role that should be eligible (e.g. a future "Lead Inspector" above Staff), add it to the explicit allowlist in `transferIssuerRights` in `task.controller.ts`.

46. **`createTaskService` assignee division lock is now privilege-gated, not role-string-gated (2026-06-14):** The check `if (!hasPrivilege(actor, 'task:assign_any') && assignee.divisionId !== actor.divisionId)` applies to ALL actors including the WP-assignment bypass path (Group Leader/Staff). Previously the check only fired for `role === 'Manager'`, so bypass users could seed a cross-division assignee on create. If `task:assign_any` is ever granted to a new role via `PrivilegeConfig`, that role inherits cross-division create-with-assignee permission — this is correct by design.

47. **Task API contract literals have a guard test (`contractSync.test.ts`):** `TASK_STATUSES`, `FINAL_TASK_STATUSES`, `REVIEW_ACTIONS`, and `DEADLINE_DECISIONS` are defined as the authority in `backend/src/constants/taskStatus.ts` and mirrored verbatim in `frontend/src/constants/taskStatus.ts`. `backend/src/__tests__/contractSync.test.ts` parses the frontend file as text on every CI run and fails if the arrays drift. If you add or rename a status/action, update BOTH files and the tests will confirm they match.

48. **`enrichTask()` is the only place `isReviewer`, `isOverdue`, and `deadlineStatus` are computed — use it at every response site:** Every task response in `task.controller.ts` must go through `enrichTask(task, req.user!)`. Do not inline `isReviewer()`/`computeIsOverdue()`/`computeDeadlineStatus()` at new response sites. The frontend `TaskActionBar` and `TaskActivityFeed` both consume `task.isReviewer` from the API response — if a new endpoint skips `enrichTask`, those components will break silently (field is `undefined`, not `false`).

49. **Free-text and task-data fields now have backend caps — never silently truncate:** `saveTaskData` rejects payloads over 512 KB or with any single string value over 100k chars. Controller free-text fields: `title` 300, `reason` 2000, `comment`/`content` 5000. Errors return 400 with a clear message. The frontend `maxLength` on `text`/`textarea` fields mirrors the per-value cap as a UX guardrail; `rich_text` fields are only capped server-side (Tiptap's output HTML can be long). If you add a new free-text field, add a `lengthError()` guard at the same pattern as the existing ones.

44. **The inbox bell (`NotificationBell`, blue) is separate from the escalation bell (`Header`, red):** They are independent — different data sources, different badges. The realtime `notification`/`escalation` signals both also dispatch the existing `escalations:changed` window event so the red bell refreshes instantly (no 60s wait). Do not merge them. `useRealtimeRefresh` deliberately never refetches content out from under a reader — it raises the "N new updates" pill and only refetches on click or tab refocus.

50. **`getOngoingWorks` (`dashboard.controller.ts`) caps each entity query at 200 rows (2026-06-19 PR #37 review fix):** The WP/Task/Blueprint `findMany` calls and the two `feedPost.findMany` calls all carry `take: 200` + an `orderBy`. This was added because the endpoint previously fetched unbounded result sets and sorted/sliced entirely in JS. If the dashboard ever needs to show more than 200 ongoing items per entity type, add real pagination — do not just raise the constant.

51. **Group Leader is scoped the same as Manager in `getOngoingWorks` (2026-06-19 PR #37 review fix):** Group Leader previously fell through to the unscoped branch and saw every division's WPs/Tasks/Blueprints. It is now grouped with Manager for `wpWhere.divisionId`/`taskWhere.targetDivisionId`, and Staff is also scoped on `bpWhere.divisionId` (previously only Manager was). If you add a new role to this endpoint, decide explicitly which bucket (own-division vs global) it belongs to — don't rely on the `else` fallthrough.

52. **`updateWorkPackage`'s `isManager` check requires same-division for Manager-by-privilege (2026-06-19 PR #37 review fix):** `wp:edit` is granted unconditionally to the Manager role in `DEFAULT_PRIVILEGES` with no division qualifier. `wp.controller.ts`'s `isManager` therefore ANDs the privilege check with `(Director|Admin|same divisionId as the WP)` — a Manager can still edit their own creations cross-division (via `wp.creatorId === userId`), but cannot edit another division's WP purely on the strength of holding `wp:edit`. If a future privilege key is meant to grant deliberate cross-division WP edit rights, give it an explicit name (e.g. `wp:edit_any`) rather than loosening this check.

53. **`launchBlueprint` validates for `Invalid Date`, not just ordering:** `timeframeFrom`/`timeframeTo` are parsed with `new Date(...)`; a malformed string produces `NaN` time values, and `NaN >= NaN` is `false`, so the pre-existing ordering check alone would silently let bad dates through. A `Number.isNaN(...)` guard now runs first and returns 400.

54. **`WpBlueprint`/`TemplateSet` index additions (migration `20260619000000_add_autogen_indexes`):** `WpBlueprint` gained `@@index([isActive, recurrenceType, nextRunAt])` (covers the nightly recurrence cron's candidate query — see gotcha #42 for why recurrence is still P7-only) and `@@index([divisionId, isActive])`; `TemplateSet` gained `@@index([divisionId, isActive])`; `WorkPackage` gained `@@index([blueprintId])`. Hand-written (not `prisma migrate dev`-generated) because no `DATABASE_URL` was reachable in the review session's environment — verify the migration applies cleanly against `sqd_qa_db`/`sqd_qa_test_db` on first deploy.
55. **Soft-delete is broader than the four "headline" models — filter `deletedAt: null` on EVERY read of any model that has the field (2026-06-21 audit):** Models with a real `deletedAt` field are `User`, `Task`, `Finding`, `WorkPackage`, `Attachment`, `CapaAction`, `Department` (the schema is the source of truth; Rule 2 in `CLAUDE.md` is now phrased this way). `Department` had a leak — picker/validation reads in `datasource.controller.ts`, `wp.controller.ts`, `wpBlueprint.controller.ts`, and `finding.controller.ts` didn't filter, so soft-deleted departments leaked into pickers and could be referenced by new records (fixed; `findUnique`→`findFirst` where a non-unique filter was needed). `AuditLog` has **no** `deletedAt` (append-only — do **not** add one). `FindingResponseAction.deletedAt` exists but is currently **unused/vestigial** (never written or filtered; schema-commented) — if you ever add a delete path for it, add `deletedAt: null` to every read first.
56. **`getFindingById` has a hidden write side-effect — never reuse it for a lightweight/frequent read (2026-06-22, Quick-View review):** Every GET through `getFindingById` calls `ensureDueDateBreachLogged`, which can write an `AuditLog`/`FeedPost` entry as a side effect of a read, plus it carries a heavy include tree (RCA/CAPA/links/trend). The finding quick-view drawer originally reused it for duplicate-candidate previews; this was wrong on both performance and correctness grounds (a preview shouldn't be able to trigger a breach log). Use the dedicated `GET /api/findings/:id/summary` (`getFindingSummary`) for any preview/summary use case instead — it is deliberately minimal and side-effect-free. If you add another lightweight finding read site, prefer extending `getFindingSummary`'s select over reaching for `getFindingById`.
57. **Quick-view drawers share JSX via `frontend/src/components/quickview/shared.tsx` — don't re-duplicate `Row`/`formatDate`/feed rendering:** `QvRow`, `formatQvDate`, and `QvFeed` are the canonical building blocks for `TaskQuickViewPanel`/`WpQuickViewPanel`/`FindingQuickViewPanel`. A 4th quick-view panel should import from `shared.tsx`, not redefine local equivalents. `QuickViewProvider`'s `openTask`/`openWp`/`openFinding` are mutually exclusive (opening one clears the other two) — only one drawer is ever mounted at a time.
58. **Task-detail back-to-finding link uses a fallback chain, not a single async source (2026-06-22 code-review fix):** `relatedFindings[0] ?? task.parentFinding ?? linkedFindings[0] ?? null` in `app/dashboard/tasks/[id]/page.tsx`. `relatedFindings` (from `getRelatedFindings`, CAPA-aware) is preferred, but the chain falls back to the synchronously-loaded `task.parentFinding`/`linkedFindings[0]` so a slow or failed fetch never drops a link the task already had. Do not collapse this back to depending solely on the async fetch.

59. **Migration history was squashed to a clean baseline (2026-06-23) — `migrate deploy`, never `db push`, and never squash again:** The prior 12-folder history could not rebuild from empty (`0_init` covered 23/45 tables; an `ALTER "CapaAction"` sorted before its `CREATE`). It was replaced, while pre-prod, with `0_init` (full schema from `schema.prisma`) + `20260623000100_add_status_check_constraints`, plus `migration_lock.toml` and `npm run migrate:deploy`/`migrate:dev`/`migrate:status` scripts. **This supersedes every earlier "run `npx prisma db push` on first deploy of branch X" gotcha (#24, #25, #40, #54) — those per-branch manual steps are now baked into the baseline.** Going forward: schema changes via `npm run migrate:dev` only (writes the file *and* keeps `migration_lock.toml` correct); never hand-author folders; the squash is a one-time pre-prod action — once any environment records this history, only ever *add* migrations. Full workflow in `backend/prisma/migrations/README.md`.

60. **The 5 DB CHECK constraints live ONLY in raw SQL and are NOT in the test DB:** `Task_status_check`, `Finding_status_check`, `Finding_severity_check`, `WorkPackage_status_check`, `FindingLink_no_self_reference_check` are in migration `20260623000100` (Prisma can't express CHECK in `schema.prisma`). `test:setup` uses `db push`, which skips raw-SQL migrations, so **the constraints do not exist in `sqd_qa_test_db` and the suite never exercises them**. A change that writes an off-list status can pass all tests yet 500 in prod with Postgres `23514`. When you add/rename a status or severity, update **both** the constant in `constants/*` **and** the CHECK list in the migration. See §12.8 item 1 for the parity-fix options.

61. **`Finding.findingId` (`FND-000001`) is allocated in app code, not by a DB sequence:** `generateFindingId` (`finding.controller.ts`) takes a transaction-scoped `pg_advisory_xact_lock(8123401)`, reads the current max `findingId`, and increments — so allocation is serialised without a dedicated DB sequence object (none exists; do not add one expecting the app to use it). The column is `String? @unique` (nullable for the historical two-step backfill; always set at creation going forward). It is org-wide (no division prefix). Verified contiguous across server restarts.

62. **Feed reads are paginated and the cursor is on a HEADER, not in the body (Phase B):** `getFeed`/`getTaskActivity` return only the newest `?limit` (default 30, max 100) posts as a **flat array**, with the next-page cursor on the **`X-Next-Cursor` response header** (CORS-exposed in `index.ts` via `exposedHeaders`). A caller that doesn't read the header silently sees a truncated feed — this was a deliberate backward-compat choice (body shape unchanged) so existing array consumers don't break. Frontend: `getFeed`/`getTaskActivity` return the array; `getFeedPage`/`getTaskActivityPage` return `{…, nextCursor}`. If you add a new feed read, keep this contract.

63. **Hidden COMMENTs must be filtered from EVERY feed read (Phase D, Rule-2-style obligation):** `hiddenAt != null` is excluded in `getFeed`, `getTaskActivity`, `getPinnedFeed`, `dashboard.controller` (`getFeed` + `getOngoingWorks`), and `task.controller`'s `getLastActivityMap`/`getRecentActivitiesMap`. Only Director/Admin may pass `?includeHidden=true` (on `getFeed`/`getTaskActivity`) to review them. If you add a new path that reads `FeedPost`, add the `hiddenAt: null` filter or you'll resurface moderated content. `hiddenReason` is internal — it only ever reaches Director/Admin because hidden posts are gated.

64. **Comment attachments use a `FEED_POST` attachment entity type (Phase F), not a FeedPost column:** files attach via the normal attachment API with `entityType='FEED_POST'`, `entityId='<post.id>'` (bucket `sqd-feed`). `attachmentService.assertEntityExists` accepts only COMMENT posts; `feedScopeFor` returns null for `FEED_POST` so no per-file SYSTEM_EVENT is written (files render inline on the comment). The upload is post-then-upload (the comment must exist first to own the entityId).

65. **`#CODE` entity links resolve at READ time and the client lookup needs a `hasOwnProperty` guard (Phase E.2):** the backend (`feedService.resolveEntityLinksForPosts`) scans COMMENT content for `#<code>` and resolves real `Task.taskId`/`WorkPackage.wpId`/`Finding.findingId` into `entityLinks`. The frontend `CommentContent` MUST use `Object.prototype.hasOwnProperty.call(entityLinks, code)` before indexing — `entityLinks` is a plain object, so a token like `#toString`/`#constructor`/`#__proto__` would otherwise resolve to an inherited prototype member and render a broken `<Link href="undefined/undefined">` (code-review F1).

67. **Segregation of duties is enforced on the ASSIGNEE, not the issuer (2026-06-28 hardening):** the task performer (`assignedToUserId`) can never `review` (`reviewTask`) or `rate` (`rateTask`) their own task, and an extension requester can't `decide` their own request (`decideDeadlineExtension`). The old `reviewTask` guard only blocked the issuer-who-is-also-assignee case — a Manager assignee who was NOT the issuer could approve their own work via `task:review_div`. If you add any new sign-off/scoring path, gate it on `assignedToUserId === userId`, not on the issuer. **Division scope on the CREATE/LINK path** is also now enforced via the single shared helper **`hasCrossDivisionReach(actor)`** (`utils/privilegeAccess.ts`): `createTaskService` (targetDivisionId), `createWorkPackage` (divisionId), `updateTaskWp` (WP must match task division — guarded by `targetDivisionId != null` so null-target tasks stay linkable), `assignUserToWp`, and `updateWorkPackageStatus` all call it. Reach = Director/Admin by role OR any role granted `task:assign_any` — so a custom role's cross-division reach is consistent across tasks AND WPs (don't re-hand-roll the `role !== 'Director' && …` triple). These are hardcoded checks by design (Phase 7 keeps division-scope out of the privilege matrix). Note WAW-9/**DEF-7**: task `skillLevel` is still NOT enforced against the assignee (no `User` competency field yet). Rate limiting: mutating task/WP routes carry a per-user limiter (disabled under test); `saveTaskData` (autosave) has its own generous bucket so it never starves the review/assign action budget.

66. **`prisma generate` after pulling the feed schema (and the schema-engine download can fail offline):** Phase D added `FeedPost.hiddenAt/hiddenByUserId/hiddenReason/pinnedAt/pinnedByUserId`; Phase G added the `FeedPostAcknowledgement` model. A stale client makes `prisma.feedPostAcknowledgement` undefined and the new columns missing — run `npx prisma generate` (and `npm run test:setup` which `db push`es + regenerates). Note: in an air-gapped/egress-limited environment, `prisma generate`/`db push` may fail fetching the **schema-engine** binary from `binaries.prisma.sh`; the query-engine `.so.node` ships in `@prisma/engines`, but the schema-engine is downloaded — fetch it once with `curl --retry --continue` to `node_modules/@prisma/engines/schema-engine-<platform>` if the auto-download resets.

### Feed & Escalation pending issues (#20–23 — all RESOLVED in Phases 4–5)

19. **Test DB reset on the Feed & Escalation branch**: Suites seed with `create` (not upsert) and assume an empty DB at process start; each self-cleans in `afterAll` (`escalation.test.ts` mirrors `feed.test.ts`'s FK-safe deletes). There is **no global wipe**. Between local runs, reset with a plain `TRUNCATE … RESTART IDENTITY CASCADE` of every table except `_prisma_migrations`, then a single `npm run test`. **Do NOT** use `prisma db push --force-reset` — Prisma's AI guardrail blocks it, and on an empty DB the `prisma.config.ts` seed auto-runs and then collides with suite fixtures. Also: a stale generated client makes `prisma.feedPost` undefined → run `npx prisma generate` after pulling schema changes. *(Still relevant.)*
20. ~~**`EscalationCard` badge is hardcoded `Pending`**~~ — **RESOLVED (Phase 4):** `getFeed` pipes posts through `enrichFlagStatus` (batch-loads `EscalationFlag.status` by the cards' `flagId`); the card renders the badge from `post.flagStatus` (Pending amber / Actioned green / Dismissed slate).
21. ~~**No dedup guard on flagging**~~ — **RESOLVED (Phase 5):** `flagPost` blocks a second PENDING flag for the same `(sourcePostId, targetScope)` → **409** via an in-tx `findFirst` at `isolationLevel: Serializable` (concurrent loser's `P2034` → 409). Re-flagging allowed once the prior flag leaves PENDING. `FlagButton` also tracks per-target flagged state client-side (checkmark + disable). +4 tests.
22. ~~**Header bell polls for every role**~~ — **RESOLVED (Phase 5):** the poll is gated to `ESCALATION_ACTION_ROLES` (Director/Admin/Manager) via `constants/escalationRoles.ts`; GL/Staff never poll and the badge is guarded by `canSeeEscalations`. Badge self-refreshes via a `window 'escalations:changed'` event from the api wrappers.
23. ~~**Minor cleanup**~~ — **RESOLVED (Phase 5):** `formatTimestamp`/`sourceHref`/`TARGET_SCOPE_LABEL` extracted to `utils/feedHelpers.ts`; the dedicated **`/dashboard/escalations`** list page now exists (+ Sidebar nav, bell links to it); the 6-action cluster extracted to `components/feed/EscalationActions.tsx` (shared by card + page).

---

## 9. ENVIRONMENT & COMMANDS

| Command | Location | Purpose |
|---|---|---|
| `npm run dev` | `/frontend` + `/backend` | Start both servers |
| `npm run test` | `/backend` | Run Jest + Supertest suite |
| `npx prisma generate` | `/backend` | Regenerate Prisma client after schema changes |
| `npx prisma db push` | `/backend` | Sync schema to DB (run on both dev + test DBs) |

- **Backend port:** `5000`
- **Frontend port:** `3000`
- **Master user:** `director@sqd.com` / `password123`
- **JWT secret:** `super-secret-development-key-12345` (dev only)

---

## 10. BEFORE STARTING ANY NEW FEATURE

1. Read this document in full
2. Check Section 6 (Schema Additions) — if the model you need doesn't have required fields yet, do the migration first
3. Respect the Draft Encapsulation logic (Section 3.1) — never mutate `formSchema` of a Published template directly
4. Write or update tests before or alongside new features — test DB only
5. All status changes must auto-log a `SYSTEM_EVENT` to `TaskActivity` (once that model exists)
6. RBAC: reviewer actions on Tasks = Issuer + Director + Managers of same Division (not Issuer alone)
7. Rating: Director rates Manager assignees; Manager rates same-Division assignees. Score 1–5. Revisable with audit log entry.
8. Reassignment: permitted at any non-final stage with mandatory reason. Blocked on `Closed`, `Terminated`, `Rejected`. All TaskData always preserved.
9. Every significant event must be written to BOTH `AuditLog` (system-wide compliance) AND `TaskActivity` (per-Task feed) — see Section 3.5.
10. Task always stores `schemaSnapshot` at creation time — never rely on Template's `formSchema` to render a Task form.
11. One-off Templates: auto-delete after first Task assignment. Task `schemaSnapshot` ensures form is never lost.
12. Privilege rules: DB-driven via `PrivilegeConfig` table (Phase 7 complete). `hasPrivilege(actor, key)` in `privilegeAccess.ts` is the single authority — Admin floor → live DB → `DEFAULT_PRIVILEGES` fallback → deny. Do not add new raw `role === 'X'` checks; add a catalog key and use `hasPrivilege`.
13. Prisma client: import `prisma` from `'../lib/prisma'`. Never instantiate `new Pool(…)` or `new PrismaClient(…)` in a controller, service, or middleware — use the shared singleton (see gotcha #36).
14. File Upload field type in Template builder is DEFERRED until Phase 5.4 — MinIO must be configured in Phase 5.0 first.
15. File size/type constraints are Admin-configurable — never hardcode them in application logic.
16. After a `/code-review` or `/security-review` session that the user accepts: update `CODE_REVIEW_AUDIT_LOG.md` with all findings + statuses, then update `CLAUDE_HANDOVER.md` §2 and §8 before ending the session.

---

## 11. AUTHENTICATION SECURITY FIXES — IMPLEMENTED

Audited on **2026-05-29**; the deferred fixes below — plus a broader session/
transport hardening — were **implemented 2026-06** on branch
`claude/amazing-ritchie-soasus` (6 phases, all backend tests green). See
**Section 12** for the deployment requirements this introduced.

### Fix 1 — `updatePassword` requires current password (CRITICAL) — ✅ DONE
**File:** `backend/src/controllers/auth.controller.ts`
**Problem:** `POST /api/auth/update-password` did NOT verify the user's current password before setting a new one. Any valid session token could silently change the password.
**Fix:** Requires `oldPassword`; `bcrypt.compare(oldPassword, user.passwordHash)` → `403` on mismatch / `400` if missing. Applied in all cases, including the forced-first-login flow. **Status:** Completed (Phase 2).

### Fix 2 — User enumeration via `forgotPassword` (RESOLVED 2026-05-30) — ✅ DONE
**File:** `backend/src/controllers/auth.controller.ts`
**Problem:** `/forgot-password` returned `404` when the email was not found, allowing enumeration.
**Fix:** Always returns `200 OK` with a generic message. **Status:** Completed during Phase 5.5 prerequisite audit fixes. (Login also made constant-time via a dummy `bcrypt.compare` on the unknown-user path — Phase 1.)

### Fix 3 — No rate limiting on `/login` and `/forgot-password` (MODERATE) — ✅ DONE
**Files:** `backend/src/middleware/rateLimit.middleware.ts` + `backend/src/routes/auth.routes.ts`
**Problem:** No brute-force protection on login or password-reset endpoints.
**Fix:** Added `express-rate-limit`; `createAuthRateLimiter` (5 req / 15 min per IP, independent buckets) applied to `/login`, `/forgot-password`, and `/reset-password`. Skipped under `NODE_ENV=test` and via `DISABLE_RATE_LIMIT`. **Status:** Completed (Phase 4).

### Fix 4 — JWT secret fallback to `'fallback_secret'` (MODERATE) — ✅ DONE
**Files:** `backend/src/config/env.ts`, `auth.controller.ts`, `auth.middleware.ts`
**Problem:** Both files used `process.env.JWT_SECRET || 'fallback_secret'`, risking token forgery in a misconfigured environment.
**Fix:** Centralized in `config/env.ts`, which **throws at startup** if `JWT_SECRET` is unset (no fallback). **Status:** Completed (Phase 1).

### Fix 5 — Reset token stored in plaintext (LOW) — ✅ DONE
**File:** `backend/src/controllers/auth.controller.ts`
**Problem:** The reset token was stored plaintext; a DB leak exposed usable links.
**Fix:** Stored and compared as `crypto.createHash('sha256')` hashes; the raw token is only emailed. **Status:** Completed (Phase 1).

### Additional hardening (beyond the original 5) — ✅ DONE
- **Server-side session revocation (Phase 3):** new `POST /api/auth/logout` clears `activeSessionId` (+ `LOGOUT` AuditLog); `resetPassword` also clears `activeSessionId` to evict live sessions. Logout was previously client-only.
- **Revocation decoupled from the single-session toggle (Phase 3):** `auth.middleware` now always revalidates the account (`deletedAt: null`) and sources `role`/`divisionId` from the DB on every request, regardless of `ENFORCE_SINGLE_SESSION`; only the `activeSessionId` comparison stays behind the toggle. Soft-deleted users can no longer ride a valid token.
- **JWT moved to an httpOnly cookie (Phase 6):** delivered as `httpOnly`, `SameSite=Strict`, `Secure`-in-prod cookie (set on login/update-password, cleared on logout); middleware accepts cookie OR `Authorization` header (header still works for API/tests). Token is no longer in JS-readable storage (XSS cannot exfiltrate it). CORS locked to `FRONTEND_ORIGIN` with `credentials:true`. The frontend `sessionStorage` temp-auth-token (an account-takeover vector on shared devices) was eliminated.
- **`register` fixed (Phase 5):** now persists a unique `employeeId` (login identifier) so a created user can actually sign in; email optional.

### Impact on Test Suite — applied
- `auth.test.ts` covers: `oldPassword` 403/400/200, no-enumeration parity, reset-token hashing, logout revocation, soft-deleted-token rejection with the toggle off, reset clears session, cookie-based auth, and register→login. New `rateLimit.test.ts` covers the limiter. No schema change was required (all columns already existed).


---

## 12. DEPLOYMENT GUIDE

> Living deployment reference. The auth-security hardening (branch
> `claude/amazing-ritchie-soasus`, 2026-06) changed how secrets, cookies, and
> CORS must be configured. **Read the "Security-critical env vars" subsection
> before any deploy — the backend now refuses to start without `JWT_SECRET`, and
> auth cookies require HTTPS + a configured origin in production.**

### 12.1 Prerequisites
- Node.js 18+ on the host.
- PostgreSQL reachable from the backend (prod DB, e.g. `sqd_qa_db` or a renamed prod DB).
- HTTPS termination (reverse proxy: Nginx / Caddy / Traefik). **Required in
  production** — the auth cookie is `Secure`, so it is only sent over HTTPS.
- Frontend and backend SHOULD be served on the same registrable domain
  (e.g. `app.example.com` + `api.example.com`). The cookie is `SameSite=Strict`;
  same-site keeps cookies flowing and mitigates CSRF. A truly cross-site split
  needs `SameSite=None` + a CSRF token (see 12.6).

### 12.2 Backend environment variables (`backend/.env` or process env)

**Security-critical (must be set in production):**

| Var | Required | Notes |
|---|---|---|
| `JWT_SECRET` | **YES** | Token signing secret. **App throws on startup if unset** (no insecure fallback any more). Must be a long random value, NOT the dev value. See 12.3. |
| `NODE_ENV` | **YES** | Set to `production`. Controls the cookie `Secure` flag (prod = HTTPS-only) and disables the dev rate-limit skip. |
| `FRONTEND_ORIGIN` | **YES** | Exact origin of the frontend, e.g. `https://app.example.com`. CORS is locked to this origin with `credentials:true` (a wildcard is incompatible with credentialed cookies). |
| `DATABASE_URL` | **YES** | `postgresql://user:pass@host:5432/dbname?schema=public`. |
| `PORT` | optional | Backend port (default 5000 in dev; set per host). |
| `DISABLE_RATE_LIMIT` | optional | Leave **unset** in production. Only `true` disables auth rate limiting. |

> `ENFORCE_SINGLE_SESSION` is a row in the `SystemSetting` table (key
> `ENFORCE_SINGLE_SESSION`, value `'true'`/`'false'`), **not** an env var.
> Default behaviour is ON when the row is absent. Independent of this toggle, the
> middleware always revalidates the account (soft-delete + role/division) on
> every request.

### 12.3 Generating and storing `JWT_SECRET`

Generate a strong secret (any one):
```bash
openssl rand -base64 48
# or
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Store it as a deployment secret — **never commit it**. Options:
- **`.env` file** on the host (chmod 600, outside the repo / git-ignored):
  `JWT_SECRET="<generated value>"`
- **systemd**: `EnvironmentFile=/etc/sqd-app/backend.env` in the unit.
- **Docker**: `--env-file` or a Docker secret mounted to env.
- **PM2**: `env` block in `ecosystem.config.js` (kept out of git).

Rotating the secret invalidates all existing tokens (everyone must re-login) —
acceptable and sometimes desirable.

### 12.4 Frontend environment variables
| Var | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | Full API base, e.g. `https://api.example.com/api`. The frontend sends requests with `withCredentials`, so this must be the HTTPS origin that sets the cookie. |

### 12.5 Build & run

Backend:
```bash
cd backend
npm ci
npx prisma generate
# Apply schema to a FRESH (empty) prod DB. The migration history is a clean,
# replayable baseline as of 2026-06-23 (see backend/prisma/migrations/README.md).
# ALWAYS use migrate deploy — NOT db push. `db push` cannot apply the raw-SQL
# CHECK constraints in 20260623000100, so it would silently ship an integrity gap.
npm run migrate:deploy      # = prisma migrate deploy  (idempotent; applies pending migrations)
npm run build               # if a build script exists; otherwise run via ts-node/node
npx prisma db seed          # first deploy only: roles, divisions, master user, templates
# start the compiled server (NODE_ENV=production)
```

Frontend:
```bash
cd frontend
npm ci
npm run build
npm run start               # serves the optimized production build
```

### 12.6 Reverse proxy / HTTPS notes
- Terminate TLS at the proxy; proxy to the backend over the internal network.
- Forward `X-Forwarded-For` so rate limiting sees the real client IP. If behind a
  proxy, set Express `trust proxy` accordingly (add `app.set('trust proxy', 1)`
  in `index.ts` for one proxy hop) so `express-rate-limit` keys on the real IP.
- Ensure the proxy passes `Set-Cookie` through and does not strip `Cookie`.
- CSRF: `SameSite=Strict` is the default mitigation. If the deployment is forced
  cross-site, change the cookie to `SameSite=None; Secure` in
  `auth.controller.ts` (`authCookieOptions`) **and** add a double-submit CSRF
  token — do not relax SameSite without it.

### 12.7 Pre-deploy security checklist (status from the 2026-06 hardening)
- [x] `JWT_SECRET` required, no insecure fallback (§11 Fix 4)
- [x] Login/forgot/reset rate limited (§11 Fix 3)
- [x] `updatePassword` verifies current password (§11 Fix 1)
- [x] Reset tokens stored hashed (§11 Fix 5)
- [x] `forgotPassword` non-enumerating (§11 Fix 2)
- [x] Server-side session revocation on logout + reset
- [x] JWT in httpOnly cookie (not JS-readable); CORS locked to `FRONTEND_ORIGIN`
- [ ] Set `JWT_SECRET`, `NODE_ENV=production`, `FRONTEND_ORIGIN` on the host
- [ ] HTTPS enabled (required for the `Secure` cookie)
- [x] `trust proxy` configured if behind a reverse proxy (`app.set('trust proxy', 1)` in `index.ts`, 2026-06-19 — fixed after `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` surfaced on the `sqdvaeco.duckdns.org` VPS)

### 12.8 Pre-deploy items to MONITOR & RECTIFY (added rev 18, 2026-06-23) ⚠️

Open standing items that are **not blockers for the current pre-prod branch** but must be
watched/closed as the app approaches and enters production. Ordered by importance.

1. **[MONITOR — highest] Test-DB ≠ prod schema-application path → CHECK constraints are NOT exercised by the suite.**
   `npm run test:setup` builds `sqd_qa_test_db` with `prisma db push`, which applies only what
   `schema.prisma` expresses — it does **not** run the raw-SQL migration `20260623000100`, so the
   5 DB-level CHECK constraints **do not exist in the test DB**. Consequence: a code path that
   writes an off-list `status`/`severity`, or a newly-added constraint, can pass all **595** tests
   yet fail at **runtime in prod** with Postgres `23514`. This gap is real and permanent until closed.
   - **Rule going forward:** whenever you add/rename a status or severity value, update **both** the
     constant in `backend/src/constants/*` **and** the CHECK list in the constraints migration.
   - **Rectify before prod (pick one):** (a) switch `test:setup` to `prisma migrate deploy` against
     the test DB for true parity (slower per run, faithful), or (b) keep `db push` for speed but add a
     CI job that replays `migrate deploy` onto an empty DB and asserts the constraints exist.

2. **[DO — at deploy] Provision prod via `migrate deploy` on a FRESH (empty) DB — never `db push`.**
   `db push` would silently skip the CHECK constraints (item 1). The migration history was **squashed
   to a clean baseline on 2026-06-23 while pre-prod** — this is a **one-time** action: once any
   environment has recorded this history, **never squash again**; only ever *add* migrations via
   `npm run migrate:dev`. Never hand-author migration folders. (Full rationale + workflow in
   `backend/prisma/migrations/README.md`.)

3. **[VERIFY — only if not a fresh DB] Data audit before applying constraints to a populated DB.**
   A fresh prod DB needs nothing. But if `migrate deploy` is ever pointed at a DB that already has
   rows, run the `SELECT DISTINCT status/severity …` audit in the header of migration
   `20260623000100` first — `ADD CONSTRAINT` fails if any existing row is off-list.

4. **[MINOR] `DISABLE_RATE_LIMIT` only takes effect via `backend/.env`, not as a shell-prefixed env var.**
   Passing it inline to `npm run dev` doesn't propagate through nodemon/ts-node to `process.env`;
   it must be written into `backend/.env` and the server restarted. Irrelevant to prod (you would
   never disable the limiter there) but a known rough edge for staging/QA smoke testing. If you want
   inline override to work, read the flag at request time rather than module-load time.

5. **[DOC — done] Master user corrected.** Login is by **employeeId** `VAE00071` / `Abc@12345`
   (Director, `forcePasswordChange: true` on fresh seed) — *not* `director@sqd.com` / `password123`,
   which was never valid. `email` is optional/notifications-only. (`CLAUDE.md` fixed 2026-06-24.)

> Lower-severity deferred items (DEF-1…DEF-6: DOMPurify-on-import, `SearchableSelect` keyboard a11y,
> issuer-transfer division scope, `task:assign_div` target-division check, `FILE_UPLOAD_CONFIG` PUT
> endpoint, attachment per-entity scope) remain tracked in `CODE_REVIEW_AUDIT_LOG.md` — none are prod
> blockers at the current privilege matrix.

---

*Generated by Claude Sonnet 4.6 in claude.ai — 2026-05-14*
