# Realtime: SSE Notifications — Developer Onboarding Guide

> **Who this is for:** a developer picking up the SSE Live Notifications / Notification Center / Manual Refresh feature for the first time.
> **What it covers:** the architecture, the data model, the event flow, every file created/modified, the non-obvious gotchas, and how to add a new trigger.
> **Companion docs:** `CLAUDE_HANDOVER.md` §2 (feature entry) + §8 gotchas #40–44 (canonical), `BUSINESS_WORKFLOW.md` (business rules), `FEED_ESCALATION_DEV_GUIDE.md` (the feed model this rides on).

---

## 1. The big idea (one paragraph)

The app was almost entirely **pull-based**: feeds reloaded only on manual action, and the only near-real-time signal was a 60-second poll on the escalation bell. This feature adds a single **Server-Sent Events** stream per signed-in user that pushes lightweight **signals** — never payloads. When a signal arrives, the browser **refetches via the existing REST endpoints**, so all RBAC scoping and the `AuditLog` + `FeedPost` dual-write are reused untouched. On top of the stream sits a persistent **Notification Center** (`Notification` model + a separate inbox bell) and a **manual-refresh UX** (a "N new updates" pill + refetch-on-tab-refocus that never yanks content out from under a reader).

Three principles drove every decision:
1. **Signals, not payloads** — the stream says "something changed for you / for this feed"; the client decides what to refetch. The dual-write is never duplicated over the wire.
2. **Additive third write** — notifications sit *alongside* the dual-write, best-effort. A notification failure can never roll back or break the business write that triggered it (Rule 3).
3. **Scale with Postgres, not Redis** — cross-instance fan-out uses `LISTEN`/`NOTIFY` on one channel. No shared in-memory state.

---

## 2. Architecture at a glance

```
                          ┌──────────────────────────────────────────────┐
   Browser (Next.js 15)   │  RealtimeProvider (1 × EventSource)            │
                          │     │ ready/notification/escalation/feed       │
                          │     ▼                                          │
                          │  realtimeStore (Zustand)                       │
                          │     ├ unreadCount ─────▶ NotificationBell (blue inbox)
                          │     └ feedSignals[key] ─▶ useRealtimeRefresh ─▶ NewUpdatesPill
                          │  (also dispatches `escalations:changed` → red Header bell)
                          └──────────────┬───────────────────────────────┘
                          EventSource GET /api/events/stream  (httpOnly cookie auth)
   ──────────────────────────────────────┼──────────────────────────────────────
   Backend (Express 5)   routes/realtime.routes · controllers/realtime.controller (streamEvents)
                          routes/notification.routes · controllers/notification.controller (REST)
                          realtime/sseHub.ts        ← in-process Map<userId, Set<res>>
                          realtime/pgEvents.ts      ← emitRealtimeEvent / startRealtimeListener
                          services/notificationService.ts (createNotifications, resolvers, purge)
                          trigger sites: task/finding/escalation/feed controllers + feedService
                                         │
   ──────── pg_notify('sqd_realtime', …) │ LISTEN sqd_realtime ◀── every instance
   PostgreSQL (Prisma v7) Notification   (+ existing User/Task/Finding/WorkPackage/FeedPost)
```

**Cross-instance path:** a write on instance A calls `emitRealtimeEvent(txClient, evt)` → `pg_notify` fires **on COMMIT** → every instance (A, B, …) that holds a `LISTEN` receives it → each instance fans the signal out to *its own* local SSE clients via `sseHub`. A user connected to instance B therefore sees an event caused by a write on instance A. No Redis, no sticky sessions required.

---

## 3. Data model — `Notification`

> Canonical version lives in `backend/prisma/schema.prisma` and `CLAUDE_HANDOVER.md`. Migration: `backend/prisma/migrations/20260613000000_add_notification`.

```prisma
model Notification {
  id        Int       @id @default(autoincrement())
  userId    Int
  user      User      @relation("UserNotifications", fields: [userId], references: [id], onDelete: Cascade)
  type      String    // TASK_ASSIGNED | TASK_REVIEWED | TASK_SUBMITTED | ESCALATION_QUEUED | FINDING_CREATED | FEED_ACTIVITY
  title     String
  body      String?
  linkScope String?   // TASK | WP | FINDING | ESCALATION  (deep-link target)
  linkId    Int?
  metadata  Json?
  readAt    DateTime?
  createdAt DateTime  @default(now())
  @@index([userId, readAt])
  @@index([userId, createdAt])
}
```

**Key facts:**
- **Not soft-delete protected.** Unlike `User/Task/Finding/WorkPackage`, there is no `deletedAt`. It is a disposable UI artifact — `AuditLog` remains the compliance system-of-record. Rows may be physically read, updated, and purged.
- **`onDelete: Cascade`** is deliberate: test teardown that hard-deletes users must not FK-error.
- **`linkScope`/`linkId`** drive the deep link when a notification is clicked (`NotificationBell.linkHref`).
- **Retention:** `purgeOldNotifications` deletes **read** notifications older than 30 days. Unread rows are never touched.

---

## 4. The event contract

`RealtimeEvent` (in `realtime/pgEvents.ts`) is the wire shape of a `pg_notify` payload — keep it tiny (the `pg_notify` hard limit is 8 KB; `emitRealtimeEvent` guards at 7900 bytes):

```ts
type RealtimeEvent =
  | { kind: 'notification'; userId: number }   // → publishToUser → SSE `notification`
  | { kind: 'escalation';   userId: number }   // → publishToUser → SSE `escalation`
  | { kind: 'feed'; scope: 'TASK'|'WP'|'DIVISION'|'ORG'; scopeId: number|null }; // → publishToAll → SSE `feed`
```

`SseEvent` (in `realtime/sseHub.ts`) is what reaches the browser. The frontend `EventSource` listens for named events `ready`, `notification`, `escalation`, `feed` (plus `:keepalive` comment lines, ignored by EventSource).

| SSE event      | Frontend reaction (`RealtimeProvider`)                                   |
|----------------|--------------------------------------------------------------------------|
| `ready`        | `setConnected(true)` + refetch unread count                              |
| `notification` | refetch unread count + dispatch `escalations:changed` (red bell refresh) |
| `escalation`   | dispatch `escalations:changed`                                          |
| `feed`         | `bumpFeed(feedKey(scope, scopeId))` → raises the pill on matching views   |

---

## 5. Backend files

| File | Role |
|------|------|
| `realtime/sseHub.ts` (NEW) | In-process registry `Map<userId, Set<res>>`. `addClient` (5-conn cap → `false`), `removeClient`, `publishToUser`, `publishToAll`, `writeEvent` (returns `false` on a dead socket so broadcast loops prune it). |
| `realtime/pgEvents.ts` (NEW) | `emitRealtimeEvent(client, evt)` (no-op under test; payload-size guard) and `startRealtimeListener()` (dedicated `LISTEN` connection, auto-reconnect). `dispatch` has an exhaustive `default` that logs unknown kinds. |
| `controllers/realtime.controller.ts` (NEW) | `streamEvents` — checks the cap **before** the 200 handshake (rejects with a real 429), sets SSE headers, registers in the hub, sends a 25 s keepalive, cleans up on `close`/`error`. |
| `routes/realtime.routes.ts` (NEW) | `GET /api/events/stream` behind `authenticateJWT`. |
| `controllers/notification.controller.ts` + `routes/notification.routes.ts` (NEW) | `GET /api/notifications` (cursor paginated, `?unread=`), `GET /unread-count`, `PATCH /:id/read`, `POST /read-all`. Every endpoint scopes by `req.user.userId` — a user can only read/mutate their own. |
| `services/notificationService.ts` (NEW) | `createNotifications` (per-recipient error isolation, batch de-dup, FEED_ACTIVITY collapse-unread, one signal per recipient), `notifyFeedWatchers` (TASK/WP only), `resolveTaskWatchers`/`resolveWpWatchers`/`resolvePrivilegedUserIds`, `purgeOldNotifications`. |
| `index.ts` (MODIFIED) | Mounts the two route groups; calls `startRealtimeListener()` + schedules the purge (`unref()`'d interval) inside the `NODE_ENV!=='test'` block. |

**Trigger sites (additive, best-effort, at the existing dual-write block):**

| Where | Trigger | Recipients |
|-------|---------|------------|
| `task.controller.ts` `assignTask` / `reassignTask` | `TASK_ASSIGNED` | new assignee (excl. actor) |
| `task.controller.ts` `submitTask` (→ In Review) | `TASK_SUBMITTED` | task issuer |
| `task.controller.ts` `reviewTask` | `TASK_REVIEWED` | assignee (outcome in metadata) |
| `finding.controller.ts` `createFinding` | `FINDING_CREATED` | `finding:review` holders in target division (excl. reporter) |
| `escalation.controller.ts` `flagPost` | `ESCALATION_QUEUED` + `escalation` signal | `escalation:review` holders (excl. flagger) |
| `feed.controller.ts` / `task.controller.ts` comment path → `feedService.createFeedPost` | `feed` signal; `FEED_ACTIVITY` to watchers | TASK/WP watchers (excl. author) |

---

## 6. Frontend files

| File | Role |
|------|------|
| `realtime/RealtimeProvider.tsx` (NEW) | One `EventSource(`${API_BASE_URL}/events/stream`, { withCredentials: true })`. Routes events into the store. Mounted once in `app/dashboard/layout.tsx`; renders `null`. |
| `store/realtimeStore.ts` (NEW) | Zustand: `connected`, `unreadCount`, `feedSignals: Record<FeedKey, number>` (monotonic per feed). `feedKey(scope, scopeId)` helper. |
| `api/notificationApi.ts` (NEW) | `listNotifications`, `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`. |
| `components/layout/NotificationBell.tsx` (NEW) | The **inbox bell** (blue badge). Dropdown list, optimistic mark-one / mark-all, deep-link via `linkScope`/`linkId`. Added to `Header.tsx` beside — but independent of — the red escalation bell. |
| `hooks/useRealtimeRefresh.ts` (NEW) | `useRealtimeRefresh(key, refetch) → { hasNew, refresh }`. `hasNew` flips when `feedSignals[key]` exceeds the last-seen value; `refresh()` runs the refetch and marks the signal consumed; tab refocus refetches automatically. |
| `components/ui/NewUpdatesPill.tsx` (NEW) | Sticky "N new updates" pill; renders `null` when `!show`. |
| `components/feed/FeedPanel.tsx`, `components/tasks/TaskActivityFeed.tsx`, `app/dashboard/tasks/[id]/page.tsx` (MODIFIED) | Wired to `useRealtimeRefresh` + `NewUpdatesPill`. |
| `types/index.ts`, `api/client.ts` (MODIFIED) | `AppNotification` interface + exported `API_BASE_URL`. |

---

## 7. Gotchas (the non-obvious ones)

1. **`emitRealtimeEvent` is a no-op under `NODE_ENV==='test'`; `startRealtimeListener` is never called under test.** Jest must not hold an open `pg` LISTEN connection past the suite. Rows are still written under test — only the `NOTIFY` is skipped. To test SSE delivery, drive `publishToUser`/`publishToAll` directly or open a real `EventSource` against a running server.
2. **Pass the base `prisma` client at post-commit trigger sites.** `createNotifications`/`notifyFeedWatchers` should run *after* the business dual-write commits, on the singleton client, so rows are durable before the signal fires. The exception is `escalation.controller.ts`, which emits **inside** the flag transaction so the signal rides COMMIT — intentional.
3. **`pg_notify` fires on COMMIT, not on call.** Because `emitRealtimeEvent` runs on the caller's tx client, the listener never refetches before the new rows are visible. This is the whole reason signals are race-free — do not "optimize" by emitting on a separate connection.
4. **Signals must stay tiny.** Never embed payloads. `emitRealtimeEvent` guards >7900-byte payloads (logs + skips). New event kinds carry identifiers only.
5. **The two bells are independent.** Inbox bell (blue, `NotificationBell`) ≠ escalation bell (red, `Header`). The `notification`/`escalation` signals also dispatch `escalations:changed` so the red bell refreshes instantly. Do not merge them.
6. **Content is never yanked mid-read.** `useRealtimeRefresh` only raises the pill on a signal; it refetches solely on pill-click or tab refocus.
7. **First deploy:** apply `migrations/20260613000000_add_notification` (or `npx prisma db push`) to **both** `sqd_qa_db` and `sqd_qa_test_db`, then `npx prisma generate`.

---

## 8. How to add a new notification trigger

1. **Pick / add an event.** If it's a per-user inbox entry, reuse `kind: 'notification'`. If it's a new live-refresh class, add a variant to `RealtimeEvent` **and** a `case` in `dispatch` (the exhaustive `default` will otherwise log it as dropped).
2. **Add a `NotificationType`** in `notificationService.ts` if it's a new inbox category, and map its `linkScope` → route in `NotificationBell.linkHref`.
3. **At the business dual-write site,** *after* the write commits, call `createNotifications(prisma, [{ userId, type, title, body, linkScope, linkId, metadata }], [actorId])`. It is best-effort and per-recipient isolated — never wrap it in a way that lets it throw into the business path.
4. **Resolving recipients:** reuse `resolveTaskWatchers` / `resolveWpWatchers` / `resolvePrivilegedUserIds(client, privilegeKey, divisionId)`. Do not hand-roll role-string gates — `resolvePrivilegedUserIds` honours `hasPrivilege` + the Director/Admin global-reach rule.
5. **Frontend:** if the new event needs a live view refresh, subscribe a view with `useRealtimeRefresh(feedKey(scope, id), refetch)` and render `<NewUpdatesPill show={hasNew} onClick={refresh} />`.
6. **Test** in `notification.test.ts` following the existing pattern (assert the actor is excluded, the right recipients are notified, and cross-division holders are not).

---

## 9. How to test

- **Unit/integration:** `cd backend && npm run test -- notification.test.ts` (15 tests). Full suite: `npm run test` (396 passing).
- **SSE smoke:** `curl -N --cookie "token=<jwt>" http://localhost:5000/api/events/stream` → expect a `ready` event, periodic `: keepalive`, and events on activity.
- **End-to-end (two users):** A assigns a task to B → B's inbox badge increments live. B viewing the task feed sees the pill when A comments; click loads them. Escalate a comment → reviewer's red bell updates instantly. Switch tab away and back → the view refetches on refocus.
- **Scaling (manual):** run two backend instances against the same DB → a `NOTIFY` from instance 1 reaches a client connected to instance 2.
