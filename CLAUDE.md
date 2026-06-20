# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About This Project

A full-stack aviation maintenance Quality Assurance (QA) and Quality Control (QC) web application for managing dynamic audit templates, task assignment, inspections, findings, and work packages.

**Status:** Core platform live through Phase 7 (Global Privilege Management). Shipped workstreams include Findings, Escalation / Unified Feed, Time Booking, Analytics, CAPA/RCA, and Auto-Generate Work Packages (P1–P6). See `CLAUDE_HANDOVER.md` §2 for the authoritative, up-to-date status.

---

## NEXT.JS 16 WARNING

This project uses **Next.js 16** (with React 19) which has breaking changes from prior versions. APIs, conventions, and file structure may differ from training data. Before writing any frontend code, read the relevant guide in `frontend/node_modules/next/dist/docs/`. Heed deprecation notices.

---

## NON-NEGOTIABLE RULES — READ BEFORE WRITING ANY CODE

Violating any of these rules silently breaks data integrity, compliance, or RBAC. No exceptions.

1. **Plan before coding.** List every file you will change and what you will do. For DB migrations, describe exactly what changes and confirm it is reversible. Wait for explicit approval before proceeding.
2. **Soft delete filter — MANDATORY.** Any model with a `deletedAt` field is NEVER physically deleted, and every read MUST include `where: { deletedAt: null }` — every controller, every endpoint, no exceptions. The schema is the source of truth for which models these are (currently `User`, `Task`, `Finding`, `WorkPackage`, `Attachment`, `CapaAction`, `Department`). When you add a `deletedAt` to a model, you take on this obligation for ALL of its reads — including pickers/datasources and existence-validation lookups, not just list endpoints.
3. **Dual write — MANDATORY.** Every status change or significant event writes to BOTH `AuditLog` (compliance) AND `TaskActivity` (`SYSTEM_EVENT`). Never one without the other.
4. **Draft encapsulation.** On Template publish, ALWAYS set `draftSchema: null`. Never mutate `formSchema` of a Published template — edits go to `draftSchema` only.
5. **Schema snapshot.** Every Task stores `schemaSnapshot` (copy of `formSchema`) at creation time. Never render a Task form from the live Template `formSchema`.
6. **RBAC — Task review rights.** Approve / Reject / Follow-up = Issuer + Director + Managers of same Division only. Not Issuer alone. Not all Managers.
7. **Reassignment.** Permitted at any non-final stage, mandatory reason, all TaskData preserved. BLOCKED on Closed, Terminated, Rejected.
8. **Test DB isolation.** Tests ALWAYS run against `sqd_qa_test_db`. Never `sqd_qa_db`. Confirm `.env.test` is loaded before running tests.
9. **Prisma generate.** Run `npx prisma generate` in `/backend` after every `schema.prisma` change.
10. **File Upload — IMPLEMENTED (local-disk, not MinIO).** Shipped 2026-06-16 (see `CLAUDE_HANDOVER.md` §3.5 + `FILE_UPLOAD_DEV_GUIDE.md`). Storage is a pluggable `StorageAdapter` (local-disk default; MinIO is a documented stub). Downloads stream through the backend — never serve files publicly. Never hardcode file size/type limits — they live in `SystemSetting['FILE_UPLOAD_CONFIG']`, Admin-configurable only (the 100 MB `ABSOLUTE_MAX_UPLOAD_BYTES` is an infra safety ceiling, not the policy). Soft-delete attachments — never physically remove evidence objects.
11. **Terminal — cmd only.** Always use cmd syntax. Never PowerShell syntax (`$env:VAR`, backtick line continuation, etc.).
12. **Update `CLAUDE_HANDOVER.md` after every completed feature.** Once the user confirms a feature is complete and all tests pass, update `CLAUDE_HANDOVER.md` — phase status, completed items, test count, new gotchas. Do this before ending the session. Never update it before the user confirms completion.
13. **Update `CODE_REVIEW_AUDIT_LOG.md` after every accepted code or security review.** Log every finding with its severity and final status (Fixed / Deferred / Accepted-as-is). Update `CLAUDE_HANDOVER.md` §2 and §8 in the same session. Do NOT wait for the user to ask — this is mandatory after any `/code-review` or `/security-review` the user accepts.

---

## QUICK START

**Prerequisites:** Node.js 18+, PostgreSQL (`sqd_qa_db` dev · `sqd_qa_test_db` tests · both on port 5432)

```cmd
REM Terminal 1 — Frontend (http://localhost:3000)
cd frontend && npm run dev

REM Terminal 2 — Backend (http://localhost:5000)
cd backend && npm run dev
```

**Master user:** `director@sqd.com` / `password123` (Director role)

---

## CRITICAL REFERENCE DOCUMENTS

Read these before touching code — they supersede this file:

1. **`CLAUDE_HANDOVER.md`** — Absolute source of truth: roadmap, architecture decisions, full object reference, schema, RBAC rules, security fixes. Read Section 10 ("BEFORE STARTING ANY NEW FEATURE") first.
2. **`BUSINESS_WORKFLOW.md`** — Human-readable workflow rules: templates, work packages, task execution, findings loop, data visibility.
3. **`CODE_REVIEW_AUDIT_LOG.md`** — Running log of all `/code-review` and `/security-review` sessions: every finding, severity, status (Fixed / Deferred / Accepted-as-is), and open flags. Read before any review session to avoid re-examining already-resolved issues.

---

## TECHNOLOGY STACK

**Frontend:** Next.js 16 (App Router, React 19), Tailwind CSS v4, Zustand (auth state), Axios, TypeScript 5 strict, ESLint 9

**Backend:** Express.js 5, Node.js, TypeScript 6 strict (ES2020/commonjs), Prisma ORM v6 + `@prisma/adapter-pg`, Jest 30 + Supertest

**Database:** PostgreSQL — `sqd_qa_db` (dev), `sqd_qa_test_db` (tests)

---

## AUTHENTICATION & AUTHORIZATION

- JWT tokens (`JWT_SECRET` env var), bcrypt password hashing, session tracking via `activeSessionId` UUID
- Test mode: `ENFORCE_SINGLE_SESSION=false` in `.env.test`

**Roles (see `constants/privileges.ts` `ROLE_NAMES` for the authoritative list):** Director, Admin, Manager, Group Leader, Staff, Senior Advisor
- Director: global access, assign to anyone, review globally
- Manager: division-scoped; assign/review within division
- Group Leader: create/assign tasks in assigned WPs (division-scoped)
- Staff: perform assigned tasks; self-assign unassigned tasks
- Senior Advisor: senior oversight role (seeded in the BOD division) with global dashboard visibility alongside Director/Admin; exact grants in `constants/privileges.ts`

Privileges are **database-driven (implemented, "Phase 7")** via the `PrivilegeConfig` model: `hasPrivilege` (`utils/privilegeAccess.ts`) resolves a live per-role `permissions` map and falls back per-key to `DEFAULT_PRIVILEGES` (`constants/privileges.ts`), which encodes the original hardcoded behaviour. Relationship grants, division-scope checks, and feed transparency remain hardcoded by design.

---

## KEY ARCHITECTURAL PATTERNS

**Draft Encapsulation** — Published template edits go to `draftSchema` only; never exposed to non-owners. Clear `draftSchema` to null on publish.

**Schema Snapshots** — Tasks store immutable `schemaSnapshot` at creation. Form rendering always uses the snapshot, never the live Template `formSchema`.

**Soft Delete** — All deletes set `deletedAt`, never physical removal (aviation compliance). Always filter `where: { deletedAt: null }`.

**Status Machines:**
- Template: Draft → Published → Archived
- Task: 9-status lifecycle — Unassigned, Assigned, In Progress, In Review, Follow-up Required, Closed, Rejected, Terminated, Inactive (authority: `constants/taskStatus.ts` `TASK_STATUSES`)
- Finding: Open → In Progress → Pending Verification → Closed
- WorkPackage: Open → In Progress → Overdue / Closed / Inactive

**Dual Audit:** `AuditLog` (system-wide compliance) + `TaskActivity` (per-task operational feed) — always both on every status change.

---

## RUNNING TESTS

```cmd
cd backend
npm run test:setup
npm run test
npm run test -- auth.test.ts
```

Always targets `sqd_qa_test_db` (Rule 8). Database wiped in `beforeEach`. The full suite must pass before and after every change (last recorded baseline ≈499, `CLAUDE_HANDOVER.md` rev 17, 2026-06-18 — always verify the actual current count with `npm test` before starting; the number grows as features land).

---

## ENVIRONMENT VARIABLES

**Backend** (`.env`):
```
DATABASE_URL="postgresql://user:password@localhost:5432/sqd_qa_db"
JWT_SECRET="super-secret-development-key-12345"
ENFORCE_SINGLE_SESSION=true
```
**Frontend:** auto-connects to `http://localhost:5000`

---

## COMMON COMMANDS

> cmd syntax only — never PowerShell

```cmd
REM Database
cd backend && npx prisma generate
cd backend && npx prisma db push
cd backend && npx prisma db seed

REM Lint
cd frontend && npm run lint

REM Production build
cd frontend && npm run build && npm run start
```

---

## SECURITY STATUS

All original 2026-05-29 audit findings are **implemented** (branch `claude/amazing-ritchie-soasus`). See `CLAUDE_HANDOVER.md` §11 for detail.

**Open deferred items** (from Task slice security review, 2026-06-14 — see `CODE_REVIEW_AUDIT_LOG.md`):
- **DEF-1:** Rich text rendered via Tiptap is safe today; if ever rendered outside `RichTextEditor` (e.g. migrations, CSV import), sanitise with DOMPurify first.
- **DEF-2:** `SearchableSelect` has no keyboard navigation — fails WCAG keyboard-only (internal tool, address before external audit).
- **DEF-3:** `transferIssuerRights` has no division-scope check on target (only role checked). Low risk at current privilege matrix.
- **DEF-4:** `task:assign_div` holders can assign on tasks targeted at another division — needs product confirmation before locking.
- **DEF-5:** (File Upload, 2026-06-16) No `PUT` endpoint for `FILE_UPLOAD_CONFIG` yet — limits change via direct DB upsert until a settings-panel endpoint is added.
- **DEF-6:** (File Upload, 2026-06-16) Attachment `list`/`download` are auth-only (no per-entity scope), consistent with the transparency model. Add a scope check at `attachmentService.assertEntityExists` if visibility is ever tightened.

All other findings from reviews on this branch are fixed. New findings from future reviews go in `CODE_REVIEW_AUDIT_LOG.md`.

---

## BEFORE STARTING ANY FEATURE

1. Re-read **NON-NEGOTIABLE RULES** above.
2. Read `CLAUDE_HANDOVER.md` Sections 1, 2, 3, 6, and 10.
3. Plan every file change, get approval before touching code (Rule 1).
4. Run `cd backend && npm run test` — confirm the full suite passes as your baseline (≈499 per `CLAUDE_HANDOVER.md` rev 17; verify the actual count).
5. After user confirms completion, update `CLAUDE_HANDOVER.md` (Rule 12).
6. After an accepted code/security review, update `CODE_REVIEW_AUDIT_LOG.md` (Rule 13).
