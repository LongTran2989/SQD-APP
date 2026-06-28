import fs from 'fs';
import path from 'path';
import { ROLE_NAMES } from '../constants/privileges';
import { TASK_STATUSES, FINAL_TASK_STATUSES } from '../constants/taskStatus';
import { FINDING_STATUSES } from '../constants/findingTaxonomy';

// ---------------------------------------------------------------------------
// Docs/code drift guard.
//
// Every doc drift fixed in the 2026-06-28 audit was an enumerable fact that had
// been re-stated in prose and then went stale. This suite asserts the few facts
// that genuinely live in two places (schema vs migrations, and the constants)
// stay in sync, so the NEXT drift is a red test instead of silent rot.
//
// Pure filesystem + constant reads — no DB needed for the assertions themselves
// (the global setup.ts beforeAll still requires the test DB, like every suite).
// ---------------------------------------------------------------------------

const PRISMA_DIR = path.join(__dirname, '..', '..', 'prisma');
const SCHEMA_PATH = path.join(PRISMA_DIR, 'schema.prisma');
const MIGRATIONS_DIR = path.join(PRISMA_DIR, 'migrations');

// Models known to exist in schema.prisma but NOT yet in any migration.
// This is the documented MIG-1 drift (Feed Phases A–H applied via `db push`).
// REMOVE entries here once the remediation migration lands — the test below
// asserts each listed model is still genuinely un-migrated, so a stale entry
// fails loudly and forces cleanup.
const KNOWN_UNMIGRATED_MODELS = ['FeedPostAcknowledgement'];

function schemaModelNames(): string[] {
  const src = fs.readFileSync(SCHEMA_PATH, 'utf8');
  return [...src.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

function migrationTableNames(): string[] {
  const names = new Set<string>();
  for (const entry of fs.readdirSync(MIGRATIONS_DIR)) {
    const sqlPath = path.join(MIGRATIONS_DIR, entry, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');
    for (const m of sql.matchAll(/CREATE TABLE\s+"(\w+)"/g)) names.add(m[1]);
  }
  return [...names];
}

describe('schema ↔ migration parity (catches db-push drift like MIG-1)', () => {
  const models = schemaModelNames();
  const tables = migrationTableNames();
  const missing = models.filter((m) => !tables.includes(m));

  it('every schema model is created by a migration, except the documented MIG-1 allowlist', () => {
    const unexpected = missing.filter((m) => !KNOWN_UNMIGRATED_MODELS.includes(m));
    expect(unexpected).toEqual([]);
  });

  it('the MIG-1 allowlist self-cleans — each listed model is still genuinely un-migrated', () => {
    // If a model here has since gained a migration, remove it from the allowlist.
    const staleAllowlistEntries = KNOWN_UNMIGRATED_MODELS.filter((m) => !missing.includes(m));
    expect(staleAllowlistEntries).toEqual([]);
  });
});

describe('status / role constants stay self-consistent', () => {
  it('FINAL_TASK_STATUSES is a subset of TASK_STATUSES', () => {
    const all = new Set<string>(TASK_STATUSES as readonly string[]);
    expect(FINAL_TASK_STATUSES.every((s) => all.has(s))).toBe(true);
  });

  it('enumerable constants have no duplicates and are non-empty', () => {
    for (const list of [ROLE_NAMES, TASK_STATUSES as readonly string[], FINDING_STATUSES]) {
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('Finding lifecycle includes the Dismissed terminal off-ramp (drift fixed 2026-06-28)', () => {
    expect(FINDING_STATUSES).toContain('Dismissed');
  });
});
