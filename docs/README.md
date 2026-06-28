# SQD-APP Documentation Index

Single entry point to every doc in the repo. The four **core docs** live at the repo
root (read in order); **feature guides** are listed by workstream below.

> **Single source of truth principle.** Code is authoritative for enumerable facts —
> statuses, roles, privileges, soft-delete models, env vars. Docs *link* to the code
> constant; they must never re-list it (that's how drift happens). See the pointer table
> at the bottom.

## Start here (core docs, in order)

1. **[`CLAUDE.md`](../CLAUDE.md)** — NON-NEGOTIABLE RULES, quick start, tech stack, the
   single-source-of-truth pointers. Read first, every session.
2. **[`CLAUDE_HANDOVER.md`](../CLAUDE_HANDOVER.md)** — Stable reference: architecture,
   schema, object reference, RBAC, gotchas (§8), pre-deploy items (§12.8). Read §10 before
   starting any feature.
3. **[`BUSINESS_WORKFLOW.md`](../BUSINESS_WORKFLOW.md)** — Human-readable domain workflows.
4. **[`CHANGELOG.md`](../CHANGELOG.md)** — Dated rev-by-rev history (append-only).
5. **[`CODE_REVIEW_AUDIT_LOG.md`](../CODE_REVIEW_AUDIT_LOG.md)** — Every review finding +
   status. Read before any `/code-review` or `/security-review`.

## Feature guides (by workstream)

| Workstream | Dev guide | User guide | Plan / audit |
|---|---|---|---|
| File Upload | [`FILE_UPLOAD_DEV_GUIDE.md`](../FILE_UPLOAD_DEV_GUIDE.md) | — | — |
| Realtime (SSE/WebSocket) | [`REALTIME_DEV_GUIDE.md`](../REALTIME_DEV_GUIDE.md) | — | — |
| Time Booking | [`TIME_BOOKING_DEV_GUIDE.md`](../TIME_BOOKING_DEV_GUIDE.md) | [`TIME_BOOKING_USER_GUIDE.md`](../TIME_BOOKING_USER_GUIDE.md) | — |
| Findings (expansion / RCA / CAPA) | [`FINDING_EXPANSION_DEV_GUIDE.md`](../FINDING_EXPANSION_DEV_GUIDE.md), [`FINDING_WORKFLOW.md`](../FINDING_WORKFLOW.md) | [`FINDING_EXPANSION_USER_GUIDE.md`](../FINDING_EXPANSION_USER_GUIDE.md) | [`PHASE6_MANUAL_TESTING.md`](../PHASE6_MANUAL_TESTING.md) |
| Feed & Escalation | [`FEED_ESCALATION_DEV_GUIDE.md`](../FEED_ESCALATION_DEV_GUIDE.md) | [`FEED_ESCALATION_USER_GUIDE.md`](../FEED_ESCALATION_USER_GUIDE.md) | [`FEED_ESCALATION_PLAN.md`](../FEED_ESCALATION_PLAN.md), [`FEED_IMPROVEMENT_PLAN.md`](../FEED_IMPROVEMENT_PLAN.md), [`FEED_FEATURES_AUDIT.md`](../FEED_FEATURES_AUDIT.md), [`FEED_ESCALATION_TEST_CHECKLIST.md`](../FEED_ESCALATION_TEST_CHECKLIST.md) |

## Reference / cross-cutting

- **[`ARCHITECTURE_AUDIT.md`](../ARCHITECTURE_AUDIT.md)** — structural health scorecard.
- **[`DESIGN.md`](../DESIGN.md)** / **[`PRODUCT.md`](../PRODUCT.md)** — brand, palette, UX principles.
- **[`backend/prisma/migrations/README.md`](../backend/prisma/migrations/README.md)** — migration workflow + known drift (MIG-1).
- `archive/` — superseded plans (`implementation_plan_v1.md`, etc.). Historical only.

## Authority pointers — where each enumerable fact actually lives

| Fact | Authority (code) |
|---|---|
| Task statuses | `backend/src/constants/taskStatus.ts` (`TASK_STATUSES`) |
| Finding statuses / severity | `backend/src/constants/findingTaxonomy.ts` (`FINDING_STATUSES`) |
| CAPA statuses | `backend/src/constants/findingExpansion.ts` (`CAPA_STATUSES`) |
| WorkPackage / Template statuses | `backend/prisma/schema.prisma` (status field comments + CHECK constraints) |
| Roles + privilege defaults | `backend/src/constants/privileges.ts` (`ROLE_NAMES`, `DEFAULT_PRIVILEGES`) |
| Soft-delete models | `backend/prisma/schema.prisma` — any model with a `deletedAt` field (Rule 2) |
| Backend env vars | `backend/.env.example` |
| Test count | run `cd backend && npm test`; last recorded figure in `CHANGELOG.md` |
