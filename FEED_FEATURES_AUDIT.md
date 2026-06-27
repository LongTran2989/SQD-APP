# Feed Features Audit & Improvement Report

> **Purpose of this document.** A complete, self-contained map of every "feed"
> feature in the SQD-APP so a future session can find the relevant code, data
> models, and data-flows *without re-deriving them from scratch*, followed by a
> prioritised list of weaknesses, vulnerabilities, and improvement
> recommendations.
>
> **Audited on:** 2026-06-27 · **Branch:** `claude/feed-features-audit-iac2uw`
> **Scope of "feed":** the unified `FeedPost` model and everything built on it —
> Task Activity Feed, WP/Division/Org feeds, the Escalation system, the
> Notification Center, the realtime (SSE) "new updates" layer, and the dashboard
> feed widgets.

---

## 0. TL;DR — what "the feed" actually is

There is **one** persistence model, `FeedPost`, that backs *every* feed surface in
the app. A `FeedPost` is polymorphic over a `(scope, scopeId)` pair:

| scope      | scopeId            | Feed surface |
|------------|--------------------|--------------|
| `TASK`     | `task.id`          | Task detail → Activity Feed |
| `WP`       | `workPackage.id`   | Work Package detail → Feed |
| `DIVISION` | `division.id`      | Division Board |
| `ORG`      | `null` (singleton) | Organisation Feed |
| `FINDING`  | `finding.id`       | Finding detail → Activity Feed |

Each post has a `type`: `COMMENT` (user-written), `SYSTEM_EVENT` (dual-write
audit trail line), `ESCALATION_CARD` (an actionable escalation landed on a feed),
or `INFO_CARD` (a "for awareness" copy on intermediate feeds).

The **Escalation** feature lets any user "flag" a `COMMENT` and raise it *upward*
the scope hierarchy (`TASK → WP → DIVISION → ORG`). An `EscalationFlag` row tracks
the lifecycle; cards are placed on the relevant feeds; reviewers action the flag
(acknowledge / dismiss / raise finding / create task / reassign / disseminate).

A **realtime SSE layer** (Postgres `LISTEN/NOTIFY` → in-process SSE hub) pushes
lightweight *signals* (never payloads) so open feed views show a "new updates"
pill and the bell badges refresh live. The **Notification Center** is an additive
third write that turns selected feed events into inbox entries.

---

## 1. Backend file map

### 1.1 Core services (`backend/src/services/`)
| File | Responsibility | Key exports |
|------|----------------|-------------|
| `feedService.ts` | Single write entry point for the unified feed; scope helpers; **post RBAC**. | `createFeedPost`, `buildFeedPostScope`, `canPostToFeed`, `isFeedScope`, `FEED_SCOPES`, `FeedScope`/`FeedPostType` types |
| `escalationService.ts` | The whole escalation placement matrix + **action RBAC**. | `SCOPE_LEVEL`, `placeEscalationCards`, `resolveEscalationOrigin`, `resolveFlagDivision`, `canActionFlag`, `buildExcerpt` (`EXCERPT_MAX = 160`), `ESCALATION_TARGET_SCOPES` |
| `notificationService.ts` | Inbox writes (the additive third write), feed-watcher notifications, recipient resolution, retention purge. | `createNotifications`, `notifyFeedWatchers`, `resolveTaskWatchers`, `resolveWpWatchers`, `resolvePrivilegedUserIds`, `purgeOldNotifications` |
| `notificationConfigService.ts` | Admin-configurable per-event enable/ccManagers map (Settings → Notifications). | `getEventConfigMap`, `isNotificationEventKey` |

### 1.2 Controllers (`backend/src/controllers/`)
| File | Endpoints it serves |
|------|---------------------|
| `feed.controller.ts` | `GET /api/feeds/:scope/:scopeId?` (read any feed), `POST /api/feeds/:scope/:scopeId?/posts` (comment). Contains `resolveFeedTarget` (validates scope + entity existence, soft-delete aware). |
| `escalation.controller.ts` | `POST /api/feeds/posts/:id/flag` (raise), `GET /api/escalations` (actionable queue/bell), `POST /api/escalations/:id/action` (lifecycle actions). |
| `task.controller.ts` | `GET /api/tasks/:id/activity`, `POST /api/tasks/:id/activity` (the **Task feed** — writes `FeedPost` scope `TASK`). Also the per-task SYSTEM_EVENT dual-write helper (`logActivity`-style, ~line 104). |
| `dashboard.controller.ts` | `GET /api/dashboard/feed` (the **role-scoped aggregate feed widget**), `getOngoingWorks` (embeds last-5 feed events per WP/Task), `getSummary` (escalation counts). |
| `finding.controller.ts` | Finding feed writes (`FeedPost` scope `FINDING`) via the shared `createFeedPost`. |
| `realtime.controller.ts` | `GET /api/events/stream` — the SSE endpoint. |

### 1.3 Realtime (`backend/src/realtime/`)
| File | Responsibility |
|------|----------------|
| `sseHub.ts` | In-process registry of open SSE responses keyed by userId. `MAX_CONNECTIONS_PER_USER = 5`. `publishToUser` / `publishToAll`, dead-socket pruning. |
| `pgEvents.ts` | Cross-instance bridge over Postgres `LISTEN/NOTIFY` (channel `sqd_realtime`). `emitRealtimeEvent` (rides the caller's tx, fires on COMMIT, no-op under test), `startRealtimeListener`, `dispatch`. Event union: `notification` / `escalation` / `feed`. |

### 1.4 Routes (`backend/src/routes/`)
- `feed.routes.ts` — note the **ordering gotcha**: `/posts/:id/flag` is registered *before* the generic `/:scope` routes (Express 5 would otherwise capture `posts` as a `:scope`). Two explicit routes each for read/comment to dodge optional-param pitfalls.
- `escalation.routes.ts` — `GET /` (queue), `POST /:id/action`.
- `realtime.routes.ts` — `GET /stream` (auth via httpOnly cookie; EventSource can't set headers).
- `dashboard.routes.ts` — `GET /feed`.

### 1.5 Data model (`backend/prisma/schema.prisma`)
- `model FeedPost` (line ~887): `type, scope, scopeId, authorId, content, metadata`, escalation linkage (`sourcePostId`, `sourceExcerpt`, `sourceTaskId`, `sourceWpId`, `flagId`, `taggedDivisionIds`). Indexes: `[scope, scopeId, createdAt]`, `[flagId]`. **No `deletedAt`** — feed posts are immutable, never soft-deleted.
- `model EscalationFlag` (line ~916): `sourcePostId, flaggedByUserId, targetScope, status (PENDING|ACTIONED|DISMISSED), reviewedByUserId, action, actionedAt, linkedEntityType/Id`. Index `[targetScope, status]`. One flag per lifecycle (no chains).
- `model Notification` (line ~634): `userId, type, title, body, linkScope, linkId, metadata, readAt`. Indexes `[userId, readAt]`, `[userId, createdAt]`. Cascade-deletes with user.
- `model NotificationEventConfig` (line ~667): admin per-event `enabled` / `ccManagers`.

---

## 2. Frontend file map

### 2.1 Feed components (`frontend/src/components/feed/`)
| File | Role |
|------|------|
| `FeedPanel.tsx` | Generic self-loading feed for WP / Division / Org. Loads via `getFeed`, gates composer with `canPostToFeed` mirror, wires `useRealtimeRefresh` for the pill. |
| `FeedPostItem.tsx` | Renders one entry; dispatches to `EscalationCard` / `InfoCard` for card types, otherwise SYSTEM_EVENT / COMMENT bubbles. Renders `content` as **plain text** (React-escaped — no `dangerouslySetInnerHTML`). |
| `EscalationCard.tsx` | The actionable card (shows excerpt + deep links + `EscalationActions` when `canAction`). |
| `InfoCard.tsx` | The read-only "for awareness" card on intermediate feeds. |
| `EscalationActions.tsx` | Action button cluster (Acknowledge/Dismiss inline; the rest open the modal). |
| `EscalationActionModal.tsx` | Payload modal for Raise Finding / Create Task / Reassign / Disseminate. |
| `FlagButton.tsx` | The "escalate this comment" affordance shown next to a COMMENT. |

### 2.2 Task / Finding feeds
- `components/tasks/TaskActivityFeed.tsx` — the **dedicated** task feed (separate from the generic `FeedPanel`; it knows the task's WP for flag targets). Composer gated by `task.isReviewer || currentUser.id === assignedToUserId`.
- `components/findings/FindingActivityFeed.tsx` — finding feed.

### 2.3 Dashboard / aggregate
- `components/dashboard/ActivityFeedWidget.tsx` — consumes `GET /api/dashboard/feed`.
- `app/dashboard/page.tsx`, `app/dashboard/org-feed/page.tsx`, `app/dashboard/division-board/page.tsx` — feed surfaces.

### 2.4 Realtime + API clients
- `realtime/RealtimeProvider.tsx` — opens the single `EventSource`, fans signals into the store, resyncs unread count on (re)connect.
- `store/realtimeStore.ts` — Zustand store; `feedKey(scope, scopeId)`, `feedSignals` monotonic counters, `unreadCount`.
- `hooks/useRealtimeRefresh.ts` — "new updates" pill logic + refetch-on-tab-refocus.
- `api/feedApi.ts` (read/comment + `canPostToFeed` mirror), `api/escalationApi.ts` (`ESCALATIONS_CHANGED_EVENT`), `api/dashboardApi.ts`, `api/notificationApi.ts`.
- `utils/feedHelpers.ts` — `getInitials`, `formatTimestamp`.

---

## 3. Data-flow walkthroughs (the parts that aren't obvious)

### 3.1 Posting a comment
`POST /feeds/:scope/:scopeId/posts` → `resolveFeedTarget` (validates scope + entity
exists, soft-delete aware) → `canPostToFeed` RBAC → `createFeedPost` → `emitRealtimeEvent({kind:'feed'})`
(rides nothing here — it's the base client, so fires immediately) → `notifyFeedWatchers`
(TASK/WP only) → returns enriched post. **Task comments take a different door**:
`POST /tasks/:id/activity` (`postTaskComment`) writes the same `FeedPost` (scope
`TASK`) but is the only comment path that enforces a length cap (`MAX_COMMENT_LEN = 5000`).

### 3.2 Raising an escalation (`flagPost`)
Validates post is a `COMMENT`, origin scope can escalate, target > origin level.
Resolves origin context (`resolveEscalationOrigin`). In a **Serializable**
transaction: dedup guard (≤1 PENDING per `(sourcePostId, targetScope)`), create
`EscalationFlag`, `placeEscalationCards` (ESCALATION_CARD at target + INFO_CARD at
each skipped level), dual-write `AuditLog` + source-feed `SYSTEM_EVENT`. Post-commit:
notify reviewers (`resolvePrivilegedUserIds` honouring division scope) + nudge their
escalation bells. P2034 (serialization conflict) is mapped to a 409.

### 3.3 The placement matrix (`escalationService.placeEscalationCards`)
`SCOPE_LEVEL = {TASK:0, WP:1, DIVISION:2, ORG:3, FINDING:-1}`. For
`level = originLevel+1 .. targetLevel`: target level gets an `ESCALATION_CARD`,
intermediate levels get `INFO_CARD`. Missing feeds (e.g. a task with no WP) are
skipped. Cards carry **only** an excerpt + denormalised deep-link IDs — never a
copy of the full source text (spec non-negotiable).

### 3.4 Actioning (`actionEscalation`)
RBAC via shared `canActionFlag`. PENDING-only. In one transaction: reuse the
existing workflow services verbatim (`createFindingService` / `createTaskService` /
`reassignTaskService`) or post an ORG card (DISSEMINATE), then flip the flag out of
PENDING, dual-write AuditLog + target-feed SYSTEM_EVENT.

### 3.5 Actionability RBAC — one source of truth
`canActionFlag`: Director/Admin → any; otherwise requires `escalation:review`
privilege (DB-driven, default grants Manager); ORG flags actionable by any holder;
WP/DIVISION flags require `flag.divisionId === user.divisionId`. The same predicate
gates `GET /escalations`, `actionEscalation`, the bell count in `getSummary`, and
`canAction` returned by `getFeed`.

### 3.6 Realtime signal path
Business write calls `emitRealtimeEvent(tx, evt)` → `pg_notify('sqd_realtime', json)`
fires on tx COMMIT → every instance's `startRealtimeListener` receives it →
`dispatch` → `sseHub.publishToUser`/`publishToAll` → browser `EventSource` → store
bump → pill / badge. Signals are **always** signals; the client refetches via REST
so RBAC + dual-write are never bypassed.

### 3.7 Read RBAC asymmetry (important)
Two different read models coexist:
- **Per-feed reads** (`getFeed`, `getTaskActivity`) — *fully transparent*: any
  authenticated user may read any feed. RBAC only gates *posting* and *actioning*.
- **Aggregate dashboard feed** (`dashboard.controller.getFeed`) — *role-scoped*:
  Staff see own tasks/findings; Manager sees division + ORG; Director/Admin see all.

---

## 4. Weaknesses & vulnerabilities

> Severity is my assessment for an internal aviation-QA tool. Nothing here is a
> "drop everything" critical, but several are worth fixing before any external
> audit. None overlap the already-tracked `DEF-1..6` in `CODE_REVIEW_AUDIT_LOG.md`
> except where noted.

### HIGH

**H1 — No length cap on the generic feed comment endpoint.**
`feed.controller.postFeedComment` validates only `content.trim()` truthiness; it
does **not** apply `MAX_COMMENT_LEN`. The task path (`postTaskComment`) does. So a
user can POST a multi-megabyte comment to any WP / Division / Org / Finding feed.
Impact: DB bloat, slow `getFeed` (no pagination — see H2), oversized `pg_notify`
is fine (signal only) but the stored row is unbounded. *Fix: extract the
`lengthError`/`MAX_COMMENT_LEN` check into `feedService` and call it from both
comment paths.*

**H2 — Feeds have no pagination; every read returns the entire history.**
`getFeed` and `getTaskActivity` do `findMany(... orderBy createdAt)` with **no
`take`/cursor**. A long-lived task or the singleton ORG feed grows without bound;
the endpoint, the author/flag batch lookups, and the client render all scale
linearly with total history. The `[scope, scopeId, createdAt]` index exists but
isn't leveraged for keyset pagination. *Fix: cursor pagination (newest N, load
older on scroll); the ORG feed especially needs it.*

**H3 — No rate limiting on comment/flag creation.**
`express-rate-limit` is wired only to auth routes. `POST /feeds/.../posts`,
`POST /tasks/:id/activity`, and `POST /feeds/posts/:id/flag` are unthrottled. An
authenticated user can spam comments (each fans out an SSE broadcast — see H4 —
and watcher notifications) or rapidly flag/clear to generate escalation churn.
*Fix: a per-user mutation rate limiter on feed writes.*

### MEDIUM

**M1 — `feed` signals are broadcast to every connected client.**
`pgEvents.dispatch` calls `publishToAll` for every feed event (the comment in the
code acknowledges "no single owner"). On a busy org this is O(comments × connected
users) socket writes, and it leaks *timing/existence* of activity on feeds a user
may not be looking at (low confidentiality impact since reads are transparent, but
it's noise + scale risk). *Fix: route feed signals to the relevant watcher/room
set, or at least debounce per feedKey server-side.*

**M2 — Transparent reads expose every comment org-wide, including escalation
excerpts.** Per-feed reads are open to all authenticated users by design, but that
means any Staff user can read every Division/Org/WP/Finding comment and every
escalation excerpt across the whole company. This is an intentional "transparency
model," but it is a **business-risk decision that should be explicitly
re-confirmed**, because the escalation feature deliberately stores only excerpts to
limit propagation — yet the *origin* comment is fully readable to anyone who can
guess/iterate the feed URL. *Fix: confirm with product; if tightened, add a scope
check in `resolveFeedTarget` (mirrors the open `DEF-6` pattern for attachments).*

**M3 — `DISSEMINATE` accepts `taggedDivisionIds` without validating they exist or
are distinct, and they're never enforced on read.** The action stores arbitrary
ints in `taggedDivisionIds`; nothing validates the divisions exist, and the ORG
card is visible to everyone regardless of the tag. So "tagging divisions" is
cosmetic metadata with no access effect and no integrity check. *Fix: validate IDs
against `Division`, dedupe, and decide whether tags should scope visibility or are
purely informational (document it either way).*

**M4 — Escalation excerpt can leak text from a since-deleted/edited context.**
`sourceExcerpt` is frozen at flag time (good for immutability) but there is no
mechanism to redact a card if the source comment is later found to contain
sensitive data, and comments themselves are immutable with no edit/delete. For an
aviation-compliance tool immutability is usually correct, but there is **no
moderation path at all** (no hide/redact even by Director). *Fix: consider a
Director-only soft-hide on `FeedPost` (audit-logged) without breaking immutability
of the audit trail.*

**M5 — SSE auth relies solely on the httpOnly cookie; no CSRF/anti-abuse on the
stream and the 5-connection cap is per-instance.** `MAX_CONNECTIONS_PER_USER = 5`
is enforced in `sseHub` *per process*. With N backend instances behind a load
balancer a user can hold 5×N streams. Minor, but worth noting for the horizontal-
scaling story the code advertises. *Fix: track counts in a shared store if the cap
matters, or accept and document the per-instance semantics.*

### LOW

**L1 — `getFeed` recomputes `viewerCanAction` once per feed and applies it to all
cards.** Correct today (all cards on a feed share scope+division), but it's a
latent bug if a feed ever hosts cards of mixed division (e.g. future cross-posting).
Document the invariant or compute per-card.

**L2 — Dashboard aggregate feed (`dashboard.controller.getFeed`) for Director/Admin
does `findMany` over ALL FeedPosts** with `take: 20` but an unindexed `OR` across
scopes. Fine at current volume; revisit with H2.

**L3 — `notifyFeedWatchers` skips DIVISION/ORG by design**, so there is no inbox
trail for org-feed comments — only the ephemeral pill. If a user misses the live
signal (offline), there is no catch-up surface for Org/Division announcements other
than visiting the page. Consider an opt-in "follow" for Division/Org.

**L4 — No automated test confirms the length cap / pagination / rate limit** because
those behaviors don't exist yet (H1–H3). `escalation.test.ts` covers the matrix and
RBAC well; add regression tests alongside any fix.

**L5 — `FeedPost.content` is rendered safely as text today**, but `DEF-1` already
warns that rich text rendered outside the sanitised editor is a future XSS risk. If
feed comments ever adopt rich text / markdown rendering, this becomes HIGH. Keep
plain-text rendering or sanitise with DOMPurify.

---

## 5. Improvement recommendations (prioritised)

1. **Add a shared comment-length validator** in `feedService` and call it from
   `postFeedComment`, `postTaskComment`, and finding comments (fixes H1). ~30 min.
2. **Add keyset pagination** to `getFeed` / `getTaskActivity` + infinite-scroll in
   `FeedPanel` / `TaskActivityFeed` (fixes H2). The index already supports it.
3. **Add a per-user mutation rate limiter** to feed/flag write routes (fixes H3).
4. **Scope the `feed` SSE signal** to interested clients instead of `publishToAll`,
   or debounce per `feedKey` (fixes M1, helps H3 blast radius).
5. **Product decision on read transparency** (M2) and **disseminate tag semantics**
   (M3) — both need a yes/no from the business owner; document the outcome in
   `BUSINESS_WORKFLOW.md`.
6. **Director-only audited soft-hide** for feed posts to give a moderation path
   without breaking the immutable audit trail (M4).
7. **Catch-up surface for Division/Org** announcements (L3) — optional "follow".
8. **Tests** for each of the above; extend `feed`/`escalation` suites.

---

## 6. What is already solid (don't "fix" these)

- **Single write chokepoint** (`createFeedPost`) keeps the realtime signal + the
  dual-write contract honest everywhere.
- **One RBAC predicate** (`canActionFlag`) shared by queue, action, dashboard
  count, and `getFeed.canAction` — no drift.
- **Escalation concurrency** is handled properly: in-tx dedup guard *plus*
  Serializable isolation *plus* P2034→409 mapping.
- **Realtime is signals-only**, riding the producer's transaction so refetches
  never race ahead of COMMIT, no-op under test, horizontally scalable via
  LISTEN/NOTIFY with no Redis.
- **Excerpt-only propagation** for escalations (no full-text copies on cards).
- **Soft-delete awareness** in `resolveFeedTarget` / `resolveEscalationOrigin`
  entity lookups.
- **Notifications are a non-blocking additive third write** with fail-open config,
  burst-collapsing for FEED_ACTIVITY, and a 30-day retention purge.

---

## 7. Reference doc cross-links
- `FEED_ESCALATION_PLAN.md` — original design + RBAC matrix.
- `FEED_ESCALATION_DEV_GUIDE.md` — implementation guide.
- `FEED_ESCALATION_USER_GUIDE.md` / `FEED_ESCALATION_TEST_CHECKLIST.md`.
- `REALTIME_DEV_GUIDE.md` — SSE / LISTEN-NOTIFY internals.
- `CODE_REVIEW_AUDIT_LOG.md` — existing `DEF-1..6` deferred items (DEF-1 & DEF-6
  are adjacent to L5 and M2 above).
- `CLAUDE_HANDOVER.md` §2 — authoritative phase/status.
</content>
</invoke>
