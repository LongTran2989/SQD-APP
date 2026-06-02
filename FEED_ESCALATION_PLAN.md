# Feed & Escalation System — Implementation Plan

**Branch:** `claude/sqd-feed-escalation-plan-4dYZa` · **Base commit:** `73274266` (== origin/main)
**Source spec:** Artifact e9ffe8a6 (Feed & Escalation System — Technical Requirements)
**Plan owner protocol:** This file is the living source of truth across sessions. After each phase is complete and tests pass, update the **Status** line and check off that phase's tasks + "Done / Gotchas" notes, then commit. A fresh Claude Code session should be able to resume from the next unchecked phase using only this file + `CLAUDE_HANDOVER.md`.

---

## STATUS: Phase 4 COMPLETE (✅ 253 backend tests pass — 236 baseline + 17 new escalation-action tests; frontend lint at baseline 70/23 — **zero new**; backend + frontend `tsc --noEmit` clean except the pre-existing legacy `clean.ts`). Next session starts at Phase 5.

| Phase | Title | State |
|------|-------|-------|
| 1 | Schema migration: `TaskActivity` → unified `FeedPost` (behavior-preserving) | ✅ Done (commit on `claude/sqd-feed-escalation-plan-4dYZa`) |
| 2 | Feed read/write API + WP / Division Board / Org Feed scopes | ✅ Done (commit on `claude/sqd-feed-escalation-plan-4dYZa`) |
| 3 | Escalation core: flag comment → cards + info cards + audit | ✅ Done (commit on `claude/sqd-feed-escalation-plan-4dYZa`) |
| 4 | Flag lifecycle actions (acknowledge/dismiss/raise finding/create task/reassign/disseminate) | ✅ Done (commit on `claude/sqd-feed-escalation-plan-4dYZa`) |
| 5 | Badges, polish, docs, full regression | ☐ Not started |

### Environment setup notes (for fresh sessions — the container starts with no DB/deps)
- Postgres is **not running** on container start: `service postgresql start`, then `sudo -u postgres psql -c "ALTER USER postgres PASSWORD '321321';"` and `createdb sqd_qa_test_db` + `sqd_qa_db` (matches `.env.test` `postgres:321321@localhost:5432`).
- `node_modules` absent in both `backend/` and `frontend/`: run `npm install` in each.
- Then `cd backend && npx prisma generate && npm run test:setup && npm run test` → expect **189 passing**.
- Baseline `frontend` lint has **70 pre-existing errors / 23 warnings** (repo lint debt, unrelated to this feature). Goal per phase: introduce **zero new** lint problems — diff the count, don't chase the absolute.

---

## Context — why this change

The QA platform has three structural gaps: knowledge silos (discussion trapped per-task), untracked escalations (no formal way to surface a concern up the org), and cross-division blindness (skipped levels never learn an escalation passed them by). This feature introduces a **unified feed** across four scopes (Task / Work Package / Division Board / Org) and a **formal escalation mechanism** where any user can flag a comment, target a scope (WP / Division / Org), and managers/directors action it by **reusing existing workflows** (Raise Finding, Create Task, Reassign Task) — never re-implementing them. Escalation cards appear at the target scope; **info cards** appear at skipped levels so no level is blind. Everything is dual-written to `AuditLog` for compliance.

## Decisions locked with user (2026-06-02)

1. **Full migration** of `TaskActivity` → unified `FeedPost` (pre-production, no legacy data). Not additive.
2. **Raise Finding restricted** to escalations whose source is a Task COMMENT on a task whose template `allowsFindings=true`. Reuse `createFinding` **as-is** — no change to finding validation. Other source posts use the other actions.
3. **Create Task / Reassign Task reuse the existing UI flows** (existing modals/endpoints), pre-filled with escalation context.
4. **Entry points:** new sidebar items *Division Board* + *Org Feed*; WP feed panel on the WP detail page; Header bell wired to a real pending-escalation count (polling, like the existing findings badge).

---

## Existing building blocks to REUSE (do not reinvent)

| Need | Reuse | Location |
|------|-------|----------|
| Dual-write (task scope) | `logAuditAndActivity()` + `logTaskActivity()` | `backend/src/controllers/task.controller.ts` |
| Dual-write (finding) | `logFindingAuditAndActivity(client, ...)` | `backend/src/services/findingService.ts` |
| Dual-write (timebooking) | `logActivityAndAudit()` | `backend/src/controllers/timebooking.controller.ts` |
| Task comment read/post | `getTaskActivity`, `postTaskComment` | `task.controller.ts` (~L1576–1676) |
| Division-scoped read RBAC | `buildFindingScope()` / `canViewFinding()` pattern | `finding.controller.ts` (~L56–80) |
| Reviewer rights (Issuer/Director/Manager-same-div) | `isReviewer()` | `task.controller.ts` (~L803) |
| Role gate middleware | `authorizeRoles(...roles)` | `backend/src/middleware/rbac.middleware.ts` |
| Raise Finding | `createFinding` (POST `/api/findings`) | `finding.controller.ts` (~L126) |
| Create Task | `createTask` (POST `/api/tasks`) | `task.controller.ts` (~L303) |
| Reassign Task | `reassignTask` (PUT `/api/tasks/:id/reassign`) | `task.controller.ts` (~L963) |
| Feed UI (task) | `TaskActivityFeed.tsx` (system/comment bubbles, auto-scroll, role-gated input) | `frontend/src/components/tasks/` |
| Axios + auth injection | `apiClient` | `frontend/src/api/client.ts` |
| Badge polling pattern | Sidebar open-findings count | `frontend/src/components/layout/Sidebar.tsx` |
| Role-gated UI | computed `isReviewer`/`isAssignee` in `TaskActionBar` | `frontend/src/components/tasks/` |

**Conventions to honor:** soft-delete `where:{deletedAt:null}` on User/Task/Finding/WorkPackage (Rule 2); dual-write on every event (Rule 3); status/type stored as plain strings (no Prisma enums in this codebase); `AuditLog.entityId` is a stringified id; tests always hit `sqd_qa_test_db` and wipe in `beforeEach`; run `npx prisma generate` after every schema change (Rule 9); cmd syntax only (Rule 11).

---

## Target data model (added in Phase 1 / extended in Phase 3)

```prisma
model FeedPost {
  id              Int       @id @default(autoincrement())
  type            String    // COMMENT | SYSTEM_EVENT | ESCALATION_CARD | INFO_CARD
  scope           String    // TASK | WP | DIVISION | ORG
  scopeId         Int?      // taskId / wpId / divisionId; NULL for ORG (singleton feed)
  authorId        Int?      // NULL for SYSTEM_EVENT / auto cards
  author          User?     @relation(fields: [authorId], references: [id])
  content         String
  metadata        Json?

  // Escalation linkage (populated Phase 3+)
  sourcePostId    Int?      // the flagged COMMENT
  sourcePost      FeedPost? @relation("PostSource", fields: [sourcePostId], references: [id])
  derivedPosts    FeedPost[] @relation("PostSource")
  sourceExcerpt   String?
  sourceTaskId    Int?      // denormalised for deep-link (no FK — polymorphic origin)
  sourceWpId      Int?
  flagId          Int?
  flag            EscalationFlag? @relation(fields: [flagId], references: [id])
  taggedDivisionIds Json?   // Org Feed only (int array)

  createdAt       DateTime  @default(now())

  @@index([scope, scopeId, createdAt])
  @@index([flagId])
}

model EscalationFlag {
  id               Int       @id @default(autoincrement())
  sourcePostId     Int       // immutable ref to the original flagged comment
  flaggedByUserId  Int
  targetScope      String    // WP | DIVISION | ORG
  status           String    @default("PENDING") // PENDING | ACTIONED | DISMISSED
  reviewedByUserId Int?
  action           String?   // ACKNOWLEDGE | DISMISS | RAISE_FINDING | CREATE_TASK | REASSIGN_TASK | DISSEMINATE
  actionedAt       DateTime?
  linkedEntityType String?   // Finding | Task
  linkedEntityId   String?
  cards            FeedPost[] // ESCALATION_CARD / INFO_CARD generated by this flag
  createdAt        DateTime  @default(now())  // never soft-deleted

  @@index([targetScope, status])
}
```

**Migration note (Phase 1):** `TaskActivity` is dropped; its rows have no legacy value (pre-prod). The `Task.activities` relation + `onDelete: Cascade` is removed — tasks are soft-deleted (never hard-deleted) so cascade is unused. The task feed becomes `FeedPost where { scope:'TASK', scopeId: task.id }`. `scopeId` is **polymorphic** → no FK on it; query by `(scope, scopeId)`.

---

## Escalation placement matrix (Phase 3)

Encoded as ONE hierarchy rule (`TASK<WP<DIVISION<ORG`): **ESCALATION_CARD at the target; INFO_CARD at every level strictly between origin and target.** The 6 instances:

| Flag origin → target | ESCALATION_CARD at | INFO_CARD at |
|---|---|---|
| Task → WP | WP feed | — |
| WP → Division *(added P3, user decision 2026-06-02)* | Division Board | — |
| Task → Division | Division Board | WP feed |
| WP → Org | Org Feed | Division Board |
| Task → Org | Org Feed | WP feed + Division Board |
| Division → Org | Org Feed | — |

Any origin→target NOT derivable from the rule (downward/same-level, ORG-comment escalation, non-COMMENT source) → **400**. Cards reference the source via excerpt + link — **never copy full text** (spec non-negotiable #3). Disseminate **reuses the same flag** (spec #5) — posts an ESCALATION_CARD to Org with optional `taggedDivisionIds`; it must NOT create a second flag.

## RBAC matrix (enforce in controllers; Director/Admin bypass division checks)

| Capability | Director/Admin | Manager | Group Leader | Staff |
|---|---|---|---|---|
| Read all feeds | ✅ | ✅ | ✅ | ✅ |
| Comment Task/WP feeds | ✅ | ✅ | ✅ | ✅ |
| Post Division Board | ✅ any | ✅ own div | ✅ own div | ✅ own div |
| Post Org Feed (original) | ✅ | ✅ | ❌ | ❌ |
| Flag any comment | ✅ | ✅ | ✅ | ✅ |
| Action flags (WP/Div) | ✅ any | ✅ own div | ❌ | ❌ |
| Action flags (Org) | ✅ | ✅ | ❌ | ❌ |

---

## PHASE 1 — Schema migration `TaskActivity` → `FeedPost` (behavior-preserving)

Goal: introduce `FeedPost` + `EscalationFlag` and route the **existing task feed** through `FeedPost` with zero behavior change. No new feeds/escalation yet. All ~150 tests pass (renamed where needed).

**Backend**
- `prisma/schema.prisma`: add `FeedPost` + `EscalationFlag`; remove `TaskActivity` model + `Task.activities`; add `User.feedPosts FeedPost[]`. Run `npx prisma generate` + `db push`.
- New `backend/src/services/feedService.ts`: `createFeedPost(client, {type,scope,scopeId,authorId,content,metadata})` and a `logAudit(client, {...})` extracted helper. Re-implement the three dual-write helpers on top of it (task scope → `scope:'TASK', scopeId:taskId`). Keep their signatures so call sites change minimally.
- Repoint reads: `getTaskActivity` → `feedPost.findMany({where:{scope:'TASK',scopeId:id}, orderBy:{createdAt:'asc'}})`; `postTaskComment` → `createFeedPost(...COMMENT...)`. Author enrichment unchanged.
- Sweep call sites: `task.controller.ts`, `finding.controller.ts`, `timebooking.controller.ts`, `services/findingService.ts`, `services/wpCheckService.ts`, and `taskInclude()` if it includes `activities`.
- Routes unchanged for now (GET/POST `/api/tasks/:id/activity` stay; they now read/write FeedPost).

**Frontend**
- `src/types/index.ts`: `TaskActivity*` → `FeedPost` shape (add `scope`,`scopeId`; keep `type`,`content`,`metadata`,`author`).
- `src/api/taskApi.ts`: response typing only; endpoints unchanged.
- `TaskActivityFeed.tsx`: adapt to FeedPost field names; render identically (COMMENT/SYSTEM_EVENT only).

**Tests**
- `src/__tests__/setup.ts` + every test `beforeEach`: replace `prisma.taskActivity.deleteMany` → `prisma.feedPost.deleteMany`; replace assertions querying `taskActivity` → `feedPost` (with `scope:'TASK'`).
- Grep for `taskActivity` across `backend` + `frontend` to ensure none missed.

**Acceptance:** task detail feed looks/behaves exactly as before; `cd backend && npm run test` → all pass; `cd frontend && npm run lint` clean.

**Done / Gotchas (Phase 1 — completed):**
- New `backend/src/services/feedService.ts` → `createFeedPost(client, input)` is the single feed-write entry point (accepts PrismaClient or a tx client). **Phases 2–4 should build on this**, not re-implement inserts.
- Schema: `TaskActivity` removed; `FeedPost` + `EscalationFlag` added (`schema.prisma` ~L383–428). `FeedPost.scopeId` is **polymorphic — no FK**; Task feed = `where:{ scope:'TASK', scopeId: task.id }`. Removed `Task.activities` + its `onDelete:Cascade` (tasks are soft-deleted, so cascade was unused) and added `User.feedPosts`.
- Repointed 5 write sites + 1 read site through `createFeedPost`/`feedPost`: `task.controller.ts` (`logTaskActivity`, `getTaskActivity`, `postTaskComment`), `services/findingService.ts`, `controllers/timebooking.controller.ts`, `services/wpCheckService.ts`. Helper **signatures unchanged** (`logTaskActivity`, `logAuditAndActivity`, `logFindingAuditAndActivity`, `logActivityAndAudit`) so the 17 `logAuditAndActivity` call sites were untouched.
- Endpoints **unchanged**: `GET/POST /api/tasks/:id/activity` still work; response rows now carry `scope`/`scopeId` instead of `taskId`.
- Tests updated (task/finding/wp): `prisma.taskActivity.*` → `prisma.feedPost.*`, queries gained `scope:'TASK', scopeId:` (was `taskId:`). No test logic changed. **189/189 pass.**
- Frontend: `TaskActivity` interface in `types/index.ts` swapped `taskId` → `scope`+`scopeId` (kept the name + the 2-value `type` union for now). `TaskActivityFeed.tsx` untouched (never read `taskId`). **No new lint errors.**
- ⚠️ For Phase 2: the generic FeedPost type system + `FeedPanel` refactor is deferred to that phase as planned. `TaskActivityFeed.tsx` is still task-specific — refactor it into the reusable `FeedPanel`/`FeedPostItem` there.

---

## PHASE 2 — Feed API + WP / Division Board / Org Feed

Goal: generic feed read + comment endpoints for all four scopes; surface WP/Division/Org feeds in UI. Comments + system events only (no escalation).

**Backend** — new `feed.controller.ts` + `feed.routes.ts` (register `/api/feeds` in `src/index.ts`):
- `GET /api/feeds/:scope/:scopeId?` — returns posts for a scope (ORG omits scopeId). All authenticated users may read (transparency default). Author-enrich like `getTaskActivity`.
- `POST /api/feeds/:scope/:scopeId?/posts` — create a COMMENT. RBAC: TASK/WP open to all; DIVISION → own division (Director any); ORG → Director/Manager only (`authorizeRoles` + division check). Dual-write COMMENT (no AuditLog for plain comments — matches current task-comment behavior; system events still dual-write).
- WP-scope SYSTEM_EVENTs: in `wp.controller.ts` lifecycle transitions, also `createFeedPost(scope:'WP', scopeId:wp.id, type:'SYSTEM_EVENT')` alongside existing audit. (Forward-only; no backfill.)
- `buildFeedPostScope` helper for any future filtered reads.

**Frontend**
- Refactor `TaskActivityFeed.tsx` → generic `FeedPanel` (+`FeedPostItem`) taking `scope`/`scopeId`; keep a thin task wrapper so the task page is untouched visually.
- `src/api/feedApi.ts`: `getFeed(scope, scopeId?)`, `postFeedComment(scope, scopeId?, content)`.
- WP detail page `app/dashboard/work-packages/[id]/page.tsx`: add WP `FeedPanel`.
- New pages `app/dashboard/division-board/page.tsx` (defaults to user's division; Director can switch) and `app/dashboard/org-feed/page.tsx`.
- `Sidebar.tsx`: add *Division Board* (all roles) + *Org Feed* (all roles read; post-gating handled in panel) nav items.

**Tests:** new `feed.test.ts` — read all scopes per role; post RBAC (org restricted, division own-only, director bypass); WP system-event emission.

**Done / Gotchas (Phase 2 — completed):**
- **Backend feed API.** New `feed.controller.ts` + `feed.routes.ts`, registered at `/api/feeds` in `index.ts`. Two endpoints, both auth-gated:
  - `GET /api/feeds/:scope/:scopeId?` — author-enriched posts (oldest-first), all authenticated users may read any feed (transparency). 400 on bad scope / missing non-ORG scopeId; 404 if the Task/WP/Division target doesn't exist (soft-delete aware).
  - `POST /api/feeds/:scope/:scopeId?/posts` — creates a COMMENT. **Plain comments write NO AuditLog** (matches existing task-comment behavior); only SYSTEM_EVENTs dual-write.
- **Express 5 routing gotcha.** `:param?` optional segments throw under Express 5 / path-to-regexp v8. Used **two explicit routes per verb** instead (`/:scope/:scopeId` + `/:scope`, and the `/posts` pair). ORG is the singleton feed: `GET /api/feeds/ORG`, `POST /api/feeds/ORG/posts` (no scopeId). Frontend `feedApi.feedPath()` matches this.
- **RBAC helpers added to `feedService.ts`** (built on the existing `createFeedPost`, no re-implemented inserts): `buildFeedPostScope(scope,scopeId)` (ORG ⇒ `scopeId:null`), `canPostToFeed(user,scope,scopeId)` (TASK/WP → all; DIVISION → own div, Director/Admin any; ORG → Director/Admin/Manager), plus `isFeedScope`/`FEED_SCOPES`. **Admin is treated as Director-equivalent** for division bypass + ORG posting (matches the "Director/Admin" matrix column).
- **WP SYSTEM_EVENTs** (decision: status + creation + assignment): added `logWpSystemEvent()` to `wp.controller.ts` — best-effort, never throws, `authorId:null` (actor captured in AuditLog). Emits on `createWorkPackage`, `updateWorkPackageStatus` (incl. reactivation wording), `assignUserToWp`, `removeUserFromWp`, alongside the existing AuditLog writes. Forward-only, no backfill.
- **`CreateFeedPostInput.metadata`** widened to `... | undefined` — this also cleared two pre-existing Phase-1 `exactOptionalPropertyTypes` tsc errors in `task.controller.ts` + `findingService.ts`. (Backend `tsc --noEmit` is now clean except the unrelated legacy `clean.ts`, which still references the removed `taskActivity` model — out of scope.)
- **Frontend (parallel, low-risk — decision):** `TaskActivityFeed.tsx` left behaviorally untouched. New generic, self-loading `components/feed/FeedPanel.tsx` + presentational `FeedPostItem.tsx` (bubble/system styles lifted from TaskActivityFeed; COMMENT + SYSTEM_EVENT now, cards fall through neutrally for Phase 3). `api/feedApi.ts` exposes `getFeed`/`postFeedComment` + a `canPostToFeed` RBAC **mirror** (UI-only; backend re-checks).
  - ⚠️ **Lint gotcha:** the `react-hooks/set-state-in-effect` rule flags the common `useEffect(()=>{ loadX(); })` pattern (the WP detail page already trips it in the baseline). `FeedPanel` loads via `getFeed(...).then(setState)` with a `cancelled` flag (Sidebar pattern) to add **zero** new lint problems.
  - Pages: WP detail page gained a `FeedPanel` (scope `WP`); new `app/dashboard/division-board/page.tsx` (defaults to own division, Director/Admin switch via `getDivisions`, remounts via `key`) + `app/dashboard/org-feed/page.tsx`. Sidebar gained *Division Board* + *Org Feed* (all roles).
- **Tests:** `feed.test.ts` — 22 tests: read access per role + 401, oldest-first author enrichment, ORG singleton, scope isolation, 400/404 validation; post RBAC (TASK/WP open, DIVISION own-only + Director bypass, ORG Director/Admin/Manager only, GL/Staff 403), no-AuditLog-for-comments, 404 target; WP SYSTEM_EVENT emission on create/status/assign. **211/211 backend pass.**
- ➡️ **For Phase 3:** `FeedPostItem` currently renders ESCALATION_CARD/INFO_CARD as a neutral note — replace with real card renderers there. `FeedPanel` appends new posts optimistically and has no polling; wire the Header bell + any live refresh in Phase 3/5.

---

## PHASE 3 — Escalation core (flag → cards + info cards + audit)

Goal: flag a COMMENT, create `EscalationFlag(PENDING)`, place ESCALATION_CARD at target + INFO_CARDs at skipped levels, dual-write audit, expose pending list/count.

**Backend** — `escalation.controller.ts` + routes (or extend feed):
- `POST /api/feeds/posts/:id/flag` body `{ targetScope }`. Validate source post is a COMMENT; any authenticated user. In a `$transaction`: create flag; create ESCALATION_CARD at target scope (denormalise `sourceExcerpt`, `sourceTaskId`/`sourceWpId`, `flagId`); create INFO_CARDs per matrix; `logAudit('ESCALATION_RAISED', entityType:'EscalationFlag', ...)` + a SYSTEM_EVENT on the source feed.
- `GET /api/escalations?status=PENDING` — RBAC-scoped (Director all; Manager own-div WP/Div + all Org; others none-actionable but visible cards via feeds). Used for badge + lists.
- Helper `placeEscalationCards(client, flag)` encodes the matrix in one place.

**Frontend**
- `FlagButton` on COMMENT posts → modal to pick target scope; calls flag endpoint.
- `EscalationCard` (actionable, Phase 4 wires buttons) + `InfoCard` (display-only) renderers in `FeedPanel`.
- `Header.tsx`: replace hardcoded red-dot with real pending-escalation count via polling (reuse Sidebar badge pattern); link to a filtered view.

**Tests:** `escalation.test.ts` — full placement matrix (6 rows), card content is excerpt+link not full copy, audit dual-write, flag status PENDING, RBAC on who sees actionable cards.

**Done / Gotchas (Phase 3 — completed):**
- **Decisions locked with user (2026-06-02):** (1) `WP → Division` IS a valid escalation (6th matrix row) — WP-assignees escalate to their division's managers. (2) Header bell / `GET /api/escalations` = **actionable-by-the-viewer** (Director/Admin all; Manager own-div WP/Div + all Org; GL/Staff empty) — everyone still SEES cards via feed transparency. (3) Task with no WP: `Task→WP` → 400; `Task→Division/Org` place the rest and **skip just the WP info-card**. (4) FlagButton ships in P3, **including on the task feed**.
- **One-helper matrix.** `services/escalationService.ts` → `placeEscalationCards(client, {flag, sourcePost, origin, flaggedByName})` encodes the whole matrix as the hierarchy rule (`SCOPE_LEVEL TASK<WP<DIVISION<ORG`; ESCALATION_CARD at target, INFO_CARD at each strictly-between level). Adding `WP→Division` was free — it has no intermediate level. `resolveEscalationOrigin()` resolves the polymorphic source feed (soft-delete aware) into `{taskId,wpId,divisionId}`. `buildExcerpt()` truncates to `EXCERPT_MAX=160` + `…` — cards store only the excerpt + denormalised `sourceTaskId/sourceWpId/flagId`, **never** the full text. Built on the existing `createFeedPost` (no re-implemented inserts).
- **Controller `escalation.controller.ts`** (own Pool/PrismaClient, like the other controllers):
  - `flagPost` → `POST /api/feeds/posts/:id/flag` `{targetScope}`. Any auth user. Validates COMMENT-only, ORG-can't-escalate, target>origin, target entity resolvable, `Task→WP` requires a WP. In a `$transaction`: create `EscalationFlag(PENDING)` → `placeEscalationCards` → dual-write (Rule 3) `AuditLog('ESCALATION_RAISED', entityType:'EscalationFlag')` + a SYSTEM_EVENT on the **source** feed (the system event carries `flagId`).
  - `getEscalations` → `GET /api/escalations?status=PENDING`. GL/Staff short-circuit to `[]`. Manager scoping resolves each flag's division via its ESCALATION_CARD (`card.scopeId` is the divisionId for DIVISION targets; for WP targets it batch-loads `WorkPackage.divisionId`). Returns flags enriched with excerpt/deep-link/flagger/card.
- **Express 5 routing.** `POST /posts/:id/flag` registered in `feed.routes.ts` **before** the generic `/:scope*` routes. Verified no collision: `/posts/5/flag` (3 segs, last `flag`) never matches `/:scope/:scopeId/posts` (last seg must be literal `posts`) nor `/:scope/posts` (2 segs). New `escalation.routes.ts` → `/api/escalations` in `index.ts`.
- **Frontend.** Real renderers `components/feed/EscalationCard.tsx` (actionable **shell** — header/excerpt/deep-link/PENDING badge; action buttons are P4) + `InfoCard.tsx` (display-only). `FeedPostItem.tsx` now branches to them and shows a `FlagButton` on COMMENTs. `FlagButton.tsx` = icon + target-picker (no interactive-div overlay → no a11y lint). `FeedPanel` computes targets from its scope (WP→[Div,Org], Division→[Org], Org→[]) and reloads after a flag. `TaskActivityFeed` adds the FlagButton to task comments with targets `task.wpId ? [WP,Div,Org] : [Div,Org]`. `Header.tsx` bell shows a real polled count via `getPendingEscalations()` (`getX().then(setState)`+`cancelled`+60s `setInterval` — zero new react-hooks lint). New `api/escalationApi.ts` (`flagPost`, `getPendingEscalations`). Types: `EscalationTargetScope`, `PendingEscalation`.
- **Tests: 25 added → 236/236 backend pass.** Matrix (6 rows + no-WP skip), excerpt≤161 & ≠ full & headline doesn't embed source, audit dual-write (AuditLog + source-feed SYSTEM_EVENT), PENDING status, anyone-can-flag, validation (401/404/400 incl. ORG-source, non-COMMENT, downward target, no-WP), and `GET /api/escalations` RBAC (Director all / Manager own-div+Org / GL+Staff empty).
- ⚠️ **Test-DB gotchas for fresh sessions (cost me time — heed these):** (a) The generated Prisma client can be **stale** — `npx prisma generate` is mandatory even if `node_modules/.prisma` exists (else `prisma.feedPost` is `undefined`). (b) Suites seed with `create` (not upsert) and **assume an empty DB at process start** + each self-cleans in `afterAll`; there is **no global wipe**. Between local runs the DB must be reset. **Do NOT use `prisma db push --force-reset`** (Prisma's AI guardrail blocks it without consent, and on an empty DB the `prisma.config.ts` seed auto-runs and then collides with suite fixtures). Reset with a plain `TRUNCATE … RESTART IDENTITY CASCADE` of all tables except `_prisma_migrations`, then a single `npm run test`. (c) `escalation.test.ts` needed its own `afterAll` (mirroring `feed.test`) deleting its Template/Task/WP/users in FK-safe order — without it, `user.test`'s global `prisma.user.deleteMany()` hits the `Template_ownerId` RESTRICT FK and that suite fails depending on run order.
- ➡️ **For Phase 4:** `EscalationCard` is a shell — add role-gated action buttons there (acknowledge/dismiss/raise-finding/create-task/reassign/disseminate) calling `POST /api/escalations/:id/action`. `getEscalations` already supports a `status` filter and returns `linked`-ready flag rows. Header bell currently shows the count only (no dedicated escalations page yet) — a filtered list view is a P4/P5 add. Disseminate must reuse the same flag (no second flag).

---

## PHASE 4 — Flag lifecycle actions

Goal: managers/directors action a PENDING flag; reuse existing workflows; single flag tracks lifecycle.

**Backend** — `POST /api/escalations/:id/action` body `{ action, payload }`, RBAC per matrix (WP/Div → Director any / Manager own-div; Org → Director/Manager):
- `ACKNOWLEDGE` → status ACTIONED.
- `DISMISS` → status DISMISSED.
- `RAISE_FINDING` → **only if** source is a Task COMMENT whose task template `allowsFindings` (else 400). Reuse `createFinding` logic; set `linkedEntityType:'Finding'`, `linkedEntityId`.
- `CREATE_TASK` → reuse `createTask` logic with payload (templateId/targetDivisionId/assignee…); link entity.
- `REASSIGN_TASK` → reuse `reassignTask` (`newAssigneeId`,`reason`) on `sourceTaskId`.
- `DISSEMINATE` → **reuse same flag** (no new flag): post ESCALATION_CARD to ORG with optional `taggedDivisionIds`; status stays/links appropriately.
- Every action: dual-write `AuditLog` + SYSTEM_EVENT on relevant feed; set `reviewedByUserId`,`actionedAt`.

**Frontend**
- Action buttons on `EscalationCard`, role-gated. Create Task / Reassign **open the existing modals/flows** pre-filled (decision #3); Raise Finding opens existing finding flow; Disseminate modal with division multi-select.

**Tests:** each action happy-path + RBAC denial; Raise-Finding restriction (non-eligible source → 400); Disseminate reuses the same flag id (no second flag); `linkedEntityId` correctness; final-state flags not re-actionable.

**Done / Gotchas (Phase 4 — completed):**
- **Decisions locked with user (2026-06-02):** (1) Reuse = **extract service cores + one atomic transaction**. (2) DISSEMINATE = any actionable flag → ORG card reusing the SAME flag, status ACTIONED (terminal). (3) RAISE_FINDING/CREATE_TASK/REASSIGN_TASK → status ACTIONED + link entity (REASSIGN links the **source task id**); ACKNOWLEDGE→ACTIONED, DISMISS→DISMISSED. (4) Payload carries the create-fn fields; reuse existing validation **as-is**. (5) Frontend = **card-local action modals** (existing flows are page-bound and wouldn't link the flag). #21 (dedup) and #22 (bell-poll gating) stay in Phase 5.
- **Service extraction (no forked validation).** `createFinding` / `createTask` / `reassignTask` were Express handlers using a module-level `prisma` + module-private helpers. Each now has an exported core `…Service(client, actor, params)` that runs every write on the supplied `client` (never the module prisma) and throws a typed `HttpError` (new `backend/src/utils/httpError.ts`); the HTTP handlers became thin wrappers (`prisma.$transaction(tx => …Service(tx, …))` + response shaping). `logTaskActivity` / `logAuditAndActivity` gained an optional trailing `client` param (default = module prisma) so the services route writes onto the caller's tx — the ~17 other `logAuditAndActivity` call sites were untouched. **Bonus:** `createTask`/`reassignTask` logging is now atomic with the create (was previously outside the tx).
- **`createTaskService` needs a tx** — its taskId generation does `SELECT … FOR UPDATE`, so the caller MUST wrap it in a `$transaction` (both the HTTP handler and the escalation action do). `Finding.fieldId` is a **String** in the schema (not a number) — the extracted `CreateFindingParams.fieldId` is typed `string | null`.
- **Cross-module tx is fine.** `escalation.controller` owns its own `PrismaClient`; it opens ONE `prisma.$transaction` and passes that `tx` to `createTaskService`/`createFindingService`/`reassignTaskService` (defined in the task/finding controllers). Because the services use the *passed* client and never their module prisma, the writes are all in one atomic transaction against the same DB. No circular import (task/finding controllers don't import escalation).
- **Shared RBAC predicate (altitude).** Extracted the inline Manager-scoping from `getEscalations` into `escalationService.ts`: `canActionFlag(user, {targetScope, divisionId})` (Director/Admin any; Manager → all ORG + own-division WP/DIVISION; GL/Staff none) + `resolveFlagDivision(client, flag)` (DIVISION → card scopeId; WP → `WorkPackage.divisionId`; ORG → null). `getEscalations` batch-resolves WP divisions then filters via `canActionFlag`; the action endpoint resolves the single flag's division then gates with the same predicate. The GET-escalations RBAC tests still pass unchanged.
- **`POST /api/escalations/:id/action`** (`actionEscalation`, route registered in `escalation.routes.ts` — explicit numeric `:id` + literal `action`, no Express-5 issue). Loads the flag + its ESCALATION_CARD + source post; **400 if not PENDING** (final-state not re-actionable); `canActionFlag` → 403. One `$transaction`: per-action work → `escalationFlag.update` (status, `action`, `reviewedByUserId`, `actionedAt`, `linkedEntityType/Id`) → dual-write `AuditLog('ESCALATION_ACTIONED')` + a `SYSTEM_EVENT` on the **target feed** (where the card lives). RAISE_FINDING requires a TASK-comment source w/ a `sourceTaskId` (then the reused `createFinding` enforces `allowsFindings`); REASSIGN_TASK runs on `card.sourceTaskId` and links it; DISSEMINATE posts an ORG `ESCALATION_CARD` with optional `taggedDivisionIds` reusing `flag.id` (asserted: no second `EscalationFlag` row).
- **#20 fixed.** `feed.controller.getFeed` now pipes posts through `enrichFlagStatus` (batch-loads `EscalationFlag.status` by the cards' `flagId`) → each ESCALATION_CARD/INFO_CARD carries a live `flagStatus`. `EscalationCard.tsx` renders the badge from `post.flagStatus` (Pending amber / Actioned green / Dismissed slate), no longer hardcoded "Pending".
- **Frontend.** `EscalationCard` shows role-gated action buttons when `flagStatus==='PENDING'` and the viewer is Director/Admin/Manager (backend re-checks). Acknowledge/Dismiss are one-click; Raise Finding (only when `sourceTaskId`), Create Task, Reassign (only when `sourceTaskId`), Disseminate open a compact card-local `EscalationActionModal` that collects the payload and POSTs to the action endpoint, then refreshes the feed. Modal loads reference data (templates via `/templates`, divisions/users via datasources, departments via `getDatasource`) with the `getX().then(setState)+cancelled` pattern. New `api/escalationApi.actionEscalation`; types `EscalationAction`/`EscalationFlagStatus`/payload interfaces + `FeedPostEnriched.flagStatus`. `FeedPanel→FeedPostItem→EscalationCard` thread `currentUser` + `onActioned=reloadFeed`. Modal backdrop is non-interactive (close via explicit button) → no a11y lint. **Lint stays 70/23 (zero new); frontend `tsc --noEmit` clean.**
- **Tests: 17 added → 253/253 backend pass.** Each action happy-path (incl. linkedEntity correctness + assignee actually changed), RBAC denial (GL/Staff 403, other-division Manager 403, own-division Manager 200, any Manager on Org 200), RAISE_FINDING restrictions (non-eligible template → 400 + flag stays PENDING via rollback; non-task source → 400), DISSEMINATE reuses the same flag (count unchanged) + ORG card w/ taggedDivisionIds, final-state not re-actionable (400), dual-write (AuditLog + target-feed SYSTEM_EVENT), and validation (404/400/401). New fixtures: ESC-002 (allowsFindings:true) + ESC-003 (allowsFindings:**false**, since the schema default is `true`) templates and tasks; `afterAll` widened to clean `ESC-` templates + findings.
- ➡️ **For Phase 5:** gate the Header bell poll to Director/Admin/Manager (#22); add a flag-dedup guard (#21); add a dedicated escalations list page; extract the duplicated `formatTimestamp`/`sourceHref` helpers (#23); refresh the Header/Sidebar badge counts after an action; update `CLAUDE_HANDOVER.md` + `BUSINESS_WORKFLOW.md` (Rule 12, after user confirms).

---

## PHASE 5 — Badges, polish, docs, regression

- Verify Header/Sidebar badge counts are RBAC-correct and refresh after actions.
- Empty states, loading, error toasts consistent with existing components.
- Full regression: `cd backend && npm run test` (all green) + `cd frontend && npm run lint` + `npm run build`.
- **Lint-debt burn-down (optional, scoped — not a blocker).** Baseline is **70 errors / 23 warnings** of *pre-existing* repo debt (verified Phase 2: `tsc --noEmit` = 0, `next build` exit 0 — none of it breaks compile or build; `next dev`/Jest unaffected). Each phase only held the line ("zero new"). If burning it down here, prioritise the *behavioral-smell* rules over cosmetics, and do it as its own commit (no feature changes) so the diff is reviewable:
  - **Priority 1 (behavioral):** `react-hooks/set-state-in-effect` (11) + `react-hooks/exhaustive-deps` (2) + `react-hooks/immutability` (3). Fix by adopting the Sidebar/`FeedPanel` pattern (`getX().then(setState)` + `cancelled` flag) instead of `useEffect(() => loadX())`. **Use this pattern in Phase 3/4 too (escalation loaders, Header bell poller) so the bucket doesn't grow.**
  - **Priority 2 (mechanical):** `@typescript-eslint/no-explicit-any` (51) — mostly `catch (err: any)` → `catch (err: unknown)` + a narrow type guard, and JSON payload casts. Safe, repetitive.
  - **Priority 3 (cosmetic):** `react/no-unescaped-entities` (5), `no-unused-vars` (18), `@next/next/no-img-element` (3).
- Update `CLAUDE_HANDOVER.md` (phase status, object reference for FeedPost/EscalationFlag, RBAC, gotchas) and `BUSINESS_WORKFLOW.md` (feeds + escalation loop) — Rule 12, only after user confirms.

**Done / Gotchas:** _…_

---

## Out of scope (this feature)
Push/email/websocket notifications (badges only), threaded replies, external integrations/analytics.

## Verification (end-to-end, per phase)
1. `cd backend && npm run test:setup && npm run test` — all pass against `sqd_qa_test_db` (Rule 8). Add new tests with each phase.
2. `cd frontend && npm run lint` (and `npm run build` at Phase 5).
3. Manual smoke (Director — log in with **employeeId `VAE00071` / `Abc@123`**; login field is employeeId, not email — `director@sqd.com/password123` in CLAUDE.md is stale): comment on a task → still works (P1); open WP/Division/Org feeds, post per RBAC (P2); flag a comment, see card at target + info cards at skipped levels (P3); action a flag → finding/task created or reassigned, badge updates (P4).
4. After each phase: update STATUS table + Done/Gotchas above, commit to `claude/sqd-feed-escalation-plan-4dYZa`.
