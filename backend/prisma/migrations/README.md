# Database Migrations

This history was **squashed to a clean baseline on 2026-06-23**, while the app was
still pre-production (no environment had a recorded migration history). The previous
hand-authored migration folders could not rebuild a database from empty — they were
written on top of a `db push`'d dev DB and never replayed in sequence (e.g. an
`ALTER` on `CapaAction` sorted before the table was created). They were dropped.

## Current history

| Migration | Contents |
|-----------|----------|
| `0_init` | Full schema generated from `schema.prisma` (`migrate diff --from-empty`): 45 tables, indexes, FKs, and the `Finding.findingId` column + unique index. Proven to apply cleanly from empty *as of the 2026-06-23 squash.* |
| `20260623000100_add_status_check_constraints` | The 5 DB-level CHECK constraints (Task/Finding/WorkPackage status, Finding severity, FindingLink self-reference). Prisma cannot express CHECK constraints in `schema.prisma`, so they live here in raw SQL — this is the **only** thing the baseline cannot regenerate, so it must never be deleted. |

Validation (2026-06-23): `migrate deploy` against an empty DB applied both cleanly;
`migrate diff … --to-schema-datamodel` reported **no drift** *at that time*.

> ⚠️ **KNOWN DRIFT (2026-06-28, audit-log MIG-1):** `schema.prisma` now has **46
> models** but the migrations above still create only **45 tables**. The entire
> **Feed Phases A–H** workstream was applied via `db push` and never captured here:
> the `FeedPostAcknowledgement` table and the `FeedPost` columns
> `hiddenAt / hiddenByUserId / hiddenReason / pinnedAt / pinnedByUserId` are missing
> from the migration baseline. A fresh `migrate deploy` builds a DB without them.
> **Remediation (owner sign-off required):** one additive migration —
> `npm run migrate:dev --name feed_phases_a_h` (or `migrate diff --from-migrations . --to-schema-datamodel ../schema.prisma --script` reviewed into a new folder).
> Until then, the "no drift" line above does not hold.

## Workflow — do NOT hand-author migration folders again

- **Schema change (dev):** edit `schema.prisma`, then `npm run migrate:dev` — Prisma
  writes the migration file *and* keeps `migration_lock.toml` correct. Run
  `npx prisma generate` after (Rule 9).
- **Deploy (staging/prod):** `npm run migrate:deploy` in the release step, **before**
  the app boots. Idempotent; only applies un-recorded migrations.
- **Check state:** `npm run migrate:status`.
- **Tests:** `test:setup` still uses `db push` for speed. Note this means the test DB
  does **not** carry the raw-SQL CHECK constraints — DB-level constraint behaviour is
  not exercised by the suite. Switch `test:setup` to `migrate:deploy` if that coverage
  is ever required.

## ⚠️ The squash is a one-time, pre-prod action

Once any environment has applied this history, **never squash again** — squashing
discards recorded history and will break `migrate deploy` on databases that already
recorded the old names. From here on, only ever *add* migrations via `migrate:dev`.

## Adding raw SQL that `schema.prisma` can't express (CHECK, triggers, functions)

`migrate dev` generates only what it derives from `schema.prisma`. For raw objects,
generate the migration, then hand-append the SQL to that migration's `migration.sql`
(as `20260623000100…` does), and re-run `migrate dev` / `migrate deploy` to apply.

## Operational playbook — which command, in which case

A schema change always means two edits together: `schema.prisma` **and** a new
migration folder. Never hand-edit a migration folder after it has been applied
anywhere (Workflow section above). Pick the case that matches what you're doing:

### Case 0 — No schema change, just running the app
Dev: `cd backend && npm run dev`. Nothing migration-related to do.

### Case A — Changing the schema, locally, in dev
1. Edit `schema.prisma`.
2. `cd backend && npm run migrate:dev` — prompts for a migration name, writes the
   migration folder, applies it to `sqd_qa_db`, keeps `migration_lock.toml` correct.
3. `npx prisma generate` (Rule 9 — regenerates the typed client).
4. Commit the new migration folder together with the `schema.prisma` change —
   never split them across commits.

**Case A-special — adding raw SQL Prisma can't express** (CHECK constraints,
triggers, functions): run step 2 above to get the generated migration first, then
hand-append the raw SQL to that same `migration.sql` file before committing (see
section above). Re-run `migrate:dev` if you need it re-applied locally.

### Case B — Verifying the change locally before pushing
1. `cd backend && npm run test:setup` — rebuilds the test DB via `db push` (fast,
   schema-only sync, **not** `migrate deploy`).
2. `npm test` — full suite must stay green.
3. Caveat: `db push` does not run raw-SQL migration content, so CHECK constraints
   are not exercised by the test suite. If you need to verify constraint behavior,
   apply the real migration to a throwaway DB and test against it directly (as was
   done to validate the 2026-06-23 squash), or temporarily point `test:setup` at
   `migrate:deploy` for that check, then revert.

### Case C — Pushing a schema change to production
1. **Stage 1 (local, before pushing):** `npm run migrate:status` against a copy/
   staging DB if available; confirm `npm test` is green; confirm the migration
   folder is committed.
2. **Stage 2 (server-side release step, before the app boots):**
   `npm run migrate:deploy` then run the seed only if this is a first-time
   provision of an empty DB. `migrate:deploy` is idempotent — it only applies
   migrations not yet recorded, safe to run on every deploy.
3. If deploying onto a DB that already has data (not a fresh provision), run the
   `SELECT DISTINCT` audits for any new CHECK constraints first (see Phase 4 in
   the DB remediation plan) — `ADD CONSTRAINT` fails loudly if existing rows
   violate it, which is the correct, safe failure mode, but you want to catch it
   before the release window, not during it.

### Case D — Full reset, starting brand new
- **D-1, dev:** `cd backend && npx prisma migrate reset --force` — drops, recreates,
  replays every migration, runs the seed. Use freely in dev.
- **D-2, test:** `npm run test:setup` already rebuilds `sqd_qa_test_db` from scratch
  every run via `db push`; no separate reset command needed.
- **D-3, production: don't.** `migrate reset` is destructive (drops the DB). If
  production genuinely needs to start over, that is a data-loss decision for a
  human to make explicitly and deliberately outside of routine tooling — not a
  step in this playbook.
