# SQD-APP — End-User Demonstration Runbook

**Format:** Slide deck + annotated screenshots (not a live click-through).
**Audience:** Mixed — Staff, Managers, Directors. Goal: convey what the app *does* and how it enforces the QA/QC workflow, role by role.
**Narrative spine:** Groundwork (architecture + RBAC) → the end-to-end lifecycle (Template → Work Package → Task execution → Findings → Time booking → Review → Closure) → the two differentiators (RCA/CAPA and the Unified Feed / Escalation loop) → Director oversight.

> This runbook is verified against the codebase (schema, services, frontend routes) as of 2026-07-02. Screen paths and behaviours below reflect the shipped app, not the older workflow prose.

---

## 0. Pre-demo preparation (do this before capturing any screenshots)

1. **Run the demo seed.** `backend/prisma/seed-mass-mockup-v2.ts` is a purpose-built *"full-coverage mockup for management demonstrations"*: 30 Work Packages (all 5 types, all statuses incl. Overdue/Inactive), 150 Tasks (all 9 statuses, TaskData, time entries, ratings, feed comments), 20 Findings + **5 "hero" findings with a full RCA/CAPA/follow-up/links lifecycle**, and a trend cluster that triggers the recurrence banner. Run after `seed-org`, `seed-reference`, `seed-templates`, `seed-blueprints`. It is idempotent (cleans `DEMO-WP / DEMO-TSK / DEMO-FND` prefixes), so it's safe to re-run.
   ```cmd
   cd backend
   npx ts-node prisma/seed-mass-mockup-v2.ts
   ```
2. **Resolve the login gotchas before screenshotting each role:**
   - Every seeded user has `forcePasswordChange: true` — first login forces a password change. Log in as each demo account **once beforehand** and set a password so your screenshots show the real screen, not the change-password wall.
   - `ENFORCE_SINGLE_SESSION=true` — the *same* account logged in twice kicks the first session. Use separate accounts (or separate browser profiles) per role; don't share one account across windows.
3. **Pick one account per role.** Master is `VAE00071` (Director). The Manager and Staff accounts live in `backend/seed_data.xlsx` (Users sheet) — choose one employeeId each and note them on a prep card.
4. **Capture screenshots in a clean, populated state** so no screen looks empty. A screen free of amber/red badges is itself a message ("system healthy") — mix in one with an overdue/finding badge to show the status vocabulary firing.

---

## SECTION 1 — Introduction & Groundwork

### Slide 1.1 — Product purpose ("The Technical Manual")
- **Show:** Title slide + one clean dashboard screenshot.
- **Talking points:** SQD-APP is an internal aviation MRO QA/QC platform — audit templates, task assignment, inspections, findings, work packages. It exists to *enforce compliance workflows and keep an auditable record of every quality event*. Design north star (quote `DESIGN.md`): **"The Technical Manual"** — authority through restraint, zero ambiguity on status, role-adaptive views. One accent (**Signal Blue** = "act here"); status colours (amber/red/emerald) fire *only* on live conditions.
- **Source to cite:** `PRODUCT.md`, `DESIGN.md` §1–2.

### Slide 1.2 — Data model / ERD
- **Show:** An ERD diagram. Draw **two linked clusters**, not a straight line:
  - **Task hub:** `Template ──1:N──> Task`, `WorkPackage ──1:N──> Task` (a Task's WP is *optional*), and `WorkPackage ──autoGenTemplate──> Template` (the WP references a template to spawn from).
  - **Finding cluster:** `Finding ──sourceTaskId──> Task` (raised from) and `Task ──parentFindingId──> Finding` (follow-up/corrective task). Findings also fan out to RCA / CAPA / ATA chapter / hazard tags.
- **Talking points:** Task is the centre of gravity. A Finding is both *born from* a task and *resolved by* new tasks — that round-trip is the corrective-action loop.
- **Source:** `backend/prisma/schema.prisma` (`Template`, `Task`, `WorkPackage`, `Finding` blocks).

### Slide 1.3 — The immutable data model
- **Show:** A simple before/after graphic.
- **Talking points, three pillars:**
  1. **Schema snapshot** — every Task stores an immutable `schemaSnapshot` of the template at creation. Editing or deleting the Template never alters an in-flight task's form.
  2. **Soft delete** — nothing with a `deletedAt` is ever physically removed (aviation compliance). Evidence and records persist.
  3. **Dual audit** — every state change writes to *both* the system-wide `AuditLog` (compliance record) *and* the operational feed. `AuditLog` is the immutable source of truth.

### Slide 1.4 — RBAC: the distinctive rule (lead with this)
- **Show:** A role matrix graphic (Staff → Group Leader → Manager → Director/Admin, plus Senior Advisor).
- **Talking points — the design decision that surprises people:** the system is **view-transparent but action-scoped**. *Every* authenticated user can *see* all Work Packages, Tasks, and Findings system-wide — deliberate safety transparency. *Acting* is restricted: only the Issuer, the Director, and **Managers of the same Division** can review/approve/reject/reassign a task; only Managers/Directors assign to WPs or close them. Privileges are database-driven (Phase 7 `PrivilegeConfig`), so an Admin can tune the matrix without a code change.
- **Source:** `BUSINESS_WORKFLOW.md` §6; `constants/privileges.ts`.

---

## SECTION 2 — The End-to-End Lifecycle (the centrepiece)

### Slide 2A — Manager view: Work Package setup + auto-generation
- **Show:** Screenshot of `/dashboard/work-packages/new` with the auto-gen config open, then the resulting task list on the WP detail page (`/dashboard/work-packages/[id]`).
- **Talking points (corrected — this is *not* CHECK-only):**
  - A Work Package is a container grouping tasks under a timeframe and type (CHECK, AUDIT, INVESTIGATION, …).
  - **Any WP type can auto-generate tasks.** The source is one of three: a single **Template**, a saved **Template Set** (ordered bundle), or an **inline set**. Two modes: `SINGLE_SHOT` (spawn once) and `REPEAT` (re-spawn every N days across the WP's timeframe).
  - The first batch fires **the moment the Manager saves the WP** — instant, not a background delay.
  - **Reusable recipes:** show `/dashboard/template-sets` and `/dashboard/wp-blueprints` — blueprints pre-fill a WP + its auto-gen config and can be put on a recurrence schedule that a nightly cron auto-launches. The "system runs its routine audits itself" moment for managers.
- **Source:** `services/autoGenService.ts`, `wp.controller.ts` (`fireAutoGenForWp` on create).

### Slide 2B — Staff view: task execution
- **Show:** The task list with the status-badge column, an unassigned task with a **"Perform This Task"** action, and a task detail page (`/dashboard/tasks/[id]`) showing a branching form.
- **Talking points:**
  - Tasks arrive assigned, or sit **Unassigned** in a pool that eligible Staff self-serve.
  - **Form logic:** templates carry Google-Forms-style JSON branching (e.g. "Damage Found = Yes → show Upload Photo"). The task renders from its immutable snapshot, so the form can't drift.
  - **Status vocabulary:** point at the 9-status machine (Unassigned → Assigned → In Progress → In Review → Follow-up Required → Closed / Rejected / Terminated / Inactive), DB-enforced. Tie it back to `DESIGN.md`: status readable in under one second, colour + label + icon aligned.

### Slide 2C — Findings: raising & routing
- **Show:** The "raise finding" flow from a task, and a finding detail page (`/dashboard/findings/[id]`) — use one of the seed **hero findings**.
- **Talking points:**
  - Any user can raise a finding from a task **if** the template has `allowsFindings = true` and the task isn't in a final state. Minimum fields: Event Type, Department, Description.
  - A **Manager/Director** reviews it, assigns **severity** (Observation / Level 1 / Level 2) and a due date → status moves **Open → In Progress**.
  - The reviewer generates **follow-up (corrective-action) tasks** from templates, linked via `parentFindingId`. When *all* follow-ups reach a final state, the finding **auto-transitions to Pending Verification**.
  - **Findings visibility follows RBAC:** Director/Admin see all; Managers see their division; Staff/GL see only what they raised or were assigned.
- (RCA/CAPA depth is Section 3 — tease it here: "and for serious findings, there's a full root-cause and corrective-action toolkit — coming up next.")

### Slide 2D — Time booking + Review
- **Show:** The time-booking panel on a closed task (budget-vs-actual badge) and the review action bar (Approve / Reject / Follow-up).
- **Talking points:**
  - Once a task hits a final state, the assignee logs **actual hours** (plus collaborators). If the source template had `estimatedHours`, a **budget-vs-actual** badge appears; exceeding **120%** of estimate forces an over-budget reason.
  - Every submission writes an append-only `TimeEntry` — an immutable revision trail — plus `AuditLog` + feed.
  - **Review rights (RBAC precision):** Approve/Reject/Follow-up = **Issuer + Director + Managers of the *same* Division** — not any manager, not the issuer alone.

### Slide 2E — Closure
- **Show:** A Director closing a task/WP; the emerald "Closed" state.
- **Talking points:** Approval closes the task; the Director closes the Work Package. Every transition is dual-written to the audit trail. Emerald appears only at resolution — restraint by design.

---

## SECTION 3 — Differentiators (headline beats)

### Slide 3.1 — Root Cause & Corrective Action (RCA / CAPA)
- **Show:** A hero finding's RCA and CAPA sections; ideally one 5-Whys example and one MEDA example.
- **Talking points:**
  - **RCA** (1:1 with a finding) supports **5-Whys**, **MEDA** contributing-factor analysis, or OTHER, concluding in a **cause code** (MEDA-style taxonomy A–J).
  - **CAPA** — corrective *and* preventive actions, each with an owner, deadline, and status, optionally linked to tasks/WPs that must close before the CAPA can be verified.
  - **Taxonomy & traceability** — ATA chapters, hazard tags, finding-to-finding links (Duplicate / Related / Caused-by), and **response actions** (CAR / NCR / QN / QR / IR) that create a follow-up task atomically.
  - **Trend/recurrence** — the seed's trend cluster (shared dept + ATA + cause + hazard tag) fires an `isRecurring` banner. This is the "we catch systemic issues, not just one-offs" story.
- **Source:** `schema.prisma` (RcaInvestigation, CapaAction, FindingResponseAction, …); `FINDING_EXPANSION_USER_GUIDE.md`.

### Slide 3.2 — Unified Feed & Escalation loop
- **Show:** A task/WP feed with comments; the header **bell**; the `/dashboard/escalations` page.
- **Talking points:**
  - **One feed, five scopes:** Task, Work Package, Division Board, Org Feed, Finding. The per-task activity feed is just the Task scope of this unified feed.
  - **Reading is open; posting is scoped.** Any user can **flag** a comment to escalate it to a higher scope. Escalation posts an **Escalation Card** at the target and **Info Cards** at every level in between — no skipped level is left blind. Cards carry only a short excerpt + deep link, never the full text (compliance).
  - **See vs. action:** everyone sees the cards; only Directors/Admins (any) and Managers (own-division + all Org flags) can *action* one — the header bell shows their pending count and links to the Escalations page (full history: Pending / Actioned / Dismissed).
  - Collaboration extras worth a line: @mentions, `#CODE` entity links, comment attachments, pinning, hide/moderation, acknowledgements, per-feed search, opt-in daily digest.
- **Source:** `BUSINESS_WORKFLOW.md` §4a; `FEED_ESCALATION_USER_GUIDE.md`.

---

## SECTION 4 — Director oversight & Analytics
- **Show:** The global dashboard and `/dashboard/analytics` (Findings tab + Personnel tab).
- **Talking points:** Directors have global action rights and global visibility. Analytics surfaces **time-efficiency trends** and **staff performance**, scoped to division or system-wide. Close the loop: everything shown today — every status change, time entry, escalation, closure — landed in the immutable `AuditLog`. That's the compliance backbone.

---

## Appendix — Screens & source references cheat-sheet

| Beat | Screen / route | Backing code |
|------|----------------|--------------|
| Architecture / ERD | — | `backend/prisma/schema.prisma` |
| Design language | — | `DESIGN.md`, `PRODUCT.md` |
| WP setup + auto-gen | `/dashboard/work-packages/new`, `/dashboard/template-sets`, `/dashboard/wp-blueprints` | `services/autoGenService.ts`, `recurrenceService.ts`, `wp.controller.ts` |
| Task execution | `/dashboard/tasks`, `/dashboard/tasks/[id]` | `constants/taskStatus.ts` |
| Findings | `/dashboard/findings`, `/dashboard/findings/[id]` | `findingService.ts` |
| RCA / CAPA | finding detail (hero findings) | `FINDING_EXPANSION_USER_GUIDE.md` |
| Feed / Escalation | task/WP feeds, header bell, `/dashboard/escalations` | `feedService.ts`, `escalationService.ts` |
| Analytics | `/dashboard/analytics` | `trendService.ts` |
| Demo data | — | `backend/prisma/seed-mass-mockup-v2.ts` |
