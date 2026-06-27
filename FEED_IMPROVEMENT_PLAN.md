# Feed Improvement — Implementation Plan

> Companion to `FEED_FEATURES_AUDIT.md`. Turns the agreed decisions (2026-06-27)
> into a phased, file-level plan for approval **before** any code is written
> (NON-NEGOTIABLE Rule 1). Nothing here is built yet.

## Locked decisions (2026-06-27)
1. **Discussion model:** cross-entity **linking + @mentions** first; threading deferred.
2. **Pinning scope:** ORG + DIVISION + WP (not TASK).
3. **Fix batch:** H1, H2, H3, M1, M3, M4 (all).
4. **New features:** attachments in comments, acknowledgement/read-receipts, feed filters, feed search + digests.
5. **M2 transparency:** confirmed intentional — do NOT tighten read access.
6. **No in-place comment editing** (fights immutability). If ever needed → append-only history.

## Cross-cutting rules this plan must honour
- **Rule 2 (soft-delete-style read filter):** M4 introduces `hiddenAt` on `FeedPost`. Every feed **read** must then exclude hidden posts — enumerated in Phase D so none is missed (same discipline as `deletedAt`).
- **Rule 3 (dual-write):** pin/unpin, hide/unhide, and acknowledge are significant events → write **AuditLog + a `SYSTEM_EVENT` FeedPost**. Read-receipts (ack) also dual-write.
- **XSS (DEF-1 / L5):** @mention + entity auto-linking must render via React elements from a safe tokenizer — never `dangerouslySetInnerHTML`, never server-built HTML.
- **Migrations:** each is additive (new nullable columns / new tables) and therefore reversible. `npx prisma generate` after every `schema.prisma` change (Rule 9). Tests run against `sqd_qa_test_db` only (Rule 8).

---

## Phasing & dependency order

```
A  Quick hardening (H1, H3, M3)            ── no schema, low risk → do first
B  Pagination (H2) + Feed filters          ── shared read path; B blocks H (search)
C  SSE signal scoping (M1)                  ── independent
D  FeedPost flags: soft-hide (M4) + pinning ── ONE shared migration
E  Cross-entity linking + @mentions
F  Attachments in comments
G  Acknowledgement / read-receipts
H  Feed search + digests                    ── depends on B
```

---

## Phase A — Quick hardening (H1, H3, M3)
No schema changes.

**H1 — shared comment length cap**
- `backend/src/services/feedService.ts`: add `MAX_COMMENT_LEN = 5000` + `assertCommentLength(content): string | null` (mirror task.controller's `lengthError`).
- Call it in `feed.controller.postFeedComment`, `task.controller.postTaskComment` (replace local check), and finding comment creation in `finding.controller.ts`.
- Tests: `feed`/`finding` suites — 413/400 over-length case per path.

**H3 — per-user write rate limit**
- `backend/src/middleware/rateLimit.middleware.ts`: add `createFeedWriteRateLimiter()` keyed on `req.user.userId` (not IP), generous (e.g. 30/min). Reuse existing base options.
- Apply in `feed.routes.ts` (comment + flag POSTs) and `task.routes.ts` (activity POST). Place **after** `authenticateJWT` so the key exists.
- Tests: extend `rateLimit.test.ts` for the user-keyed limiter.

**M3 — validate `taggedDivisionIds`**
- `backend/src/controllers/escalation.controller.ts` (`DISSEMINATE` branch): validate IDs exist in `Division`, dedupe, drop unknowns before storing. Reject if a non-numeric sneaks through.
- Document in `BUSINESS_WORKFLOW.md`: tags are **informational only**, not access control (consistent with M2 transparency).
- Tests: `escalation.test.ts` — bad/duplicate IDs sanitised.

---

## Phase B — Pagination (H2) + Feed filters
Backend read path + two feed components.

**H2 — keyset pagination**
- `backend/src/controllers/feed.controller.getFeed`: accept `?limit` (default 30, max 100) + `?before` cursor (`createdAt`+`id`). Fetch newest-first on the `[scope, scopeId, createdAt]` index, return `{ posts, nextCursor }`. Keep response enrichment (author/flag/canAction) unchanged.
- `backend/src/controllers/task.controller.getTaskActivity`: same cursor treatment.
- `frontend/src/api/feedApi.ts` + `taskApi.ts`: thread `limit`/`before`, return cursor.
- `frontend/src/components/feed/FeedPanel.tsx` + `components/tasks/TaskActivityFeed.tsx`: "load earlier" on scroll-to-top; keep newest-at-bottom chat layout; preserve scroll position when prepending.
- Tests: cursor correctness, page boundaries, empty/last page.

**Feed filters**
- Backend: optional `?types=COMMENT,SYSTEM_EVENT,ESCALATION_CARD,INFO_CARD` filter in `getFeed`/`getTaskActivity` (validated against allowed set).
- Frontend: a small filter control in `FeedPanel`/`TaskActivityFeed` header (Comments / Events / Escalations). Client passes `types`; default = all.
- Tests: filtered reads return only requested types.

---

## Phase C — SSE signal scoping (M1)
- `backend/src/realtime/pgEvents.ts` `dispatch`: keep `publishToAll` for **DIVISION/ORG** (genuinely shared), but route **TASK/WP/FINDING** feed signals to their watcher set via `publishToUser` (reuse `resolveTaskWatchers`/`resolveWpWatchers`; add a finding watcher resolver).
- **DECIDED: resolve watchers at emit time.** `emitRealtimeEvent` resolves the watcher userIds (one producer-side DB hit) and includes them in the NOTIFY payload (still << limit); `dispatch` fans out to those users for TASK/WP/FINDING and broadcasts for DIVISION/ORG.
- Tests: signal fan-out unit test (watchers only for TASK/WP/FINDING; broadcast for DIVISION/ORG).

---

## Phase D — FeedPost flags: soft-hide (M4) + pinning  *(one migration)*
**Migration (additive, reversible):** on `model FeedPost` add
`hiddenAt DateTime?`, `hiddenByUserId Int?`, `hiddenReason String?`,
`pinnedAt DateTime?`, `pinnedByUserId Int?`. Add index `@@index([scope, scopeId, pinnedAt])`.

**M4 — Director-only soft-hide**
- New endpoint `POST /api/feeds/posts/:id/hide` + `/unhide` (Director/Admin only) in `feed.controller.ts` / `feed.routes.ts`.
- **Rule 2 obligation — update EVERY feed read to exclude `hiddenAt != null`:**
  `feed.controller.getFeed`, `task.controller.getTaskActivity`, `dashboard.controller.getFeed`, `dashboard.controller.getOngoingWorks` (recent events), and the escalation card lookups in `escalation.controller`/`dashboard.controller` summary. (Hidden COMMENTs still keep their `EscalationFlag` row; the card is unaffected — only rendering of the hidden comment stops.)
- Dual-write on hide/unhide (AuditLog + SYSTEM_EVENT noting "comment hidden by X").
- Frontend: `FeedPostItem` shows a Director-only hide affordance; hidden posts simply don't render for everyone else.

**Pinning (ORG + DIVISION + WP)**
- `POST /api/feeds/posts/:id/pin` + `/unpin`, gated by `canPostToFeed` for that scope (Director/Admin always; Manager per scope rules); reject pin on TASK/FINDING scopes.
- `getFeed`: return pinned posts separately (or sorted pinned-first) so the client renders a "Pinned" strip above the chronological feed.
- Dual-write on pin/unpin.
- Frontend: `FeedPanel` renders a pinned section; pin/unpin action on `FeedPostItem`.
- Tests: pin RBAC per scope, TASK/FINDING rejected, pinned ordering, hide hides everywhere (one assertion per read path).

---

## Phase E — Cross-entity linking + @mentions
No new feed model; mentions reuse the notification system.

**Auto-linking (render-time, safe)**
- `frontend/src/utils/feedHelpers.ts`: a tokenizer that splits comment text into plain spans + recognised tokens — `#TASK-<code>`, `WP-<code>`, `Finding F-<code>`, and `@<name/employeeId>` — and a renderer that maps tokens to `<Link>`s. Plain text otherwise. No HTML injection.
- Resolve display + href: a lightweight `GET /api/feeds/resolve-links?refs=...` (or reuse existing entity lookups) to turn codes into titles/links; unresolved tokens render as plain text.

**@mentions → notifications**
- `backend/src/services/notificationService.ts`: new `MENTION` notification type + `notifyMentionedUsers(client, post, mentionIds, authorId)`; resolve `@` tokens server-side at comment-create time (parse in `createFeedPost` callers or a shared parser in `feedService`).
- New `NotificationType 'FEED_MENTION'` + `NotificationEventConfig` key so admins can toggle it.
- RBAC/transparency: mentioning anyone is allowed (everyone can already read), mention just notifies.
- Tests: mention parse, notification fan-out, self-mention excluded, unknown handle ignored.

---

## Phase F — Attachments in comments
Reuse the existing local-disk `StorageAdapter` + soft-deleted `Attachment` model (FILE_UPLOAD_DEV_GUIDE.md).

- Confirm `Attachment` polymorphic linkage supports `entityType='FeedPost'` (or add it). Migration only if a new entity type/column is needed.
- `feed.controller.postFeedComment` / `postTaskComment`: accept attachment IDs (uploaded via existing attachment upload endpoint), associate to the created `FeedPost`. Enforce `FILE_UPLOAD_CONFIG` limits (never hardcode — Rule 10). Soft-delete only.
- `getFeed`/`getTaskActivity`: include attachment metadata; downloads keep streaming through the backend (never public).
- **Rule 2:** attachment reads filter `deletedAt: null`.
- Frontend: attach control in both composers; render attachment chips/thumbnails in `FeedPostItem`/`TaskActivityFeed`; download via existing streamed endpoint.
- Tests: attach on comment, limit enforcement, soft-deleted attachment hidden, download authz.

---

## Phase G — Acknowledgement / read-receipts
For ORG/DIVISION (and optionally WP) directives — compliance "I have read this."

**Migration (new table):** `model FeedPostAcknowledgement { id, feedPostId, userId, acknowledgedAt, @@unique([feedPostId, userId]) }`. Immutable (no `deletedAt`).
- `POST /api/feeds/posts/:id/ack` (idempotent via the unique constraint). **DECIDED: dual-write both** AuditLog + a feed `SYSTEM_EVENT` (Rule 3 consistency over spam-avoidance; mitigate noise by only emitting the SYSTEM_EVENT on the *first* ack per user, which the unique constraint already gives us).
- `getFeed`: include `ackCount` + `viewerHasAcked` per eligible post.
- Frontend: "Acknowledge" button + "Acknowledged by N" on pinned/announcement posts.
- Tests: idempotent ack, count accuracy, RBAC (any authenticated user may ack).

---

## Phase H — Feed search + digests  *(needs Phase B)*
**Search**
- `GET /api/feeds/search?q=...&scope=...` over `FeedPost.content` (Postgres `ILIKE`/trigram or `to_tsvector` — decide during build; trigram index on `content` for scale). Excludes hidden posts (Phase D). Respects transparency (all readable).
- Frontend: a feed search surface (global + per-feed).
- Tests: match/no-match, hidden excluded, pagination.

**Digests**
- `notificationConfigService` / `notificationService`: opt-in DIVISION/ORG digest (instant-batch or daily) summarising new posts since last seen — closes L3 for offline users. Likely a scheduled job (mirror `purgeOldNotifications` 24h interval in `index.ts`).
- Tests: digest assembly, opt-in respected, no double-send.

---

## Test & doc obligations (every phase)
- Full backend suite must pass before and after (`cd backend && npm run test`, target `sqd_qa_test_db`). Baseline ≈499 — verify actual count first.
- After each accepted phase: update `CLAUDE_HANDOVER.md` (Rule 12) and, for any review, `CODE_REVIEW_AUDIT_LOG.md` (Rule 13).
- Update `BUSINESS_WORKFLOW.md` for behaviour changes (M3 tags, pinning, ack, hide).

## Suggested delivery order for PRs
1. **PR-1:** Phase A (H1+H3+M3) — small, safe, immediate value.
2. **PR-2:** Phase B (H2 + filters).
3. **PR-3:** Phase D (hide + pinning migration).
4. **PR-4:** Phase C (SSE scoping).
5. **PR-5:** Phase E (linking + mentions).
6. **PR-6:** Phase F (attachments).
7. **PR-7:** Phase G (acknowledgement).
8. **PR-8:** Phase H (search + digests).
</content>
