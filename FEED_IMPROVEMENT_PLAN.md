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

## Phase B — Pagination (H2) + Feed filters  ✅ IMPLEMENTED
Backend read path + three feed components.

**H2 — keyset pagination (as built)**
- **Cursor by primary key, returned via header** (not a `{posts,nextCursor}` body) to stay backward-compatible with the many existing array-consuming callers (quickview previews, the task detail page's 6 call sites) and existing tests. Response **body stays an array**; the cursor rides `X-Next-Cursor` (exposed in CORS, `index.ts`).
- `feedService.ts`: shared `parseFeedLimit` (default 30, max 100), `parseFeedBefore`, `parseFeedTypes`, `FEED_POST_TYPES`.
- `feed.controller.getFeed` + `task.controller.getTaskActivity`: `WHERE scope/scopeId [+ type in] [+ id < before] ORDER BY id DESC LIMIT n`, then reverse to ascending; `nextCursor` = oldest id when the page is full, else null → `X-Next-Cursor`.
- `frontend/src/api/feedApi.ts`: `getFeed` (array, unchanged) + new `getFeedPage` (reads header). `taskApi.ts`: `getTaskActivity` (array) + `getTaskActivityPage`.
- `FeedPanel.tsx` + `FindingActivityFeed.tsx`: paginate via `getFeedPage`, **"Load earlier"** button that prepends older posts with scroll-position preservation; auto-scroll-to-bottom fires only when the bottom entry changes. `TaskActivityFeed.tsx`: keeps parent-owned `activities` (newest page) and manages an internal `earlier` list + cursor (optimistic), so the big task page is untouched.

**Feed filters (as built)**
- Backend supports `?types=` (validated subset) for server-side use.
- UI uses a shared **client-side** `FeedFilterBar` (hidden-set semantics) in all three feeds — Comments / Events / (Escalations / Info on FeedPanel) — no refetch, no cursor interaction.
- Tests added (feed.test.ts): page-size cap + `X-Next-Cursor`, backward paging via `before` to exhaustion, `types` filter.
- Verified: frontend `tsc --noEmit` + `npm run lint` clean on changed files. Backend jest not run in-container (Prisma engine egress-blocked + no PG) — run locally.

---

## Phase C — SSE signal scoping (M1)  ✅ IMPLEMENTED
- **Resolved at emit time** in `feedService.createFeedPost` (the single feed-write chokepoint): for TASK/WP/FINDING it resolves the watcher userIds (`resolveTaskWatchers`/`resolveWpWatchers`/new `resolveFindingWatchers` in notificationService) and passes them on the realtime event; DIVISION/ORG omit userIds. Resolution is best-effort (wrapped, never breaks the write) and skipped under test.
- `pgEvents.ts`: `RealtimeEvent` feed variant gains optional `userIds`; `dispatch` fans out to those users via `publishToUser`, else `publishToAll`. Payload-overflow on a huge watcher set falls back to a broadcast (omit userIds) instead of dropping the signal. `dispatch` is now exported for unit testing.
- `resolveFindingWatchers` = reporter + closer + source-task watchers.
- Tests: `realtime.test.ts` (DB-free) asserts scoped TASK signal reaches only listed watchers, ORG broadcasts to all, empty userIds falls back to broadcast.
- Tests: signal fan-out unit test (watchers only for TASK/WP/FINDING; broadcast for DIVISION/ORG).

---

## Phase D — FeedPost flags: soft-hide (M4) + pinning  ✅ IMPLEMENTED  *(one migration)*

**As built.** Schema: `FeedPost` gains `hiddenAt`/`hiddenByUserId`/`hiddenReason` +
`pinnedAt`/`pinnedByUserId` and index `[scope, scopeId, pinnedAt]` (additive,
reversible). **Run `npm run migrate:dev` + `npx prisma generate` for dev; tests pick
it up via `test:setup` (db push regenerates the client).**
- Endpoints (`feed.controller` + `feed.routes`): `POST /feeds/posts/:id/hide|unhide`
  (Director/Admin), `…/pin|unpin` (scope-gated via `canPostToFeed`, WP/DIV/ORG only),
  `GET /feeds/pinned/:scope/:scopeId?`. All COMMENT-only, rate-limited, dual-write
  AuditLog + a SYSTEM_EVENT.
- **Hidden filter applied to EVERY feed read** (the Rule-2-style obligation): `getFeed`,
  `getTaskActivity`, dashboard `getFeed` + `getOngoingWorks`, and the task-list
  `getLastActivityMap` + `getRecentActivitiesMap`. Default excludes hidden; Director/
  Admin may pass `?includeHidden=true` (getFeed/getTaskActivity) to review them.
- Frontend: shared `CommentModerationMenu` (pin/hide icons), pinned strip + "Show
  hidden" toggle in `FeedPanel`; `FindingActivityFeed` gets hide/unhide + show-hidden
  (self-contained); `TaskActivityFeed` gets hide/unhide + a self-fetched "Show hidden"
  moderation view (parent page untouched). `getFeed`/`getTaskActivity` return
  `hidden`/`pinned` flags. Verified: frontend `tsc` + lint clean.
- Tests (feed.test.ts): hide excludes from reads / includeHidden reveals for Director /
  non-privileged ignored / unhide restores; pin→pinned-feed→unpin; cross-division pin
  403; TASK pin 400.
- Known limitation: pinning is COMMENT-only and WP/DIV/ORG-only (TASK/FINDING not
  pinnable, by design).

### Original plan notes
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

## Phase E — @mentions  ✅  ·  E.2 entity (#) hyperlinks  ✅ IMPLEMENTED
No new feed model; mentions reuse the notification system.

**E.2 as built (entity # hyperlinks).** No composer picker and no stored markup —
users type a business code with a leading `#` (e.g. `#FED-000001`); the text stays
plain. Reads resolve any code that maps to a real, non-deleted Task.taskId /
WorkPackage.wpId / Finding.findingId into `{ type, id }` and the client linkifies it
to the numeric detail route; unknown codes render as plain text.
- Backend (`feedService`): `extractEntityRefs` + `resolveEntityLinks` +
  `resolveEntityLinksForPosts`; `getFeed` / `getTaskActivity` / `getPinnedFeed`
  attach a per-post `entityLinks` map.
- Frontend: `CommentContent` tokenizes `#CODE` and renders `<Link>`s (React
  elements only — XSS-safe per DEF-1); wired into all three comment renderers;
  composer placeholders hint at `#CODE`.
- Tests: feed.test.ts resolves #task/#wp codes, drops unknown. Verified live
  (`#SMOKE-WP-2` → WP link; `#NOPE-9` unlinked) and via full suite 612/612.
- Routes: TASK→/dashboard/tasks/:id, WP→/dashboard/work-packages/:id,
  FINDING→/dashboard/findings/:id.

**As built (@mentions).** Chosen a **chip-based** mention field over inline `@`
autocomplete: mentions are picked from a dropdown and kept as removable chips
separate from the comment text, so the textarea stays clean (no markup) and there's
no fragile caret/markup parsing. Selected ids are sent alongside the comment.
- Backend: `GET /users/mention-search?q=` (auth-only, returns up to 8 {id,name,
  employeeId}); `feedService.resolveMentions`/`mentionIdsFromMetadata`;
  `postFeedComment`/`postTaskComment` validate ids → real users, store
  `metadata.mentions` (int[]), and call `notificationService.notifyMentions` (new
  `FEED_MENTION` type + config key; deep-links on TASK/WP/FINDING). Reads
  (`getFeed`/`getTaskActivity`) resolve mention names into `post.mentions`.
- Frontend: shared `MentionField` (picker + chips) in all three composers; shared
  `MentionsLine` renders "@Name, …" under each comment; `userApi.mentionSearch`.
- Tests (feed.test.ts): mentions stored + returned + resolved on read; mentioned
  user notified; author (self-mention) never notified; non-existent ids dropped.
- Verified: frontend `tsc` + lint clean.
- **Manual-QA note:** the mention picker dropdown/debounce is UI not exercised by
  type-checks — smoke-test the picker, chip add/remove, and that a mentioned user
  sees the inbox notification.

**Deferred to E.2 — entity (#) hyperlinks.** Reliable inline linking of TASK/WP/
FINDING references needs code→numeric-id resolution (business codes differ from the
route ids), so it's a focused follow-up: a `#`-sigil picker (or a read-time
resolution map) that emits links to `/dashboard/...`. Not blocking @mentions.

### Original plan notes

**Auto-linking (render-time, safe)**
- `frontend/src/utils/feedHelpers.ts`: a tokenizer that splits comment text into plain spans + recognised tokens — `#TASK-<code>`, `WP-<code>`, `Finding F-<code>`, and `@<name/employeeId>` — and a renderer that maps tokens to `<Link>`s. Plain text otherwise. No HTML injection.
- Resolve display + href: a lightweight `GET /api/feeds/resolve-links?refs=...` (or reuse existing entity lookups) to turn codes into titles/links; unresolved tokens render as plain text.

**@mentions → notifications**
- `backend/src/services/notificationService.ts`: new `MENTION` notification type + `notifyMentionedUsers(client, post, mentionIds, authorId)`; resolve `@` tokens server-side at comment-create time (parse in `createFeedPost` callers or a shared parser in `feedService`).
- New `NotificationType 'FEED_MENTION'` + `NotificationEventConfig` key so admins can toggle it.
- RBAC/transparency: mentioning anyone is allowed (everyone can already read), mention just notifies.
- Tests: mention parse, notification fan-out, self-mention excluded, unknown handle ignored.

---

## Phase F — Attachments in comments  ✅ IMPLEMENTED
Reuse the existing local-disk `StorageAdapter` + soft-deleted `Attachment` model (FILE_UPLOAD_DEV_GUIDE.md).

**As built.** Added a `FEED_POST` attachment entity type (bucket `sqd-feed`) so files
attach to a specific COMMENT — no schema migration (the polymorphic `Attachment`
model already supports it). All existing policy/quota/soft-delete/streamed-download
rules apply unchanged (Rule 10).
- Backend: `ATTACHMENT_ENTITY_TYPES` + `ENTITY_BUCKET` gain `FEED_POST`;
  `attachmentService.assertEntityExists` resolves a FEED_POST to its COMMENT (rejects
  non-comment posts → 404); `feedScopeFor` returns null for FEED_POST (no per-file
  SYSTEM_EVENT — files render inline on the comment). Reads (`getFeed`/
  `getTaskActivity`/`getPinnedFeed`) batch-resolve `resolveAttachmentsForPosts` and
  attach `attachments[]` per comment.
- Frontend: shared `AttachmentPicker` (stages File[] in the composer) + post-then-
  upload flow (the comment is created first, then files upload to FEED_POST/its id,
  then the feed reloads); shared `CommentAttachments` renders download chips
  (streamed via `/api/attachments/:id/download`, never a public URL);
  `attachmentApi.uploadCommentAttachments` helper. Wired into all three composers +
  renderers.
- Tests: attachment.test.ts A23 (attach to comment → surfaces on activity read) +
  A24 (non-COMMENT post → 404). Full suite 614/614; frontend tsc + lint clean.
- Verified live: comment → upload note.pdf → feed shows attachment metadata →
  download streams the bytes (HTTP 200, 31 bytes).

### Original plan notes

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
