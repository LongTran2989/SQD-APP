# TEST_P1 Deployment Guide

This guide covers pushing local changes to the `TEST_P1` branch, deploying to the test VPS,
and safely handling schema changes. `deploy.sh` hardcodes `BRANCH="TEST_P1"`, so that branch
is always the source of truth for what the test server runs.

Two machines are involved in every scenario below:
- **Local** — your Windows machine, this repo (`g:\SQD-APP`). Use **cmd**, never PowerShell
  (CLAUDE.md Rule 11).
- **VPS** — the remote Ubuntu server running the live test site. Reached via `ssh`. Commands
  there are `bash`.

> ⚠️ **Known gap:** `deploy.sh` still uses `npx prisma db push` / `db push --force-reset`.
> The project's canonical migration workflow (`backend/prisma/migrations/README.md`) has
> since moved to `prisma migrate dev` / `migrate deploy` / `migrate reset` for anything with
> a recorded migration history. This guide uses the canonical commands; `deploy.sh` itself
> has not been updated to match — treat that as a known follow-up, not something to "fix"
> ad hoc on the server.

---

## Prerequisites (all scenarios) — run on Local

```cmd
git add .
git commit -m "Your descriptive commit message"
git checkout TEST_P1
git pull origin TEST_P1
git merge main
git push origin TEST_P1
```

Pushing here triggers the **pre-push hook** installed in this repo — see
[Git Hook: pre-push safety checks](#git-hook-pre-push-safety-checks). It only warns; it
never blocks the push.

---

## Schema Changes: the safe commit-and-migrate workflow

**This is the part to follow whenever `schema.prisma` changes**, whether you got there via
Scenario 1 (routine update) or Scenario 2 (dev reset). It's condensed from
`backend/prisma/migrations/README.md` ("Case A/B/C") — read that file for full detail.

### Rule: a schema change is always two files committed together
`schema.prisma` **and** a new folder under `backend/prisma/migrations/`. Never commit one
without the other, and never hand-edit a migration folder once it's been applied anywhere.
The pre-push hook checks for this (see below) and will warn if it looks violated.

### Step 1 — make the change, locally, in dev
```cmd
cd backend
REM edit schema.prisma
npm run migrate:dev
```
`migrate:dev` prompts for a migration name, writes the migration folder, applies it to your
local `sqd_qa_db`, and keeps `migration_lock.toml` correct.
```cmd
npx prisma generate
```
(Rule 9 — regenerates the typed client. `migrate:dev` does not do this for you.)

> Adding raw SQL Prisma can't express (CHECK constraints, triggers, functions)? Run
> `migrate:dev` first to get the generated migration, then hand-append the raw SQL to that
> same `migration.sql` before committing.

### Step 2 — verify before pushing
```cmd
npm run test:setup
npm test
```
`test:setup` rebuilds `sqd_qa_test_db` via `db push` (fast, schema-only — this is the one
place `db push` is still correct, since it's disposable and rebuilt every run). Note this
means raw-SQL CHECK constraints aren't exercised by the suite; if you need to verify
constraint behavior, apply the real migration to a throwaway DB instead.

### Step 3 — commit and push
```cmd
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "..."
git push origin TEST_P1
```

### Step 4 — apply on the deploy target (VPS)
```bash
cd /app/backend
npm install
npx prisma generate
npm run migrate:deploy
```
`migrate:deploy` only applies migrations not yet recorded on that database — safe to run on
every deploy, unlike `db push`. If the target DB already has real data (not a fresh
provision) and the new migration adds a CHECK constraint or similar, confirm existing rows
won't violate it *before* the release window — `migrate deploy` will fail loudly (and
safely) if they do, but you'd rather catch that ahead of time.

---

## Updating `.env` on the VPS

The VPS `.env` lives at `/app/backend/.env` and is **never committed to git** (it's
`.gitignore`d). When a new feature introduces new env vars, add them manually via SSH before
(or immediately after) pulling the new code.

### How to edit `.env` on the VPS

```bash
ssh root@your-server-ip
nano /app/backend/.env
```

Add the new lines at the end (or in the relevant section). Save with **Ctrl-O, Enter,
Ctrl-X**. Then restart the backend so the new values are picked up:

```bash
pm2 restart backend
pm2 logs backend --lines 20    # confirm startup, no "is not configured" errors
```

### Finding the right values

- **String names that reference DB rows** (e.g. `SHEET_CHK_BLUEPRINT_NAME`) — the value
  must exactly match an active record's `name` field. If unsure, query the DB:
  ```bash
  cd /app/backend
  npx prisma studio   # browser-based, or use psql below
  # or via psql:
  psql $DATABASE_URL -c "SELECT name FROM \"WpBlueprint\" WHERE \"isActive\" = true;"
  ```
- **Public URLs** (e.g. `GOOGLE_SHEET_CSV_URL`) — copy from the source directly; test
  `curl -L "<url>" | head` to confirm the CSV is reachable from the server.

### Checking what's currently set

```bash
grep -E "GOOGLE_SHEET|SHEET_CHK|SHEET_PC_EQ|ENFORCE_SINGLE" /app/backend/.env
```

### Reference: `.env.example`

`backend/.env.example` (tracked in git) always lists every var the app reads, with
placeholder values and inline comments. It's the canonical reference for what a `.env`
must contain; diff it against the live file whenever deploying a new branch.

---

## Scenario 1: Standard Update (no data loss)

**Use this when:** updating the server with new code/fixes, keeping existing DB data,
accounts, and uploaded files intact.

> ⚠️ **Do not use `deploy.sh` for this.** `backend/prisma/seed.ts` has no delete/upsert
> logic — it only `.create()`s rows. `deploy.sh` runs `npx prisma db seed` unconditionally
> on every run, so re-running it against a populated database throws unique-constraint
> errors partway through. Reserve `deploy.sh` for first-time installs (Scenario 3).

### Manual Update — run on VPS (via `ssh`)

```bash
cd /app
git fetch origin
git checkout TEST_P1
git pull origin TEST_P1
```

**If backend changed (no schema change):**
```bash
cd /app/backend
npm install
pm2 restart backend
```

**If backend changed and `schema.prisma` changed:** follow Step 4 of the
[schema-change workflow](#schema-changes-the-safe-commit-and-migrate-workflow) above
(`prisma generate` + `migrate:deploy`), then `pm2 restart backend`.

**If frontend changed:**
```bash
cd /app/frontend
npm install
npm run build
pm2 restart frontend
```

---

## Scenario 2: Clear All and Start New — Dev phase only

**Use this when:** you're iterating locally and want a clean slate, replaying every
migration from scratch and reseeding — no manual `db push --force-reset` + separate
`db seed` needed.

```cmd
cd backend
npx prisma migrate reset --force
```
This drops `sqd_qa_db`, recreates it, replays every migration in order, and runs the
configured seed (`seed.ts`) automatically. Safe to run as often as you like in dev.

**Do not use `migrate reset` on the VPS / any environment with real test data you care
about** — it's the same kind of destructive drop as `db push --force-reset`, just routed
through the migration history instead of a schema diff. If you genuinely want to wipe the
VPS test database, that's still a deliberate, explicit decision (see Scenario 2b), not a
routine dev command.

### Scenario 2b: Full reset on the VPS test server (explicit, not routine)

```bash
ssh root@your-server-ip
cd /app
git fetch origin && git checkout TEST_P1 && git pull origin TEST_P1
pm2 stop backend

cd /app/backend
npm install
npx prisma generate
npx prisma migrate reset --force   # drops + recreates + replays migrations + seeds

cd /app/frontend
npm run build      # if there are UI changes

pm2 restart all
```

---

## Scenario 2c: Loading demo/mock data after a reset

`npx prisma db seed` always runs `seed.ts` only (it's the fixed binding in
`backend/package.json`'s `"prisma": { "seed": ... }` block) — base users, roles, templates,
reference data. The other `prisma/seed-*.ts` files are separate, optional, run directly via
`ts-node`, **not** through `db seed`.

`seed-mass-mockup-v2.ts` is the one to know about — it's idempotent (it deletes its own
prior output by stable ID prefix — `DEMO-WP`, `DEMO-TSK`, `FND-0`, etc. — before
re-creating), so it's safe to re-run. It depends on the base seed having already run (it
reads existing users), so always run it **after** `seed.ts` / `migrate reset`, never on an
empty DB.

```bash
cd /app/backend
node node_modules/ts-node/dist/bin.js prisma/seed-mass-mockup-v2.ts
```
Same command works locally (Local, in `cmd`, from `backend/`) or on the VPS (`bash`) — the
script doesn't care which machine, only which `DATABASE_URL` is active in `.env`.

---

## Scenario 3: Initial Setup on a Fresh VPS

**Use this when:** standing up a brand-new server.

```bash
ssh root@your-new-server-ip
curl -O https://raw.githubusercontent.com/LongTran2989/SQD-APP/TEST_P1/deploy.sh
sudo bash deploy.sh your-subdomain.duckdns.org
```

`deploy.sh` installs Node, nginx, PostgreSQL, configures the firewall, clones `TEST_P1`
into `/app`, pushes the schema (`db push`, not yet migrated to `migrate deploy` — see the
known-gap note at the top), seeds the DB, builds the frontend, starts PM2, configures
nginx, and requests a Let's Encrypt cert. Safe here specifically because the DB is empty —
the seed-idempotency issue in Scenario 1 doesn't apply on a fresh install.

---

## Scenario 4: Local Testing Environment Reset — run on Local

**Use this when:** syncing your own Windows dev environment with `TEST_P1` and resetting
your local dev DB (`sqd_qa_db`). This does not touch the VPS or `sqd_qa_test_db`
(automated tests always use the latter — Rule 8).

```cmd
git checkout TEST_P1
git pull origin TEST_P1

cd backend
npm install
npx prisma generate
npx prisma migrate reset --force
```

Start the app (two terminals):
```cmd
REM Terminal 1 — Backend
cd backend && npm run dev

REM Terminal 2 — Frontend
cd frontend && npm run dev
```

---

## Git Hook: pre-push safety checks

A `pre-push` hook is installed at `.git/hooks/pre-push` (sourced from the version-controlled
copy at `scripts/git-hooks/pre-push`). It runs automatically every time you `git push` and
checks the commits being pushed to **`TEST_P1`** or **`main`**:

- If `backend/prisma/schema.prisma` changed in the push **without** a new folder under
  `backend/prisma/migrations/` in the same push, it warns that the schema change and its
  migration may have been split across commits/pushes (violates the Case A rule above).
- If `schema.prisma` changed at all, it reminds you to run
  `npx prisma generate && npm run migrate:deploy` on the target server afterward (Rule 9 +
  the schema-change workflow above).
- If the target branch is `TEST_P1`, it reminds you not to re-run `deploy.sh` on the live
  test server, pointing at Scenario 1's manual steps instead.

It is **warning-only** — it always exits `0` and never blocks a push.

**Already active** in this clone (installed directly into `.git/hooks/pre-push`).

**Re-installing after a fresh clone** (`.git/hooks` is local-only, never pushed to GitHub):
```cmd
copy scripts\git-hooks\pre-push .git\hooks\pre-push
```
(On the VPS / any Linux shell instead: `cp scripts/git-hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push`.)

**Bypassing it for one push** (not recommended — only if you're certain):
```cmd
git push --no-verify
```

**Editing it:** change `scripts/git-hooks/pre-push` (the tracked copy), then re-copy it over
`.git/hooks/pre-push` to pick up the change — git does not auto-sync hooks from a tracked
path.

---

## Troubleshooting (on VPS)

- `pm2 status` — check if backend/frontend are running
- `pm2 logs backend` — backend live logs
- `pm2 logs frontend` — frontend live logs
- `pm2 restart all` — restart both services
- `npm run migrate:status` (in `backend/`) — see which migrations are applied vs pending
