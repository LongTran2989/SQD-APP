# Changelog

Dated, rev-by-rev history of SQD-APP. **This is the append-only log** — add a new
`## rev NN` block at the top for each shipped workstream so `CLAUDE_HANDOVER.md`
stays a lean, stable reference instead of growing an ever-longer preamble.

- For the **feature narrative / architecture / object reference**, see `CLAUDE_HANDOVER.md` §2.
- For the **per-finding review record**, see `CODE_REVIEW_AUDIT_LOG.md`.
- Earlier history (pre-rev-18) lives in git history and the `CLAUDE_HANDOVER.md` §2 "Completed" narrative.

---

## rev 21 — 2026-06-28 — Doc/Code consistency audit + single-source-of-truth restructure

Branch `claude/codebase-docs-architecture-jev3tw`. Audited the four reference docs against
the code and corrected the drifts (full table in `CODE_REVIEW_AUDIT_LOG.md`, 2026-06-28
"Doc/Code Consistency Audit" session):

- **MIG-1 (High, deploy-blocker — documented, fix sign-off-gated):** the Feed Phases A–H
  schema (`FeedPostAcknowledgement` table + `FeedPost` hide/pin columns) was applied via
  `db push` and never captured in a migration. Schema has 46 models; migrations create 45
  tables. A fresh `migrate deploy` builds an incomplete DB. See `CLAUDE_HANDOVER.md` §12.8
  item 0 and `backend/prisma/migrations/README.md`.
- **Doc fixes:** Finding `Dismissed` status added to `CLAUDE.md` + `BUSINESS_WORKFLOW.md`;
  `ENFORCE_SINGLE_SESSION` corrected (it's a DB `SystemSetting`, not an env var); stale
  "Phase 7" status line and "≈499" test baseline de-hardcoded; "45 models" → 46.
- **Restructure:** code is now the authority for enumerable facts (statuses/roles/env vars)
  and docs link to the constant instead of restating it; this changelog split out of the
  handover; added `docs/README.md` index, `backend/.env.example`, and a drift-guard test
  (`backend/src/__tests__/docs-consistency.test.ts`) that fails if schema model count ≠
  migration table count (would have caught MIG-1). **No app/runtime code changed.**

## rev 20 — 2026-06-28 — Work Assignment Workflow security/hardening pass

Branch `claude/review-work-assignment-workflow-jrw9md` — a manual review of the Task +
Work Package assignment workflow (`task.controller.ts`, `wp.controller.ts`, `autoGenService.ts`,
task/WP routes, privilege model) and remediation of the accepted findings. Closes two
**segregation-of-duties** holes (a task performer could review — WAW-1 — or rate — WAW-5 —
their own work; an extension requester could decide their own request — WAW-8) and three
**division-scope escalations** (Manager could create a WP — WAW-2 — or a task — WAW-3 — or
link a task to a WP — WAW-7 — across divisions; the WP-assign div check was role-string-gated
— WAW-4). Plus past-deadline validation (WAW-10), per-user rate limits on all mutating
task/WP routes (WAW-11), `createTask` now honours `title` (WAW-12), and
`updateWorkPackageStatus` div scope (WAW-6). **No schema migration, no new privilege keys**
(division checks stay hardcoded per Phase 7 design). Skill-gating (WAW-9) deferred as
**DEF-7** (needs a `User` competency field). Transparency reads (WAW-13) accepted-as-is. A
follow-up `/code-review` of the diff fixed 4 more items (WAW-R1..R4): a shared rate-limit
bucket split (autosave gets its own), a null-`targetDivisionId` link regression, a
timezone-safe deadline check (UTC epoch-days), and extraction of a shared
`hasCrossDivisionReach` helper used by all 5 division-scope sites. **Backend 635/635** (was
621; +14). See `CODE_REVIEW_AUDIT_LOG.md` 2026-06-28 (Work Assignment Workflow Review +
follow-up) and `CLAUDE_HANDOVER.md` §8 gotcha #59.

## rev 19 — 2026-06-28 — Feed Features workstream (Phases A–H)

Branch `claude/feed-features-audit-iac2uw` — a hardening + capability expansion of the
unified `FeedPost` feed, built from `FEED_FEATURES_AUDIT.md` against `FEED_IMPROVEMENT_PLAN.md`.
Shipped: comment length cap + per-user write rate-limit + disseminate validation (A);
**keyset pagination + type filters** with the cursor on an `X-Next-Cursor` header (B);
**scoped SSE feed signals** to watchers instead of broadcast (C); **soft-hide + pinning** (D);
**@mentions** with notifications (E); inline **`#CODE` entity hyperlinks** (E.2);
**attachments in comments** via a new `FEED_POST` attachment entity type (F);
**acknowledgement / read-receipts** (G); **feed search + opt-in daily digest** (H). Then an
accepted high-effort `/code-review` (8 fixes, 1 accepted-as-is, 1 deferred — see
`CODE_REVIEW_AUDIT_LOG.md` 2026-06-28). **Backend 621/621**, frontend `tsc --noEmit` + lint
clean — verified end-to-end against a live Postgres + backend + Next.js stack. Schema:
`FeedPost` gains moderation columns + a new `FeedPostAcknowledgement` model (additive — but
see rev 21 / MIG-1: this was not captured in a migration). See `CLAUDE_HANDOVER.md` OBJECT H,
§6, and `FEED_IMPROVEMENT_PLAN.md` for per-phase detail.

## rev 18 — 2026-06-24 — Task-list pagination + DB hardening + migration squash

Task-list server-side pagination + new `/tasks/stats|assignees|options` endpoints;
`Finding.findingId` business code (`FND-000001`); DB integrity hardening (CHECK constraints,
Finding indexes); post-review picker/UX fixes; **migration history squashed to a clean
replayable baseline** (was unshippable). Backend **595/595**, frontend build clean — verified
locally on a real DB (incl. the DB-level CHECK constraint rejection). **⚠️ Read
`CLAUDE_HANDOVER.md` §12.8 "Pre-deploy items to MONITOR & RECTIFY" before going to prod** —
most importantly the test-DB/prod schema-application parity gap. Also folds in the Quick-View
Enrichment + Back-to-Finding feature (582/582) and its clean `/security-review` from
`claude/nice-darwin-nwyj81`.

---

*Revisions before rev 18 are summarized in `CLAUDE_HANDOVER.md` §2 ("Completed") and the
git history.*
