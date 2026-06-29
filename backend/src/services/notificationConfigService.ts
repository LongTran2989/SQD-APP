import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Notification Event Configuration service.
 *
 * Backs the Settings → Notifications admin panel and is consulted at the single
 * `createNotifications` chokepoint. Every read is FAIL-OPEN: if the table is
 * missing or unreadable, callers fall back to "all enabled, no CC" so a config
 * problem can never silently suppress a notification (notifications are an
 * additive, best-effort THIRD write — Rule 3).
 */

type PrismaLike = PrismaClient | Prisma.TransactionClient;

// The configurable event classes. NOTE: the `Notification.type` field only has
// six values — FEED_ACTIVITY covers both task and WP feeds, so it is split here
// by linkScope into two independently-configurable keys.
export const NOTIFICATION_EVENT_KEYS = [
  'TASK_ASSIGNED',
  'TASK_SUBMITTED',
  'TASK_REVIEWED',
  'FINDING_CREATED',
  'ESCALATION_QUEUED',
  'FEED_ACTIVITY_TASK',
  'FEED_ACTIVITY_WP',
  'FEED_MENTION',
  'FEED_DIGEST',
  'BLUEPRINT_LAUNCHED',
  'TASKS_GENERATED',
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

export interface EventConfigValue {
  enabled: boolean;
  ccManagers: boolean;
}

export interface EventCatalogItem {
  key: NotificationEventKey;
  group: string;
  label: string;
  description: string;
  // Whether the "CC division Managers" knob is the only audience control for
  // this event (base recipients are governed by the Privileges matrix instead).
  recipientsFromPrivileges: boolean;
}

// Ordered catalog driving the frontend panel.
export const NOTIFICATION_EVENT_CATALOG: EventCatalogItem[] = [
  { key: 'TASK_ASSIGNED', group: 'Tasks', label: 'Task assigned', description: 'Sent to the new assignee when a task is assigned or reassigned.', recipientsFromPrivileges: false },
  { key: 'TASK_SUBMITTED', group: 'Tasks', label: 'Task submitted for review', description: "Sent to the task issuer when a task enters review.", recipientsFromPrivileges: false },
  { key: 'TASK_REVIEWED', group: 'Tasks', label: 'Task reviewed', description: 'Sent to the assignee when their task is approved, rejected, or sent for follow-up.', recipientsFromPrivileges: false },
  { key: 'FINDING_CREATED', group: 'Findings', label: 'Finding raised', description: 'Sent to finding reviewers in the target division when a finding is raised.', recipientsFromPrivileges: true },
  { key: 'ESCALATION_QUEUED', group: 'Escalation', label: 'Escalation queued', description: 'Sent to escalation reviewers when a comment is escalated.', recipientsFromPrivileges: true },
  { key: 'FEED_ACTIVITY_TASK', group: 'Feed activity', label: 'New comment on a task', description: 'Sent to task watchers (issuer + assignee) when a comment is posted.', recipientsFromPrivileges: false },
  { key: 'FEED_ACTIVITY_WP', group: 'Feed activity', label: 'New comment on a work package', description: 'Sent to work package watchers (creator + members) when a comment is posted.', recipientsFromPrivileges: false },
  { key: 'FEED_MENTION', group: 'Feed activity', label: 'You were mentioned', description: 'Sent to a user when they are @mentioned in a feed comment.', recipientsFromPrivileges: false },
  { key: 'FEED_DIGEST', group: 'Feed activity', label: 'Daily feed digest', description: 'A once-daily summary of new Org Feed + Division Board activity, sent only to users who opt in (Preferences).', recipientsFromPrivileges: false },
  { key: 'BLUEPRINT_LAUNCHED', group: 'Work packages', label: 'Routine WP auto-launch', description: 'Sent to the blueprint owner and division managers when a recurring blueprint auto-launches a work package, or when an auto-launch fails.', recipientsFromPrivileges: false },
  { key: 'TASKS_GENERATED', group: 'Work packages', label: 'Tasks auto-generated', description: "Sent to a work package's assigned members when tasks are auto-generated into it, and to a member newly assigned to a work package that already has auto-generated tasks.", recipientsFromPrivileges: false },
];

const DEFAULT_VALUE: EventConfigValue = { enabled: true, ccManagers: false };

export function isNotificationEventKey(value: unknown): value is NotificationEventKey {
  return typeof value === 'string' && (NOTIFICATION_EVENT_KEYS as readonly string[]).includes(value);
}

export type EventConfigMap = Record<NotificationEventKey, EventConfigValue>;

function buildDefaultMap(): EventConfigMap {
  const map = {} as EventConfigMap;
  for (const key of NOTIFICATION_EVENT_KEYS) map[key] = { ...DEFAULT_VALUE };
  return map;
}

// ─── Read cache ──────────────────────────────────────────────────────────────
// Config is consulted on every notification write, so we cache it briefly.
// Cross-instance staleness of < TTL is acceptable for an admin config panel and
// avoids a pg_notify dependency. Disabled under test so config writes are
// observed immediately by the same suite.
const CACHE_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 60_000;
let cache: { map: EventConfigMap; expiresAt: number } | null = null;

export function clearNotificationConfigCache(): void {
  cache = null;
}

/**
 * Returns the effective config map (stored rows merged over defaults). FAIL-OPEN:
 * any error yields the all-enabled default map so notifications are never lost.
 */
export async function getEventConfigMap(client: PrismaLike): Promise<EventConfigMap> {
  if (cache && cache.expiresAt > Date.now()) return cache.map;
  try {
    const rows = await client.notificationEventConfig.findMany({
      select: { eventKey: true, enabled: true, ccManagers: true },
    });
    const map = buildDefaultMap();
    for (const row of rows) {
      if (isNotificationEventKey(row.eventKey)) {
        map[row.eventKey] = { enabled: row.enabled, ccManagers: row.ccManagers };
      }
    }
    if (CACHE_TTL_MS > 0) cache = { map, expiresAt: Date.now() + CACHE_TTL_MS };
    return map;
  } catch (err) {
    console.error('[notifications] config read failed — failing open (all enabled):', err);
    return buildDefaultMap();
  }
}

/** Catalog + current effective values, for the GET endpoint. */
export async function getAllConfigs(client: PrismaLike): Promise<{
  catalog: EventCatalogItem[];
  configs: Array<EventConfigValue & { eventKey: NotificationEventKey }>;
}> {
  const map = await getEventConfigMap(client);
  return {
    catalog: NOTIFICATION_EVENT_CATALOG,
    configs: NOTIFICATION_EVENT_KEYS.map((key) => ({ eventKey: key, ...map[key] })),
  };
}

/**
 * Upserts a single event config row and records the change in AuditLog (Rule 3 —
 * AuditLog only; this is not task-scoped so no FeedPost dual-write applies).
 * Clears the read cache so the next notification sees the new value.
 */
export async function upsertConfig(
  client: PrismaClient,
  eventKey: NotificationEventKey,
  value: EventConfigValue,
  actorUserId: number
): Promise<EventConfigValue & { eventKey: NotificationEventKey }> {
  const before = await client.notificationEventConfig.findUnique({ where: { eventKey } });
  await client.$transaction(async (tx) => {
    await tx.notificationEventConfig.upsert({
      where: { eventKey },
      update: { enabled: value.enabled, ccManagers: value.ccManagers, updatedById: actorUserId },
      create: { eventKey, enabled: value.enabled, ccManagers: value.ccManagers, updatedById: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        actionType: 'NOTIFICATION_CONFIG_UPDATED',
        entityType: 'NotificationEventConfig',
        entityId: eventKey,
        performedByUserId: actorUserId,
        details: {
          before: before ? { enabled: before.enabled, ccManagers: before.ccManagers } : null,
          after: value,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });
  clearNotificationConfigCache();
  return { eventKey, ...value };
}
