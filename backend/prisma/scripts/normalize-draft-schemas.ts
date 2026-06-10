// backend/prisma/scripts/normalize-draft-schemas.ts
// -----------------------------------------------------------------------
// One-off data migration: normalize legacy array-form `draftSchema`s into the
// standardized object form { title, description, formSchema, requiresApproval,
// allowsFindings, estimatedHours, isOneOff, skillLevel, type }.
//
// Legacy array form carried ONLY the field definitions (the formSchema array);
// all other draft meta defaults to the template's current published values so a
// subsequent publish preserves behaviour.
//
// Idempotent: rows already in object form are skipped. Safe to re-run.
//
// USAGE (from /backend):
//   npx ts-node prisma/scripts/normalize-draft-schemas.ts            # dry-run (counts only)
//   npx ts-node prisma/scripts/normalize-draft-schemas.ts --apply    # perform the migration
// -----------------------------------------------------------------------

import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const apply = process.argv.includes('--apply');

  const templates = await prisma.template.findMany({
    where: { draftSchema: { not: Prisma.DbNull } },
  });

  let arrayForm = 0;
  let objectForm = 0;
  let nullish = 0;

  for (const t of templates) {
    const draft = t.draftSchema as unknown;
    if (Array.isArray(draft)) {
      arrayForm++;
      if (apply) {
        await prisma.template.update({
          where: { id: t.id },
          data: {
            draftSchema: {
              title: t.title,
              description: t.description,
              formSchema: draft,
              requiresApproval: t.requiresApproval,
              allowsFindings: t.allowsFindings,
              estimatedHours: t.estimatedHours,
              isOneOff: t.isOneOff,
              skillLevel: t.skillLevel,
              type: t.type,
            } as any,
          },
        });
      }
    } else if (draft && typeof draft === 'object') {
      objectForm++;
    } else {
      nullish++;
    }
  }

  console.log('── draftSchema normalization ───────────────────────────');
  console.log(`  templates with draftSchema : ${templates.length}`);
  console.log(`  legacy array form          : ${arrayForm}${apply ? ' (converted)' : ' (would convert)'}`);
  console.log(`  already object form        : ${objectForm} (skipped)`);
  console.log(`  null/other                 : ${nullish} (skipped)`);
  console.log(`  mode                       : ${apply ? 'APPLY' : 'DRY-RUN (pass --apply to migrate)'}`);
  console.log('────────────────────────────────────────────────────────');
}

main()
  .catch(e => {
    console.error('❌ Normalization failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
