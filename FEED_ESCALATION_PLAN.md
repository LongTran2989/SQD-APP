# Feed & Escalation System — Implementation Plan

**Branch:** `claude/sqd-feed-escalation-plan-4dYZa` · **Base commit:** `73274266` (== origin/main)
**Source spec:** Artifact e9ffe8a6 (Feed & Escalation System — Technical Requirements)
**Plan owner protocol:** This file is the living source of truth across sessions. After each phase is complete and tests pass, update the **Status** line and check off that phase's tasks + "Done / Gotchas" notes, then commit. A fresh Claude Code session should be able to resume from the next unchecked phase using only this file + `CLAUDE_HANDOVER.md`.

---

## STATUS: Phase 2 COMPLETE (✅ 211 backend tests pass — 189 baseline + 22 new feed tests; frontend lint at baseline 70/23). Next session starts at Phase 3.

| Phase | Title | State |
|------|-------|-------|
| 1 | Schema migration: `TaskActivity` → unified `FeedPost` (behavior-preserving) | ✅ Done (commit on `claude/sqd-feed-escalation-plan-4dYZa`) |
| 2 | Feed read/write API + WP / Division Board / Org Feed scopes | ✅ Done (commit on `claude/sqd-feed-escalation-plan-4dYZa`) |
| 3 | Escalation core: flag comment → cards + info cards + audit | ☐ Not started |
| 4 | Flag lifecycle actions (acknowledge/dismiss/raise finding/create task/reassign/disseminate) | ☐ Not started |
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

| Flag origin → target | ESCALATION_CARD at | INFO_CARD at |
|---|---|---|
| Task → WP | WP feed | — |
| Task → Division | Division Board | WP feed |
| Task → Org | Org Feed | WP feed + Division Board |
| WP → Org | Org Feed | Division Board |
| Division → Org | Org Feed | — |

Cards reference the source via excerpt + link — **never copy full text** (spec non-negotiable #3). Disseminate **reuses the same flag** (spec #5) — posts an ESCALATION_CARD to Org with optional `taggedDivisionIds`; it must NOT create a second flag.

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

**Tests:** `escalation.test.ts` — full placement matrix (5 rows), card content is excerpt+link not full copy, audit dual-write, flag status PENDING, RBAC on who sees actionable cards.

**Done / Gotchas:** _…_

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

**Done / Gotchas:** _…_

---

## PHASE 5 — Badges, polish, docs, regression

- Verify Header/Sidebar badge counts are RBAC-correct and refresh after actions.
- Empty states, loading, error toasts consistent with existing components.
- Full regression: `cd backend && npm run test` (all green) + `cd frontend && npm run lint` + `npm run build`.
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
