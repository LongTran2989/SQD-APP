# Database Migrations

This history was **squashed to a clean baseline on 2026-06-23**, while the app was
still pre-production (no environment had a recorded migration history). The previous
hand-authored migration folders could not rebuild a database from empty — they were
written on top of a `db push`'d dev DB and never replayed in sequence (e.g. an
`ALTER` on `CapaAction` sorted before the table was created). They were dropped.

## Current history

| Migration | Contents |
|-----------|----------|
| `0_init` | Full schema generated from `schema.prisma` (`migrate diff --from-empty`): all 45 tables, indexes, FKs, and the `Finding.findingId` column + unique index. Proven to apply cleanly from empty. |
| `20260623000100_add_status_check_constraints` | The 5 DB-level CHECK constraints (Task/Finding/WorkPackage status, Finding severity, FindingLink self-reference). Prisma cannot express CHECK constraints in `schema.prisma`, so they live here in raw SQL — this is the **only** thing the baseline cannot regenerate, so it must never be deleted. |

Validation (2026-06-23): `migrate deploy` against an empty DB applies both cleanly;
`migrate diff --from-migrations … --to-schema-datamodel` reports **no drift**.

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
