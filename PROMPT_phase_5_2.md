# Phase 5.2 — Task Backend Implementation Plan

*SQD-APP · Aviation Maintenance QA · Generated 2026-05-23*

---

## Background

Phase 5.1 (Work Package Backend) is complete. All 51 tests pass. The `Task` and `TaskActivity` models are fully in the database schema (applied in Phase 5.0). The existing `task.routes.ts` is a stub that references handler names not yet implemented. This phase replaces that stub and builds `task.controller.ts` from scratch.

---

## Open Questions — Decision Required Before Implementation

> [!IMPORTANT]
> The following edge cases must be resolved before coding starts. Answers will determine branching logic in the controller. Please respond inline or in your approval message.

### OQ-1 · Task deadline and WP parent closure interaction

**Scenario:** A Task is `In Progress` or `In Review`. Its parent WP is then set to `Inactive` (manually) or expires (`Overdue`). What happens to the Task?

**Proposed default behaviour (confirm or override):**
- WP going `Inactive` does **not** automatically inactivate linked Tasks. Tasks continue independently; only the WP is frozen.
- WP going `Overdue` (time expiry) does **not** change any Task statuses. Tasks remain open; the WP is simply flagged.
- WP being force-closed is **already blocked** if any Task is non-final — so no mid-execution closure is possible.

**Decision needed:** Is this correct, or should WP inactivation cascade a `Inactive` status onto all linked Tasks?

---

### OQ-2 · Deadline extension: who decides?

**From CLAUDE_HANDOVER.md Section C:**
> "Either assignee or issuer can submit a request with a mandatory reason. Reviewer decides: approve (new deadline set) or deny."

**Decision needed:** Who exactly is "Reviewer" in the deadline extension context?
- Option A: Same as Task reviewer — Issuer + Director + Managers of same Division
- Option B: Only Issuer (since it is a bilateral negotiation between issuer and assignee)

---

### OQ-3 · `requiresApproval = false` — grace window

**From CLAUDE_HANDOVER.md:**
> "Task auto-closes on submission. Reviewer still has an optional grace window to intervene before auto-close triggers (configurable grace period — TBD, implement as a system setting)."

**Decision needed:** For Phase 5.2 implementation:
- Option A: Skip the grace window entirely — `requiresApproval = false` tasks close **immediately** on submit. The grace window logic deferred to a future phase.
- Option B: Implement the grace window now as a `SystemSetting` (e.g., `TASK_APPROVAL_GRACE_MINUTES`, default `0` = instant close).

---

### OQ-4 · Issuer rights transfer — scope of transferred rights

**Decision needed:** When Issuer A transfers issuer rights to Person B:
- Does B get **all** issuer rights (review, approve, reject, inactivate, reassign)?
- Or does B only become the "issuer of record" for display purposes, with the original issuer retaining some operational rights?

**Proposed:** Full transfer — B gets all issuer rights, A loses them entirely. Confirm?

---

### OQ-5 · Rating — final states

**From CLAUDE_HANDOVER.md:**
> "Only available once Task is in a final state: `Closed`, `Rejected`, or `Terminated`"

**Decision needed:** Can a Manager rate a Task that is `Rejected` or `Terminated` (i.e., failed/abandoned tasks)? Or is rating only appropriate on `Closed` tasks?

**Proposed:** All three final states are ratable. Confirm?

---

### OQ-6 · Self-serve assignment and WP membership

**From CLAUDE_HANDOVER.md:**
> "A regular user assigned to a WP can create Tasks inside that WP and assign them to any user in the same Division."

**Decision needed:** For the `Unassigned` pool (`GET /api/tasks/unassigned`) and the "PERFORM THIS TASK" self-serve:
- Option A: All Unassigned tasks where `targetDivisionId = user.divisionId` (Division-scoped pool)
- Option B: Only Unassigned tasks where the WP has the user in `WorkPackageAssignment` (WP-member-scoped)
- Option C: All Unassigned tasks system-wide (Director/Admin view)

---

### OQ-7 · One-off Template deletion — hard-delete or archive?

**From CLAUDE_HANDOVER.md:**
> "If `isOneOff = true`, Template is auto-deleted after first Task **assignment** (not just created — assigned)."

**Decision needed:** Should this be a hard-delete from the DB or a status change to `Archived`? The handover says "auto-deleted", which implies hard-delete. Confirm hard-delete?

---

### OQ-8 · `GET /api/tasks` — visibility scope

**Decision needed:** What does the full Task list return by role?
- **Director / Admin:** All tasks system-wide (with `deletedAt: null`)
- **Manager:** Tasks in their Division (issuer or assignee or `targetDivisionId`)
- **Staff / Group Leader:** Only tasks where they are assignee or issuer

---

---

## Proposed Route Table

All routes mount under `/api/tasks` and require `authenticateJWT`.

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| `GET` | `/` | `getTasks` | Role-scoped list (see OQ-8) |
| `GET` | `/my-tasks` | `getMyTasks` | Tasks where user is assignee OR issuer |
| `GET` | `/unassigned` | `getUnassignedTasks` | Pool for self-serve (see OQ-6) |
| `GET` | `/:id` | `getTaskById` | Any authenticated user (with role scope check) |
| `POST` | `/` | `createTask` | Issuer roles only (Manager, Director) |
| `PUT` | `/:id/assign` | `assignTask` | Director (any), Manager (same div), WP-member (same div in WP context) |
| `PUT` | `/:id/self-assign` | `selfAssignTask` | "PERFORM THIS TASK" — any eligible user on Unassigned task |
| `PUT` | `/:id/data` | `saveTaskData` | Assignee only; sets status `In Progress` on first save |
| `PUT` | `/:id/submit` | `submitTask` | Assignee only; moves to `In Review` (or `Closed` if !requiresApproval) |
| `PUT` | `/:id/review` | `reviewTask` | Reviewer: Issuer + Director + Managers of same Division |
| `PUT` | `/:id/post-rejection` | `postRejectionAction` | Terminate or Reassign; same RBAC as review |
| `PUT` | `/:id/reassign` | `reassignTask` | Issuer + Director + Managers of same Division; reason required |
| `PUT` | `/:id/transfer-issuer` | `transferIssuerRights` | Issuer only |
| `PUT` | `/:id/inactive` | `inactivateTask` | Issuer + Admin |
| `PUT` | `/:id/reactivate` | `reactivateTask` | Issuer + Admin |
| `PUT` | `/:id/deadline` | `setDeadline` | Issuer + Director + Manager |
| `PUT` | `/:id/deadline/request` | `requestDeadlineExtension` | Assignee or Issuer; requires reason |
| `PUT` | `/:id/deadline/decide` | `decideDeadlineExtension` | Reviewer (per OQ-2 decision) |
| `PUT` | `/:id/rate` | `rateTask` | Director (Manager assignees) / Manager (same-div assignees); final state only |
| `GET` | `/:id/activity` | `getTaskActivity` | All authenticated users who can see the Task |
| `POST` | `/:id/activity` | `postTaskComment` | Assignee + Issuer + Director + Managers of same Division |

> **Note on Phase 5.3:** The `GET /api/tasks/:id/activity` and `POST /api/tasks/:id/activity` endpoints will be implemented **within `task.controller.ts`** in Phase 5.2. Phase 5.3 effectively becomes a no-op milestone.

> **Note on existing stub:** `task.routes.ts` already exists with the old stub handlers. It will be replaced entirely. It is also **not yet registered** in `index.ts` — that will be added.

---

## Controller Implementation Details

### Task Creation (`POST /api/tasks`)

**Allowed roles:** Manager, Director (Admin as fallback)

**Request body:**
```json
{
  "templateId": 5,
  "targetDivisionId": 2,
  "wpId": 12,
  "assignedToUserId": 8,
  "deadline": "2026-07-01",
  "estimatedHours": 4.0
}
```

**Logic:**
1. Fetch Template — must exist, `status = Published`, `deletedAt = null`
2. Validate `assignedToUserId` if provided (Director = any; Manager = same div)
3. Validate `wpId` if provided — WP must not be `Closed`
4. Generate `taskId` in `$transaction` using sequential pattern: `[DivisionCode]-[000001]`
5. `schemaSnapshot = template.formSchema` (captured once, never changes)
6. Inherit `estimatedHours` from Template if not overridden
7. `status = assignedToUserId ? 'Assigned' : 'Unassigned'`
8. Create Task, log AuditLog + TaskActivity SYSTEM_EVENT
9. If `template.isOneOff` AND assignee was set: delete/archive Template (per OQ-7)

---

### Status Transition Matrix

| Current Status | Endpoint | Action | New Status | RBAC |
|---|---|---|---|---|
| `Unassigned` | `/assign` | Explicit assignment | `Assigned` | Director / Manager (same div) / WP-member |
| `Unassigned` | `/self-assign` | "PERFORM THIS TASK" | `Assigned` | Any eligible (per OQ-6) |
| `Assigned` | `/data` (first save) | Save progress | `In Progress` | Assignee only |
| `In Progress` | `/data` | Save progress again | `In Progress` (no change) | Assignee only |
| `Assigned` / `In Progress` | `/submit` | Submit | `In Review` OR `Closed` (!requiresApproval) | Assignee only |
| `In Review` | `/review` | Approve | `Closed` | Reviewer |
| `In Review` | `/review` | Reject | `Rejected` | Reviewer |
| `In Review` | `/review` | Follow-up | `Follow-up Required` | Reviewer |
| `Follow-up Required` | `/submit` | Resubmit | `In Review` | Assignee only |
| `Rejected` | `/post-rejection` | Terminate | `Terminated` | Reviewer |
| `Rejected` | `/post-rejection` | Reassign | `Assigned` | Reviewer |
| Any non-final | `/inactive` | Inactivate | `Inactive` | Issuer + Admin |
| `Inactive` | `/reactivate` | Reactivate | Previous status | Issuer + Admin |
| Any non-final | `/reassign` | Reassign performer | `Assigned` | Issuer + Director + Manager (same div) |
| Final state | `/rate` | Rate 0–3 | (no status change) | Director/Manager per rules |

> **Overdue is computed, not stored.** When deadline has passed on a non-final, non-Inactive task, `getTaskById` returns `isOverdue: true`. The stored `status` field is unchanged.

---

### `isReviewer()` helper

```typescript
function isReviewer(
  userId: number,
  userRole: string,
  userDivisionId: number,
  task: { issuerId: number; targetDivisionId: number | null }
): boolean {
  if (userId === task.issuerId) return true;
  if (['Director', 'Admin'].includes(userRole)) return true;
  if (userRole === 'Manager' && userDivisionId === task.targetDivisionId) return true;
  return false;
}
```

Used across: `reviewTask`, `postRejectionAction`, `reassignTask`, `rateTask`, `postTaskComment`, `decideDeadlineExtension`.

---

### `logTaskActivity()` helper

```typescript
async function logTaskActivity(
  prismaClient: PrismaClientType,
  taskId: number,
  type: 'SYSTEM_EVENT' | 'COMMENT',
  content: string,
  metadata?: Record<string, unknown>,
  authorId?: number
): Promise<void>
```

- Called **after** the main DB write succeeds
- Never throws — errors logged to console only
- Used by every status-changing endpoint

---

### `schemaSnapshot` rules

- Set once at `createTask` from `template.formSchema`
- **Never updated** — even if Template is republished, archived, or deleted
- Returned in every `getTaskById` response
- This is the source of truth for rendering the Task's form on the frontend

---

### Inactivation — previousStatus storage

```json
// inactivationLog stored on Task:
{
  "reason": "Aircraft unavailable",
  "inactivatedBy": 7,
  "inactivatedAt": "2026-06-10T08:00:00Z",
  "previousStatus": "In Progress"
}
```

`reactivateTask` reads `inactivationLog.previousStatus` and restores it, then sets `inactivationLog = null`.

---

### Rating logic

1. Task must be in `FINAL_TASK_STATUSES` (`Closed`, `Rejected`, `Terminated`)
2. Fetch assignee's **role from DB** (not from requester's JWT)
3. If requester role = `Director` → assignee role must be `Manager`
4. If requester role = `Manager` → assignee must be in same Division as requester
5. If `task.rating !== null` → this is a **revision** — log SYSTEM_EVENT with old and new values
6. Update `task.rating`
7. Write AuditLog (`TASK_RATED`) + TaskActivity SYSTEM_EVENT

---

### Deadline Extension Flow

**Request:** `PUT /api/tasks/:id/deadline/request`
- Body: `{ reason: string, proposedDeadline?: string }`
- Appends to `deadlineExtensions` JSON array:
```json
{
  "requestedBy": 7,
  "reason": "Awaiting parts",
  "proposedDeadline": "2026-07-15",
  "requestedAt": "2026-06-20T10:00:00Z",
  "decision": null,
  "decidedAt": null
}
```

**Decide:** `PUT /api/tasks/:id/deadline/decide`
- Body: `{ extensionIndex: number, decision: 'approve' | 'deny', newDeadline?: string }`
- Updates the entry at `extensionIndex`
- If approved: sets `task.deadline = newDeadline || proposedDeadline`
- Logs SYSTEM_EVENT for both request and decision

---

### One-off Template handling

In `createTask` (if assignee provided at creation time):
```typescript
if (template.isOneOff && assignedToUserId) {
  await tx.template.delete({ where: { id: templateId } }); // OQ-7: hard-delete
}
```

In `assignTask` / `selfAssignTask` (if Task was created Unassigned first):
```typescript
const template = await prisma.template.findUnique({ where: { id: task.templateId } });
if (template?.isOneOff) {
  await prisma.template.delete({ where: { id: task.templateId } });
}
```

---

## Files to Create / Modify

### [MODIFY] [task.routes.ts](file:///c:/SQD-APP/backend/src/routes/task.routes.ts)
Replace stub with full 21-route table importing all handler names from `task.controller.ts`.

### [NEW] [task.controller.ts](file:///c:/SQD-APP/backend/src/controllers/task.controller.ts)
Full implementation — all handlers + internal helpers.

### [MODIFY] [index.ts](file:///c:/SQD-APP/backend/src/index.ts)
Add: `import taskRoutes from './routes/task.routes'; app.use('/api/tasks', taskRoutes);`

### [NEW] [task.test.ts](file:///c:/SQD-APP/backend/src/__tests__/task.test.ts)
~73 integration tests covering all groups below.

---

## `task.test.ts` — Test Suite Design

### Setup (mirrors `wp.test.ts` pattern)

```typescript
// beforeAll:
//   - Roles: Director, Admin, Manager, Staff (+ Manager2 in second division)
//   - Divisions: TSK (primary), TSK2 (secondary)
//   - Users: director, admin, manager, staff, manager2
//   - Seed a Published Template (formSchema with 1 radio field)
//
// beforeEach: deleteMany Tasks, TaskActivity, AuditLog
// afterAll: cleanup users, disconnect
```

### Test Group 1 — Task Creation (~11 tests)

| # | Test | Expected |
|---|------|---------|
| T01 | Manager creates Task without assignee | 201, status=Unassigned, taskId=/^TSK-\d{6}$/ |
| T02 | Manager creates Task with assignee | 201, status=Assigned |
| T03 | Director creates Task with cross-div assignee | 201 |
| T04 | Staff attempts create | 403 |
| T05 | Create from Archived template | 400 |
| T06 | Create from non-existent template | 404 |
| T07 | Create linked to Closed WP | 400 |
| T08 | isOneOff Template deleted after assignment | Template 404 post-creation |
| T09 | schemaSnapshot equals template.formSchema at creation | Deep equality |
| T10 | estimatedHours inherited from Template | task.estimatedHours = template.estimatedHours |
| T11 | SYSTEM_EVENT logged on create | activity[0].type = SYSTEM_EVENT |

### Test Group 2 — Assignment (~9 tests)

| # | Test | Expected |
|---|------|---------|
| T12 | Manager assigns Unassigned task to same-div user | 200, status=Assigned |
| T13 | Manager assigns cross-div user | 403 |
| T14 | Director assigns cross-div user | 200 |
| T15 | Self-assign on Unassigned task | 200, assignedToUserId=requester |
| T16 | Self-assign on Assigned task | 400 |
| T17 | Reassign at InProgress with reason | 200, status=Assigned, TaskData preserved |
| T18 | Reassign without reason | 400 |
| T19 | Reassign on Closed task | 400 |
| T20 | SYSTEM_EVENT logged on assignment | activity contains event |

### Test Group 3 — TaskData Save (~4 tests)

| # | Test | Expected |
|---|------|---------|
| T21 | Assignee first save | 200, status→In Progress |
| T22 | Assignee second save | 200, status stays In Progress |
| T23 | Non-assignee save | 403 |
| T24 | SYSTEM_EVENT logged on first save | activity contains In Progress event |

### Test Group 4 — Submission (~4 tests)

| # | Test | Expected |
|---|------|---------|
| T25 | Assignee submits (requiresApproval=true) | 200, status→In Review |
| T26 | Assignee submits (requiresApproval=false) | 200, status→Closed |
| T27 | Non-assignee submits | 403 |
| T28 | SYSTEM_EVENT logged | activity contains event |

### Test Group 5 — Review (~8 tests)

| # | Test | Expected |
|---|------|---------|
| T29 | Reviewer approves | 200, status→Closed |
| T30 | Reviewer rejects | 200, status→Rejected |
| T31 | Reviewer requests follow-up | 200, status→Follow-up Required |
| T32 | Assignee resubmits | 200, status→In Review |
| T33 | Staff (non-reviewer) reviews | 403 |
| T34 | Manager from different division reviews | 403 |
| T35 | Manager from same division reviews | 200 |
| T36 | SYSTEM_EVENT logged on every review action | activity entries present |

### Test Group 6 — Post-Rejection (~4 tests)

| # | Test | Expected |
|---|------|---------|
| T37 | Terminate Rejected task | 200, status→Terminated |
| T38 | Reassign Rejected task | 200, status→Assigned |
| T39 | Post-rejection on non-Rejected task | 400 |
| T40 | SYSTEM_EVENT logged | activity entries present |

### Test Group 7 — Inactivation & Reactivation (~6 tests)

| # | Test | Expected |
|---|------|---------|
| T41 | Issuer inactivates with reason | 200, status→Inactive, inactivationLog set |
| T42 | Inactivate without reason | 400 |
| T43 | Staff (non-issuer) inactivates | 403 |
| T44 | Issuer reactivates → status restored | 200, previousStatus restored |
| T45 | Reactivate non-Inactive task | 400 |
| T46 | SYSTEM_EVENT logged for both | activity entries present |

### Test Group 8 — Deadline (~6 tests)

| # | Test | Expected |
|---|------|---------|
| T47 | Issuer sets initial deadline | 200, task.deadline set |
| T48 | Assignee requests extension with reason | 200, deadlineExtensions updated |
| T49 | Extension request without reason | 400 |
| T50 | Reviewer approves extension | 200, task.deadline updated |
| T51 | Reviewer denies extension | 200, task.deadline unchanged |
| T52 | SYSTEM_EVENT logged for request + decision | activity entries present |

### Test Group 9 — Issuer Transfer (~5 tests)

| # | Test | Expected |
|---|------|---------|
| T53 | Issuer transfers to another user | 200, task.issuerId updated |
| T54 | Non-issuer transfers | 403 |
| T55 | Original issuer loses review rights | 403 on review attempt |
| T56 | New issuer gains review rights | 200 on review |
| T57 | SYSTEM_EVENT logged | activity present |

### Test Group 10 — Rating (~6 tests)

| # | Test | Expected |
|---|------|---------|
| T58 | Manager rates Closed task with same-div Staff assignee | 200, rating set |
| T59 | Director rates Closed task with Manager assignee | 200, rating set |
| T60 | Manager rates task with Director assignee | 403 |
| T61 | Rate before final state | 400 |
| T62 | Director re-rates — SYSTEM_EVENT logs old+new | revision logged |
| T63 | Rating = 4 (out of range) | 400 |

### Test Group 11 — TaskActivity Feed (~6 tests)

| # | Test | Expected |
|---|------|---------|
| T64 | GET activity returns ordered feed | 200, array ASC order |
| T65 | Issuer posts comment | 201, type=COMMENT |
| T66 | Assignee posts comment | 201 |
| T67 | Same-div Manager posts comment | 201 |
| T68 | Staff (non-participant) posts comment | 403 |
| T69 | No edit/delete endpoints for comments | 404/405 |

### Test Group 12 — Soft Delete & Lists (~4 tests)

| # | Test | Expected |
|---|------|---------|
| T70 | Soft-deleted task not in GET /api/tasks | Not in list |
| T71 | GET /:id on soft-deleted task | 404 |
| T72 | GET /my-tasks returns only user's tasks | Correct subset |
| T73 | GET /unassigned returns only Unassigned | All status=Unassigned |

**Total: ~73 tests**

---

## RBAC Summary

| Action | Director | Admin | Manager (same div) | Manager (other div) | Issuer | Assignee | Staff |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Create Task | ✅ | ✅ | ✅ | ✅ | — | — | ❌ |
| Assign Task | ✅ (any) | ✅ | ✅ (same) | ❌ | — | — | ❌ |
| Self-Assign | ✅ | ✅ | ✅ | ✅ | — | — | ✅ (OQ-6) |
| Save TaskData | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Submit Task | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Review | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Post-Rejection | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Reassign Performer | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Transfer Issuer | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Inactivate | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Reactivate | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Set Deadline | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Request Extension | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Decide Extension | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Rate (Manager assignee) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Rate (same-div assignee) | — | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Post Comment | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |

---

## AuditLog Action Types

| actionType | Trigger |
|---|---|
| `TASK_CREATED` | Task created |
| `TASK_ASSIGNED` | Explicit assignment |
| `TASK_SELF_ASSIGNED` | Self-serve |
| `TASK_IN_PROGRESS` | First data save |
| `TASK_SUBMITTED` | Assignee submits |
| `TASK_APPROVED` | Reviewer approves |
| `TASK_REJECTED` | Reviewer rejects |
| `TASK_FOLLOW_UP_REQUESTED` | Follow-up requested |
| `TASK_RESUBMITTED` | Assignee resubmits |
| `TASK_TERMINATED` | Post-rejection Terminate |
| `TASK_REASSIGNED` | Performer reassigned |
| `TASK_ISSUER_TRANSFERRED` | Issuer rights transferred |
| `TASK_INACTIVATED` | Task inactivated |
| `TASK_REACTIVATED` | Task reactivated |
| `TASK_DEADLINE_SET` | Deadline set |
| `TASK_DEADLINE_EXTENSION_REQUESTED` | Extension requested |
| `TASK_DEADLINE_EXTENSION_APPROVED` | Extension approved |
| `TASK_DEADLINE_EXTENSION_DENIED` | Extension denied |
| `TASK_RATED` | Task rated or re-rated |

---

## Verification Plan

### Automated Tests
```bash
cd backend && npm run test
```
- All existing 51 tests must continue passing
- All ~73 new task tests must pass
- Total ≥ 124 passing tests

### Manual Spot-Checks
1. `POST /api/tasks` creates `taskId` matching `[DivCode]-[000001]` pattern
2. Every status change produces a SYSTEM_EVENT in TaskActivity
3. Rating blocked on non-final tasks
4. `schemaSnapshot` in response matches Template.formSchema at creation time (not current state)
5. `task.routes.ts` registered and reachable at `/api/tasks`

---

*Plan authored for review — 2026-05-23. Do not begin implementation until Open Questions are answered and plan is approved.*
