// backend/prisma/clean-mock-findings.ts
// -----------------------------------------------------------------------
// PRE-PRODUCTION CLEANUP — removes MOCK / TEST finding data only.
//
// Deletes the entire Finding subsystem (the 8 seeded sample findings AND
// anything you created while testing them) while PRESERVING all reference /
// master data: users, roles, divisions, departments, ATA chapters, event
// types, hazard-tag definitions, templates, system settings, privileges.
//
// WHAT IT DELETES
//   • All Findings  (+ cascade: RCA, CAPA, hazard-tag links, finding links,
//                    response actions — all onDelete: Cascade)
//   • All FINDING-scoped FeedPosts        (polymorphic — no FK, deleted here)
//   • Follow-up Tasks generated from findings (Task.parentFindingId set)
//     and their TASK-scoped FeedPosts      (+ cascade: TaskData, TimeEntry…)
//   • FINDING-scoped Notifications
//
// WHAT IT KEEPS
//   • User, Role, Division, Department, AtaChapter, EventType, HazardTag,
//     Template, SystemSetting, PrivilegeConfig, WorkPackage, and every other
//     non-follow-up Task.
//
// ⚠️  This is a HARD delete (bypasses the app's soft-delete rule on purpose).
//     Run it ONLY against a pre-production database that contains mock data.
//     NEVER run it against a live production database with real findings.
//
// HOW TO RUN (from inside /backend):
//   1. Dry run (counts only, deletes nothing):
//        npx ts-node prisma/clean-mock-findings.ts
//   2. Execute for real:
//        CONFIRM=yes npx ts-node prisma/clean-mock-findings.ts
//
//   Options (env vars):
//     KEEP_FOLLOWUP_TASKS=yes  → detach follow-up tasks (set parentFindingId
//                                = null) instead of deleting them.
// -----------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const confirmed = process.env.CONFIRM === 'yes';
  const keepFollowUps = process.env.KEEP_FOLLOWUP_TASKS === 'yes';

  // ── Survey what will be removed ──
  const findings = await prisma.finding.findMany({ select: { id: true } });
  const findingIds = findings.map((f) => f.id);

  const followUps = findingIds.length
    ? await prisma.task.findMany({ where: { parentFindingId: { in: findingIds } }, select: { id: true } })
    : [];
  const followUpIds = followUps.map((t) => t.id);

  const findingFeedCount = await prisma.feedPost.count({ where: { scope: 'FINDING' } });
  const taskFeedCount = followUpIds.length
    ? await prisma.feedPost.count({ where: { scope: 'TASK', scopeId: { in: followUpIds } } })
    : 0;
  const findingNotifCount = await prisma.notification.count({ where: { linkScope: 'FINDING' } });

  console.log('── Mock-finding cleanup survey ──────────────────────────');
  console.log(`   Findings to delete        : ${findingIds.length}`);
  console.log(`   FINDING feed posts         : ${findingFeedCount}`);
  console.log(`   Follow-up tasks            : ${followUpIds.length}  (${keepFollowUps ? 'detach only' : 'delete'})`);
  console.log(`   Follow-up TASK feed posts  : ${taskFeedCount}`);
  console.log(`   FINDING notifications      : ${findingNotifCount}`);
  console.log('─────────────────────────────────────────────────────────');

  if (findingIds.length === 0 && findingFeedCount === 0) {
    console.log('✅ Nothing to clean — no findings or finding feed posts present.');
    return;
  }

  if (!confirmed) {
    console.log('\nDRY RUN — nothing deleted. Re-run with CONFIRM=yes to execute.');
    return;
  }

  // ── Execute, FK-safe, in one transaction ──
  await prisma.$transaction(async (tx) => {
    // 1. Polymorphic feed posts (no FK → must be deleted explicitly).
    await tx.feedPost.deleteMany({ where: { scope: 'FINDING' } });
    if (followUpIds.length) {
      await tx.feedPost.deleteMany({ where: { scope: 'TASK', scopeId: { in: followUpIds } } });
    }

    // 2. Finding notifications (polymorphic linkScope/linkId).
    await tx.notification.deleteMany({ where: { linkScope: 'FINDING' } });
    if (followUpIds.length) {
      await tx.notification.deleteMany({ where: { linkScope: 'TASK', linkId: { in: followUpIds } } });
    }

    // 3. Unblock finding deletion: Task.parentFindingId is the only inbound FK
    //    to Finding without a cascade rule. Detach it before deleting findings.
    if (followUpIds.length) {
      await tx.task.updateMany({ where: { id: { in: followUpIds } }, data: { parentFindingId: null } });
    }

    // 4. Delete findings → cascades RCA / CAPA / hazard tags / links / response
    //    actions (and their dept rows + capa-task links), removing every
    //    finding-owned reference to the follow-up tasks.
    if (findingIds.length) {
      await tx.finding.deleteMany({ where: { id: { in: findingIds } } });
    }

    // 5. Delete the now-orphaned follow-up tasks (TaskData / TimeBooking /
    //    TimeEntry cascade). Skipped when KEEP_FOLLOWUP_TASKS=yes.
    if (!keepFollowUps && followUpIds.length) {
      await tx.task.deleteMany({ where: { id: { in: followUpIds } } });
    }
  });

  // ── Verify ──
  const remainingFindings = await prisma.finding.count();
  const remainingFindingFeed = await prisma.feedPost.count({ where: { scope: 'FINDING' } });
  console.log('\n✅ Cleanup complete.');
  console.log(`   Remaining findings        : ${remainingFindings}`);
  console.log(`   Remaining FINDING feed     : ${remainingFindingFeed}`);
  if (keepFollowUps && followUpIds.length) {
    console.log(`   Follow-up tasks detached   : ${followUpIds.length} (parentFindingId cleared, tasks kept)`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Cleanup failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
