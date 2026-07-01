# Task Management Module Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bulk-preloaded dropdowns in Task creation flows with async search, add a lock-free Task ID sequence, and close several small UI gaps (Task Title, Estimated Hours, Task List subtitle, WP unlink) in the Task Management module.

**Architecture:** Backend gets an atomic `TaskSequence` upsert to replace the row-locked `findFirst` ID generator, plus search (`q`/`limit`/`divisionId`) params bolted onto the existing single `/datasources/:source` endpoint (backward compatible — no params = current unfiltered behavior, used by ~15 other call sites). Frontend gets a new `AsyncSearchableSelect` wrapping the existing `SearchableSelect` (two small additive props: `loading`, `noResultsLabel`, `serverFiltered`), then `TaskCreateForm` and `QuickTaskForm` are rewired onto it. Design source: `docs/superpowers/specs/2026-07-01-task-management-improvements-design.md`.

**Tech Stack:** Express 5 + TypeScript + Prisma v6 (backend), Next.js 16 / React 19 / TypeScript strict (frontend), Jest 30 + Supertest (backend tests only — frontend has no test runner, verification is `tsc --noEmit` + `eslint` + manual dev-server checks).

## Global Constraints

- Rule 2 (soft delete): every new/modified query on `User`, `Task`, `WorkPackage` MUST filter `deletedAt: null`.
- Rule 8: backend tests always run against `sqd_qa_test_db` via `cd backend && npm test` (loads `.env.test` automatically). Never run bare `jest`.
- Rule 9: run `npx prisma generate` in `/backend` after every `schema.prisma` change.
- Rule 11: backend terminal commands use cmd syntax per CLAUDE.md; the commands below are plain cross-shell commands (npm/npx/git) so they work as given in bash or cmd.
- Migration workflow is `backend/prisma/migrations/README.md`, **not** the simplified `db push` line in CLAUDE.md's Quick Start: schema changes go through `npx prisma migrate dev --name <name>`, commit the schema + migration folder together, never hand-edit an already-applied migration folder.
- `getUsers()`/`getDivisions()`/`getDatasource(source)` (no params) are called with **no query params from ~15 other call sites** across the app (findings, WP assignment, time booking, escalation modal, user management settings, template sets, etc.). Every backend change to `/datasources/:source` MUST leave the no-params response byte-identical to today — `q`/`limit`/`divisionId` are opt-in filters only, applied only when explicitly provided.
- No new Task indexes (confirmed redundant with existing 3-column composites — see design doc §"Corrections", item 2).
- Deadline-offset auto-calc is out of scope for this plan (no backing schema field — dropped per design doc).

---

### Task 1: `TaskSequence` model, migration, backfill

**Files:**
- Modify: `backend/prisma/schema.prisma:313` (insert new model after `Task`, before `TaskData`)
- Create: `backend/prisma/migrations/<timestamp>_add_task_sequence/migration.sql` (generated, then hand-appended)

**Interfaces:**
- Produces: `prisma.taskSequence.upsert({ where: { divisionCode }, create: { divisionCode, sequence }, update: { sequence: { increment: 1 } } })` — consumed by Task 2.

- [ ] **Step 1: Add the model to `schema.prisma`**

Insert immediately after line 313 (the `Task` model's closing `}`), before `model TaskData {`:

```prisma
model TaskSequence {
  divisionCode String @id
  sequence     Int    @default(0)
}
```

- [ ] **Step 2: Generate the migration**

Run from `/backend`:
```
npx prisma migrate dev --name add_task_sequence
```
Expected: a new folder `backend/prisma/migrations/<timestamp>_add_task_sequence/migration.sql` containing a single `CREATE TABLE "TaskSequence" (...)` statement, applied to `sqd_qa_db`.

- [ ] **Step 3: Hand-append the backfill SQL to the generated migration file**

Open the newly generated `migration.sql` and append at the end (this is the same pattern already used in `20260623000100_add_status_check_constraints` for raw SQL Prisma can't express — see `backend/prisma/migrations/README.md` "Case A-special"):

```sql
-- Backfill: seed TaskSequence with the highest already-issued sequence number
-- per division, so IDs generated going forward never collide with existing
-- Task rows (including soft-deleted ones — taskId stays globally unique
-- regardless of deletedAt). Divisions with no existing tasks get no row;
-- their first generateTaskId() upsert correctly starts them at 1.
INSERT INTO "TaskSequence" ("divisionCode", "sequence")
SELECT
  split_part("taskId", '-', 1) AS "divisionCode",
  MAX(CAST(split_part("taskId", '-', 2) AS INTEGER)) AS "sequence"
FROM "Task"
WHERE "taskId" ~ '^[A-Za-z0-9]+-[0-9]+$'
GROUP BY split_part("taskId", '-', 1)
ON CONFLICT ("divisionCode") DO UPDATE SET "sequence" = EXCLUDED."sequence";
```

- [ ] **Step 4: Re-apply the migration with the backfill included**

Run from `/backend`:
```
npx prisma migrate dev --name add_task_sequence
```
Prisma will detect the migration is already recorded but the file changed underneath it in dev — if it reports drift, run `npx prisma migrate reset --force` instead (dev-only, per README "Case D-1": drops, recreates, replays every migration including the edited one, then reseeds). Confirm no errors.

- [ ] **Step 5: Regenerate the Prisma client (Rule 9)**

```
npx prisma generate
```

- [ ] **Step 6: Manually verify the backfill against the dev DB**

This cannot be covered by the Jest suite — `test:setup` uses `db push` for speed, which does not execute raw-SQL migration content (`backend/prisma/migrations/README.md`, "Tests" bullet). Verify directly against `sqd_qa_db`:
```
npx prisma studio
```
Or via a one-off query — open a psql/DB client against `sqd_qa_db` and run:
```sql
SELECT s."divisionCode", s.sequence,
       (SELECT MAX(CAST(split_part(t."taskId", '-', 2) AS INTEGER)))
FROM "TaskSequence" s
JOIN "Task" t ON split_part(t."taskId", '-', 1) = s."divisionCode"
GROUP BY s."divisionCode", s.sequence;
```
Expected: `sequence` equals the max in every row (no mismatches). If a division has tasks but no `TaskSequence` row, the backfill regex or grouping has a bug — stop and investigate before proceeding to Task 2.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add TaskSequence model with backfill for atomic task ID generation"
```

---

### Task 2: Refactor `generateTaskId` to use the atomic upsert

**Files:**
- Modify: `backend/src/controllers/task.controller.ts:85-103` (the `generateTaskId` function)
- Modify: `backend/src/controllers/task.controller.ts:844-846` (call site — remove the row lock)
- Test: `backend/src/__tests__/task.test.ts` (new `it` blocks in the existing `describe('Task Backend (Phase 5.2)', ...)` block)

**Interfaces:**
- Consumes: `TaskSequence` model from Task 1.
- Produces: `generateTaskId(divisionCode: string, tx: Prisma.TransactionClient): Promise<string>` — same signature as before, no callers outside this file need to change.

- [ ] **Step 1: Write the failing tests**

Add these two `it` blocks inside the existing `describe('Task Backend (Phase 5.2)', ...)` block in `backend/src/__tests__/task.test.ts` (after the existing task-creation tests — exact insertion point doesn't matter, it's a flat `it` list sharing the suite's `beforeAll` fixtures):

```ts
  it('generates unique taskIds under concurrent creation (TaskSequence atomicity)', async () => {
    const concurrency = 8;
    const requests = Array.from({ length: concurrency }, () =>
      request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ templateId: publishedTemplateId, targetDivisionId: divisionId })
    );
    const responses = await Promise.all(requests);
    responses.forEach((r) => expect(r.status).toBe(201));
    const taskIds = responses.map((r) => r.body.taskId as string);
    expect(new Set(taskIds).size).toBe(concurrency);
    taskIds.forEach((id) => expect(id).toMatch(/^TSK-\d{6}$/));
  });

  it('persists TaskSequence.sequence matching the highest issued taskId per division', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ templateId: publishedTemplateId, targetDivisionId: divisionId });
    expect(res.status).toBe(201);
    const issuedSeq = Number((res.body.taskId as string).split('-')[1]);
    const seqRow = await prisma.taskSequence.findUnique({ where: { divisionCode: 'TSK' } });
    expect(seqRow?.sequence).toBe(issuedSeq);
  });
```

- [ ] **Step 2: Run the tests to verify they fail (or pass coincidentally with the old implementation, then confirm the refactor doesn't regress them)**

```
cd backend && npm test -- task.test.ts -t "TaskSequence"
```
Expected: the second test fails with `Cannot read properties of null (reading 'sequence')` — `prisma.taskSequence` won't return a row yet because `generateTaskId` doesn't write to it until Step 3.

- [ ] **Step 3: Refactor `generateTaskId`**

Replace lines 85-103 of `backend/src/controllers/task.controller.ts`:

```ts
async function generateTaskId(divisionCode: string, tx: Prisma.TransactionClient): Promise<string> {
  const lastTask = await tx.task.findFirst({
    where: { taskId: { startsWith: `${divisionCode}-` } },
    orderBy: { id: 'desc' },
    select: { taskId: true }
  });
  let nextSeq = 1;
  if (lastTask?.taskId) {
    const parts = lastTask.taskId.split('-');
    const seqPart = parts[parts.length - 1];
    if (seqPart) nextSeq = parseInt(seqPart, 10) + 1;
  }
  return `${divisionCode}-${String(nextSeq).padStart(6, '0')}`;
}
```

with:

```ts
async function generateTaskId(divisionCode: string, tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.taskSequence.upsert({
    where: { divisionCode },
    create: { divisionCode, sequence: 1 },
    update: { sequence: { increment: 1 } }
  });
  return `${divisionCode}-${String(seq.sequence).padStart(6, '0')}`;
}
```

- [ ] **Step 4: Remove the now-redundant Division row lock at the call site**

In `createTaskService` (around line 844-846), remove the raw-SQL lock — it existed solely to prevent taskId collisions, which the `TaskSequence` upsert now guarantees atomically via Postgres's `ON CONFLICT` row-level locking:

Before:
```ts
  // Lock division row to prevent concurrent taskId collisions (requires a tx).
  await client.$queryRaw`SELECT id FROM "Division" WHERE id = ${targetDivisionId} FOR UPDATE`;
  const newTaskId = await generateTaskId(targetDiv.code, client as Prisma.TransactionClient);
```

After:
```ts
  const newTaskId = await generateTaskId(targetDiv.code, client as Prisma.TransactionClient);
```

- [ ] **Step 5: Run the tests to verify they pass**

```
cd backend && npm test -- task.test.ts
```
Expected: full `task.test.ts` suite passes, including the two new tests.

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

```
cd backend && npm test
```
Expected: same pass count as the pre-change baseline (confirm the current count first if unsure — CLAUDE.md's ≈499 is a rough baseline, not exact).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/task.controller.ts backend/src/__tests__/task.test.ts
git commit -m "refactor: replace row-locked task ID generation with atomic TaskSequence upsert"
```

---

### Task 3: Datasource search — extend `users` and `divisions`

**Files:**
- Modify: `backend/src/controllers/datasource.controller.ts`
- Create: `backend/src/__tests__/datasource.test.ts`

**Interfaces:**
- Produces: `GET /api/datasources/users?q=&limit=&divisionId=` and `GET /api/datasources/divisions?q=&limit=` — both **backward compatible**: omitting all params returns the exact same unfiltered/uncapped result as today. Consumed by Task 6 (`AsyncSearchableSelect` fetchers) and Task 4 (pattern reuse for `workpackages`).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/__tests__/datasource.test.ts`:

```ts
import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function makeToken(userId: number, role: string, divisionId: number): string {
  const secret = process.env.JWT_SECRET || 'fallback_secret';
  return jwt.sign({ userId, role, divisionId }, secret);
}

describe('Datasource search endpoints', () => {
  let token: string;
  let divisionAId: number;
  let divisionBId: number;
  let userA1Id: number;
  let userA2Id: number;
  let userB1Id: number;

  beforeAll(async () => {
    const staffRole = await prisma.role.upsert({ where: { name: 'Staff' }, update: {}, create: { name: 'Staff' } });
    const deptA = await prisma.department.upsert({ where: { name: 'Datasource Test Dept A' }, update: {}, create: { name: 'Datasource Test Dept A' } });
    const deptB = await prisma.department.upsert({ where: { name: 'Datasource Test Dept B' }, update: {}, create: { name: 'Datasource Test Dept B' } });
    const divA = await prisma.division.upsert({ where: { code: 'DSA' }, update: {}, create: { name: 'Datasource Div A', code: 'DSA', departmentId: deptA.id } });
    const divB = await prisma.division.upsert({ where: { code: 'DSB' }, update: {}, create: { name: 'Datasource Div B', code: 'DSB', departmentId: deptB.id } });
    divisionAId = divA.id;
    divisionBId = divB.id;

    const userA1 = await prisma.user.create({ data: { name: 'Alice Anderson', employeeId: 'DSA0001', email: 'alice.ds@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: divisionAId, roleId: staffRole.id } });
    userA1Id = userA1.id;
    const userA2 = await prisma.user.create({ data: { name: 'Aaron Alvarez', employeeId: 'DSA0002', email: 'aaron.ds@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: divisionAId, roleId: staffRole.id } });
    userA2Id = userA2.id;
    const userB1 = await prisma.user.create({ data: { name: 'Bob Baker', employeeId: 'DSB0001', email: 'bob.ds@sqd.com', passwordHash: 'hash', forcePasswordChange: false, divisionId: divisionBId, roleId: staffRole.id } });
    userB1Id = userB1.id;

    token = makeToken(userA1Id, 'Staff', divisionAId);
  });

  it('returns the full unfiltered users list when no q/limit/divisionId is given (backward compatible)', async () => {
    const res = await request(app).get('/api/datasources/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((u: any) => Number(u.value));
    expect(ids).toEqual(expect.arrayContaining([userA1Id, userA2Id, userB1Id]));
  });

  it('filters users by name/employeeId substring when q is given', async () => {
    const res = await request(app).get('/api/datasources/users?q=Alvarez').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => Number(u.value))).toEqual([userA2Id]);
  });

  it('caps results at the given limit, max 20', async () => {
    const res = await request(app).get('/api/datasources/users?limit=1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('filters users by divisionId when given', async () => {
    const res = await request(app).get(`/api/datasources/users?divisionId=${divisionBId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((u: any) => Number(u.value));
    expect(ids).toContain(userB1Id);
    expect(ids).not.toContain(userA1Id);
  });

  it('filters divisions by q when given, and stays unfiltered without it', async () => {
    const filtered = await request(app).get('/api/datasources/divisions?q=Div B').set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.map((d: any) => Number(d.value))).toEqual([divisionBId]);

    const unfiltered = await request(app).get('/api/datasources/divisions').set('Authorization', `Bearer ${token}`);
    expect(unfiltered.status).toBe(200);
    const ids = unfiltered.body.map((d: any) => Number(d.value));
    expect(ids).toEqual(expect.arrayContaining([divisionAId, divisionBId]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

```
cd backend && npm test -- datasource.test.ts
```
Expected: `q`/`limit`/`divisionId` tests fail (params are currently ignored, `divisions?q=Div B` returns everything, `limit=1` returns everything).

- [ ] **Step 3: Implement — extend `users` and `divisions` cases**

In `backend/src/controllers/datasource.controller.ts`, add parameter parsing at the top of `getDataSource` (after `const source = ...`):

```ts
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limitParam = Number(req.query.limit);
    // undefined = no cap, preserving today's unlimited behavior for every
    // existing caller that doesn't pass `limit` (see Global Constraints).
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : undefined;
```

Replace the `divisions` case:
```ts
      case 'divisions': {
        const divisions = await prisma.division.findMany({
          where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
          select: { id: true, name: true, department: { select: { name: true } } },
          orderBy: { name: 'asc' },
          take: limit
        });
        res.json(divisions.map(d => ({
          value: String(d.id),
          label: `${d.name} (${d.department.name})`
        })));
        return;
      }
```

Replace the `users` case:
```ts
      case 'users': {
        const divisionIdParam = Number(req.query.divisionId);
        const divisionId = Number.isFinite(divisionIdParam) && divisionIdParam > 0 ? divisionIdParam : undefined;
        const users = await prisma.user.findMany({
          select: { id: true, name: true, employeeId: true, divisionId: true },
          where: {
            deletedAt: null,
            role: { name: { notIn: ['Admin', 'Senior Advisor'] } },
            ...(divisionId ? { divisionId } : {}),
            ...(q ? { OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { employeeId: { contains: q, mode: 'insensitive' } }
            ] } : {})
          },
          orderBy: { name: 'asc' },
          take: limit
        });
        res.json(users.map(u => ({ value: String(u.id), label: `${u.name} (${u.employeeId ?? ''})`, divisionId: u.divisionId })));
        return;
      }
```

- [ ] **Step 4: Run to verify pass**

```
cd backend && npm test -- datasource.test.ts
```
Expected: all pass.

- [ ] **Step 5: Run the full backend suite to confirm no regressions in the other ~15 callers**

```
cd backend && npm test
```
Expected: same pass count as before Task 2 (no drop).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/datasource.controller.ts backend/src/__tests__/datasource.test.ts
git commit -m "feat: add search/limit/divisionId params to users and divisions datasources"
```

---

### Task 4: Datasource search — add `workpackages`

**Files:**
- Modify: `backend/src/controllers/datasource.controller.ts`
- Modify: `backend/src/__tests__/datasource.test.ts`

**Interfaces:**
- Produces: `GET /api/datasources/workpackages?q=&limit=` — new source, no backward-compat concern (didn't exist before). Consumed by Task 6/7.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/__tests__/datasource.test.ts`, inside the same `describe` block (extend `beforeAll` and add an `it`):

In `beforeAll`, after the existing user creation, add a work package fixture (`WorkPackage` has no required template FK on base fields — only `divisionId` and `creatorId`):
```ts
    const wp = await prisma.workPackage.create({
      data: {
        wpId: 'DSA-WP-000001',
        name: 'Datasource Search Test WP',
        type: 'AUDIT',
        divisionId: divisionAId,
        timeframeFrom: new Date(),
        timeframeTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        creatorId: userA1Id,
        status: 'Open'
      }
    });
    const closedWp = await prisma.workPackage.create({
      data: {
        wpId: 'DSA-WP-000002',
        name: 'Datasource Closed Test WP',
        type: 'AUDIT',
        divisionId: divisionAId,
        timeframeFrom: new Date(),
        timeframeTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        creatorId: userA1Id,
        status: 'Closed'
      }
    });
    wpId = wp.id;
    closedWpId = closedWp.id;
```
(add `let wpId: number;` and `let closedWpId: number;` to the shared `let` declarations at the top of the `describe` block, alongside the existing ones.)

Add the test:
```ts
  it('searches work packages by wpId/name, excludes Closed, respects limit', async () => {
    const res = await request(app).get('/api/datasources/workpackages?q=Search Test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((w: any) => Number(w.value));
    expect(ids).toContain(wpId);
    expect(ids).not.toContain(closedWpId);
  });
```

- [ ] **Step 2: Run to verify failure**

```
cd backend && npm test -- datasource.test.ts -t "work packages"
```
Expected: fails with 400 `Unknown data source: workpackages`.

- [ ] **Step 3: Implement — add the `workpackages` case**

In `backend/src/controllers/datasource.controller.ts`, add a new case (after `registrations`, before `default`):

```ts
      case 'workpackages': {
        const workPackages = await prisma.workPackage.findMany({
          select: { id: true, wpId: true, name: true },
          where: {
            deletedAt: null,
            status: { notIn: ['Closed', 'Inactive'] },
            ...(q ? { OR: [
              { wpId: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } }
            ] } : {})
          },
          orderBy: { wpId: 'asc' },
          take: limit
        });
        res.json(workPackages.map(w => ({ value: String(w.id), label: `${w.wpId} — ${w.name}` })));
        return;
      }
```

- [ ] **Step 4: Run to verify pass**

```
cd backend && npm test -- datasource.test.ts
```

- [ ] **Step 5: Full suite regression check**

```
cd backend && npm test
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/datasource.controller.ts backend/src/__tests__/datasource.test.ts
git commit -m "feat: add workpackages datasource search endpoint"
```

---

### Task 5: Backend — `findingId` on `taskInclude()`

**Files:**
- Modify: `backend/src/controllers/task.controller.ts:296-306` (`taskInclude()`)
- Modify: `frontend/src/types/index.ts:182` (`TaskEnriched.parentFinding` type)
- Test: `backend/src/__tests__/task.test.ts`

**Interfaces:**
- Produces: `TaskEnriched.parentFinding: { id: number; findingId: string | null } | null` — consumed by Task 12 (Task List subtitle).

- [ ] **Step 1: Write the failing test**

`Finding`'s required fields are `description`, `eventType`, `reportedByUserId`, and `departmentId` (see `backend/prisma/schema.prisma:329-356`; `targetDivisionId` is optional and not needed here). Add to `backend/src/__tests__/task.test.ts`, inside the existing `describe('Task Backend (Phase 5.2)', ...)` block:

```ts
  it('includes findingId on parentFinding in task responses', async () => {
    const dept = await prisma.department.upsert({
      where: { name: 'Task Test Dept (findingId case)' },
      update: {},
      create: { name: 'Task Test Dept (findingId case)' }
    });
    const finding = await prisma.finding.create({
      data: {
        findingId: 'DSK-000001',
        description: 'Test finding for parentFinding.findingId assertion',
        eventType: 'Other',
        status: 'Open',
        reportedByUserId: directorId,
        departmentId: dept.id
      }
    });
    const followUp = await prisma.task.create({
      data: {
        taskId: 'TSK-900001',
        templateId: publishedTemplateId,
        issuerId: directorId,
        targetDivisionId: divisionId,
        status: 'Unassigned',
        schemaSnapshot: [],
        parentFindingId: finding.id
      }
    });
    const res = await request(app)
      .get(`/api/tasks/${followUp.id}`)
      .set('Authorization', `Bearer ${directorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.parentFinding).toEqual({ id: finding.id, findingId: 'DSK-000001' });
  });
```

- [ ] **Step 2: Run to verify failure**

```
cd backend && npm test -- task.test.ts -t "findingId on parentFinding"
```
Expected: fails — `res.body.parentFinding` is `{ id: ... }` without `findingId`.

- [ ] **Step 3: Implement**

In `backend/src/controllers/task.controller.ts`, change line 296-306:
```ts
function taskInclude() {
  return {
    template: { select: { id: true, templateId: true, title: true, allowsFindings: true } },
    issuer: { select: { id: true, name: true } },
    assignedToUser: { select: { id: true, name: true, role: { select: { name: true } } } },
    targetDivision: { select: { id: true, name: true, code: true } },
    wp: { select: { id: true, wpId: true, name: true } },
    timeBooking: true,
    parentFinding: { select: { id: true, findingId: true } }
  };
}
```
(only the `parentFinding` line changes — add `findingId: true`.)

- [ ] **Step 4: Update the frontend type**

In `frontend/src/types/index.ts:182`:
```ts
  parentFinding?: { id: number; findingId: string | null } | null;
```

- [ ] **Step 5: Run to verify pass**

```
cd backend && npm test -- task.test.ts
```

- [ ] **Step 6: Full suite regression check**

```
cd backend && npm test
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/task.controller.ts backend/src/__tests__/task.test.ts frontend/src/types/index.ts
git commit -m "feat: include human-readable findingId on task's parentFinding"
```

---

### Task 6: Frontend — `AsyncSearchableSelect` component

**Files:**
- Modify: `frontend/src/components/ui/SearchableSelect.tsx` (three new optional, backward-compatible props)
- Create: `frontend/src/components/ui/AsyncSearchableSelect.tsx`
- Modify: `frontend/src/api/taskApi.ts` (`getDatasource` signature)

**Interfaces:**
- Consumes: `GET /api/datasources/:source?q=&limit=&divisionId=` from Tasks 3-4.
- Produces: `<AsyncSearchableSelect value onChange fetchOptions placeholder? clearable? clearLabel? disabled? id? minChars? debounceMs? />` where `fetchOptions: (query: string) => Promise<SearchableSelectOption[]>` — consumed by Tasks 7 and 11.

- [ ] **Step 1: Extend `SearchableSelect` with `loading`, `noResultsLabel`, `serverFiltered`**

In `frontend/src/components/ui/SearchableSelect.tsx`, add three optional props to `SearchableSelectProps` (after `onQueryChange`):
```ts
  /** External loading state (e.g. an in-flight async search) — shows a spinner
   *  in the dropdown instead of the options list. */
  loading?: boolean;
  /** Overrides the "No results" text shown when the option list is empty. */
  noResultsLabel?: string;
  /** When true, skip the internal client-side substring filter — the caller
   *  (e.g. AsyncSearchableSelect) has already filtered `options` server-side. */
  serverFiltered?: boolean;
```

Add them to the function signature's destructured props (after `onQueryChange,`):
```ts
  loading = false,
  noResultsLabel,
  serverFiltered = false,
```

Change the `filteredOptions` computation (line 53-55):
```ts
  const filteredOptions = serverFiltered
    ? options
    : query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
      : options;
```

Change the options-list rendering block (lines 199-202) from:
```tsx
            {listItems.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400 text-center" role="status">
                No results
              </p>
            ) : (
```
to:
```tsx
            {loading ? (
              <p className="px-4 py-3 text-sm text-slate-400 text-center flex items-center justify-center gap-2" role="status">
                <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                Searching…
              </p>
            ) : listItems.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400 text-center" role="status">
                {noResultsLabel ?? 'No results'}
              </p>
            ) : (
```

- [ ] **Step 2: Verify `SearchableSelect` still type-checks and lints**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```
Expected: no new errors. All existing 15+ call sites omit the three new props, which default to unchanged behavior (`loading=false`, `noResultsLabel=undefined` → falls back to `'No results'`, `serverFiltered=false` → same filter as before).

- [ ] **Step 3: Create `AsyncSearchableSelect.tsx`**

```tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import SearchableSelect, { SearchableSelectOption } from './SearchableSelect';

interface AsyncSearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  fetchOptions: (query: string) => Promise<SearchableSelectOption[]>;
  placeholder?: string;
  clearable?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  id?: string;
  minChars?: number;
  debounceMs?: number;
}

export default function AsyncSearchableSelect({
  value,
  onChange,
  fetchOptions,
  placeholder = 'Search…',
  clearable = false,
  clearLabel = 'None',
  disabled = false,
  id,
  minChars = 3,
  debounceMs = 300,
}: AsyncSearchableSelectProps) {
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const runFetch = useCallback((q: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    fetchOptions(q)
      .then((results) => {
        if (requestId !== requestIdRef.current) return; // stale response, ignore
        setOptions((prev) => {
          // Keep the currently-selected option visible even if the new
          // result set doesn't include it, so the trigger never reverts to
          // showing a blank value mid-search.
          const selected = prev.find((o) => o.value === value);
          if (value && selected && !results.some((o) => o.value === value)) {
            return [selected, ...results];
          }
          return results;
        });
      })
      .catch(() => {
        // non-fatal — leave existing options in place
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOptions, value]);

  // Resolve a label for a pre-filled value (e.g. a division defaulted from
  // the creator's own profile) before any search has run.
  useEffect(() => {
    if (value && !options.some((o) => o.value === value)) {
      runFetch('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < minChars) {
      setOptions((prev) => prev.filter((o) => o.value === value));
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runFetch(q.trim()), debounceMs);
  };

  const belowThreshold = query.trim().length < minChars;

  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      onQueryChange={handleQueryChange}
      placeholder={placeholder}
      clearable={clearable}
      clearLabel={clearLabel}
      disabled={disabled}
      loading={loading}
      serverFiltered
      noResultsLabel={belowThreshold ? `Type at least ${minChars} characters to search` : 'No results'}
    />
  );
}
```

- [ ] **Step 4: Update `getDatasource` in `taskApi.ts` to accept search params**

In `frontend/src/api/taskApi.ts`, replace lines 366-369:
```ts
export const getDatasource = (
  source: string
): Promise<{ value: string; label: string }[]> =>
  apiClient.get(`/datasources/${source}`).then((r) => r.data);
```
with:
```ts
export const getDatasource = (
  source: string,
  params?: { q?: string; limit?: number; divisionId?: number }
): Promise<{ value: string; label: string; divisionId?: number | null }[]> =>
  apiClient.get(`/datasources/${source}`, { params }).then((r) => r.data);
```
This is backward compatible — the 4 existing no-arg call sites (`getDatasource('operators')`, `getDatasource('registrations')`, `getDatasource('departments')`, `getDatasource(field.dataSource)` in `TaskFormPanel.tsx`) pass `params: undefined`, which axios omits entirely from the query string, identical to today's request.

- [ ] **Step 5: Type-check and lint**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 6: Manual smoke check**

```
cd frontend && npm run dev
```
No page currently uses `AsyncSearchableSelect` yet (wired up in Task 7), so this step just confirms the dev server still boots cleanly with no new TypeScript/build errors. Stop the server after confirming.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/SearchableSelect.tsx frontend/src/components/ui/AsyncSearchableSelect.tsx frontend/src/api/taskApi.ts
git commit -m "feat: add AsyncSearchableSelect with debounced server-side search"
```

---

### Task 7: `TaskCreateForm` — swap to async selects, remove bulk fetch

**Files:**
- Modify: `frontend/src/components/tasks/TaskCreateForm.tsx` (full rewrite of state/effects/selects; JSX structure unchanged elsewhere)

**Interfaces:**
- Consumes: `AsyncSearchableSelect` (Task 6), `getDatasource('divisions'|'users'|'workpackages', ...)` (Tasks 3-4), `getWorkPackageById` (existing, `frontend/src/api/wpApi.ts:9`).

- [ ] **Step 1: Replace the full file content**

Replace `frontend/src/components/tasks/TaskCreateForm.tsx` in full with:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { Template, WorkPackageDetail } from '../../types';
import { createTask, getDatasource } from '../../api/taskApi';
import { getWorkPackageById } from '../../api/wpApi';
import AsyncSearchableSelect from '../ui/AsyncSearchableSelect';
import { SearchableSelectOption } from '../ui/SearchableSelect';
import TemplatePickerModal from '../templates/TemplatePickerModal';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { FileCheck2, Clock, Info, FolderOpen, LayoutTemplate, X } from 'lucide-react';

export interface TaskCreateFormProps {
  prefilledWpId?: number | null;
  onSaved?: (taskId: number) => void;
  onCancel?: () => void;
}

export default function TaskCreateForm({ prefilledWpId, onSaved, onCancel }: TaskCreateFormProps) {
  const router = useRouter();
  const { user } = useAuthStore();

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [targetDivisionId, setTargetDivisionId] = useState<number | ''>(user?.divisionId ?? '');
  const [assignedToUserId, setAssignedToUserId] = useState<number | ''>('');
  const [deadline, setDeadline] = useState('');
  const [wpId, setWpId] = useState<number | ''>(prefilledWpId ?? '');
  const [issuanceNote, setIssuanceNote] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [skillLevel, setSkillLevel] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const [prefilledWp, setPrefilledWp] = useState<WorkPackageDetail | null>(null);
  const [readOnlyDivisionLabel, setReadOnlyDivisionLabel] = useState<string>('—');

  const templateId = selectedTemplate?.id;

  // Seed per-task overrides from the chosen template; the user can still override.
  useEffect(() => {
    if (selectedTemplate) {
      setRequiresApproval(selectedTemplate.requiresApproval);
      setSkillLevel(selectedTemplate.skillLevel ?? 0);
    }
  }, [selectedTemplate]);

  // Resolve the display name for a pre-selected work package (from the WP page).
  useEffect(() => {
    if (prefilledWpId) {
      getWorkPackageById(prefilledWpId).then(setPrefilledWp).catch(() => {});
    }
  }, [prefilledWpId]);

  const ELEVATED_ROLES = ['Manager', 'Director', 'Admin'];
  const isElevated = ELEVATED_ROLES.includes(user?.role ?? '');

  // Non-elevated users have a fixed target division (their own) with no
  // picker — resolve just that one division's label for the read-only display.
  useEffect(() => {
    if (!isElevated && targetDivisionId) {
      getDatasource('divisions', { limit: 20 }).then((divs) => {
        const match = divs.find((d) => d.value === String(targetDivisionId));
        if (match) setReadOnlyDivisionLabel(match.label);
      }).catch(() => {});
    }
  }, [isElevated, targetDivisionId]);

  const fetchDivisionOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('divisions', { q, limit: 20 });

  const fetchAssigneeOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('users', { q, limit: 20, divisionId: targetDivisionId || undefined });

  const fetchWpOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('workpackages', { q, limit: 20 });

  const handleDivisionChange = (val: string) => {
    setTargetDivisionId(val ? Number(val) : '');
    // Division-scoped assignee search means a previously-picked assignee may
    // no longer be valid for the new division — always clear it on change.
    setAssignedToUserId('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId) {
      toast.error('Please select a template');
      return;
    }
    if (!targetDivisionId) {
      toast.error('Please select a target division');
      return;
    }
    if (deadline) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(deadline) || isNaN(Date.parse(deadline))) {
        toast.error('Invalid deadline date format. Please use a valid date.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const task = await createTask({
        templateId: Number(templateId),
        targetDivisionId: Number(targetDivisionId),
        assignedToUserId: assignedToUserId ? Number(assignedToUserId) : undefined,
        deadline: deadline || undefined,
        wpId: wpId ? Number(wpId) : undefined,
        issuanceNote: issuanceNote.trim() || undefined,
        requiresApproval,
        skillLevel,
      });
      toast.success(`Task ${task.taskId} created`);
      if (onSaved) {
        onSaved(task.id);
      } else {
        router.push(`/dashboard/tasks/${task.id}`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to create task');
    } finally {
      // Always release the button — even if onSaved() throws, the form must not
      // stay frozen in its spinner state.
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Template selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-blue-600" />
          Template *
        </h2>
        <div>
          {selectedTemplate ? (
            <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                    {selectedTemplate.templateId}
                  </span>
                  {selectedTemplate.type && (
                    <span className="text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded">
                      {selectedTemplate.type}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-800">{selectedTemplate.title}</p>
                {selectedTemplate.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{selectedTemplate.description}</p>
                )}
                <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-1.5">
                  {selectedTemplate.estimatedHours != null && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      Est. {selectedTemplate.estimatedHours}h
                    </span>
                  )}
                  {selectedTemplate.requiresApproval && (
                    <span className="font-medium text-amber-600">Requires Approval</span>
                  )}
                  {selectedTemplate.skillLevel > 0 && (
                    <span className="font-medium text-blue-600">Skill Level {selectedTemplate.skillLevel}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTemplate(null)}
                className="p-1 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-600 flex-shrink-0"
                title="Change template"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl text-sm text-slate-500 hover:text-blue-600 transition-all"
            >
              <LayoutTemplate className="w-4 h-4" />
              Browse and select a template…
            </button>
          )}
        </div>
      </div>

      {/* Task details */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">Task Details</h2>

        {/* Target Division */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Target Division *
          </label>
          {isElevated ? (
            <AsyncSearchableSelect
              id="division-select"
              value={targetDivisionId ? String(targetDivisionId) : ''}
              onChange={handleDivisionChange}
              fetchOptions={fetchDivisionOptions}
              placeholder="Search for division…"
            />
          ) : (
            <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-500">
              {readOnlyDivisionLabel}
            </div>
          )}
        </div>

        {/* Assignee */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Assignee{' '}
            <span className="font-normal text-slate-400">
              (optional — leave blank to create as Unassigned)
            </span>
          </label>
          <AsyncSearchableSelect
            id="assignee-select"
            value={assignedToUserId ? String(assignedToUserId) : ''}
            onChange={(val) => setAssignedToUserId(val ? Number(val) : '')}
            fetchOptions={fetchAssigneeOptions}
            placeholder={targetDivisionId ? 'Search for assignee…' : 'Select a division first'}
            disabled={!targetDivisionId}
            clearable
            clearLabel="No assignee (Unassigned)"
          />
          {!targetDivisionId && (
            <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" /> Select a target division before searching for an assignee.
            </p>
          )}
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="deadline-input">
            Deadline <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="deadline-input"
            type="date"
            value={deadline}
            min={new Date().toISOString().split('T')[0]}
            max="9999-12-31"
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
          />
        </div>

        {/* Skill Level + Requires Approval */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="skill-level-select">
              Skill Level <span className="font-normal text-slate-400">(seeded from template)</span>
            </label>
            <select
              id="skill-level-select"
              value={skillLevel}
              onChange={(e) => setSkillLevel(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            >
              {[0, 1, 2, 3, 4].map((lvl) => (
                <option key={lvl} value={lvl}>Level {lvl}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer group pb-2.5">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600" title="When unchecked, the task closes immediately on submit (unless it requires Director approval)">
                Requires Approval
              </span>
            </label>
          </div>
        </div>

        {/* Work Package */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            <span className="flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-slate-400" />
              Work Package <span className="font-normal text-slate-400">(optional)</span>
            </span>
          </label>
          {prefilledWpId ? (
            <>
              <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-500">
                {prefilledWp ? `${prefilledWp.wpId} — ${prefilledWp.name}` : `WP #${prefilledWpId}`}
              </div>
              <p className="mt-1.5 text-xs text-blue-600 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Work package pre-selected from the work package page.
              </p>
            </>
          ) : (
            <AsyncSearchableSelect
              id="wp-select"
              value={wpId ? String(wpId) : ''}
              onChange={(val) => setWpId(val ? Number(val) : '')}
              fetchOptions={fetchWpOptions}
              placeholder="Search for work package…"
              clearable
              clearLabel="No work package"
            />
          )}
        </div>

        {/* Task Instruction */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="instruction-input">
            Task Instruction <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="instruction-input"
            rows={3}
            value={issuanceNote}
            onChange={(e) => setIssuanceNote(e.target.value)}
            placeholder="Add context or specific guidance for this task instance…"
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm resize-none"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end gap-3">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
          >
            Cancel
          </button>
        ) : (
          <Link
            href="/dashboard/tasks"
            className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
          >
            Cancel
          </Link>
        )}
        <button
          type="submit"
          disabled={submitting || !templateId || !targetDivisionId}
          id="create-task-submit"
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-sm transition-all"
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </span>
          ) : (
            'Create Task'
          )}
        </button>
      </div>

      {/* Template Picker Modal */}
      <TemplatePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(t) => { setSelectedTemplate(t); setPickerOpen(false); }}
      />
    </form>
  );
}
```

Note: the `loadingData` mount-blocking spinner is gone entirely — there's no more bulk fetch to wait for, so the form now renders immediately.

- [ ] **Step 2: Type-check and lint**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 3: Manual verification**

```
cd frontend && npm run dev
```
In a browser (logged in as a Manager/Director/Admin — Staff won't see the elevated division picker):
1. Navigate to Create Task. Confirm the form renders instantly (no spinner).
2. Confirm Target Division shows your own division pre-selected with its real name (not blank).
3. Type 1-2 characters into Target Division — confirm it shows "Type at least 3 characters to search" and does not fire a network request (check Network tab).
4. Type 3+ characters matching a division name — confirm results load after ~300ms with a brief spinner.
5. Pick a different division — confirm Assignee clears.
6. Search and pick an Assignee — confirm it's scoped to the newly selected division.
7. Search and pick a Work Package — confirm results exclude Closed WPs.
8. Submit — confirm task creation still succeeds end-to-end.
9. Navigate to a Work Package page and use its "Create Task" entry point (prefilled WP) — confirm the WP shows its real name (not just `WP #<id>`) in the read-only field.

Stop the dev server after confirming. Report the outcome — if manual browser verification isn't possible in this environment, say so explicitly rather than claiming success (per verification-before-completion norms).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/tasks/TaskCreateForm.tsx
git commit -m "refactor: TaskCreateForm uses AsyncSearchableSelect instead of bulk-preloaded dropdowns"
```

---

### Task 8: `TaskCreateForm` — Task Title input

**Files:**
- Modify: `frontend/src/components/tasks/TaskCreateForm.tsx`

**Interfaces:**
- Consumes: `Template.title` (existing field). `createTask` payload already accepts `title` (backend already persists it — see `task.controller.ts:852`).

- [ ] **Step 1: Add `title` state and prefill-on-template-select**

In `frontend/src/components/tasks/TaskCreateForm.tsx`, add state near the other form fields:
```ts
  const [title, setTitle] = useState('');
```

Update the template-seed effect to also prefill the title:
```ts
  // Seed per-task overrides from the chosen template; the user can still override.
  useEffect(() => {
    if (selectedTemplate) {
      setRequiresApproval(selectedTemplate.requiresApproval);
      setSkillLevel(selectedTemplate.skillLevel ?? 0);
      setTitle((prev) => prev || selectedTemplate.title);
    }
  }, [selectedTemplate]);
```
(`prev || selectedTemplate.title` — only auto-fills if the user hasn't already typed a custom title; if they change templates after having already customized the title, their edit is preserved.)

- [ ] **Step 2: Add the input to the JSX**

Insert a new field block right after the Template selector `</div>` and before the "Task details" `<div>` block (i.e. as its own card, matching the existing card layout):
```tsx
      {/* Task Title */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">Task Title</h2>
        <input
          id="task-title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
          placeholder="Defaults to the template title — edit to customize"
          className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
        />
      </div>
```
(`maxLength={300}` mirrors the backend's `MAX_TITLE_LEN` — a UX hint only, the backend remains the authoritative boundary.)

- [ ] **Step 3: Send it in the payload**

In `handleSubmit`, add `title` to the `createTask(...)` call:
```ts
      const task = await createTask({
        templateId: Number(templateId),
        targetDivisionId: Number(targetDivisionId),
        assignedToUserId: assignedToUserId ? Number(assignedToUserId) : undefined,
        deadline: deadline || undefined,
        wpId: wpId ? Number(wpId) : undefined,
        issuanceNote: issuanceNote.trim() || undefined,
        requiresApproval,
        skillLevel,
        title: title.trim() || undefined,
      });
```

- [ ] **Step 4: Add `title` to `CreateTaskPayload`**

In `frontend/src/api/taskApi.ts`, add to `CreateTaskPayload` (line 95-105):
```ts
export interface CreateTaskPayload {
  templateId: number;
  targetDivisionId: number;
  assignedToUserId?: number;
  deadline?: string;
  estimatedHours?: number;
  skillLevel?: number;
  requiresApproval?: boolean;
  wpId?: number;
  issuanceNote?: string;
  title?: string;
}
```

- [ ] **Step 5: Type-check and lint**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 6: Manual verification**

```
cd frontend && npm run dev
```
Select a template, confirm the Title field auto-fills with the template's title, edit it, submit, and confirm the created task's detail page and Task List row (once Task 12 lands) show the custom title, not the template title. Stop the dev server after confirming.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/tasks/TaskCreateForm.tsx frontend/src/api/taskApi.ts
git commit -m "feat: editable Task Title field on TaskCreateForm, pre-filled from template"
```

---

### Task 9: `TaskCreateForm` — Estimated Hours input

**Files:**
- Modify: `frontend/src/components/tasks/TaskCreateForm.tsx`

**Interfaces:**
- Consumes: `Template.estimatedHours` (existing field). `createTask` payload already accepts `estimatedHours` (backend already persists it — `task.controller.ts:862`, this closes a pre-existing gap where the form silently never sent it).

- [ ] **Step 1: Add `estimatedHours` state and prefill-on-template-select**

```ts
  const [estimatedHours, setEstimatedHours] = useState<number | ''>('');
```

Extend the same seed effect from Task 8:
```ts
  useEffect(() => {
    if (selectedTemplate) {
      setRequiresApproval(selectedTemplate.requiresApproval);
      setSkillLevel(selectedTemplate.skillLevel ?? 0);
      setTitle((prev) => prev || selectedTemplate.title);
      setEstimatedHours((prev) => (prev === '' ? (selectedTemplate.estimatedHours ?? '') : prev));
    }
  }, [selectedTemplate]);
```

- [ ] **Step 2: Add the input to the JSX**

Insert into the "Skill Level + Requires Approval" grid, changing it from a 2-column to a 3-column grid:
```tsx
        {/* Skill Level + Estimated Hours + Requires Approval */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="skill-level-select">
              Skill Level <span className="font-normal text-slate-400">(seeded from template)</span>
            </label>
            <select
              id="skill-level-select"
              value={skillLevel}
              onChange={(e) => setSkillLevel(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            >
              {[0, 1, 2, 3, 4].map((lvl) => (
                <option key={lvl} value={lvl}>Level {lvl}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="estimated-hours-input">
              Estimated Hours <span className="font-normal text-slate-400">(seeded from template)</span>
            </label>
            <input
              id="estimated-hours-input"
              type="number"
              min="0"
              step="0.5"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Optional"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer group pb-2.5">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600" title="When unchecked, the task closes immediately on submit (unless it requires Director approval)">
                Requires Approval
              </span>
            </label>
          </div>
        </div>
```
(replaces the existing 2-column "Skill Level + Requires Approval" `<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">...</div>` block from Task 7's version.)

- [ ] **Step 3: Send it in the payload**

```ts
      const task = await createTask({
        templateId: Number(templateId),
        targetDivisionId: Number(targetDivisionId),
        assignedToUserId: assignedToUserId ? Number(assignedToUserId) : undefined,
        deadline: deadline || undefined,
        wpId: wpId ? Number(wpId) : undefined,
        issuanceNote: issuanceNote.trim() || undefined,
        requiresApproval,
        skillLevel,
        title: title.trim() || undefined,
        estimatedHours: estimatedHours === '' ? undefined : Number(estimatedHours),
      });
```

- [ ] **Step 4: Type-check and lint**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 5: Manual verification**

```
cd frontend && npm run dev
```
Select a template with a nonzero `estimatedHours`, confirm the field prefills, edit it, submit, and confirm the created task's `estimatedHours` (visible on the Task Detail page's "Est. Hours" row) matches your edited value, not the template's default. Stop the dev server after confirming.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/tasks/TaskCreateForm.tsx
git commit -m "feat: editable Estimated Hours field on TaskCreateForm, pre-filled from template"
```

---

### Task 10: `TaskCreateForm` — localStorage draft autosave for Task Instruction

**Files:**
- Modify: `frontend/src/components/tasks/TaskCreateForm.tsx`

**Interfaces:**
- Produces: `localStorage['taskCreateForm.issuanceNoteDraft'] = JSON.stringify({ text: string, savedAt: string })`.

- [ ] **Step 1: Add draft state and the save-on-change effect**

Add near the other state:
```ts
  const DRAFT_KEY = 'taskCreateForm.issuanceNoteDraft';
  const [draftBanner, setDraftBanner] = useState<{ text: string; savedAt: string } | null>(null);
```

Add an effect that checks for an existing draft on mount (runs once):
```ts
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { text: string; savedAt: string };
        if (parsed.text?.trim()) setDraftBanner(parsed);
      }
    } catch {
      // corrupt/unavailable storage — ignore, no draft to offer
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Add an effect that persists `issuanceNote` as it changes (debounced to avoid writing on every keystroke):
```ts
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (issuanceNote.trim()) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: issuanceNote, savedAt: new Date().toISOString() }));
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch {
        // storage unavailable (private browsing, quota) — non-fatal, drafts are a convenience only
      }
    }, 500);
    return () => clearTimeout(t);
  }, [issuanceNote]);
```

- [ ] **Step 2: Add restore/discard handlers**

```ts
  const handleRestoreDraft = () => {
    if (draftBanner) setIssuanceNote(draftBanner.text);
    setDraftBanner(null);
  };

  const handleDiscardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* non-fatal */ }
    setDraftBanner(null);
  };
```

- [ ] **Step 3: Clear the draft on successful submit**

In `handleSubmit`, right after `toast.success(...)`:
```ts
      toast.success(`Task ${task.taskId} created`);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* non-fatal */ }
      if (onSaved) {
```

- [ ] **Step 4: Add the banner and relative-time helper to the JSX**

Add a helper function above the component (or inline — keep it local since it's only used here):
```ts
function formatRelativeDraftTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
```

In the JSX, insert the banner directly above the Task Instruction field's `<div>`:
```tsx
        {/* Draft restore banner */}
        {draftBanner && (
          <div className="flex items-center justify-between gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
            <span>You have an unsaved instruction draft from {formatRelativeDraftTime(draftBanner.savedAt)}.</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button type="button" onClick={handleRestoreDraft} className="px-3 py-1 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition-colors">
                Restore
              </button>
              <button type="button" onClick={handleDiscardDraft} className="px-3 py-1 text-amber-700 hover:bg-amber-100 rounded-lg font-semibold transition-colors">
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Task Instruction */}
        <div>
```

- [ ] **Step 5: Type-check and lint**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 6: Manual verification**

```
cd frontend && npm run dev
```
1. Open Create Task, type into Task Instruction, wait ~1s, navigate away without submitting (e.g. browser back).
2. Return to Create Task — confirm the "unsaved instruction draft" banner appears (not silently pre-filled).
3. Click Restore — confirm the text reappears in the field.
4. Submit the task — confirm the draft is cleared (reload the Create Task page again, banner should not reappear).
5. Repeat steps 1-2, click Discard instead — confirm the banner disappears and the field stays empty.

Stop the dev server after confirming.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/tasks/TaskCreateForm.tsx
git commit -m "feat: localStorage draft autosave with explicit restore/discard for Task Instruction"
```

---

### Task 11: `QuickTaskForm` — Estimated Hours, Target Division, Assignee

**Files:**
- Modify: `frontend/src/components/tasks/QuickTaskForm.tsx`
- Modify: `frontend/src/api/taskApi.ts` (`QuickTaskPayload`)

**Interfaces:**
- Consumes: `AsyncSearchableSelect` (Task 6). Backend `createQuickTask` already accepts `targetDivisionId` and `estimatedHours` in `req.body` (`task.controller.ts:1036`) — this task is a frontend-only change (type + UI), no backend edit needed.

- [ ] **Step 1: Add `targetDivisionId` to `QuickTaskPayload`**

In `frontend/src/api/taskApi.ts`, update lines 110-118:
```ts
export interface QuickTaskPayload {
  title: string;
  issuanceNote?: string;
  assignedToUserId?: number;
  deadline?: string;
  estimatedHours?: number;
  skillLevel?: number;
  requiresApproval?: boolean;
  targetDivisionId?: number;
}
```

- [ ] **Step 2: Replace the full `QuickTaskForm.tsx` content**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { createQuickTask, getDatasource } from '../../api/taskApi';
import { useAuthStore } from '../../store/authStore';
import AsyncSearchableSelect from '../ui/AsyncSearchableSelect';
import { SearchableSelectOption } from '../ui/SearchableSelect';

export default function QuickTaskForm() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [skillLevel, setSkillLevel] = useState(0);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [estimatedHours, setEstimatedHours] = useState<number | ''>('');
  const [targetDivisionId, setTargetDivisionId] = useState<number | ''>(user?.divisionId ?? '');
  const [assignedToUserId, setAssignedToUserId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);

  const fetchDivisionOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('divisions', { q, limit: 20 });

  const fetchAssigneeOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('users', { q, limit: 20, divisionId: targetDivisionId || undefined });

  const handleDivisionChange = (val: string) => {
    setTargetDivisionId(val ? Number(val) : '');
    setAssignedToUserId('');
  };

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSubmitting(true);
    try {
      const task = await createQuickTask({
        title: title.trim(),
        issuanceNote: note.trim() || undefined,
        deadline: deadline || undefined,
        skillLevel,
        requiresApproval,
        estimatedHours: estimatedHours === '' ? undefined : Number(estimatedHours),
        targetDivisionId: targetDivisionId ? Number(targetDivisionId) : undefined,
        assignedToUserId: assignedToUserId ? Number(assignedToUserId) : undefined,
      });
      toast.success(`Quick task ${task.taskId} created`);
      router.push(`/dashboard/tasks/${task.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create quick task');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-title">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="qt-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-note">
            Instruction / Note
          </label>
          <textarea
            id="qt-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional context or guidance"
            className={`${inputCls} resize-none`}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-division">
              Target Division
            </label>
            <AsyncSearchableSelect
              id="qt-division"
              value={targetDivisionId ? String(targetDivisionId) : ''}
              onChange={handleDivisionChange}
              fetchOptions={fetchDivisionOptions}
              placeholder="Search for division…"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-assignee">
              Assignee
            </label>
            <AsyncSearchableSelect
              id="qt-assignee"
              value={assignedToUserId ? String(assignedToUserId) : ''}
              onChange={(val) => setAssignedToUserId(val ? Number(val) : '')}
              fetchOptions={fetchAssigneeOptions}
              placeholder={targetDivisionId ? 'Search for assignee…' : 'Select a division first'}
              disabled={!targetDivisionId}
              clearable
              clearLabel="No assignee (Unassigned)"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-deadline">
              Deadline
            </label>
            <input
              id="qt-deadline"
              type="date"
              value={deadline}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => setDeadline(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-skill">
              Skill Level
            </label>
            <select
              id="qt-skill"
              value={skillLevel}
              onChange={(e) => setSkillLevel(Number(e.target.value))}
              className={inputCls}
            >
              {[0, 1, 2, 3, 4].map((l) => (
                <option key={l} value={l}>Level {l}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="qt-hours">
            Estimated Hours
          </label>
          <input
            id="qt-hours"
            type="number"
            min="0"
            step="0.5"
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Optional"
            className={inputCls}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <span className="text-sm font-medium text-slate-700">Requires Approval</span>
        </label>
        <button
          onClick={handleSubmit}
          disabled={submitting || !title.trim()}
          className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Creating…' : 'Issue Task'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 4: Manual verification**

```
cd frontend && npm run dev
```
Open the Quick Task form, confirm Target Division is pre-selected to your own division with the correct name, change it, confirm Assignee search is scoped to the new division and clears on division change, fill Estimated Hours, submit, and confirm the created task's detail page reflects the division/assignee/hours you set (not just the title/note that worked before).

Stop the dev server after confirming.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tasks/QuickTaskForm.tsx frontend/src/api/taskApi.ts
git commit -m "feat: add Estimated Hours, Target Division, and Assignee to QuickTaskForm"
```

---

### Task 12: Task List — title/subtitle rendering

**Files:**
- Modify: `frontend/src/app/dashboard/tasks/page.tsx:695-711`

**Interfaces:**
- Consumes: `Task.title` (existing field, now populated by Task 8), `TaskEnriched.parentFinding.findingId` (Task 5).

- [ ] **Step 1: Replace the title/subtitle cell**

In `frontend/src/app/dashboard/tasks/page.tsx`, replace lines 695-711:
```tsx
                    {/* Title — the row's primary link to the detail page (Eye icon removed) */}
                    <td className="p-4 align-middle max-w-xs">
                      <Link
                        href={`/dashboard/tasks/${task.id}`}
                        id={`view-task-${task.id}`}
                        title={task.template?.title ?? undefined}
                        aria-label={`View task ${task.taskId}`}
                        className="font-medium text-slate-800 hover:text-signal-blue truncate block focus:outline-none focus:underline"
                      >
                        {task.template?.title ?? '—'}
                      </Link>
                      {task.wp && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          WP: {task.wp.wpId}
                        </div>
                      )}
                    </td>
```
with:
```tsx
                    {/* Title — the row's primary link to the detail page. Custom
                        Task.title overrides the template title when set. */}
                    <td className="p-4 align-middle max-w-xs">
                      <Link
                        href={`/dashboard/tasks/${task.id}`}
                        id={`view-task-${task.id}`}
                        aria-label={`View task ${task.taskId}`}
                        className="font-medium text-slate-800 hover:text-signal-blue block focus:outline-none focus:underline whitespace-normal break-words"
                      >
                        {task.title ?? task.template?.title ?? '—'}
                      </Link>
                      {(task.wp || task.parentFinding?.findingId || task.template?.title) && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          {[
                            task.wp ? `WP: ${task.wp.wpId}` : null,
                            task.parentFinding?.findingId ? `Finding: ${task.parentFinding.findingId}` : null,
                            task.template?.title ? `Template: ${task.template.title}` : null,
                          ].filter(Boolean).join(' | ')}
                        </div>
                      )}
                    </td>
```
(the `title={...}` native-tooltip attribute on the `Link` is dropped — with `whitespace-normal break-words` the full title is now visible in the row itself, so a truncation tooltip is no longer needed.)

- [ ] **Step 2: Type-check and lint**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 3: Manual verification**

```
cd frontend && npm run dev
```
On the Task List page, confirm: a task created with a custom title (Task 8) shows that title, not the template title. A task with no custom title falls back to the template title (existing tasks, unaffected). The subtitle line shows `WP: ... | Finding: ... | Template: ...` with only the present segments, separated by ` | `. A long custom title wraps onto multiple lines instead of truncating with an ellipsis.

Stop the dev server after confirming.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/dashboard/tasks/page.tsx
git commit -m "feat: show custom task title and WP/Finding/Template subtitle on Task List"
```

---

### Task 13: WP Unlink button in `TaskDetailPanel`

**Files:**
- Modify: `frontend/src/components/tasks/TaskDetailPanel.tsx`
- Modify: `frontend/src/app/dashboard/tasks/[id]/page.tsx:335`

**Interfaces:**
- Consumes: `relinkTaskWp(taskId, null)` (existing, `frontend/src/api/taskApi.ts:71-72`, backend already guards issuer-or-`task:relink_any` + blocks final/inactive statuses at `task.controller.ts:955-995`). `FINAL_TASK_STATUSES` from `frontend/src/constants/taskStatus.ts:21`.
- Produces: new optional prop `TaskDetailPanel({ onWpUnlinked?: () => void })`.

- [ ] **Step 1: Add the prop, state, and handler to `TaskDetailPanel.tsx`**

Update imports (top of file):
```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { TaskEnriched, User } from '../../types';
import { relinkTaskWp } from '../../api/taskApi';
import { FINAL_TASK_STATUSES } from '../../constants/taskStatus';
import TaskStatusBadge from './TaskStatusBadge';
import StarRating from './StarRating';
import { AlertTriangle, Calendar, Clock, User as UserIcon, Link as LinkIcon, Briefcase, ShieldCheck, X } from 'lucide-react';
import { ResponseActionBadge } from '../findings/FindingBadges';
```

Update the props interface:
```tsx
interface TaskDetailPanelProps {
  task: TaskEnriched;
  currentUser: User;
  onWpUnlinked?: () => void;
}
```

Update the component signature and add the unlink logic (right after `const isOverdue = task.isOverdue;`):
```tsx
export default function TaskDetailPanel({ task, currentUser, onWpUnlinked }: TaskDetailPanelProps) {
  const isOverdue = task.isOverdue;
  const [unlinking, setUnlinking] = useState(false);

  // Client-side approximation of the backend's issuer-or-privilege guard
  // (task.controller.ts updateTaskWp) — the backend remains the sole
  // authority; this only avoids showing a button that will always 403.
  const canUnlinkWp =
    !FINAL_TASK_STATUSES.includes(task.status) &&
    task.status !== 'Inactive' &&
    (currentUser.id === task.issuerId || currentUser.role === 'Admin');

  const handleUnlinkWp = async () => {
    setUnlinking(true);
    try {
      await relinkTaskWp(task.id, null);
      toast.success('Work package unlinked');
      onWpUnlinked?.();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to unlink work package');
    } finally {
      setUnlinking(false);
    }
  };
```

- [ ] **Step 2: Add the unlink button next to the WP row**

Replace the existing "Work Package" `DetailRow` block:
```tsx
        {/* Work Package */}
        {task.wp && (
          <DetailRow label="Work Package">
            <span className="flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-slate-400" />
              {task.wp.wpId} — {task.wp.name}
            </span>
          </DetailRow>
        )}
```
with:
```tsx
        {/* Work Package */}
        {task.wp && (
          <DetailRow label="Work Package">
            <span className="flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-slate-400" />
              {task.wp.wpId} — {task.wp.name}
              {canUnlinkWp && (
                <button
                  type="button"
                  onClick={handleUnlinkWp}
                  disabled={unlinking}
                  title="Unlink work package"
                  aria-label="Unlink work package"
                  className="p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 disabled:opacity-50 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          </DetailRow>
        )}
```

- [ ] **Step 3: Wire the refresh callback in the parent page**

In `frontend/src/app/dashboard/tasks/[id]/page.tsx:335`, change:
```tsx
          <TaskDetailPanel task={task} currentUser={user} />
```
to:
```tsx
          <TaskDetailPanel task={task} currentUser={user} onWpUnlinked={refreshTaskMeta} />
```
(`refreshTaskMeta` already exists at `[id]/page.tsx:93-107` and is the established pattern for this exact kind of mid-page refresh — used identically by `TimeEntryPanel`'s `onEntryAdded` and `TimeBookingPanel`'s `onBookingChange`.)

- [ ] **Step 4: Type-check and lint**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Step 5: Manual verification**

```
cd frontend && npm run dev
```
1. As the task's issuer (or an Admin), open a task with a linked WP that's not Closed/Rejected/Terminated/Inactive — confirm the small "X" unlink button appears next to the WP name.
2. Click it — confirm the WP disappears from the panel (row removed since `task.wp` becomes null) and a success toast appears.
3. As a different user (not the issuer, not Admin) viewing a WP-linked task — confirm the button does not appear.
4. Open a Closed task with a linked WP as the issuer — confirm the button does not appear (client-side status guard).
5. (Optional, defense-in-depth check) If reachable, attempt the unlink on a task where the client-side approximation might under- or over-show the button relative to the actual backend privilege set — confirm a 403/400 surfaces as a toast rather than crashing the page.

Stop the dev server after confirming.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/tasks/TaskDetailPanel.tsx frontend/src/app/dashboard/tasks/[id]/page.tsx
git commit -m "feat: add WP unlink button to TaskDetailPanel"
```

---

## Final full-suite check

- [ ] **Run the full backend suite one more time**

```
cd backend && npm test
```
Expected: all green, count ≥ the pre-plan baseline (13 tasks each added or preserved tests; no task removed backend test coverage).

- [ ] **Run frontend type-check and lint one more time**

```
cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Update `CLAUDE_HANDOVER.md` and `CODE_REVIEW_AUDIT_LOG.md` per Rules 12-13**

Only after the user confirms the whole feature is complete and all tests pass — not before. This is a manual step for the session wrap-up, not part of any individual task above.
