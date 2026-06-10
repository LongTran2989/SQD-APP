# SQD-APP: Claude Code Project Handover
*Last updated: 2026-06-10 (rev 9). Supersedes all previous versions.*

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

### Test Suite
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
| `File Upload` | Upload documents/images | **Deferred to Phase 5.4** — MinIO infrastructure required first |
| `Rich Text` | Formatted text with Bold, Italic, Bullet/Numbered lists | Editor powered by Tiptap/StarterKit. Stored as HTML string in `TaskData.data`. Read-only mode uses `editable: false` — no XSS surface. Added 2026-06-08 |

> **Field type history:** The original single "Checkbox" field type has been split into `Checkbox Single` (boolean toggle) and `Checkbox Group` (multi-option picker). `Radio` added for single-choice from visible options. `File Upload` deferred until MinIO is configured in Phase 5.0. `Rich Text` added 2026-06-08 using Tiptap.

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

**Added by the Feed & Escalation feature (Phases 1–5 — complete).** Replaces the former `TaskActivity` (OBJECT D). `FeedPost.scopeId` is **polymorphic — no foreign key**; a feed is located by `(scope, scopeId)`.

**`FeedPost`**

| Field | Type | Notes |
|---|---|---|
| `id` | Int | |
| `type` | String | `COMMENT` \| `SYSTEM_EVENT` \| `ESCALATION_CARD` \| `INFO_CARD` |
| `scope` | String | `TASK` \| `WP` \| `DIVISION` \| `ORG` |
| `scopeId` | Int? | taskId / wpId / divisionId; **NULL for the singleton ORG feed** |
| `authorId` | Int? | NULL for SYSTEM_EVENT / auto-generated cards |
| `content` | String | Comment body, system text, or generated card headline |
| `metadata` | Json? | |
| `sourcePostId` | Int? | The flagged COMMENT a card references (self-relation) |
| `sourceExcerpt` | String? | Truncated snippet (≤160 + `…`) — **never the full source text** |
| `sourceTaskId` / `sourceWpId` | Int? | Denormalised deep-link (no FK — polymorphic origin) |
| `flagId` | Int? | FK to `EscalationFlag` |
| `taggedDivisionIds` | Json? | Org Feed only (int array) — used by Disseminate (Phase 4) |
| `createdAt` | DateTime | Immutable |

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

- **Allow final booking during `In Review`** — `FINAL_TASK_STATUSES` in `timebooking.controller.ts` now includes `'In Review'`. This single constant gates both endpoints: `createTimeBooking` (POST) now accepts `In Review` status; `createTimeEntry` (POST) now blocks new session entries for the same status (correct — you cannot log new work once a task is submitted for review).
- **Keep Work Log visible after close** — `TimeEntryPanel` is now rendered for all post-assignment statuses (`task.status !== 'Unassigned' && task.status !== 'Inactive'`), so the history list persists on `Closed`/`Rejected`/`Terminated` tasks for traceability. The create form inside `TimeEntryPanel` is gated separately via a `LOGGABLE_STATUSES` constant (`Assigned` / `In Progress` / `Follow-up Required`) — final-state and `In Review` tasks show the history read-only only.

**Frontend additions:**
- `TimeBookingPanel` wrapped in `<div id="time-booking-section">` for in-page anchor navigation.
- Amber banner on `In Review` tasks without a booking: *"Submit it now so your manager can rate the task once it is approved."* (Accurate: rating happens after `Closed`, not during `In Review` — the rating gate lives in `task.controller.ts` which uses a separate `FINAL_TASK_STATUSES` constant that does not include `In Review`.)
- Pre-submit reminder link added below the Save/Submit button group in `TaskActionBar.tsx` (`isEditable && isAssignee` block): *"After submitting, Please perform final time booking!"*

**Code-review fixes (same branch, post-ship):**
- `TimeEntryPanel.tsx`: `LOGGABLE_STATUSES` constant added; form gated with `isAssignee && canLogEntries` to prevent an interactive form rendering on tasks where the backend would hard-reject the POST with 400.
- `page.tsx` In Review banner copy corrected (see above — removed misleading "your manager needs this before rating").
- `timebooking.controller.ts` 400 error message updated to list "In Review, Closed, Rejected, or Terminated" (was stale after adding `In Review` to `FINAL_TASK_STATUSES`).

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
10. **Finding follow-up tasks are Unassigned**: The original spec in OBJECT F said "Finding raiser automatically becomes the Task assignee." The actual implementation creates follow-up tasks as `Unassigned`. An Issuer/Manager/Director must manually assign them. Do not change this without a deliberate decision.
11. **`checkAndTriggerPendingVerification` is best-effort**: The hook in `findingService.ts` is wrapped in try/catch and never rethrows. If it fails silently, a finding will remain `In Progress` even after all follow-up tasks close. This is intentional — the hook must never break the task action that triggered it.
12. **`Finding.category` is nullable**: The original Phase 5 schema had `category` as required, but the Phase 6 raise endpoint does not include it (it belongs to Stage 2 analysis). It was made nullable in Phase 6 to avoid NOT NULL violations on raise. Set it via `PUT /api/findings/:id/stage2`.
13. **`Finding.departmentId` vs `targetDivisionId`**: Two separate fields. `departmentId` is the department where the finding occurred (operational, required at raise). `targetDivisionId` is the division used for RBAC scoping. Do not conflate them.
14. **`seed-verification.test.ts` platform fix**: This test spawns `ts-node` as a child process. It now uses `process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node'`. If tests fail on Windows with "ts-node not found", confirm the `.cmd` variant is on PATH.
15. **Post-rejection Reassign vs General Reassign use different endpoints**: When a task is `Rejected`, the "Reassign" action must go through `POST /api/tasks/:id/post-rejection` with `action: 'reassign'` — NOT through `PUT /api/tasks/:id/reassign` (which blocks Rejected status). For all other non-final states, use `PUT /api/tasks/:id/reassign`. `TaskActionBar` has two separate handlers: `handlePostRejectReassign` and `handleGeneralReassign`.
16. **`decideDeadlineExtension` requires `extensionIndex`**: The backend requires the index of the pending extension within the `deadlineExtensions` JSON array. The frontend uses `getPendingExtensionIndex()` to find the first entry where `decision` is null/undefined. If an extension was already decided, it won't be found and the call is blocked client-side.
17. **`task.assignedToUser.role` is a flat string**: The user object returned in task responses has `role` as a plain string (e.g. `'Manager'`), not a nested Role object. Do not access `.role.name` — it will always be `undefined`.
18. **Event Type in Findings is hardcoded until Phase 7**: `RaiseFindingPanel` uses a 9-item hardcoded list. Phase 7 will replace this with an admin-managed `EventType` table. The "Other" option writes a free-text value directly to `Finding.eventType`.

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

33. **`FINAL_TASK_STATUSES` is intentionally duplicated across controllers and is NOT the same as `LOGGABLE_STATUSES` in the frontend:** `timebooking.controller.ts` has its own module-local copy that now includes `'In Review'`. `task.controller.ts`, `analytics.controller.ts`, `wp.controller.ts`, and `findingService.ts` each have their own copy that is still `['Closed', 'Rejected', 'Terminated']`. Do NOT consolidate into a shared constant — the rating gate, WP status, and finding hooks must not include `'In Review'`. `TimeEntryPanel.tsx` has a separate `LOGGABLE_STATUSES = ['Assigned', 'In Progress', 'Follow-up Required']` that gates the entry create form; it is also intentionally separate from the backend constant.

34. **Rating is still blocked for `In Review` tasks despite booking being allowed there:** The rating gate in `task.controller.ts` (`rateTask`) uses its own `FINAL_TASK_STATUSES` which does NOT include `'In Review'`. A manager attempting to rate an `In Review` task will get *"Task must be in a final state to be rated."* This is correct by design — the booking is created during `In Review` as preparation so it is ready the moment the task is approved/closed. The In Review banner copy reflects this: *"Submit it now so your manager can rate the task once it is approved."*

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
