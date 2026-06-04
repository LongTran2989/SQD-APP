# Feed & Escalation — Developer Onboarding Guide

> **Who this is for:** a developer picking up the Feed & Escalation feature for the first time.
> **What it covers:** the architecture, the data model, request flows, every file created/modified, naming conventions, the non-obvious gotchas, and how to test.
> **Companion docs:** `FEED_ESCALATION_PLAN.md` (phase-by-phase build log + decisions), `CLAUDE_HANDOVER.md` OBJECT H (canonical schema), `BUSINESS_WORKFLOW.md` §4a (business rules), `FEED_ESCALATION_USER_GUIDE.md` (end-user), `FEED_ESCALATION_TEST_CHECKLIST.md` (manual QA).

---

## 1. The big idea (one paragraph)

There is **one feed model** — `FeedPost` — that serves **four scopes** (`TASK`, `WP`, `DIVISION`, `ORG`). The old per-task `TaskActivity` table was migrated into it (the task feed is just `FeedPost where scope='TASK'`). On top of feeds sits an **escalation mechanism**: any user can **flag a comment** to a higher scope, which creates one `EscalationFlag` and places **cards** on the relevant feeds. Managers/Directors **action** a flag by reusing the existing Finding/Task workflows. Everything dual-writes to `AuditLog` for compliance.

Two principles drove every design decision:
1. **One model, one helper, one rule** — avoid per-scope special-casing (see the placement matrix, §4).
2. **Reuse, never re-implement** — escalation actions call the *same* `createFinding`/`createTask`/`reassignTask` cores the rest of the app uses.

---

## 2. Architecture at a glance

```
                          ┌─────────────────────────────────────────┐
   Browser (Next.js 15)   │  FeedPanel ─ FeedPostItem ─ ┬ EscalationCard ─ EscalationActions
                          │                             ├ InfoCard          └ EscalationActionModal
                          │                             ├ FlagButton
                          │  Header(bell) · Sidebar · /dashboard/{escalations,division-board,org-feed}
                          └──────────────┬──────────────────────────┘
                          api/feedApi · api/escalationApi · api/templateApi
                                         │  (axios → http://localhost:5000/api)
   ──────────────────────────────────────┼──────────────────────────────────────
                                         │
   Backend (Express 5)   routes/feed.routes · routes/escalation.routes
                          controllers/feed.controller · controllers/escalation.controller
                          services/feedService (createFeedPost, RBAC) · services/escalationService (placement, canActionFlag)
                          reuses: task.controller(createTaskService, reassignTaskService) · finding.controller(createFindingService)
                                         │
   ──────────────────────────────────────┼──────────────────────────────────────
   PostgreSQL (Prisma v7) FeedPost · EscalationFlag · AuditLog   (+ existing Task/Finding/WorkPackage/User)
```

---

## 3. Data model

> Canonical version lives in `CLAUDE_HANDOVER.md` OBJECT H and `backend/prisma/schema.prisma`. Summary here.

### `FeedPost`
The single feed row. `scopeId` is **polymorphic — there is no foreign key on it**; a feed is located by the pair `(scope, scopeId)`.

- `type`: `COMMENT | SYSTEM_EVENT | ESCALATION_CARD | INFO_CARD`
- `scope`: `TASK | WP | DIVISION | ORG`; `scopeId`: taskId / wpId / divisionId, **NULL for the singleton ORG feed**
- `authorId`: NULL for system events & auto-generated cards
- `content`, `metadata`
- Escalation linkage: `sourcePostId` (the flagged comment, self-relation), `sourceExcerpt` (≤160 chars + `…`, **never the full text**), `sourceTaskId`/`sourceWpId` (denormalised deep-links, no FK), `flagId` (FK → `EscalationFlag`), `taggedDivisionIds` (Org-only int array, used by Disseminate)
- Indexes: `(scope, scopeId, createdAt)`, `(flagId)`

### `EscalationFlag`
One flag tracks an escalation through its **entire** lifecycle — there are **no flag chains**. Immutable, never soft-deleted.

- `sourcePostId`, `flaggedByUserId`, `targetScope` (`WP | DIVISION | ORG`)
- `status`: `PENDING` → `ACTIONED | DISMISSED`
- `reviewedByUserId`, `action`, `actionedAt`, `linkedEntityType`/`linkedEntityId` (Finding/Task produced by the action)
- Index: `(targetScope, status)`

---

## 4. The placement matrix (the heart of the feature)

Encoded as **ONE hierarchy rule** in `services/escalationService.ts` → `placeEscalationCards()`, with `SCOPE_LEVEL: TASK(0) < WP(1) < DIVISION(2) < ORG(3)`:

> **An ESCALATION_CARD is posted at the *target* scope; an INFO_CARD is posted at every level *strictly between* origin and target.**

That single rule yields all six valid escalations — no per-case branching:

| Flag origin → target | ESCALATION_CARD at | INFO_CARD at |
|---|---|---|
| Task → WP | WP feed | — |
| WP → Division | Division Board | — |
| Task → Division | Division Board | WP feed |
| WP → Org | Org Feed | Division Board |
| Task → Org | Org Feed | WP feed + Division Board |
| Division → Org | Org Feed | — |

Anything not derivable from the rule — downward/same-level, an Org-comment escalation, or a non-COMMENT source — returns **400**. A `Task→WP` flag on a task with no WP also 400s; `Task→Division/Org` for a WP-less task simply skips the (non-existent) WP info-card.

`resolveEscalationOrigin()` turns the polymorphic source comment into `{ taskId, wpId, divisionId }` (soft-delete aware). `buildExcerpt()` truncates to `EXCERPT_MAX = 160`.

---

## 5. RBAC — one predicate, two call sites

`canActionFlag(user, { targetScope, divisionId })` in `services/escalationService.ts` is the **single authority** for who may action a flag:

```
Director / Admin → any flag
Manager          → all ORG flags + own-division WP/DIVISION flags
Group Leader / Staff → none (they still SEE cards via feed transparency)
```

It's called in **two** places, so the UI and the API can never disagree:
1. The **action endpoint** (`POST /api/escalations/:id/action`) — the enforcement point.
2. **`getFeed`** — computes a per-card `canAction` boolean so the frontend knows whether to render action buttons (a cross-division Manager sees the card but no buttons).

Posting rights are a separate predicate, `canPostToFeed(user, scope, scopeId)` (Task/WP all; Division own-div + Director/Admin any; Org Director/Admin/Manager). **Admin is treated as Director-equivalent** for division bypass throughout.

> The frontend mirrors these rules (`constants/escalationRoles.ts` → `ESCALATION_ACTION_ROLES`, `canPostToFeed` in `feedApi`) purely for UX convenience — the backend always re-checks.

---

## 6. Request flows

### Flagging a comment
`POST /api/feeds/posts/:id/flag { targetScope }` → `escalation.controller.flagPost`:
1. Validate: source is a COMMENT, target > origin, target entity resolvable, `Task→WP` has a WP.
2. Open `prisma.$transaction({ isolationLevel: Serializable })`:
   - **Dedup guard (#21):** `findFirst` an existing PENDING flag for `(sourcePostId, targetScope)` → if found, `throw HttpError(409)`.
   - Create `EscalationFlag(PENDING)`.
   - `placeEscalationCards()` → escalation card at target + info cards at skipped levels.
   - **Dual-write:** `AuditLog('ESCALATION_RAISED')` + a `SYSTEM_EVENT` FeedPost on the **source** feed.
3. `catch`: `isHttpError` → its status; Prisma `P2034` (Serializable abort, the concurrent loser) → **409**; else 500.

### Reading a feed
`GET /api/feeds/:scope/:scopeId?` → `feed.controller.getFeed`:
- Collects `authorIds` + `flagIds`, fires **one `Promise.all`** (authors `findMany` + flag-status `findMany` + the WP-division `findUnique` when a card needs it), then a single `.map` pass to attach `author`, `flagStatus`, and the computed `canAction`. (This was 3 sequential round-trips before Phase 5.)

### Actioning a flag
`POST /api/escalations/:id/action { action, payload }` → `escalation.controller.actionEscalation`:
- Load flag + its card + source post; **400 if not PENDING** (final-state flags aren't re-actionable); `canActionFlag` → 403.
- ONE `$transaction`: do the per-action work → `escalationFlag.update(status/action/reviewedByUserId/actionedAt/linkedEntity…)` → dual-write `AuditLog('ESCALATION_ACTIONED')` + a SYSTEM_EVENT on the **target** feed.
- `RAISE_FINDING`/`CREATE_TASK`/`REASSIGN_TASK` call the extracted service cores (next section); `DISSEMINATE` posts an Org card **reusing the same `flag.id`** (asserted: no second flag row).

---

## 7. "Reuse, never re-implement" — the service-core pattern

The Phase-4 actions had to run inside the escalation transaction *and* share validation with the existing endpoints. So each existing handler was split:

```
createFinding (HTTP handler)  ──>  createFindingService(client, actor, params)   // every write on `client`
createTask    (HTTP handler)  ──>  createTaskService(client, actor, params)      // throws typed HttpError
reassignTask  (HTTP handler)  ──>  reassignTaskService(client, actor, params)
```

- The exported `…Service(client, …)` core runs **every write on the passed `client`** (a Prisma tx), never a module-level prisma — so the escalation controller can pass its own `tx` and get one atomic action.
- They throw `HttpError` (`backend/src/utils/httpError.ts`); the thin HTTP wrappers map it to a response.
- The logging helpers (`logTaskActivity`, `logAuditAndActivity`, …) gained an **optional trailing `client` param** (default = module prisma) so the ~17 existing call sites were untouched.
- **Gotcha:** `createTaskService` does `SELECT … FOR UPDATE` for taskId generation, so it **must** be called inside a `$transaction` (both the HTTP handler and the escalation action do).

---

## 8. File inventory

### Backend — new
| File | Responsibility |
|---|---|
| `services/feedService.ts` | `createFeedPost()` — the **single feed-write entry point** (accepts a PrismaClient or tx). RBAC helpers: `buildFeedPostScope`, `canPostToFeed`, `isFeedScope`, `FEED_SCOPES`. |
| `services/escalationService.ts` | `placeEscalationCards()` (the matrix), `resolveEscalationOrigin()`, `buildExcerpt()`, `canActionFlag()`, `resolveFlagDivision()`. |
| `controllers/feed.controller.ts` | `getFeed`, `postFeedComment`. |
| `controllers/escalation.controller.ts` | `flagPost`, `getEscalations`, `actionEscalation`. |
| `routes/feed.routes.ts` | `/api/feeds/*` (flag route registered **before** the generic `/:scope` routes). |
| `routes/escalation.routes.ts` | `/api/escalations/*`. |
| `utils/httpError.ts` | `HttpError` class + `isHttpError` guard (used by the service cores). |
| `__tests__/feed.test.ts`, `__tests__/escalation.test.ts` | 22 + 29 tests. |

### Backend — modified
| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `FeedPost` + `EscalationFlag`; removed `TaskActivity` + `Task.activities`; added `User.feedPosts`. |
| `controllers/task.controller.ts` | Extracted `createTaskService` / `reassignTaskService`; `logTaskActivity`/`logAuditAndActivity` gained optional `client`. |
| `controllers/finding.controller.ts` + `services/findingService.ts` | Extracted `createFindingService`; dual-write helper routes onto the passed client. |
| `controllers/timebooking.controller.ts`, `services/wpCheckService.ts` | Repointed feed writes through `createFeedPost`. |
| `controllers/wp.controller.ts` | `logWpSystemEvent()` — WP lifecycle SYSTEM_EVENTs. |
| `index.ts` | Registered `/api/feeds` + `/api/escalations`. |
| `__tests__/setup.ts` & existing suites | `prisma.taskActivity.*` → `prisma.feedPost.*` (+ `scope:'TASK'`). |

### Frontend — new
| File | Responsibility |
|---|---|
| `components/feed/FeedPanel.tsx` | Generic self-loading feed (any scope); composer gated by `canPostToFeed`. |
| `components/feed/FeedPostItem.tsx` | Dispatches a post to the right renderer; shows `FlagButton` on comments. |
| `components/feed/EscalationCard.tsx` | Renders an ESCALATION_CARD (status badge from `flagStatus`); shows `EscalationActions` when `canAction`. |
| `components/feed/InfoCard.tsx` | Display-only skipped-level card. |
| `components/feed/FlagButton.tsx` | Target picker; tracks per-target flagged state (✓ + disable; 409 marks done). |
| `components/feed/EscalationActions.tsx` | The 6-action button cluster (shared by the card **and** the escalations page). |
| `components/feed/EscalationActionModal.tsx` | Collects payload for Raise-Finding/Create-Task/Reassign/Disseminate. |
| `api/feedApi.ts` | `getFeed`, `postFeedComment`, `canPostToFeed` mirror. |
| `api/escalationApi.ts` | `flagPost`, `getPendingEscalations`, `actionEscalation`; `ESCALATIONS_CHANGED_EVENT` + broadcast. |
| `api/templateApi.ts` | `getPublishedTemplates()` (dedup of the `/templates` + Published filter). |
| `utils/feedHelpers.ts` | `formatTimestamp`, `sourceHref`, `TARGET_SCOPE_LABEL`. |
| `constants/escalationRoles.ts` | `ESCALATION_ACTION_ROLES` — one home for the Header/page/Sidebar gate. |
| `app/dashboard/escalations/page.tsx` | The pending-queue page. |
| `app/dashboard/division-board/page.tsx`, `app/dashboard/org-feed/page.tsx` | The Division/Org feed pages. |

### Frontend — modified
| File | Change |
|---|---|
| `components/layout/Header.tsx` | Bell: RBAC-gated poll + `escalations:changed` listener + link to `/dashboard/escalations`. |
| `components/layout/Sidebar.tsx` | Added Division Board, Org Feed, Escalations nav items. |
| `components/tasks/TaskActivityFeed.tsx` | Added `FlagButton` to task comments. |
| `types/index.ts` | `FeedPost*`, `EscalationTargetScope`, `EscalationAction`, `EscalationFlagStatus`, `PendingEscalation`, `FeedPostEnriched`. |

---

## 9. Naming & code conventions

- **Scopes** are UPPERCASE string literals (`'TASK' | 'WP' | 'DIVISION' | 'ORG'`) — **no Prisma enums** anywhere in this codebase. Same for `type`, `status`, `action`, `targetScope`.
- **`scopeId` is polymorphic** — never add a foreign key to it. Query feeds by `(scope, scopeId)`; ORG uses `scopeId: null`.
- **Soft delete (Rule 2):** every query on `User`/`Task`/`Finding`/`WorkPackage` includes `where: { deletedAt: null }`. `FeedPost` and `EscalationFlag` are **never** soft-deleted (immutable audit trail).
- **Dual write (Rule 3):** every escalation event writes **both** `AuditLog` **and** a `SYSTEM_EVENT` FeedPost — never one without the other. Plain comments write **no** AuditLog (matches the original task-comment behaviour).
- **`AuditLog.entityId` is a stringified id** (`String(flag.id)`).
- **Service cores** are named `<verb><Noun>Service(client, actor, params)` and always write on `client`.
- **Express 5 routing:** optional `:param?` segments throw under path-to-regexp v8 — use **two explicit routes per verb** (`/:scope/:scopeId` + `/:scope`). Register specific literal routes (`/posts/:id/flag`) **before** generic `/:scope` ones.
- **Frontend effects:** load data with the `getX().then(setState)` + `cancelled`-flag pattern (the `FeedPanel`/Sidebar idiom) — **never** `useEffect(() => { loadX() })`, which trips `react-hooks/set-state-in-effect`. Key effects on `user` (the object), not a derived boolean, so a same-role user switch refetches.
- **Cross-component refresh:** the api wrappers dispatch a `window` `escalations:changed` event on flag/action; the Header listens. Single choke point — components don't have to remember to refresh.
- **Lint discipline:** the repo carries a pre-existing **70 errors / 23 warnings** of lint debt. The bar for any change is **zero new** — diff the count, don't chase the absolute.

---

## 10. Gotchas that will bite you

1. **Run `npx prisma generate` after any schema pull/change (Rule 9).** A stale client makes `prisma.feedPost` `undefined`.
2. **The dev DB needs a `.env`** with `DATABASE_URL` + `JWT_SECRET` + `PORT=5000`. The repo ships only `.env.test`. The container also starts with **Postgres stopped** (`service postgresql start`) and an **empty/absent dev DB** — `prisma db push` + `npx ts-node prisma/seed.ts` to populate.
3. **Login is by `employeeId`, not email** (e.g. Director `VAE00071` / `Abc@123`). Seed users have `forcePasswordChange=true` — clear it in the DB to skip the first-login gate during a smoke test.
4. **Dedup can't be a DB constraint.** A full `@@unique(sourcePostId, targetScope)` would wrongly block re-flagging after DISMISS/ACTIONED, and a *partial* unique index (`WHERE status='PENDING'`) isn't expressible under `prisma db push`. Hence the **Serializable transaction** guard + `P2034 → 409` mapping.
5. **Test DB has no global wipe.** Suites seed with `create` and self-clean in `afterAll` in FK-safe order. Between local runs, `TRUNCATE … RESTART IDENTITY CASCADE` everything except `_prisma_migrations`. **Never** `prisma db push --force-reset` (guardrail blocks it; the config seed then collides with fixtures).
6. **`createTaskService` must be inside a `$transaction`** (its `FOR UPDATE` taskId generation).

---

## 11. How to run & test

```cmd
REM Backend (port 5000)
cd backend && npm run dev

REM Frontend (port 3000)
cd frontend && npm run dev

REM Backend tests — ALWAYS sqd_qa_test_db (Rule 8); 260 must pass
cd backend && npm run test:setup && npm run test
cd backend && npm run test -- escalation.test.ts   REM single suite

REM Frontend gates (no test runner — these are the gates)
cd frontend && npm run lint        REM expect 70/23, zero new
cd frontend && npx tsc --noEmit    REM clean except legacy clean.ts
cd frontend && npm run build        REM exit 0
```

For manual verification, follow `FEED_ESCALATION_TEST_CHECKLIST.md`.

---

## 12. Where to look next

- **Business rules / workflow** → `BUSINESS_WORKFLOW.md` §4a, §6.
- **Canonical schema + RBAC matrix + dedup rationale** → `CLAUDE_HANDOVER.md` OBJECT H.
- **Why each decision was made, phase by phase** → `FEED_ESCALATION_PLAN.md` (the "Done / Gotchas" notes per phase are gold).
- **Deferred / out of scope** → no push/email/websocket notifications (badges only), no threaded replies, no analytics. Privilege rules are hardcoded until the Phase 7 `PrivilegeConfig` wiring.
