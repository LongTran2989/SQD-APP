import { PrismaClient, Prisma } from '@prisma/client';
import { emitRealtimeEvent } from '../realtime/pgEvents';
import { resolveTaskWatchers, resolveWpWatchers, resolveFindingWatchers } from './notificationService';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type FeedScope = 'TASK' | 'WP' | 'DIVISION' | 'ORG' | 'FINDING';
export type FeedPostType = 'COMMENT' | 'SYSTEM_EVENT' | 'ESCALATION_CARD' | 'INFO_CARD';

export interface CreateFeedPostInput {
  type: FeedPostType;
  scope: FeedScope;
  scopeId?: number | null; // NULL for the singleton ORG feed
  content: string;
  authorId?: number | null; // NULL for SYSTEM_EVENT / auto-generated cards
  metadata?: Record<string, unknown> | null | undefined;
  // Escalation linkage (used from Phase 3 onward)
  sourcePostId?: number | null;
  sourceExcerpt?: string | null;
  sourceTaskId?: number | null;
  sourceWpId?: number | null;
  flagId?: number | null;
  taggedDivisionIds?: number[] | null;
}

/**
 * Creates a FeedPost on the given scope. Accepts a PrismaClient OR a transaction
 * client so callers that mutate inside a $transaction keep writes atomic.
 *
 * This is the single entry point for writing the unified feed — the Task feed
 * (scope 'TASK', scopeId = task.id) replaces the former TaskActivity model.
 */
export async function createFeedPost(client: PrismaLike, input: CreateFeedPostInput) {
  const post = await client.feedPost.create({
    data: {
      type: input.type,
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      content: input.content,
      authorId: input.authorId ?? null,
      metadata: (input.metadata as any) ?? Prisma.DbNull,
      sourcePostId: input.sourcePostId ?? null,
      sourceExcerpt: input.sourceExcerpt ?? null,
      sourceTaskId: input.sourceTaskId ?? null,
      sourceWpId: input.sourceWpId ?? null,
      flagId: input.flagId ?? null,
      taggedDivisionIds: (input.taggedDivisionIds as any) ?? Prisma.DbNull,
    },
  });

  // Realtime SIGNAL for the "new updates" pill + soft refetch. Rides the
  // caller's transaction client so the NOTIFY only fires on COMMIT (no refetch
  // race), is best-effort (never throws), and is a no-op under NODE_ENV=test.
  //
  // M1: scope the signal. TASK/WP/FINDING feeds have a bounded watcher set, so we
  // resolve it here (emit-time) and fan out to just those users — instead of the
  // old broadcast-to-everyone, which was O(comments × connected users). DIVISION/
  // ORG are genuinely shared feeds and stay a broadcast (userIds omitted). Watcher
  // resolution is wrapped so it can never break the feed write (best-effort like
  // the emit itself), and skipped entirely under test where emit is a no-op.
  if (process.env.NODE_ENV !== 'test') {
    try {
      const sid = input.scopeId ?? null;
      let userIds: number[] | undefined;
      if (sid != null) {
        if (input.scope === 'TASK') userIds = await resolveTaskWatchers(client, sid);
        else if (input.scope === 'WP') userIds = await resolveWpWatchers(client, sid);
        else if (input.scope === 'FINDING') userIds = await resolveFindingWatchers(client, sid);
      }
      await emitRealtimeEvent(
        client,
        userIds
          ? { kind: 'feed', scope: input.scope, scopeId: sid, userIds }
          : { kind: 'feed', scope: input.scope, scopeId: sid }
      );
    } catch (err) {
      console.error('[realtime] feed signal scoping failed (non-fatal):', err);
    }
  }

  return post;
}

export const FEED_SCOPES: FeedScope[] = ['TASK', 'WP', 'DIVISION', 'ORG', 'FINDING'];

export function isFeedScope(value: string): value is FeedScope {
  return (FEED_SCOPES as string[]).includes(value);
}

export const FEED_POST_TYPES: FeedPostType[] = ['COMMENT', 'SYSTEM_EVENT', 'ESCALATION_CARD', 'INFO_CARD'];

// ─── @mentions (Phase E) ──────────────────────────────────────────────────────
// Mentions are explicit: the client sends the resolved user ids alongside a
// comment. They are stored on the post as metadata.mentions (int[]) and surfaced
// on reads as { id, name }. Validation drops ids that aren't real, non-deleted
// users, so the stored set is always trustworthy.

/** Validates raw mention ids → ordered, de-duped [{id,name}] of real users. */
export async function resolveMentions(
  client: PrismaLike,
  raw: unknown
): Promise<{ id: number; name: string | null }[]> {
  if (!Array.isArray(raw)) return [];
  const ids = [...new Set(raw.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)))];
  if (ids.length === 0) return [];
  const users = await client.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true },
  });
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return ids.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id) ?? null }));
}

/** Extracts the stored mention ids from a FeedPost.metadata value (read path). */
export function mentionIdsFromMetadata(metadata: unknown): number[] {
  const m = (metadata as { mentions?: unknown } | null)?.mentions;
  return Array.isArray(m) ? m.filter((n): n is number => typeof n === 'number') : [];
}

// ─── Inline entity links (#CODE) — Phase E.2 ──────────────────────────────────
// Users reference a Task / Work Package / Finding by its business code with a
// leading '#' (e.g. "#QCH-015"). The reference is NOT stored as markup — it stays
// plain text; reads resolve any code that maps to a real, non-deleted entity into
// { type, id } so the client can linkify it to the numeric detail route. Unknown
// codes resolve to nothing and render as plain text.

export type EntityRefType = 'TASK' | 'WP' | 'FINDING';
export interface EntityLink { type: EntityRefType; id: number; }

// '#' followed by an alphanumeric run (codes are letters/digits/_/-). Brackets and
// whitespace terminate the token, so prose like "#1 priority" matches '#1' only.
const ENTITY_REF_REGEX = /#([A-Za-z0-9][A-Za-z0-9_-]*)/g;

/** Pulls the distinct #CODE references out of a comment body. */
export function extractEntityRefs(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(ENTITY_REF_REGEX)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/**
 * Resolves candidate codes → { type, id } for the ones that match a real,
 * non-deleted Task.taskId / WorkPackage.wpId / Finding.findingId. Code namespaces
 * are distinct in practice; on the rare collision, Task wins (assigned last).
 */
export async function resolveEntityLinks(
  client: PrismaLike,
  codes: string[]
): Promise<Record<string, EntityLink>> {
  const map: Record<string, EntityLink> = {};
  const unique = [...new Set(codes)];
  if (unique.length === 0) return map;

  const [tasks, wps, findings] = await Promise.all([
    client.task.findMany({ where: { taskId: { in: unique }, deletedAt: null }, select: { id: true, taskId: true } }),
    client.workPackage.findMany({ where: { wpId: { in: unique }, deletedAt: null }, select: { id: true, wpId: true } }),
    client.finding.findMany({ where: { findingId: { in: unique }, deletedAt: null }, select: { id: true, findingId: true } }),
  ]);

  for (const f of findings) if (f.findingId) map[f.findingId] = { type: 'FINDING', id: f.id };
  for (const w of wps) if (w.wpId) map[w.wpId] = { type: 'WP', id: w.id };
  for (const t of tasks) if (t.taskId) map[t.taskId] = { type: 'TASK', id: t.id };
  return map;
}

// ─── Comment attachments (Phase F) ────────────────────────────────────────────
// Files attached to a feed COMMENT are stored as Attachment rows with
// entityType='FEED_POST', entityId=post.id. Reads surface their metadata so the
// comment can render download chips. Bytes always stream via /api/attachments.

export interface FeedAttachment {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  caption: string | null;
}

/** Batched: the non-deleted attachments for a page of posts, keyed by post id. */
export async function resolveAttachmentsForPosts(
  client: PrismaLike,
  postIds: number[]
): Promise<Map<number, FeedAttachment[]>> {
  const out = new Map<number, FeedAttachment[]>();
  if (postIds.length === 0) return out;
  const rows = await client.attachment.findMany({
    where: { entityType: 'FEED_POST', entityId: { in: postIds.map(String) }, deletedAt: null },
    select: { id: true, fileName: true, fileType: true, fileSize: true, caption: true, entityId: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of rows) {
    const pid = Number(r.entityId);
    const list = out.get(pid) ?? [];
    list.push({ id: r.id, fileName: r.fileName, fileType: r.fileType, fileSize: r.fileSize, caption: r.caption });
    out.set(pid, list);
  }
  return out;
}

/**
 * Convenience for a read path: resolve the entity links for a page of posts and
 * return a per-post map (only the codes found in that post that actually resolve).
 */
export async function resolveEntityLinksForPosts<T extends { id: number; content: string }>(
  client: PrismaLike,
  posts: T[]
): Promise<Map<number, Record<string, EntityLink>>> {
  const refsByPost = new Map(posts.map((p) => [p.id, extractEntityRefs(p.content)]));
  const allRefs = [...new Set([...refsByPost.values()].flat())];
  const linkMap = await resolveEntityLinks(client, allRefs);
  const out = new Map<number, Record<string, EntityLink>>();
  for (const [postId, refs] of refsByPost) {
    const entry: Record<string, EntityLink> = {};
    for (const code of refs) if (linkMap[code]) entry[code] = linkMap[code]!;
    out.set(postId, entry);
  }
  return out;
}

// Feed read pagination (H2). Reads are keyset-paginated newest-first on the
// primary key (FeedPost.id is monotonic with creation, so id-desc == createdAt-
// desc) and the controller reverses the page to ascending for chat-style display.
export const DEFAULT_FEED_LIMIT = 30;
export const MAX_FEED_LIMIT = 100;

/** Clamps a requested page size to [1, MAX_FEED_LIMIT], defaulting when absent/invalid. */
export function parseFeedLimit(raw: unknown): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_FEED_LIMIT;
  return Math.min(n, MAX_FEED_LIMIT);
}

/** Parses the keyset cursor: the id to page *before* (older than). Null when absent/invalid. */
export function parseFeedBefore(raw: unknown): number | null {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isNaN(n) || n < 1 ? null : n;
}

/**
 * Parses an optional `types` filter ("COMMENT,SYSTEM_EVENT") into a validated,
 * de-duplicated FeedPostType[]. Returns null when absent/empty/all-invalid so the
 * caller omits the type filter entirely (= all types).
 */
export function parseFeedTypes(raw: unknown): FeedPostType[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parts = raw.split(',').map((s) => s.trim().toUpperCase());
  const valid = parts.filter((p): p is FeedPostType => (FEED_POST_TYPES as string[]).includes(p));
  return valid.length > 0 ? [...new Set(valid)] : null;
}

/**
 * Maximum length of a single feed COMMENT. Mirrors the cap the Task feed has
 * always enforced (task.controller's MAX_COMMENT_LEN). Centralised here so EVERY
 * comment path (task, WP, division, org, finding) shares one ceiling — see H1 in
 * FEED_FEATURES_AUDIT.md: the generic feed endpoint previously had no cap.
 */
export const MAX_COMMENT_LEN = 5000;

/**
 * Validates a comment body's length. Returns an error message string when the
 * (trimmed) content exceeds MAX_COMMENT_LEN, or null when it is acceptable.
 * Callers handle the empty/whitespace case separately (a 400 "content required").
 */
export function commentLengthError(content: string): string | null {
  if (content.trim().length > MAX_COMMENT_LEN) {
    return `Comment is too long (max ${MAX_COMMENT_LEN} characters).`;
  }
  return null;
}

/**
 * Builds the Prisma WHERE clause that selects every post on a single feed.
 * scopeId is polymorphic (taskId / wpId / divisionId) and ignored for the
 * singleton ORG feed (always scopeId NULL). Reads are open to all authenticated
 * users (transparency default) — this helper only locates the feed, not who may
 * see it. Provided for any future filtered reads as well.
 */
export function buildFeedPostScope(scope: FeedScope, scopeId: number | null): Prisma.FeedPostWhereInput {
  if (scope === 'ORG') return { scope: 'ORG', scopeId: null };
  return { scope, scopeId };
}

/**
 * RBAC gate for posting a COMMENT to a feed (mirrors the plan's RBAC matrix):
 *   - TASK / WP    → any authenticated user (transparent commenting).
 *   - DIVISION     → own division only; Director / Admin may post to any.
 *   - ORG          → Director / Admin / Manager only.
 * Director / Admin bypass division checks throughout.
 */
export function canPostToFeed(
  user: { role: string; divisionId: number },
  scope: FeedScope,
  scopeId: number | null
): boolean {
  const isDirectorOrAdmin = user.role === 'Director' || user.role === 'Admin';
  switch (scope) {
    case 'TASK':
    case 'WP':
    case 'FINDING':  // open commenting — any authenticated user (findings are globally readable)
      return true;
    case 'DIVISION':
      return isDirectorOrAdmin || scopeId === user.divisionId;
    case 'ORG':
      return isDirectorOrAdmin || user.role === 'Manager';
    default:
      return false;
  }
}
