# Task Management Module Improvements — Design

Status: Approved (2026-07-01)

## Background

The Task Management module needs a round of UI/UX, backend, and performance
improvements. The original request specified six workstreams (ID sequencing,
async typeahead selects, Task Creation Form overhaul, Quick Task
enhancements, Task List view updates, WP unlinking). Codebase exploration
before design surfaced several places where the original ask didn't match
current reality; those corrections are captured below and were confirmed
with the user before this spec was written.

## Corrections to the original ask (confirmed with user)

1. **Task ID contention is already scoped per-division**, not global —
   `generateTaskId` runs inside a transaction holding `SELECT ... FOR UPDATE`
   on the `Division` row (confirmed sole purpose: "Lock division row to
   prevent concurrent taskId collisions", `task.controller.ts:844`). Moving
   to a `TaskSequence` upsert is still worth doing (atomic via Postgres
   `ON CONFLICT`, no raw SQL lock, simpler to reason about) — but the
   original "heavy lock contention" framing overstated today's problem.
2. **The two new indexes requested are redundant.** `Task` already has
   `@@index([assignedToUserId, status, deletedAt])` and
   `@@index([targetDivisionId, status, deletedAt])`. Postgres B-tree
   indexes support leading-column prefix matches, so `(assignedToUserId,
   status)`-only queries already use these. **Decision: skip the new
   indexes.**
3. **Task Title pre-fill source: `Template.title`, not `description`.**
   Templates have both a short `title` (used everywhere else as the default
   task label) and a free-text `description`. **Decision: seed the new Task
   Title input from `Template.title`.**
4. **No deadline-offset field exists on `Template`.** The original ask
   assumed a template-level deadline offset that isn't in the schema.
   **Decision: drop auto-calculated deadlines from this round.** Deadline
   stays a manual date picker. Revisit as its own feature later if needed.
5. **The WP badge doesn't live in the Task Detail page header.** It's
   rendered inside `TaskDetailPanel.tsx` (left-column child component), not
   `[id]/page.tsx`. **Decision: add the unlink button next to the existing
   WP row in `TaskDetailPanel.tsx`, not the header** — no new UI element,
   matches the existing layout.
6. **Draft auto-save UX:** silently pre-filling a textarea from localStorage
   risks reusing stale instruction text on an unrelated new task, which
   matters in a compliance tool. **Decision: show an explicit "Restore
   draft from [time]? Restore / Discard" banner** instead of silent
   pre-fill.
7. **Quick Task Target Division default:** the backend already defaults
   `targetDivisionId` to the creator's division when omitted.
   **Decision: the new dropdown starts pre-selected to the creator's
   division**, matching existing backend behavior, user can change it if
   they hold cross-division rights.

## Pre-existing capability inventory (do not rebuild)

- `SearchableSelect.tsx` already exposes an `onQueryChange` prop (currently
  unconsumed) — `AsyncSearchableSelect` wraps it rather than replacing it.
- `Task.title` (optional override) already exists in the schema and is
  already accepted by both `createTask` and `createQuickTask` on the
  backend (`task.controller.ts:756, 852, 907, 922, 1036, 1072`). Only the
  frontend forms are missing the input.
- `CreateTaskPayload` (FE type) already supports `estimatedHours`; the
  backend already persists it (`estimatedHours ?? template.estimatedHours`,
  `task.controller.ts:862`). `TaskCreateForm.tsx` simply never collects or
  sends it today.
- `createQuickTask` backend handler already accepts `targetDivisionId` and
  `estimatedHours` in `req.body` (`task.controller.ts:1036`) — only the FE
  `QuickTaskPayload` type and `QuickTaskForm.tsx` UI are missing them.
- `PATCH /tasks/:id/wp` (`updateTaskWp`, `relinkTaskWp` on the frontend) is
  fully implemented and guarded: issuer-or-`task:relink_any` privilege
  check, blocked on `FINAL_TASK_STATUSES`/`Inactive`
  (`task.controller.ts:955-995`). This phase is frontend-only.
- Division-scoped assignee lists (clearing a stale assignee when the target
  division changes) already exist in `TaskCreateForm.tsx` — Quick Task's
  new Assignee field should follow the same pattern for consistency.

## Phase 1 — Backend: Atomic Task ID sequencing

**Files:** `backend/prisma/schema.prisma`, `backend/src/controllers/task.controller.ts`, a one-time backfill script.

1. Add to `schema.prisma`:
   ```prisma
   model TaskSequence {
     divisionCode String @id
     sequence     Int    @default(0)
   }
   ```
   Purely additive — new table, no changes to existing models. Reversible
   via `prisma migrate` rollback (drops the table; existing `Task` rows are
   untouched since `taskId` generation logic lives in application code, not
   a DB trigger).

2. **Backfill (must ship in the same deploy, before the new code path is
   live):** for every distinct division-code prefix found in existing
   `Task.taskId` values, compute the max numeric suffix and
   `upsert` a `TaskSequence` row with that value as `sequence`. Divisions
   with zero existing tasks need no row (first upsert from `generateTaskId`
   will correctly start them at 1). This prevents the new sequence table
   from reissuing already-used IDs (e.g. a division at `QA-000042` must not
   restart at `QA-000001`).

3. Refactor `generateTaskId`:
   ```ts
   async function generateTaskId(divisionCode: string, tx: Prisma.TransactionClient): Promise<string> {
     const seq = await tx.taskSequence.upsert({
       where: { divisionCode },
       create: { divisionCode, sequence: 1 },
       update: { sequence: { increment: 1 } },
     });
     return `${divisionCode}-${String(seq.sequence).padStart(6, '0')}`;
   }
   ```
   Atomicity comes from Postgres's row-level locking on `INSERT ... ON
   CONFLICT DO UPDATE` — concurrent transactions for the same
   `divisionCode` serialize automatically.

4. Remove the now-redundant `await client.$queryRaw\`SELECT id FROM
   "Division" WHERE id = ${targetDivisionId} FOR UPDATE\`` at the call site
   (`task.controller.ts:845`) — confirmed its only purpose was taskId
   collision prevention, which the upsert now handles.

5. **No new indexes** (redundant with existing composites, per decision
   above).

## Phase 2 — Backend: Search-capable datasource endpoints

**Files:** `backend/src/controllers/datasource.controller.ts`.

- Extend the existing `users` and `divisions` cases to accept `?q=<query>`
  (search) and cap results at 20 (`take: 20`), preserving the existing
  `GET /datasources/:source` route shape — no new routes needed for these
  two.
  - Users: search `name` OR `employeeId`, case-insensitive `contains`.
  - Divisions: search `name`, case-insensitive `contains`.
- Add a new `workpackages` case to the same controller (WPs currently come
  from a separate full-table `wpApi.ts` endpoint, not this controller).
  Search `wpId` OR `name`, case-insensitive `contains`, `take: 20`, exclude
  `Closed`/soft-deleted per existing WP conventions used elsewhere.
- All three continue returning `{ value, label, ... }` shape consistent
  with existing datasource entries (e.g. users keep `divisionId` in the
  payload, already relied on by division-scoped assignee filtering).

## Phase 3 — Frontend: `AsyncSearchableSelect`

**Files:** new `frontend/src/components/ui/AsyncSearchableSelect.tsx`.

- Wraps `SearchableSelect`, using its existing `onQueryChange` prop.
- Requires 3+ characters typed before firing a request.
- 300ms debounce on the search callback.
- Loading state (spinner) while a request is in flight.
- Below 3 characters: show a "Type at least 3 characters" hint instead of
  querying.
- Empty result set: show "No results".
- Fetches from the Phase 2 endpoints (`getDatasource('users'|'divisions'|
  'workpackages', { q, limit: 20 })`).

## Phase 4 — Frontend: `TaskCreateForm` overhaul

**Files:** `frontend/src/components/tasks/TaskCreateForm.tsx`, `frontend/src/api/taskApi.ts` (payload type only, already supports the fields).

- Replace the pre-loaded (`Promise.all([getDivisions(), getUsers(),
  getWorkPackages()])`) Division/Assignee/WP `SearchableSelect`s with
  `AsyncSearchableSelect`. Remove the mount-time bulk fetch entirely.
- Add editable **Task Title** text input. On template selection, pre-fill
  from `selectedTemplate.title` (per corrected decision above). Sent as
  `title` in the `createTask` payload (backend already accepts it — no
  backend change needed here).
- Add editable **Estimated Hours** number input. On template selection,
  pre-fill from `selectedTemplate.estimatedHours`. Sent as `estimatedHours`
  in the payload (backend already accepts it — closes an existing gap
  where the form silently dropped this field).
- Deadline stays a manual date picker — no auto-calc (dropped per decision
  above).
- localStorage auto-save for `issuanceNote`:
  - Save on change (debounced), keyed to this form (e.g.
    `taskCreateForm.issuanceNoteDraft`).
  - On mount, if a saved draft exists, show a dismissible banner: "Restore
    draft from [relative time]? [Restore] [Discard]" — do not silently
    fill the field.
  - Clear the stored draft on successful task creation or explicit
    Discard.

## Phase 5 — Frontend + Backend: `QuickTaskForm` enhancements

**Files:** `frontend/src/components/tasks/QuickTaskForm.tsx`, `frontend/src/api/taskApi.ts` (`QuickTaskPayload` type).

- Add **Estimated Hours** (number input).
- Add **Target Division** (`AsyncSearchableSelect`), pre-selected to the
  creator's own division on mount (matches backend default).
- Add **Assignee** (`AsyncSearchableSelect`), division-scoped to the
  selected Target Division, cleared when Target Division changes (same
  pattern as `TaskCreateForm`).
- Update FE `QuickTaskPayload` type to include `targetDivisionId` (backend
  `createQuickTask` already accepts and uses it — this is a frontend type
  gap only, no backend change needed for this field).

## Phase 6 — Task List view

**Files:** `backend/src/controllers/task.controller.ts` (`taskInclude()`), `frontend/src/app/dashboard/tasks/page.tsx`.

- Backend: add `findingId: true` to the `parentFinding` select inside
  `taskInclude()` (currently only selects `{ id: true }`).
- Frontend: row title link becomes `task.title ?? task.template?.title`
  (matches the fallback semantics already established on the `Task.title`
  schema comment), styled with `whitespace-normal break-words` so long
  custom titles wrap instead of truncating.
- Subtitle line below the title, each segment conditionally rendered only
  when present: `WP: [task.wp.wpId] | Finding: [task.parentFinding.findingId]
  | Template: [task.template.title]`.

## Phase 7 — WP Unlink button

**Files:** `frontend/src/components/tasks/TaskDetailPanel.tsx`.

- Add a small "X" icon button next to the existing "Work Package"
  `DetailRow` (`TaskDetailPanel.tsx:126-134`).
- Calls `relinkTaskWp(taskId, null)` (existing, fully guarded backend
  endpoint — no backend change).
- On success: refresh task data in the parent view.
- On error (403 insufficient permission, 400 blocked status): surface the
  backend's error message using this panel's existing error-handling
  convention (confirm exact pattern — e.g. toast vs inline — during
  implementation by checking how nearby actions in this panel/page handle
  errors, and match it).

## Testing

- Backend (Jest/Supertest, `sqd_qa_test_db` only per Rule 8):
  - `TaskSequence` upsert concurrency: parallel task creations in the same
    division produce unique, sequential `taskId`s with no collisions or
    gaps under race conditions.
  - Backfill correctness: seeded `TaskSequence.sequence` matches the max
    existing suffix per division.
  - New datasource search params (`q`, `limit`) for `users`, `divisions`,
    `workpackages`.
  - `createQuickTask` accepting `targetDivisionId` and `estimatedHours`
    end-to-end.
  - `taskInclude()` returns `findingId` on `parentFinding`.
  - `updateTaskWp` regression coverage unaffected (no backend change in
    Phase 7, existing tests should still pass).
- Frontend: no existing frontend test runner was identified during
  exploration. Verification for frontend phases will be manual/browser-
  based (dev server) unless a test runner is confirmed to exist when
  implementation starts.

## Rollout / sequencing

Phases 1–2 (backend) can ship independently. Phase 3 depends on nothing
but is a prerequisite for Phases 4 and 5. Phases 6 and 7 are independent of
everything else and can ship in any order. Recommended build order: 1 → 2
→ 3 → 4 → 5 → 6 → 7, matching the phase numbering above.
