import { PrismaClient, Prisma } from '@prisma/client';
import { hasPrivilege } from '../utils/privilegeAccess';
import { PrivilegeKey } from '../constants/privileges';
import { emitRealtimeEvent } from '../realtime/pgEvents';

// Retain read notifications for this many days before purging.
const NOTIFICATION_RETENTION_DAYS = 30;

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Notification Center service.
 *
 * Notifications are an ADDITIVE THIRD write (Rule 3): they sit alongside — never
 * replace — the AuditLog + FeedPost dual-write. Every public entry point here is
 * best-effort: it swallows its own errors so a notification failure can never
 * roll back or break the business write that triggered it. Call these AFTER the
 * business dual-write has committed, passing the base `prisma` client (not a
 * transaction client) so the notification rows are durable before the realtime
 * signal fires.
 */

export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_REVIEWED'
  | 'TASK_SUBMITTED'
  | 'ESCALATION_QUEUED'
  | 'FINDING_CREATED'
  | 'FEED_ACTIVITY';

export type NotificationLinkScope = 'TASK' | 'WP' | 'FINDING' | 'ESCALATION';

export interface NotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  body?: string | null;
  linkScope?: NotificationLinkScope | null;
  linkId?: number | null;
  metadata?: Record<string, unknown> | null;
}

// Director / Admin carry cross-division reach (scope rule, hardcoded — mirrors
// canActionFlag). Every other role is division-scoped for recipient resolution.
const GLOBAL_REACH_ROLES = new Set(['Director', 'Admin']);

/**
 * Creates notifications for a batch of recipients, best-effort.
 *  - Skips any input whose userId is in `excludeUserIds` (e.g. the actor) and
 *    de-duplicates repeated recipients within the batch.
 *  - FEED_ACTIVITY collapses onto an existing UNREAD notification for the same
 *    (user, linkScope, linkId): instead of inserting a new row it bumps the
 *    timestamp and a rolling count, so a burst of comments yields one inbox
 *    entry rather than many (noise control).
 *  - After writing, emits one realtime `notification` signal per distinct
 *    recipient so their inbox bell refreshes live.
 */
export async function createNotifications(
  client: PrismaLike,
  inputs: NotificationInput[],
  excludeUserIds: Array<number | null | undefined> = []
): Promise<void> {
  const exclude = new Set(excludeUserIds.filter((id): id is number => typeof id === 'number'));
  // De-dup identical (user,type,linkScope,linkId) tuples within this batch.
  const seen = new Set<string>();
  const recipients = new Set<number>();

  for (const input of inputs) {
    if (exclude.has(input.userId)) continue;
    const key = `${input.userId}|${input.type}|${input.linkScope ?? ''}|${input.linkId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Isolate each write: one recipient's failure must never abort the rest of
    // the batch (e.g. a transient error on reviewer #3 should still notify #4-N).
    try {
      const written = await writeOne(client, input);
      if (written) recipients.add(input.userId);
    } catch (err) {
      console.error('[notifications] write failed for user', input.userId, '(non-fatal):', err);
    }
  }

  for (const userId of recipients) {
    try {
      await emitRealtimeEvent(client, { kind: 'notification', userId });
    } catch (err) {
      console.error('[notifications] signal failed for user', userId, '(non-fatal):', err);
    }
  }
}

async function writeOne(client: PrismaLike, input: NotificationInput): Promise<boolean> {
  if (input.type === 'FEED_ACTIVITY' && input.linkScope && input.linkId != null) {
    const existing = await client.notification.findFirst({
      where: {
        userId: input.userId,
        type: 'FEED_ACTIVITY',
        linkScope: input.linkScope,
        linkId: input.linkId,
        readAt: null,
      },
      select: { id: true, metadata: true },
    });
    if (existing) {
      const prevCount =
        (existing.metadata as { count?: number } | null)?.count ?? 1;
      await client.notification.update({
        where: { id: existing.id },
        data: {
          createdAt: new Date(),
          title: input.title,
          body: input.body ?? null,
          metadata: { ...(input.metadata ?? {}), count: prevCount + 1 } as Prisma.InputJsonValue,
        },
      });
      return true;
    }
  }

  await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      linkScope: input.linkScope ?? null,
      linkId: input.linkId ?? null,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
    },
  });
  return true;
}

/**
 * Notifies the watchers of a TASK or WP feed about a new COMMENT (FEED_ACTIVITY),
 * skipping the author. Only TASK and WP carry a bounded watcher set; DIVISION /
 * ORG are broadcast feeds whose activity is surfaced by the live "new updates"
 * pill rather than persistent inbox entries, so they are intentionally skipped
 * here to avoid notifying the whole org on every comment.
 */
export async function notifyFeedWatchers(
  client: PrismaLike,
  scope: 'TASK' | 'WP' | 'DIVISION' | 'ORG' | 'FINDING',
  scopeId: number | null,
  authorId: number,
  content: string
): Promise<void> {
  try {
    let watchers: number[];
    let linkScope: NotificationLinkScope;
    let linkId: number;

    if (scope === 'TASK' && scopeId != null) {
      watchers = await resolveTaskWatchers(client, scopeId);
      linkScope = 'TASK';
      linkId = scopeId;
    } else if (scope === 'WP' && scopeId != null) {
      watchers = await resolveWpWatchers(client, scopeId);
      linkScope = 'WP';
      linkId = scopeId;
    } else {
      return;
    }

    const excerpt = content.trim();
    const body = excerpt.length > 140 ? `${excerpt.slice(0, 140)}…` : excerpt;
    const title =
      scope === 'TASK' ? 'New comment on a task you follow' : 'New comment on a work package you follow';

    const inputs: NotificationInput[] = watchers.map((userId) => ({
      userId,
      type: 'FEED_ACTIVITY',
      title,
      body,
      linkScope,
      linkId,
    }));

    await createNotifications(client, inputs, [authorId]);
  } catch (err) {
    console.error('[notifications] notifyFeedWatchers failed (non-fatal):', err);
  }
}

// ─── Retention / housekeeping ────────────────────────────────────────────────

/**
 * Deletes notifications that have been read and are older than
 * NOTIFICATION_RETENTION_DAYS. Unread notifications are never touched.
 * Called once at startup and then on a 24-hour interval (see index.ts).
 */
export async function purgeOldNotifications(client: PrismaClient): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await client.notification.deleteMany({
      where: { readAt: { not: null, lt: cutoff } },
    });
    if (count > 0) console.log(`[notifications] purged ${count} old read notification(s)`);
  } catch (err) {
    console.error('[notifications] purge failed (non-fatal):', err);
  }
}

// ─── Recipient resolvers ─────────────────────────────────────────────────────

/** Issuer + current assignee of a task (the people "involved" in it). */
export async function resolveTaskWatchers(client: PrismaLike, taskId: number): Promise<number[]> {
  const task = await client.task.findUnique({
    where: { id: taskId, deletedAt: null },
    select: { issuerId: true, assignedToUserId: true },
  });
  if (!task) return [];
  const ids = [task.issuerId, task.assignedToUserId].filter(
    (id): id is number => typeof id === 'number'
  );
  return Array.from(new Set(ids));
}

/** Creator + every assigned member of a work package. */
export async function resolveWpWatchers(client: PrismaLike, wpId: number): Promise<number[]> {
  const wp = await client.workPackage.findUnique({
    where: { id: wpId, deletedAt: null },
    select: { creatorId: true, assignments: { select: { userId: true } } },
  });
  if (!wp) return [];
  const ids = [wp.creatorId, ...wp.assignments.map((a) => a.userId)];
  return Array.from(new Set(ids));
}

/**
 * Resolves the set of users who hold a given privilege, honouring the same
 * scope rule as escalation/finding review: Director/Admin reach across all
 * divisions; every other privileged role is limited to `divisionId`. Pass
 * divisionId = null to resolve all holders regardless of division (used for
 * ORG-scope escalations).
 */
export async function resolvePrivilegedUserIds(
  client: PrismaLike,
  privilege: PrivilegeKey,
  divisionId: number | null
): Promise<number[]> {
  const roles = await client.role.findMany({
    select: { id: true, name: true, privilegeConfig: { select: { permissions: true } } },
  });
  const granting = roles.filter((r) =>
    hasPrivilege(
      { role: r.name, permissions: r.privilegeConfig?.permissions as Record<string, boolean> | null },
      privilege
    )
  );
  if (granting.length === 0) return [];

  const globalRoleIds = granting.filter((r) => GLOBAL_REACH_ROLES.has(r.name)).map((r) => r.id);
  const scopedRoleIds = granting.filter((r) => !GLOBAL_REACH_ROLES.has(r.name)).map((r) => r.id);

  const where: Prisma.UserWhereInput =
    divisionId == null
      ? { deletedAt: null, roleId: { in: granting.map((r) => r.id) } }
      : {
          deletedAt: null,
          OR: [
            { roleId: { in: globalRoleIds } },
            { roleId: { in: scopedRoleIds }, divisionId },
          ],
        };

  const users = await client.user.findMany({ where, select: { id: true } });
  return users.map((u) => u.id);
}
