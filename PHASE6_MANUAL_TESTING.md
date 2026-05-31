# Phase 6 — Findings System: Manual Testing Checklist

**Branch:** TEST  
**Date:** 2026-05-31  
**Scope:** Everything added in Phase 6. Do NOT test chat, escalation, triage, or sourceMessageId — those are out of scope.

---

## Prerequisites

- [ ] Backend running on `http://localhost:5000`
- [ ] Frontend running on `http://localhost:3000`
- [ ] Database seeded (`cd backend && npx prisma db seed`)
- [ ] You have accounts for all 5 roles. Suggested set:
  - **Director:** `director@sqd.com` / `password123`
  - **Admin:** `admin@sqd.com` / `password123`
  - **Manager:** a Manager user in a known division
  - **Group Leader:** a Group Leader in the same division
  - **Staff:** a Staff user assigned to at least one task

- [ ] At least one published template with **Allows Findings = true** exists
- [ ] At least one Task in a non-final status (Assigned / In Progress) exists, built from that template
- [ ] Backend tests passing: `cd backend && npm run test` → **187 / 187 green**

---

## 1. Sidebar Badge

### 1.1 Badge Visibility
- [ ] Log in as **Staff**. Navigate to any page. Confirm "Findings" appears in the sidebar nav.
- [ ] Log in as **Group Leader**. Confirm "Findings" nav item is visible.
- [ ] Log in as **Manager**. Confirm "Findings" nav item is visible.
- [ ] Log in as **Director**. Confirm "Findings" nav item is visible.

### 1.2 Badge Count
- [ ] With zero Open or In Progress findings: no amber badge is shown next to "Findings".
- [ ] Raise a finding (see Section 3). Return to sidebar — an amber badge with count **1** appears.
- [ ] Raise a second finding. Badge updates to **2**.
- [ ] Close a finding (status → Closed). Badge count decrements.
- [ ] As **Staff** (limited visibility): badge only counts findings within RBAC scope (own findings or follow-up assignee), not global total.

---

## 2. Findings List Page (`/dashboard/findings`)

### 2.1 Page Load
- [ ] Navigate to `/dashboard/findings` as Director. Page loads with a table of all findings (or empty state).
- [ ] Empty state: a message ("No findings found") is shown when no findings exist.

### 2.2 Columns
Each row should display:
- [ ] Finding ID (`#1`, `#2`, …)
- [ ] Severity badge (Observation / Level 1 / Level 2, or blank if not yet reviewed)
- [ ] Status badge (Open / In Progress / Pending Verification / Closed)
- [ ] Event Type
- [ ] Description (truncated)
- [ ] Reported By
- [ ] Source Task ID (linked, or "—")
- [ ] Due Date (or "—", red if breached)
- [ ] Department

### 2.3 Filters
- [ ] **Status filter** — select "Open"; only Open findings shown.
- [ ] **Status filter** — select "In Progress"; only In Progress findings shown.
- [ ] **Severity filter** — select "Level 1"; only Level 1 findings shown.
- [ ] **Severity filter** + **Status filter** combined — both filters apply together.
- [ ] Clear filters — all findings shown again.
- [ ] **Search** — type part of a description; matching rows shown.

### 2.4 RBAC Scoping
- [ ] **Director / Admin**: sees all findings across all divisions.
- [ ] **Manager**: sees only findings in own division.
- [ ] **Group Leader / Staff**: sees only findings they raised **or** where they are the follow-up task assignee.
- [ ] Log in as Staff who has no findings — empty state shown.

### 2.5 Navigation
- [ ] Click a row → navigates to `/dashboard/findings/:id`.

---

## 3. Raise Finding (from Task Detail Page)

### 3.1 Button Visibility
- [ ] Open a task built from a template where **Allows Findings = true**, status is **In Progress**. Confirm "Raise Finding" button (amber) is visible in the page header.
- [ ] Open a task built from a template where **Allows Findings = false**. Confirm button is **not** shown.
- [ ] Open a task with status **Closed / Terminated / Inactive**. Confirm button is **not** shown even if template allows findings.

### 3.2 Slide-Over Opens & Closes
- [ ] Click "Raise Finding". A slide-over panel appears from the right.
- [ ] Click **Cancel** or the **×** button. Panel closes, no finding created.
- [ ] Click outside the panel (the semi-transparent overlay). Panel closes.

### 3.3 Validation
- [ ] Submit with all fields empty → toast error "Event type is required".
- [ ] Fill Event Type only → toast error "Department is required".
- [ ] Fill Event Type + Department, leave Description empty → toast error "Description is required".

### 3.4 Successful Submission
- [ ] Fill **Event Type**, **Department**, **Description** (optional: Aircraft Registration, Regulatory Reference, Field Reference).
- [ ] Click "Raise Finding". Toast appears: "Finding #N raised".
- [ ] Panel closes.
- [ ] The **Linked Findings** section on the task detail page now shows the new finding (with ID, description, severity badge, status badge).
- [ ] The task's **Activity Feed** shows a new system event: "Finding #N raised".
- [ ] Navigating to `/dashboard/findings` — the new finding appears in the list with status **Open** and no severity yet.

### 3.5 Multiple Findings on Same Task
- [ ] Raise a second finding on the same task. Both appear in the Linked Findings section.
- [ ] Each links to its own `/dashboard/findings/:id` page.

---

## 4. Finding Detail Page (`/dashboard/findings/:id`)

### 4.1 Page Load
- [ ] Click a finding from the list page. Detail page loads at `/dashboard/findings/:id`.
- [ ] Header shows: Finding ID (`#N`), severity badge (or "Not Reviewed"), status badge, event type.
- [ ] "Back to Findings" link works.

### 4.2 Section — Details
- [ ] **Description** displayed correctly.
- [ ] **Event Type** displayed.
- [ ] **Department** displayed.
- [ ] **Aircraft Registration** shown if set, "—" if not.
- [ ] **Regulatory Reference** shown if set, "—" if not.
- [ ] **Field Reference** shown if set, "—" if not.
- [ ] **Reported By** (user name).
- [ ] **Source Task** — shows task ID as a clickable link to the task detail page. Clicking navigates correctly.
- [ ] **Target Division** — shown if set.
- [ ] **Created At** timestamp.

### 4.3 Section — Review (Stage 1)

#### Status: Open (not yet reviewed)
- [ ] As **Director**: Review form visible with Severity dropdown (Observation / Level 1 / Level 2) and Due Date picker.
- [ ] As **Admin**: same.
- [ ] As **Manager**: same.
- [ ] As **Group Leader**: review form is **read-only** (no edit controls visible).
- [ ] As **Staff** (reporter): review form is **read-only**.

#### Submitting a Review
- [ ] As Director: select Severity "Level 2", set a due date 30 days out, click "Submit Review".
- [ ] Toast: "Finding reviewed".
- [ ] Severity badge in header updates to "Level 2".
- [ ] Status badge updates to **In Progress**.
- [ ] Due date displayed in the review section.
- [ ] Review form becomes read-only (already submitted).

#### Validation
- [ ] Submit review with no Severity selected → toast error.
- [ ] Submit review with no Due Date → toast error.

### 4.4 Section — Follow-Up Tasks

#### Before review
- [ ] As Director: "Generate Follow-Up Tasks" button is **not** yet clickable / section shows "Review first" message.

#### After review (Status: In Progress)
- [ ] As Director: "Generate Follow-Up Tasks" button is active.
- [ ] Click button → modal opens.

#### Generate Follow-Up Tasks Modal
- [ ] Modal opens with one blank row (Template, Assignee, Title).
- [ ] Click **+ Add Row** — a second row appears.
- [ ] Click the **trash** icon on a row — row removed (minimum 1 row enforced or row removed freely — confirm actual behavior).
- [ ] Submit with empty template → toast error "Select a template for each task".
- [ ] Fill in valid Template and Title for each row (Assignee optional — tasks created as Unassigned).
- [ ] Click **Generate Tasks**.
- [ ] Toast: "N follow-up task(s) created".
- [ ] Modal closes.
- [ ] Follow-Up Tasks section on the finding detail page now lists the created tasks with task ID, title, status (Unassigned), assignee ("—").
- [ ] Each task ID is a link. Clicking navigates to the task detail page.
- [ ] On the task detail page, the task's `parentFindingId` is set — verify by checking the task metadata panel shows "Linked Finding #N".

#### RBAC for task generation
- [ ] As **Group Leader** / **Staff**: "Generate Follow-Up Tasks" button is **not** shown.

### 4.5 Section — Stage 2 Analysis

#### Before Pending Verification
- [ ] Stage 2 section shows empty fields (Root Cause, Corrective Action, Error Code, Recurrence, Category). Fields are **read-only** or hidden.
- [ ] As Director: an edit button / form is visible once status is In Progress.

#### Editing Stage 2 fields (as Director/Admin/Manager)
- [ ] Click **Edit** (or inline edit if applicable).
- [ ] Fill Root Cause, Corrective Action, select Category, check Recurrence.
- [ ] Click **Save**. Toast: "Stage 2 saved" (or similar).
- [ ] Reload page — fields persist.

#### RBAC
- [ ] As **Staff**: Stage 2 fields are read-only.

### 4.6 Section — Close Finding

#### Preconditions
- [ ] Finding must be in **Pending Verification** status to show the Close button.

#### Closing
- [ ] Status reaches Pending Verification (see Section 5).
- [ ] As Director: "Close Finding" button visible.
- [ ] Click "Close Finding".
- [ ] Confirmation prompt (if any). Confirm.
- [ ] Toast: "Finding closed".
- [ ] Status badge updates to **Closed**.
- [ ] Closed By and Closed At fields appear.
- [ ] Sidebar badge count decrements (Closed findings excluded from badge).

#### RBAC for close
- [ ] As **Manager**: can close.
- [ ] As **Group Leader**: cannot close (button hidden or disabled).
- [ ] As **Staff**: cannot close.

### 4.7 Activity Feed (right panel)
- [ ] Activity feed visible on right side of finding detail page.
- [ ] Shows system events: "Finding #N raised", "Finding reviewed — Level 2, due YYYY-MM-DD", "Follow-up tasks created: TID-xxx", "Finding closed".
- [ ] Events are in chronological order.

---

## 5. Pending Verification Hook (Automated Transition)

This tests the automatic `Open → Pending Verification` trigger that fires when all follow-up tasks reach a final state.

### 5.1 Setup
- [ ] Create a finding (status: Open).
- [ ] Review it (status: In Progress).
- [ ] Generate **2** follow-up tasks.

### 5.2 Single Task — Trigger
- [ ] With only 1 follow-up task: close/complete that task (status → Closed).
- [ ] Navigate back to the finding detail page.
- [ ] Finding status is now **Pending Verification**.

### 5.3 Multiple Tasks — All Must Complete
- [ ] With 2 follow-up tasks: close/complete **1** of them.
- [ ] Finding status remains **In Progress** (not all done).
- [ ] Close/complete the **second** task.
- [ ] Finding status transitions to **Pending Verification**.

### 5.4 Follow-Up Task Rejection
- [ ] Generate 1 follow-up task on a finding.
- [ ] Reject the follow-up task.
- [ ] Finding status transitions to **Pending Verification** (rejection counts as final state).

### 5.5 Follow-Up Task Termination
- [ ] Generate 1 follow-up task.
- [ ] Terminate the follow-up task.
- [ ] Finding status transitions to **Pending Verification**.

### 5.6 Non-Final State Does Not Trigger
- [ ] Follow-up task reaches **In Review** (not yet final).
- [ ] Finding status stays **In Progress**.

### 5.7 Activity Feed After Hook
- [ ] After the trigger fires, the source task's Activity Feed shows: "Finding #N moved to Pending Verification — all follow-up tasks resolved."

---

## 6. RBAC — Role-by-Role Matrix

Work through each combination. Mark ✓ = allowed, ✗ = blocked.

| Action | Director | Admin | Manager | Group Leader | Staff |
|---|---|---|---|---|---|
| View Findings list (own scope) | ✓ | ✓ | ✓ | ✓ | ✓ |
| View Findings list (all) | ✓ | ✓ | ✗ | ✗ | ✗ |
| View Finding detail | ✓ | ✓ | ✓ (division) | ✓ (own) | ✓ (own) |
| Raise Finding (from task) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit Review (set severity/due) | ✓ | ✓ | ✓ | ✗ | ✗ |
| Generate Follow-Up Tasks | ✓ | ✓ | ✓ | ✗ | ✗ |
| Edit Stage 2 fields | ✓ | ✓ | ✓ | ✗ | ✗ |
| Close Finding | ✓ | ✓ | ✓ | ✗ | ✗ |

- [ ] Director: all actions allowed globally — confirmed.
- [ ] Admin: all actions allowed globally — confirmed.
- [ ] Manager: cannot see findings outside own division — confirmed.
- [ ] Group Leader: review/generate/close buttons hidden or return 403 — confirmed.
- [ ] Staff: review/generate/close buttons hidden or return 403 — confirmed.

---

## 7. Edge Cases & Error Handling

### 7.1 Duplicate / Re-submit
- [ ] Try to review a finding that is already In Progress → API returns 400 / toast error "Already reviewed".
- [ ] Try to close a finding that is already Closed → error shown.

### 7.2 Invalid IDs
- [ ] Navigate to `/dashboard/findings/99999` (non-existent ID) → error state shown ("Finding not found").
- [ ] API `GET /api/findings/99999` returns 404.

### 7.3 Missing Required Fields on Raise
- [ ] POST `/api/findings` with missing `eventType` → 400 with descriptive message.
- [ ] POST `/api/findings` with missing `departmentId` → 400.
- [ ] POST `/api/findings` with missing `description` → 400.
- [ ] POST `/api/findings` with missing `taskId` → 400.

### 7.4 Finding on Non-Allowed Template
- [ ] POST `/api/findings` with a `taskId` whose template has `allowsFindings = false` → 400 "This task does not allow findings".

### 7.5 Finding on Final-Status Task
- [ ] POST `/api/findings` with a `taskId` in Closed status → 400 "Cannot raise a finding on a closed or terminated task" (or similar).

### 7.6 Due Date Breach Display
- [ ] Create a finding, review it, set due date to **yesterday**.
- [ ] Finding list page shows the due date in red.
- [ ] Finding detail page shows the due date in red.
- [ ] `dueDateBreached: true` in API response.

### 7.7 Soft Delete Integrity
- [ ] Soft-delete a user who raised a finding — finding still appears with their name (or "Deleted User").
- [ ] Soft-delete a task that is a follow-up task — finding's follow-up task list shows gracefully.

### 7.8 Concurrent Review
- [ ] Open the same finding detail page in two browser tabs.
- [ ] Submit review in Tab 1.
- [ ] Attempt to submit review in Tab 2 → 400 error "Already reviewed" returned; toast shown.

---

## 8. Audit Log Verification

For each action below, verify the `AuditLog` table has a corresponding entry with `entityType = 'Finding'`:

- [ ] Raise finding → `action = 'FINDING_RAISED'` (or equivalent), `entityId = finding.id`.
- [ ] Review finding → `action = 'FINDING_REVIEWED'`, correct `userId`.
- [ ] Generate follow-up tasks → `action = 'FINDING_TASKS_GENERATED'`.
- [ ] Stage 2 update → `action = 'FINDING_STAGE2_UPDATED'`.
- [ ] Close finding → `action = 'FINDING_CLOSED'`.
- [ ] Pending Verification hook → `action = 'FINDING_PENDING_VERIFICATION'`.

SQL to verify:
```sql
SELECT action, "entityType", "entityId", "userId", "createdAt"
FROM "AuditLog"
WHERE "entityType" = 'Finding'
ORDER BY "createdAt" DESC
LIMIT 20;
```

---

## 9. Backend API — Direct Endpoint Tests

Use a REST client (curl / Postman) to test each endpoint directly.

### POST /api/findings
```
POST /api/findings
Authorization: Bearer <token>
{
  "taskId": <id>,
  "eventType": "Procedural Breach",
  "departmentId": <id>,
  "description": "Test finding description",
  "aircraftRegistration": "VH-TEST",
  "regulatoryReference": "EASA Part-M",
  "fieldId": "field_001"
}
```
- [ ] 201 response with `id`, `status: "Open"`, `severity: null`.

### GET /api/findings
```
GET /api/findings?status=Open&page=1&pageSize=10
Authorization: Bearer <token>
```
- [ ] 200 response with `{ findings: [...], total, page, pageSize }`.
- [ ] Filter by `severity=Level+1` works.
- [ ] Filter by `status=In+Progress` works.
- [ ] Pagination: `page=2` returns next set.

### GET /api/findings/:id
```
GET /api/findings/1
Authorization: Bearer <token>
```
- [ ] 200 with full finding detail including `sourceTask`, `followUpTasks`, `reportedByUser`, `department`.

### PUT /api/findings/:id/review
```
PUT /api/findings/1/review
{
  "severity": "Level 1",
  "dueDate": "2026-06-30"
}
```
- [ ] 200. Finding status changes to `In Progress`.
- [ ] Second call returns 400 (already reviewed).

### POST /api/findings/:id/tasks
```
POST /api/findings/1/tasks
{
  "tasks": [
    { "templateId": <id>, "title": "Follow-up inspection" },
    { "templateId": <id>, "title": "Document review" }
  ]
}
```
- [ ] 201. Returns array of created tasks, each with `status: "Unassigned"`.
- [ ] Each task has `parentFindingId` set to the finding ID.

### PUT /api/findings/:id/stage2
```
PUT /api/findings/1/stage2
{
  "rootCause": "Training gap",
  "correctiveAction": "Refresher course scheduled",
  "errorCode": "E-042",
  "recurrence": false,
  "category": "Training"
}
```
- [ ] 200. All fields saved.
- [ ] GET /api/findings/1 returns updated stage2 fields.

### PUT /api/findings/:id/close
```
PUT /api/findings/1/close
```
(Finding must be in Pending Verification)
- [ ] 200. Status → `Closed`, `closedAt` set.
- [ ] As Staff → 403 Forbidden.

---

## 10. Regression — Phase 5 Features Unaffected

Confirm existing features still work after Phase 6 changes.

- [ ] Task detail page loads without errors for a task on a template with **no** findings support.
- [ ] Submitting a task (Staff) still works (Pending Verification hook in task.controller doesn't break submit flow).
- [ ] Approving a task (Director) still works.
- [ ] Rejecting a task still works.
- [ ] Work Package detail page still loads and shows tasks.
- [ ] Template Builder still works — publish a template, create a task from it.
- [ ] User Management (Director/Admin) still loads.
- [ ] Time Booking on a Closed task still works.
- [ ] Activity Feed on a task (with no findings) shows only task events, no phantom finding events.

---

## Sign-Off

| Section | Tester | Date | Pass / Fail | Notes |
|---|---|---|---|---|
| 1. Sidebar Badge | | | | |
| 2. Findings List Page | | | | |
| 3. Raise Finding | | | | |
| 4. Finding Detail Page | | | | |
| 5. Pending Verification Hook | | | | |
| 6. RBAC Matrix | | | | |
| 7. Edge Cases | | | | |
| 8. Audit Log | | | | |
| 9. API Endpoints | | | | |
| 10. Regression | | | | |
