# Time Booking — Developer Onboarding Guide

> **Who this is for:** a developer picking up the Time Booking feature for the first time.
> **What it covers:** architecture, data models, every file created or modified, the RBAC design, three-layer enforcement, analytics endpoint design, non-obvious gotchas, and how to run tests.
> **Companion docs:** `CLAUDE_HANDOVER.md` OBJECT E (Time Booking) and Time Booking Enhancement section, `BUSINESS_WORKFLOW.md` §3, `TIME_BOOKING_USER_GUIDE.md` (end-user perspective).

---

## 1. The big idea (one paragraph)

Time Booking is an **append-only audit record** attached to a Task after it reaches a final state. The assignee submits hours; the system enforces that a booking exists before allowing a star rating. The enhancement layer (added in 2026-06) extends the original Phase 5.6 model with: per-submission `TimeEntry` records (immutable history), over-budget reason tracking, a budget-vs-actual efficiency badge on the task UI, and a management analytics endpoint that aggregates template efficiency and staff performance across all completed tasks. One design principle runs through everything: *writes are append-only; RBAC is pushed to the DB `WHERE` clause; aggregation happens in JavaScript, not SQL.*

---

## 2. Architecture at a glance

```
                      ┌───────────────────────────────────────────────────┐
  Browser (Next.js)   │  tasks/[id]/page.tsx
                      │    └── TimeBookingPanel.tsx   (submit, edit, view)
                      │                               (efficiency badge)
                      │  dashboard/analytics/page.tsx
                      │    ├── Template Efficiency table
                      │    └── Staff Performance table
                      └──────────────┬────────────────────────────────────┘
                      api/taskApi.ts  (axios → /api/tasks/:id/time-booking)
                      api/taskApi.ts  (axios → /api/analytics/time-booking)
  ────────────────────────────────────┼───────────────────────────────────
  Backend (Express 5) routes/task.routes.ts         (time booking endpoints)
                      routes/analytics.routes.ts    (analytics endpoint)
                      controllers/timebooking.controller.ts
                      controllers/analytics.controller.ts
  ────────────────────────────────────┼───────────────────────────────────
  PostgreSQL (Prisma)  Task · TimeBooking · TimeEntry · AuditLog · TaskActivity
```

---

## 3. Data models

> Canonical version: `backend/prisma/schema.prisma`. Below covers Time Booking models only.

### `TimeBooking` (1:1 with Task)

| Field | Type | Notes |
|---|---|---|
| `id` | Int | PK |
| `taskId` | Int @unique | FK → Task |
| `assigneeEntry` | Json | `{ userId, hoursLogged, notes }` |
| `collaborators` | Json | Array of `{ userId, hoursLogged, notes }` |
| `totalHours` | Float | Computed sum of all entries on creation/update |
| `estimatedHours` | Float? | Snapshot of `Task.estimatedHours` at booking creation time |
| `overBudgetReason` | String? | `COMPLEX_TASK \| WAIT_TIME \| ADDITIONAL_WORK \| OTHER` |
| `overBudgetNote` | String? | Required when `overBudgetReason = 'OTHER'` |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | @updatedAt |

### `TimeEntry` (N:1 with TimeBooking — append-only)

| Field | Type | Notes |
|---|---|---|
| `id` | Int | PK |
| `timeBookingId` | Int | FK → TimeBooking |
| `taskId` | Int | FK → Task (denormalised) |
| `userId` | Int | User who submitted this entry |
| `hoursLogged` | Float | Assignee's hours for this submission |
| `notes` | String? | Optional notes |
| `collaboratorEntries` | Json | JSONB `[{ userId, hoursLogged, notes }]` |
| `createdAt` | DateTime | **No `updatedAt`** — immutable after insertion |

> `TimeEntry` has no `updatedAt` and must never be mutated. If a submission needs correction, a new entry is appended and the discrepancy is noted in `notes`. This is an intentional compliance design.

---

## 4. Backend endpoints

### 4.1 `POST /api/tasks/:id/time-booking`

Controller: `createTimeEntry` in `timebooking.controller.ts`

Key validation steps (in order):

1. Soft-delete guard: `where: { id, deletedAt: null }` on task lookup
2. Task must be in a final state (`Closed`, `Rejected`, `Terminated`)
3. Caller must be the task assignee
4. `hoursLogged` must be `> 0`
5. Assignee must not appear in `collaboratorEntries`
6. No duplicate `userId` within `collaboratorEntries`
7. All collaborator `userId` values must exist in the `User` table (DB check, not in-memory)
8. `overBudgetReason` must be a valid enum value (unconditional — rejected even when task is not over budget)
9. `overBudgetReason = 'OTHER'` requires non-empty `overBudgetNote`
10. If `totalHours > estimatedHours × 1.2` and no `overBudgetReason` provided → 400

On success:
- Creates or updates `TimeBooking` (upsert by `taskId`)
- Appends one `TimeEntry` record
- Dual-writes: `AuditLog` (`TIME_BOOKING_CREATE` / `TIME_BOOKING_UPDATE`) + `TaskActivity` (`SYSTEM_EVENT`)

### 4.2 `GET /api/analytics/time-booking`

Controller: `getTimeBookingAnalytics` in `analytics.controller.ts`

Query parameters: `templateId`, `divisionId`, `from`, `to` (all optional)

RBAC:
- Only `Manager`, `Director`, `Admin` may call this endpoint (403 otherwise)
- `Manager`: `targetDivisionId` forced to their own division ID — pushed to DB `WHERE`, not post-fetch
- `Director` / `Admin`: `targetDivisionId = divisionFilter ?? undefined` (optional narrowing)

Two-query pattern:
1. **`incompleteBookings`** — `prisma.task.count()` with `{ status: 'Closed', timeBooking: null }` applied BEFORE any `templateId` filter. This is a division-wide compliance metric; narrowing it by templateId would silently corrupt the count.
2. **Main tasks query** — `prisma.task.findMany()` with `status: { in: FINAL_TASK_STATUSES }` plus optional templateId + date filters.

`select` not `include`: only the exact fields needed are fetched. This avoids pulling `schemaSnapshot` (large JSON), `deadlineExtensions`, `inactivationLog`, and other heavy columns for every row.

Single-pass aggregation:
- One `for` loop builds both `templateMap` and `staffMap`
- `templateMap` key: `templateId`; `staffMap` key: `userId`
- `estimatedHours` in template rows = `t.template.estimatedHours` (canonical live template value — not an average of booking-time snapshots)
- Over-budget guard: `tb.estimatedHours !== null && tb.estimatedHours > 0` (consistent for both template and staff aggregation)

---

## 5. Frontend components and pages

### `TimeBookingPanel.tsx` (`frontend/src/components/tasks/TimeBookingPanel.tsx`)

Renders in three modes:
- **Empty state** — form to submit initial booking
- **Read-only summary** — shows actual, estimated, badge, collaborator list, edit button
- **Edit mode** — pre-populated form

Over-budget UI:
- A reason dropdown appears dynamically when `totalHours > estimatedHours × 1.2`
- `OTHER` reveals a free-text notes field

### `TaskActionBar.tsx` — efficiency badge

Above the star-rating widget, when `task.timeBooking` exists and `task.timeBooking.estimatedHours != null`:

```tsx
// Shows: "Actual: 5.0h  vs  Estimated: 4.0h  [+1.0h over]" or "[−0.5h under]"
```

The badge colour (green/red) is driven purely by whether `totalHours > estimatedHours`. It does not use the 1.2× threshold — that threshold applies only to the mandatory-reason gate.

### `analytics/page.tsx` (`frontend/src/app/dashboard/analytics/page.tsx`)

- Calls `getTimeBookingAnalytics()` from `taskApi.ts` on mount
- 403 response shows a permission error (non-management roles)
- Tables sorted client-side: templates by efficiency ratio desc (nulls last); staff by avgRating desc (nulls last)
- `EfficiencyBadge` component: green ≤ 1.0×, red > 1.0×

### `taskApi.ts` types

```typescript
export interface TemplateEfficiencyRow {
  templateId: number;
  templateCode: string;
  title: string;
  taskCount: number;
  avgActualHours: number | null;
  estimatedHours: number | null;   // canonical template value — NOT avgEstimatedHours
  efficiencyRatio: number | null;
  overBudgetCount: number;
  topOverBudgetReason: string | null;
}

export interface StaffPerformanceRow {
  userId: number;
  name: string;
  avgRating: number | null;
  ratedTaskCount: number;
  avgEfficiencyRatio: number | null;
}

export interface TimeBookingAnalytics {
  templates: TemplateEfficiencyRow[];
  staff: StaffPerformanceRow[];
  incompleteBookings: number;
}
```

---

## 6. Three-layer booking completeness enforcement

The system enforces time booking at three distinct points so no final-state task is left unbooked before being rated:

| Layer | Where | What it does |
|---|---|---|
| **API gate** | `task.controller.ts` → `rateTask` | Returns 400 if `task.timeBooking` is null |
| **UI banner** | `tasks/[id]/page.tsx` or `TimeBookingPanel.tsx` | Amber warning shown on final-state tasks with no booking |
| **Analytics** | `analytics.controller.ts` → `incompleteBookings` | Reports count of Closed tasks missing a booking division-wide |

The three layers are intentionally redundant. The API gate is the hard enforcement; the UI banner is a proactive nudge; the analytics count gives managers visibility into compliance gaps.

---

## 7. DB indexes added to `Task` model

Four indexes were added to `backend/prisma/schema.prisma` to support analytics queries at scale:

```prisma
@@index([status, deletedAt])
@@index([targetDivisionId, status, deletedAt])
@@index([templateId, status, deletedAt])
@@index([completedAt])
```

These cover the two hot queries in `analytics.controller.ts`: the `incompleteBookings` count (`status = 'Closed'`, `deletedAt = null`) and the main task fetch (`status IN (...)`, optional `targetDivisionId`, optional `templateId`, optional `completedAt` range).

> **Important:** `npx prisma db push` must be run against both `sqd_qa_db` and `sqd_qa_test_db` on first deployment of this branch. The `prisma generate` step can run without a live DB (it regenerates the client from the schema file alone).

---

## 8. RBAC summary

| Endpoint | Who can call | Scope |
|---|---|---|
| `POST /api/tasks/:id/time-booking` | Task assignee only | Own task |
| `PUT /api/tasks/:id/time-booking` | Assignee + Admin + Director | Own task / any task |
| `GET /api/analytics/time-booking` | Manager + Director + Admin | Manager: own division; Director/Admin: system-wide |

No post-fetch JS filtering. RBAC is pushed into the Prisma `where` clause via `targetDivisionId`. Never add a filter loop after `findMany` — it will silently fail if the dataset is later paginated.

---

## 9. Files created or modified

### Backend

| File | Change |
|---|---|
| `controllers/timebooking.controller.ts` | `createTimeEntry`: added duplicate-userId guard, DB existence check for collaborators, unconditional `overBudgetReason` enum validation, `overBudgetNote` required for `OTHER` |
| `controllers/analytics.controller.ts` | New file — `getTimeBookingAnalytics` function |
| `routes/analytics.routes.ts` | New file — registers `GET /time-booking` with JWT middleware |
| `index.ts` | Mounted `analyticsRoutes` at `/api/analytics` |
| `prisma/schema.prisma` | Added `overBudgetReason`/`overBudgetNote` to `TimeBooking`; added `TimeEntry` model; added four `@@index` to `Task` |

### Frontend

| File | Change |
|---|---|
| `components/tasks/TaskActionBar.tsx` | Added `formatHours` helper; added efficiency ratio display above the star-rating widget |
| `components/tasks/TimeBookingPanel.tsx` | Over-budget reason dropdown + `overBudgetNote` field; collaborator form updates |
| `app/dashboard/analytics/page.tsx` | New file — full analytics page |
| `api/taskApi.ts` | Added `TemplateEfficiencyRow`, `StaffPerformanceRow`, `TimeBookingAnalytics` types; added `getTimeBookingAnalytics` function |
| `components/layout/Sidebar.tsx` | Added `BarChart2` icon import; added Analytics nav item for Manager/Director/Admin |

---

## 10. Gotchas

1. **`incompleteBookings` must use a separate query, not a sub-filter.** The count in `analytics.controller.ts` runs as a standalone `prisma.task.count()` *before* the `templateId` filter is applied. If you merge the queries, the count will be silently wrong whenever a `?templateId` param is supplied.

2. **`estimatedHours` in analytics is the canonical template value, not a snapshot average.** The `templates[n].estimatedHours` field in the API response comes from `t.template.estimatedHours` — the live `Template` record. Using the average of `TimeBooking.estimatedHours` snapshots would mix vintages (some tasks booked against an old estimate, others against a new one).

3. **`TimeEntry` is append-only — never write an update endpoint for it.** If data is wrong, append a corrective entry and note the discrepancy. An `updatedAt` field does not exist on the model by design.

4. **Over-budget validation is unconditional.** The `overBudgetReason` enum check in `createTimeEntry` fires for all submissions, even those under budget. This prevents clients from silently submitting garbage reason codes on non-over-budget tasks that might later become over budget after a booking edit.

5. **Manager RBAC is enforced in the DB `WHERE`, not post-fetch JS.** `targetDivisionId` is injected into the Prisma `where` clause. Do not add a post-fetch filter loop — it will silently expose data if the underlying query is paginated or if a future refactor changes the fetch strategy.

6. **`select` not `include` on the analytics query.** The task model has `schemaSnapshot`, `deadlineExtensions`, and `inactivationLog` as large JSON columns. Always use `select` when fetching tasks for aggregation — `include` will pull the full row including those columns for every task in the result set.

7. **The 1.2× threshold applies only to the mandatory-reason gate.** The efficiency badge in `TaskActionBar.tsx` uses a simple `totalHours > estimatedHours` comparison (any overage is red). The over-budget reason requirement uses `totalHours > estimatedHours × 1.2`. Keep these thresholds separate.

---

## 11. Running tests

No dedicated `timebooking.test.ts` suite exists yet. The feature is covered by integration through the existing task tests. Before adding tests:

```cmd
cd backend
npm run test:setup
npm run test
```

All 187 existing tests must pass before and after any change to the time booking or analytics code.

When writing new time-booking tests, follow the same isolation pattern as `task.test.ts`: wipe relevant rows in `beforeEach`, create fixtures inline, never share state between tests.
