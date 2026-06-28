# Architecture & Maintainability Audit

**Date:** 2026-06-21
**Scope:** Structural / maintainability audit (not a bug or security review — for those, use `/code-review` and `/security-review`).
**Question asked:** *"The codebase is getting bigger and will become unmanageable soon. What should I do?"*

> **Note:** This report was recreated on 2026-06-21 after the original working-tree copy was lost before being committed. Content reflects the corrected final state (see the Pressure Point 2 correction note).

**Short answer:** You are **not** in trouble yet. The bones are good — RBAC is centralized, soft-delete is applied consistently, the frontend `api/` layer is cleanly split per-domain, and tests are substantial. The pressure is concentrated in **four** spots. Fix those and the codebase scales comfortably through the remaining phases. Ignore them and every new feature gets ~10% more expensive than the last.

---

## Scorecard

| Area | State | Verdict |
|---|---|---|
| RBAC / privilege checks | `60×` `hasPrivilege`, `39×` `requirePrivilege` → all route through `utils/privilegeAccess.ts` + `middleware/rbac.middleware.ts` | ✅ Well-factored |
| Soft-delete (Rule 2) | All 25 controllers reference `deletedAt` | ✅ Consistent (one Department leak later found + fixed — see `CODE_REVIEW_AUDIT_LOG.md` 2026-06-21) |
| Frontend API layer | 19 per-domain files under `src/api/` | ✅ Clean |
| Tests | 25 files, ~540 test cases / 120 `describe` blocks | ✅ Strong coverage |
| **Service layer** | Controllers **11,563** lines vs services **2,341** lines | ⚠️ **Inverted — main risk** |
| Dual-write (Rule 3) | Feed write already unified (`createFeedPost`); audit+feed pairing lives in 4 correct per-domain wrappers | ✅ Sound — minor consistency cleanup only (see PP2) |
| **God files** | `task.controller.ts` 2,342 lines; `finding.controller.ts` 1,397; `TaskActionBar.tsx` 1,027 | ⚠️ Hard to navigate/review |
| **Doc sprawl** | 19 root `.md` files; `CLAUDE_HANDOVER.md` = 190 KB | ⚠️ Onboarding & drift cost |

---

## Pressure Point 1 — Fat controllers, thin/inconsistent service layer  ★ highest priority

**Evidence**
- Controllers: 25 files, **11,563 lines total**.
- Services: 10 files, **2,341 lines total** (a ~5:1 inversion of the healthy ratio).
- Prisma calls embedded directly in controllers:
  - `task.controller.ts` — **52** `prisma.*` calls, **2,342 lines**
  - `referenceData.controller.ts` — 51
  - `dashboard.controller.ts` — 37
  - `finding.controller.ts` — 29 (1,397 lines)
- Meanwhile services barely touch the DB (`attachmentService` 7, `findingService` 4, others 0–3). So the service layer exists but is **applied inconsistently** — some domains (attachment, finding, autoGen, notification) have services; the two biggest domains (task, finding-controller logic) keep their logic in the controller.

**Why this is the thing that makes it "unmanageable"**
Every business rule — status machine transitions, dual-write, schema-snapshot handling, reassignment guards — lives inline next to HTTP request/response plumbing. That means:
- You can't unit-test a transition without spinning up Supertest + a request.
- Re-reviewing `task.controller.ts` for one change means scrolling 2,300 lines.
- The same logic gets re-implemented (slightly differently) in the next controller.

**Recommendation**
Extract a real service per domain and make controllers thin (parse → call service → respond). **Do this opportunistically, not as a big-bang refactor** — every time you touch a controller for a feature, lift that endpoint's logic into a `*Service.ts`. Start with `task.controller.ts` since it's the worst and most active. Target: no controller over ~400 lines, no `prisma.*` call in a controller.

---

## Pressure Point 2 — Dual-write (Rule 3): sound, with a minor consistency cleanup available

> **Corrected 2026-06-21 after a deeper investigation.** An earlier draft of this section overstated the risk ("no shared helper / compliance-critical fragility"). A careful read of the feed and audit layers showed the dual-write is in good shape. The corrected finding follows.

**What's actually true**
- The **feed write is already consolidated.** `createFeedPost` (`backend/src/services/feedService.ts:32`) is the single entry point for every feed post across all 5 scopes (`TASK | WP | DIVISION | ORG | FINDING`), and it already bundles the realtime NOTIFY emit (best-effort, no-op under test). There is no separate `TaskActivity` model — the per-task feed *is* `FeedPost` with `scope: 'TASK'`.
- The **audit + feed pairing lives in four per-domain wrappers**, each internally correct:
  - `logAuditAndActivity` — `task.controller.ts:136` (entityType `Task`, feed → TASK, sequential, tx-aware)
  - `logFindingAuditAndActivity` — `findingService.ts:21` (entityType `Finding`, feed → **source Task** feed, **skipped when `sourceTaskId` is null**, tx-aware)
  - `logActivityAndAudit` — `timebooking.controller.ts:39` (entityType `TimeBooking`, feed → TASK, **parallel + best-effort**)
  - `logWpSystemEvent` + inline audit — `wp.controller.ts:13` (feed → WP)
- **~12 sites write `AuditLog` only, by design** — config models (TemplateSet, WpBlueprint, Privilege, NotificationEventConfig), `DUE_DATE_BREACHED` breach logging, `BLUEPRINT_AUTO_LAUNCH_FAILED`, and auth logout. These must **not** be forced into dual-write (no task/feed scope to post to).
- The investigation found **no feed-write-without-audit asymmetry** in the action paths.

**Net assessment**
This is **not** a compliance hole. The pairing is enforced today by per-domain wrappers *because their feed semantics genuinely differ* (Finding routes to the source-Task feed with a null-skip; timebooking is intentionally parallel/best-effort). The only available improvement is a *moderate* consistency cleanup: factor the identical `AuditLog.create` shape into a shared `recordAudit` helper that the wrappers delegate to. A naive "one `recordEvent` does audit + feed for everyone" would be **risky** — it would have to flatten the per-domain differences and would wrongly force feed posts onto the 12 audit-only sites.

**Decision (2026-06-21): deferred.** Because the feed is already centralized, this cleanup is low-value relative to Pressure Point 1. Not done now; revisit only if the consistency win is wanted.

---

## Pressure Point 3 — God files

**Backend**
| File | Lines |
|---|---|
| `controllers/task.controller.ts` | 2,342 |
| `controllers/finding.controller.ts` | 1,397 |
| `controllers/wp.controller.ts` | 758 |
| `controllers/template.controller.ts` | 677 |

**Frontend**
| File | Lines |
|---|---|
| `components/tasks/TaskActionBar.tsx` | 1,027 |
| `app/dashboard/tasks/page.tsx` | 847 |
| `types/index.ts` | **778 (single monolithic types file)** |
| `app/dashboard/analytics/PersonnelTab.tsx` | 585 |
| `components/templates/TemplateBuilder.tsx` | 536 |

**Recommendation**
- Backend god files largely dissolve once Pressure Point 1 is addressed (logic moves to services, and services split by sub-domain — e.g. `taskLifecycleService`, `taskReassignmentService`).
- `TaskActionBar.tsx` (1,027) — split per action group (review actions, reassignment, time-booking entry points) into child components.
- `types/index.ts` (778) — split into per-domain type modules (`types/task.ts`, `types/finding.ts`, …) and re-export from an index barrel. A single shared types file becomes a merge-conflict magnet with multiple contributors.

---

## Pressure Point 4 — Documentation sprawl

**Evidence**
- **19 Markdown files in the repo root**, including four `FEED_ESCALATION_*` docs, two `FINDING_EXPANSION_*`, two `TIME_BOOKING_*`, plus `implementation_plan.md`, `PHASE6_MANUAL_TESTING.md`, etc.
- `CLAUDE_HANDOVER.md` is **190 KB** — too large to hold in working memory, for you or for Claude.

**Why it matters**
Docs are a maintainability asset only while they're findable and current. 19 root files means new info lands in an arbitrary one, and the 190 KB handover guarantees stale sections nobody re-reads. This is low-stakes but cheap to fix.

**Recommendation**
- Create `docs/` (it already exists) and move all feature dev-guides/user-guides/plans into it, grouped by feature. Keep only the canonical few at root: `README.md`, `CLAUDE.md`, `CLAUDE_HANDOVER.md`, `BUSINESS_WORKFLOW.md`, `CODE_REVIEW_AUDIT_LOG.md`.
- Split `CLAUDE_HANDOVER.md`: keep it as a thin index/roadmap that links into `docs/` sections, rather than one 190 KB scroll.

---

## Quick wins (low effort, do now)

1. **Delete `temp-tests/`** — a stray root folder with its own `package.json`/`package-lock.json` and a `test_run.js`. Looks like leftover scratch; confirm and remove.
2. **Move feature docs into `docs/`** (Pressure Point 4) — pure file moves, no code risk.

---

## What NOT to do

- **Don't do a big-bang refactor.** With ~540 tests as a safety net, the right move is to refactor in the margins of feature work, one controller at a time, keeping tests green at each step.
- **Don't add new architectural layers** (e.g. repositories, CQRS, microservices). The codebase is a well-organized modular monolith — that's the correct shape for this app. The fix is *consistency within the existing layers*, not new ones.
- **Don't split the Prisma schema yet.** 46 models / ~1,035 lines in one `schema.prisma` is still navigable; revisit only past ~1,500 lines. (Note: of those 46 models, the Feed Phases A–H additions are not yet in any migration — see `CODE_REVIEW_AUDIT_LOG.md` MIG-1.)

---

## Suggested sequence

1. Quick wins (above) — an afternoon.
2. As each controller is next touched for a feature: extract its logic to a service, split it if it's a god file. Start with `task.controller.ts` (Pressure Point 1 — the real lever).
3. Split `types/index.ts` and `TaskActionBar.tsx` when next editing those areas.

(Dual-write consolidation, Pressure Point 2, is deliberately **not** in this sequence — investigated and deferred 2026-06-21; the feed is already centralized so the cleanup is low-value.)

**Bottom line:** the codebase isn't becoming unmanageable. The one structural debt worth paying down is logic-in-controllers (Pressure Point 1) — cheap to address incrementally in the flow of normal feature work, expensive to ignore. The dual-write was investigated and found sound. Address PP1 as you go and you won't hit a wall.
