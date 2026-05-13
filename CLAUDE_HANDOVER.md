# SQD-APP: Claude Code Project Handover

## 1. PROJECT OVERVIEW
SQD-APP is an aviation maintenance quality assurance (QA) and quality control (QC) web application. It enables administrators and inspectors to create dynamic audit templates, assign tasks, conduct inspections, and record findings. 

**Stack:**
- **Frontend**: Next.js 15 (App Router), React, Tailwind CSS v4, Zustand (Auth state), Lucide Icons.
- **Backend**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL.
- **Testing**: Jest + Supertest (Backend integration).

---

## 2. CURRENT STATE & RECENT ARCHITECTURAL DECISIONS

The core infrastructure, authentication, and the **Template Builder** are fully implemented and stable. 

### Recent Major Overhauls (May 2026)
1. **Ownership Concurrency Model**: We abandoned the "Pessimistic Locking" (lock timeouts) approach. Templates are now strictly tied to an `ownerId`. Only the owner (or an Admin/Director) can edit or publish. If someone else needs to edit, the owner must actively use the "Transfer Ownership" feature.
2. **Draft Encapsulation (`draftSchema`)**: 
   - *The Problem*: Editing a "Published" template and saving a draft was leaking the draft title/schema to all other users because there was only one database row.
   - *The Solution*: The `Template` model now has a `draftSchema` column (JSON). When a Published template is updated as a draft, the **entire** draft payload (title, description, formSchema, requiresApproval, allowsFindings) is saved into `draftSchema`. 
   - *Dynamic Mapping*: The backend API (`template.controller.ts`) intercepts requests. If the requester is the owner, it dynamically unpacks `draftSchema` and overrides the root properties, setting `status: 'Draft'`. For all other users, it strips `draftSchema`, ensuring they only see the clean, active Published state.
3. **Frontend UI Enhancements**:
   - `beforeunload` Guardian to prevent accidental navigation with unsaved changes.
   - "Revision History" slide-over panel that accurately queries `TemplateRevisionArchive`.
   - Read-only banners and dynamic Transfer/History action buttons.

---

## 3. DATABASE SCHEMA HIGHLIGHTS

- `Template`: Contains `templateId` (e.g. `QA-001`), `status`, `ownerId`, `formSchema` (active), and `draftSchema` (pending).
- `TemplateRevisionArchive`: Stores immutable snapshots of previously published schemas for audit history.
- `Division`: `QA`, `QCH`, `QCS`, `SQ`. Determines the `templateId` prefix.
- `Task` / `TaskData`: Tracks the assignment and the filled-out JSON data corresponding to a Template's schema.
- `Finding`: Tracks non-conformances identified during a Task.
- `AuditLog`: General accountability ledger.

---

## 4. WHAT REMAINS / PRIORITISED NEXT STEPS

Now that the Template Builder is robust, the next phases focus on the actual execution of QA Audits (Tasks and Findings).

### Phase 5: Task Management (High Priority)
- **Goal**: Allow Managers/Directors to instantiate a `Task` from a `Published` Template and assign it to an Inspector.
- **Backend**:
  - Implement CRUD routes in `task.routes.ts`.
  - Endpoint to fetch all assigned tasks for a user (`GET /api/tasks/my-tasks`).
  - Endpoint to save `TaskData` progress (`PUT /api/tasks/:id/data`).
  - Endpoint to complete/submit a task.
- **Frontend**:
  - Build `/dashboard/tasks` (List view with tabs: Assigned, In Progress, Review).
  - Build `/dashboard/tasks/[id]` (Execution view rendering the dynamic `formSchema` into actual inputs).
- **Dependencies**: Depends on the existing `Template` schemas.

### Phase 6: Findings System (Medium Priority)
- **Goal**: Allow Inspectors to flag specific answers within a Task as "Findings" (non-conformities) requiring follow-up.
- **Backend**:
  - Create `finding.routes.ts`.
  - Associate findings with specific field IDs from the `TaskData`.
- **Frontend**:
  - Build `/dashboard/findings` to track Open/Closed findings.

### Phase 7: User Management & Settings (Low Priority)
- **Goal**: Fill out the missing 404 pages linked in the sidebar.
- **Frontend**: 
  - Build `/dashboard/users` (Admin only) to manage roles and divisions.
  - Build `/dashboard/settings` for personal user preferences (e.g. password changes).

---

## 5. KNOWN BUGS & GOTCHAS

1. **Test Environment DB**: You **MUST** run tests against `sqd_qa_test_db`. Ensure your `.env.test` is loaded. The test suite automatically wipes tables in `beforeEach` (`test/setup.ts`), so do not run tests against the dev DB.
2. **Hydration Mismatch on Login**: There is a minor React hydration warning on `/login` occasionally due to browser extensions or mismatched server/client rendering of the form.
3. **Missing GET /api/templates/:id/revisions Route**: We technically never registered a dedicated revisions route because `getTemplateById` returns nested `revisionArchives` efficiently. Do not attempt to call `/revisions` directly; use the nested data.
4. **Checkbox Icon Bug**: In the Template Builder preview, the checkmark icon sometimes does not render properly when toggled.

---

## 6. GIT PROTOCOL & DEVELOPMENT COMMANDS

- **Dev Server**: `npm run dev` (Frontend on :3000, Backend on :5000 via `nodemon`).
- **Tests**: `npm run test` inside the `/backend` folder.
- **Prisma**: Run `npx prisma db push` to sync schema changes. Remember to update both dev and test DBs if making structural changes.

*(Note: Ensure you read this document before beginning any new feature to respect the current architecture, particularly the Draft Encapsulation logic in templates).*
