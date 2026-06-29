// backend/prisma/seed.ts
// -----------------------------------------------------------------------
// Top-level seed entrypoint. Seeds Roles (the one thing that must never come
// from Excel — RoleName is a fixed TS literal union used throughout the
// codebase), then runs the Excel-driven seed scripts in dependency order as
// separate child processes (each gets its own Prisma client, avoiding pool
// conflicts; a failure in one script does not abort the others).
//
// All seed data — Departments, Divisions, Users, WpTypes, SystemSettings,
// NotificationEventConfig, finding taxonomy, aviation reference data, cause
// codes, Privileges, Templates, TemplateSets, WpBlueprints — lives in
// backend/seed_data.xlsx. See the GUIDE sheet in that workbook for which
// sheets are freely editable vs. code-coupled.
//
// HOW TO RUN (from inside /backend):
//   npx ts-node prisma/seed.ts
//   or: npx prisma db seed
// -----------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function runChildSeed(label: string, scriptPath: string) {
  console.log('');
  console.log(`── ${label} ──────────────────────────────────────────────`);
  try {
    execSync(`node node_modules/ts-node/dist/bin.js ${scriptPath}`, {
      stdio: 'inherit',
      cwd: __dirname + '/..',
    });
  } catch (e) {
    console.warn(`⚠️  ${label} encountered an error (non-fatal). Check output above.`);
  }
}

async function main() {
  console.log('🌱 Seeding database...');

  // ── ROLES ──────────────────────────────────────────────────────────────────
  const roles = await Promise.all([
    prisma.role.upsert({ where: { name: 'Director'     }, update: {}, create: { name: 'Director'     } }),
    prisma.role.upsert({ where: { name: 'Admin'        }, update: {}, create: { name: 'Admin'        } }),
    prisma.role.upsert({ where: { name: 'Manager'      }, update: {}, create: { name: 'Manager'      } }),
    prisma.role.upsert({ where: { name: 'Group Leader' }, update: {}, create: { name: 'Group Leader' } }),
    prisma.role.upsert({ where: { name: 'Staff'        }, update: {}, create: { name: 'Staff'        } }),
    prisma.role.upsert({ where: { name: 'Senior Advisor'}, update: {}, create: { name: 'Senior Advisor'} }),
  ]);
  console.log(`✅ Roles seeded (${roles.length})`);
}

main()
  .then(() => {
    // Each script below opens its own DB connection; run sequentially and after
    // this process has released its Prisma/pg pool to avoid connection contention.
    runChildSeed('Excel Org Data Seed (Departments / Divisions / Users)', 'prisma/seed-org.ts');
    runChildSeed('Excel Reference Data Seed (WpTypes / Taxonomy / Aviation / Privileges)', 'prisma/seed-reference.ts');
    runChildSeed('Excel Template Seed', 'prisma/seed-templates.ts');
    runChildSeed('Excel Template Set & WP Blueprint Seed', 'prisma/seed-blueprints.ts');
    console.log('');
    console.log('🎉 Seed complete!');
  })
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
