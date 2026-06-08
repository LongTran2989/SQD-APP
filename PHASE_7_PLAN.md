# Phase 7 — User Management & Settings: Implementation Plan

> **Status:** Planned, not started. Project Phase 7 (NOT the Feed & Escalation internal "Phase 1–5").
> **Goal:** DB-driven RBAC + admin user/role/division management + personal settings + admin-managed `WpType`/`EventType`.
> **Baseline before starting:** confirm `cd backend && npm run test` is green (handover says 187 on `main` Phase 6; higher on feature branches). Record the number.

This plan is staged so each step is independently shippable and keeps tests green. **Steps 1–2 are low-risk and self-contained. Step 3 is the heavy/risky one (touches every controller). Step 4 is frontend.** Do them in order.

---

## Pre-flight (every session, per CLAUDE.md NON-NEGOTIABLE RULES)

1. Plan before coding; list files; get explicit approval (Rule 1).
2. Soft-delete filter `where: { deletedAt: null }` on `User`/`Task`/`Finding`/`WorkPackage` (Rule 2).
3. Dual write `AuditLog` + `FeedPost(SYSTEM_EVENT)` on every significant event (Rule 3). Note: `TaskActivity` is now the unified `FeedPost` model.
4. Tests against `sqd_qa_test_db` only; `.env.test` loaded (Rule 8).
5. `npx prisma generate` in `/backend` after every `schema.prisma` change (Rule 9).
6. cmd syntax only in terminal examples (Rule 11).
7. Update `CLAUDE_HANDOVER.md` only after the user confirms a step is complete and tests pass (Rule 12).

---

## STEP 1 — `EventType` reference table (small, self-contained)

**Why:** `Finding.eventType` is a free `String`. The 9 event types are hardcoded in `frontend/src/components/findings/RaiseFindingPanel.tsx`. Phase 7 makes them admin-managed. Mirror the existing `AtaChapter` taxonomy pattern exactly.

### Schema (`backend/prisma/schema.prisma`)
Add alongside the other taxonomy models (near `AtaChapter`, ~line 431):
```prisma
model EventType {
  id        Int      @id @default(autoincrement())
  code      String   @unique // stable key, e.g. "PROCEDURAL_BREACH"
  label     String   // display label, e.g. "Procedural Breach"
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```
- **Reversible:** yes — additive model, no FK, no change to `Finding`. (Do NOT convert `Finding.eventType` to a FK in this step — keep it a string to avoid a data migration; the table is a managed picklist only.)
- Run `npx prisma db push` against **both** dev and test DBs, then `npx prisma generate`.

### Backend
- `backend/src/controllers/taxonomy.controller.ts` — add `listEventTypes` + `upsertEventType`, copying the `listAtaChapters` / `upsertAtaChapter` shape (lines 16–62).
- `backend/src/routes/taxonomy.routes.ts` — add:
  ```ts
  router.get('/event-types', listEventTypes);
  router.post('/event-types', authorizeRoles('Admin'), upsertEventType);
  router.put('/event-types/:id', authorizeRoles('Admin'), upsertEventType);
  ```
  **GOTCHA / decision:** the existing taxonomy write routes (ata-chapters, cause-codes, hazard-tags) currently have **NO `authorizeRoles` guard** — any authenticated user can upsert them. For `EventType` add the `authorizeRoles('Admin')` guard. Flag the existing gap to the user and ask whether to retro-fit guards on the other three (separate decision).

### Seed
- `backend/prisma/seed.ts` — seed the 9 current values (codes + labels). Add an `eventTypes` section to `backend/prisma/data/seed-data.json` too (mirror existing sections).
  Values: Procedural Breach, Equipment Fault, Documentation Error, Maintenance Error, Safety Observation, Regulatory Non-compliance, Training Gap, Communication Failure, Other.

### Tests
- New `backend/src/__tests__/taxonomy.eventtype.test.ts` (or extend an existing taxonomy test if one exists): list returns seeded rows; Admin can create/update; non-Admin gets 403; duplicate `code` rejected.

### Acceptance
- `GET /api/taxonomy/event-types` returns active types; Admin-only writes; tests green; no change to `Finding` behavior.

---

## STEP 2 — Security fixes (deferred items from CLAUDE.md §SECURITY NOTES)

All in `backend/src/controllers/auth.controller.ts`. Independent of Step 1.

### 2a. `updatePassword` — require current password (lines 124–175)
- **Current bug:** accepts only `newPassword`; anyone with a valid session token can change the password.
- **Fix:** require `currentPassword`; load the user; `bcrypt.compare(currentPassword, user.passwordHash)`; 400/401 on mismatch before hashing the new one.
- **CAVEAT — first-login flow:** the forced-password-change flow (login returns 202 + token when `forcePasswordChange=true`) uses this same endpoint and the user does know their temp password, so requiring `currentPassword` is fine. **Verify** `frontend` first-login screen sends the temp password as `currentPassword`. If it doesn't, update the frontend call too, or branch: skip the check only when `forcePasswordChange === true` (decision — ask user; recommend NOT skipping, just wire the frontend).

### 2b. Reset tokens stored plaintext (lines 190–198, `resetPassword` 226–249)
- **Fix:** store only a hash. On `forgotPassword`: generate `resetToken` (raw, emailed) but persist `crypto.createHash('sha256').update(resetToken).digest('hex')` into `resetPasswordToken`. On `resetPassword`: hash the incoming token the same way before the `findFirst` lookup.
- Schema unchanged (still `String?`). Reversible.

### 2c. (Already fixed — verify only)
- `forgotPassword` enumeration is **already** mitigated (generic 200, no 404). No change. JWT fallback `'fallback_secret'` (lines 54, 156) and login rate-limiting are separate hardening items — **out of scope for Step 2 unless user asks**; note them.

### Tests
- Extend `backend/src/__tests__/auth.test.ts`: updatePassword rejects wrong/missing `currentPassword` (400/401); succeeds with correct one. resetPassword works end-to-end with the hashed-token flow; a raw token that isn't the stored hash fails.

### Acceptance
- Both fixes covered by tests; full suite green; first-login flow still works manually.

---

## STEP 3 — RBAC config extraction → activate `PrivilegeConfig` (heavy / risky)

> **Get a fresh approval before starting Step 3.** It touches ~10 controllers. Do it as its own session/PR.

**Current state:** rules are scattered constants + inline conditionals:
- `backend/src/middleware/rbac.middleware.ts` — only coarse `authorizeRoles(...roles)`.
- `backend/src/controllers/task.controller.ts` — `TASK_CREATOR_ROLES = ['Manager','Director','Admin']` (line ~20), `isReviewer()` (lines ~115–125), plus inline checks for assign/reassign/rate/deadline/post-rejection.
- Similar inline checks in `wp.controller.ts`, `template.controller.ts`, `finding.controller.ts`, `capa.controller.ts`.

**Target:** a single in-code permissions map that `PrivilegeConfig` (schema.prisma:653–658, `roleId @unique`, `permissions Json`) can override at runtime.

### 3a. Define the permission catalogue
- New `backend/src/config/permissions.ts`: enumerate every gated action as a stable key (e.g. `TASK_CREATE`, `TASK_REVIEW`, `TASK_REASSIGN`, `WP_CREATE`, `WP_ASSIGN`, `TEMPLATE_PUBLISH`, `FINDING_CLOSE`, `USER_MANAGE`, `TAXONOMY_MANAGE`, `PRIVILEGE_MANAGE`, …). Export `DEFAULT_PERMISSIONS: Record<RoleName, PermissionKey[]>` mirroring today's hardcoded rules **exactly** (default config must reproduce current behavior — this is the regression guard).
- Keep **division-scoping** logic (e.g. "Manager of same division") as a separate concern — `PrivilegeConfig` governs *action* grants; scope predicates (`isReviewer`'s `userDivisionId === task.targetDivisionId`) stay in code. Document this split clearly.

### 3b. Central resolver
- New `backend/src/services/privilegeService.ts`: `can(roleName, permissionKey): Promise<boolean>` that reads `PrivilegeConfig` for the role and falls back to `DEFAULT_PERMISSIONS` when no row exists. Cache per-request or with short TTL (avoid a DB hit per check).
- New middleware `requirePermission(key)` in `rbac.middleware.ts` (keep `authorizeRoles` for simple cases / backward compat).

### 3c. Migrate callsites incrementally
- Replace `TASK_CREATOR_ROLES.includes(...)` and similar with `await can(role, 'TASK_CREATE')`, one controller per commit, running tests after each. Leave scope predicates intact.

### 3d. Seed + admin endpoints
- Seed `PrivilegeConfig` from `DEFAULT_PERMISSIONS` (add to `seed.ts` + `seed-data.json`, status REVIEW→SEEDED).
- New `backend/src/controllers/privilege.controller.ts` + `routes/privilege.routes.ts`: `GET /api/privileges` (current effective map), `PUT /api/privileges/:roleId` (Admin only, dual-write `AuditLog('PRIVILEGE_UPDATED')` + an ORG `FeedPost` SYSTEM_EVENT). Register in `src/index.ts` (`app.use('/api/privileges', …)`).

### Tests
- `backend/src/__tests__/rbac.test.ts` already exists — extend it. Add `privilege.test.ts`: default map reproduces current grants; overriding a role's `PrivilegeConfig` flips a previously-denied action; Admin-only on the write endpoint.

### Acceptance
- **Zero behavior change with the default/seeded config** (the whole existing suite stays green). A `PrivilegeConfig` override demonstrably changes an authorization outcome. Then update CLAUDE.md/handover to mark RBAC as DB-driven.

---

## STEP 4 — Frontend dashboard pages (Next.js 15 — read `frontend/node_modules/next/dist/docs/` first)

Depends on Steps 1–3 endpoints. Each page is independent; ship per page.

### 4a. `/dashboard/users` (Admin only)
- List users (needs **new backend endpoints**: `GET /api/users` with RBAC scope + soft-delete filter, `POST /api/users` create, `PUT /api/users/:id` edit division/details, `DELETE /api/users/:id` = soft delete `deletedAt`). Today only `PUT /:id/role` exists (`user.routes.ts:9`). Add these in this step (or fold into Step 1/3 as a "user CRUD" sub-task).
- Table + create/edit modals; role dropdown (reuse existing `PUT /:id/role`); division dropdown; soft-delete action.

### 4b. `/dashboard/settings` (all roles)
- Personal: change password (wired to the hardened `POST /api/auth/update-password` with `currentPassword`); show profile (name, employeeId, division, role read-only).

### 4c. Admin: manage `WpType` and `EventType`
- `WpType` endpoints already exist (`GET`/`POST /api/work-packages/types`). `EventType` from Step 1. Simple CRUD tables. Point `RaiseFindingPanel.tsx` at `GET /api/taxonomy/event-types` instead of the hardcoded array (remove the 9-item literal; keep "Other" free-text fallback).

### 4d. `/settings/privileges` (Admin only) — Global Privilege Management panel
- Render the permission catalogue as a Role × Permission toggle grid from `GET /api/privileges`. Changes staged client-side; explicit **Publish** button → `PUT /api/privileges/:roleId`. Confirmation step before going live (handover §3.4a requirement).

### Frontend checks each page
- `cd frontend && npm run lint` (baseline ~70 errors/23 warnings — zero NEW), `tsc --noEmit` clean, `next build` exit 0.

---

## Suggested branch / PR strategy
- Branch per step off `main` (or current integration branch): `claude/phase7-eventtype`, `claude/phase7-security`, `claude/phase7-rbac-privilegeconfig`, `claude/phase7-frontend`.
- Keep Step 3 isolated in its own PR for careful review.
- Do NOT open a PR unless the user asks.

## Open decisions to surface to the user before coding
1. Retro-fit `authorizeRoles('Admin')` onto existing taxonomy write routes (ata-chapters/cause-codes/hazard-tags), or only guard the new EventType? (Recommend: guard all — quick win.)
2. `updatePassword` — wire frontend to send temp password as `currentPassword`, vs. skip the check when `forcePasswordChange===true`? (Recommend: wire frontend, no skip.)
3. Scope of Step 3 user-CRUD: build full `GET/POST/PUT/DELETE /api/users` in Step 3 or defer to Step 4a? (Recommend: build endpoints in a short "Step 3.5" so 4a is pure UI.)
4. Include JWT-secret hardening + login rate-limiting now, or keep deferred? (Recommend: separate security pass, not Phase 7.)
