# SQD-APP: Claude Code Project Handover
*Last updated: 2026-05-31 (rev 5). Supersedes all previous versions.*

---

## 1. PROJECT OVERVIEW

SQD-APP is an aviation maintenance Quality Assurance (QA) and Quality Control (QC) web application. It enables administrators and inspectors to create dynamic audit templates, assign tasks, conduct inspections, record findings, and track work packages.

**Stack:**
- **Frontend**: Next.js 15 (App Router), React, Tailwind CSS v4, Zustand (Auth state), Lucide Icons
- **Backend**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL
- **Testing**: Jest + Supertest (Backend integration)

---

## 2. CURRENT IMPLEMENTATION STATUS

### Completed
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
  - `Task` model expanded with `taskId`, `issuerId`, `wpId`, `schemaSnapshot`, `rating`, `deadline`, and full 10-status set
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

### Test Suite
- All **150 integration tests passing** as of 2026-05-31
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

**Implementation note:** Build a `PrivilegeConfig` model in Phase 7. For Phases 5–6, hardcode the default rules in middleware but structure the code so the middleware reads from a config object — making it straightforward to wire up the DB-driven config in Phase 7 without rewriting business logic.

### 3.4a PrivilegeConfig Model (Phase 7)

The `PrivilegeConfig` model was added to the database schema in Phase 5.0 as a placeholder table. It will be populated and activated in Phase 7.

**What it is:** A database table that stores a JSON permissions map for each Role. Rather than hardcoding rules like "only Managers can assign Tasks" directly in middleware logic, the `PrivilegeConfig` table will store these rules as configurable data.

**How it works (Phase 7 target):**
```
PrivilegeConfig {
  roleId: 3           // Manager role
  permissions: {
    "task.create": true,
    "task.assign.sameDiv": true,
    "task.assign.anyDiv": false,
    "template.archive": true,
    ...
  }
}
```

**Why it matters:** The Admin-only Privilege Management panel (`/settings/privileges`) reads from and writes to this table. When an Admin changes which roles can do what, the change is saved here. The backend middleware then reads this table on each privileged request instead of relying on hardcoded role names.

**Current state (Phase 5):** Table exists in DB but is empty. All RBAC rules in Phases 5–6 are still hardcoded in middleware as config objects, making Phase 7 a wiring exercise — not a rewrite.

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

### 3.5 File Attachments & Storage (MinIO)

**Decision:** Use MinIO (self-hosted, S3-compatible) on the VPS for all file storage.

**Rationale:**
- Files stay on the same VPS as the app — important for aviation regulatory compliance
- S3-compatible API means future migration to AWS S3 / Cloudflare R2 is a config change, not a rewrite
- NAS rejected: only accessible inside WAN, VPS cannot reach it without VPN tunnel
- OneDrive rejected: Microsoft Graph API is complex, not designed for programmatic file serving

**MinIO bucket structure:**
- `sqd-templates` — attachments on Templates
- `sqd-findings` — evidence attachments on Findings
- `sqd-tasks` — attachments on Task execution

**File constraints (Admin-configurable via Privilege Management panel):**

| Category | Allowed types | Max size |
|---|---|---|
| Documents | PDF, DOCX, XLSX, TXT | 20MB |
| Images | JPG, PNG, WEBP | 10MB |
| Total per entity | — | 50MB |

**Access pattern:** Files never served publicly. All downloads via presigned URLs (time-limited, generated at request time).

**Implementation phases:**
- Phase 5.0 — Install MinIO on VPS, create buckets, add `Attachment` model to schema, add `multer` + `minio` SDK to backend
- Phase 5.4 — Add `File Upload` field type to Template builder
- Phase 6 — File attachments on Findings

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
| `File Upload` | Upload documents/images | **Deferred to Phase 5.4** — MinIO infrastructure required first |

> **Field type history:** The original single "Checkbox" field type has been split into `Checkbox Single` (boolean toggle) and `Checkbox Group` (multi-option picker). `Radio` added for single-choice from visible options. `File Upload` deferred until MinIO is configured in Phase 5.0.

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

### OBJECT D: TASK ACTIVITY FEED

**Purpose:** Per-Task chronological feed combining system events and human comments. This is the communication layer between reviewer and assignee.

**New model — not yet in schema. Must be added in Phase 5.**

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

**Purpose:** Log actual hours spent on a Task after it reaches a final state.

**Model implemented in Phase 5.0 schema migration. Backend + frontend completed in Phase 5.6.**

**Available only when Task status is:** `Closed`, `Rejected`, or `Terminated`

**Attributes:**

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `taskId` | Int | Unique — one booking per Task |
| `assigneeEntry` | Json | `{ userId, hoursLogged, notes }` |
| `collaborators` | Json | Array of `{ userId, hoursLogged, notes }` |
| `totalHours` | Float | Computed sum of all entries |
| `estimatedHours` | Float? | Snapshot from `Task.estimatedHours` at time of booking |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Rules:**
- Only the assignee can create the Time Booking and add collaborators
- Collaborators cannot add themselves
- `estimatedHours` stored as a snapshot now — budget-vs-actual comparison UI deferred to a future phase

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
| `sourceTaskId` | Int | Task the finding was raised on |
| `reportedByUserId` | Int | User who raised the finding |
| `closedByUserId` | Int? | |
| `createdAt` / `closedAt` | DateTime | |

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
5. Finding raiser **automatically becomes the Task assignee**
6. Issuer/Director/Manager can override assignee (standard reassignment rules, all data preserved)
7. One Finding can generate multiple Tasks (supported but not common)
8. Each generated Task linked to source Finding via `parentFindingId`
9. When all follow-up Tasks reach a final state → Finding status → `Pending Verification` → system prompts reporter to return
10. Reporter completes Stage 2 fields → Manager/Director signs off → Finding → `Closed`

**Future — Findings Dashboard (Phase 6+):**
Dedicated analytics view with charts and filters across severity, eventType, errorCode, department, aircraft, recurrence, time period. Deferred — implement list view first.

---

### OBJECT G: AUDIT LOG

**Current schema is functional. Suggested improvements:**

- Change `entityId Int` → `entityId String` to support future UUID migration and prevent ID-reuse collisions after soft deletes
- Extend `entityType` values to include: `WorkPackage`, `TimeBooking`, `TaskActivity`
- Add soft delete support (`deletedAt DateTime?`) to: `User`, `Task`, `Finding`, `WorkPackage`

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
| `Task` | EXPAND | `status` values to full 10-status set |
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
| `AuditLog` | CHANGE | `entityId Int` → `entityId String` |
| `User`, `Task`, `Finding` | ADD field | `deletedAt DateTime?` (soft delete) |
| **NEW** | CREATE model | `WorkPackage` |
| **NEW** | CREATE model | `WorkPackageAssignment` (join table: WP ↔ Users) |
| **NEW** | CREATE model | `TaskActivity` |
| **NEW** | CREATE model | `TimeBooking` |
| **NEW** | CREATE model | `WpType` (DB table, Admin-extensible — not hardcoded enum) |
| **NEW** | CREATE model | `PrivilegeConfig` (Phase 7 — stores Admin-configurable role permissions) |
| **NEW** | CREATE model | `Attachment` — `fileName`, `fileType`, `fileSize`, `storageKey`, `entityType`, `entityId`, `uploadedById` |

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

### Phase 6 — Findings System
- [ ] `finding.routes.ts` + `finding.controller.ts`
- [ ] Stage 1 create endpoint — enforce required fields (eventType, departmentId, aircraftRegistration, regulatoryReference)
- [ ] Manager/Director review endpoint — set severity, generate follow-up Task(s)
- [ ] Follow-up Task generation from pre-defined Templates — auto-assign Finding raiser
- [ ] `parentFindingId` linkage on generated Tasks
- [ ] Stage 2 hook — when all linked follow-up Tasks reach final state, set Finding → `Pending Verification` and notify reporter
- [ ] Stage 2 update endpoint — reporter fills analytical fields (errorCode, rootCause, correctiveAction, recurrence, violatorIds)
- [ ] violatorIds search integration — searchable multi-select UI against external personnel DB (5000+ records)
- [ ] Finding close endpoint (Manager/Director sign-off after Stage 2)
- [ ] `/dashboard/findings` — list view with tabs: Open / In Progress / Pending Verification / Closed
- [ ] Findings dashboard with charts/filters (deferred — list view first)

### Phase 7 — User Management & Settings
- [ ] `/dashboard/users` — Admin only: manage users, roles, divisions
- [ ] `/dashboard/settings` — personal preferences, password change
- [ ] Admin: manage `WpType` values
- [ ] Admin: manage `EventType` values (for Findings)
- [ ] **Global Privilege Management panel** (`/settings/privileges` — Admin only)
  - List all configurable actions as toggleable permissions per Role
  - Changes require explicit confirmation/publish step before going live
  - Backend: `PrivilegeConfig` model; middleware reads from config table instead of hardcoded role checks
  - Default config mirrors rules documented in this handover

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
12. Privilege rules: currently hardcoded in middleware but structured as a config object — Phase 7 will wire up DB-driven `PrivilegeConfig` table without rewriting business logic.
13. File Upload field type in Template builder is DEFERRED until Phase 5.4 — MinIO must be configured in Phase 5.0 first.
14. File size/type constraints are Admin-configurable — never hardcode them in application logic.

---

## 11. DEFERRED SECURITY FIXES — Authentication (Approved Plan, Not Yet Implemented)

Audited on **2026-05-29**. These are known vulnerabilities to be fixed before any production deployment.

### Fix 1 — `updatePassword` requires current password (CRITICAL)
**File:** `backend/src/controllers/auth.controller.ts`
**Problem:** `PUT /api/auth/update-password` does NOT verify the user's current password before setting a new one. Any valid session token can silently change the password.
**Fix:** Require `oldPassword` in request body. Call `bcrypt.compare(oldPassword, user.passwordHash)` — reject with `403` if it fails.

### Fix 2 — User enumeration via `forgotPassword` (RESOLVED 2026-05-30)
**File:** `backend/src/controllers/auth.controller.ts`
**Problem:** `/forgot-password` returns `404` when the email is not found, allowing an attacker to enumerate valid user emails.
**Fix:** Always return `200 OK` with a generic message (`"If an account exists, a reset link has been generated."`) regardless of whether the email exists.
**Status:** Completed during Phase 5.5 prerequisite audit fixes.

### Fix 3 — No rate limiting on `/login` and `/forgot-password` (MODERATE)
**File:** Add `backend/src/middleware/rateLimit.middleware.ts` + update `backend/src/routes/auth.routes.ts`
**Problem:** No brute-force protection on login or password-reset endpoints.
**Fix:** Install `express-rate-limit`. Apply a limiter (e.g., max 5 requests / 15 min per IP) to `/login` and `/forgot-password`.

### Fix 4 — JWT secret fallback to `'fallback_secret'` (MODERATE)
**Files:** `auth.controller.ts`, `auth.middleware.ts`
**Problem:** Both files use `process.env.JWT_SECRET || 'fallback_secret'`. A misconfigured production environment would silently use a well-known weak secret, allowing token forgery.
**Fix:** Remove the fallback. Throw an explicit startup error if `JWT_SECRET` is undefined.

### Fix 5 — Reset token stored in plaintext (LOW)
**File:** `backend/src/controllers/auth.controller.ts`
**Problem:** The password reset token is stored as plaintext in the DB. If the DB is compromised, all active reset tokens are exposed.
**Fix:** Hash the token via `crypto.createHash('sha256')` before storing. Hash the incoming token before comparing during reset.

### Impact on Test Suite
- `auth.test.ts` will need to be updated to cover:
  - The `oldPassword` requirement in `updatePassword`
  - The `200` (not `404`) response from `forgotPassword`
  - Rate-limiting behaviour (or mock the limiter in tests)

---

*Generated by Claude Sonnet 4.6 in claude.ai — 2026-05-14*
