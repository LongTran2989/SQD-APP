# Finding Functionality — Detailed Workflow

> Derived from the implemented code on branch `claude/vigilant-turing-aG21L`
> (backend controllers, services, routes, and `schema.prisma`). This is a
> reference document — it describes what the code does today, not a proposal.

Key source files:
- `backend/src/controllers/finding.controller.ts` — core lifecycle (raise, review, follow-up tasks, Stage 2, close)
- `backend/src/controllers/rca.controller.ts` — Root Cause Analysis
- `backend/src/controllers/capa.controller.ts` — Corrective / Preventive Actions
- `backend/src/controllers/findingLink.controller.ts` — cross-finding traceability
- `backend/src/controllers/taxonomy.controller.ts` — ATA chapters / cause codes / hazard tags
- `backend/src/services/findingService.ts` — dual-write helper, close-gate, Pending-Verification hook
- `backend/src/services/trendService.ts` — compute-on-read recurrence detection
- `backend/src/utils/findingAccess.ts` — centralized RBAC
- `backend/src/constants/findingExpansion.ts` — controlled vocabularies + config
- `backend/src/routes/finding.routes.ts`, `backend/src/routes/taxonomy.routes.ts`

---

## 1. Data Model Overview

A **Finding** is raised against a source **Task** and lives through a 4-state
lifecycle. Around it sit the expansion-pack entities.

Note: `sourceTaskId` is nullable — a Finding may exist without a source Task.
When null, the task feed write is skipped.

| Entity | Relation to Finding | Purpose |
|---|---|---|
| `Finding` | — | Core record (`status`, `severity`, `eventType`, `departmentId`, `targetDivisionId`, Stage-2 fields) |
| `RcaInvestigation` | 1 : 1 (`rca`) | Structured root-cause analysis (method-aware) |
| `RcaWhyStep` | child of RCA | Ordered 5-Whys ladder |
| `RcaContributingFactor` | child of RCA | MEDA contributing factors |
| `CapaAction` | 1 : N (`capaActions`) | Corrective / Preventive actions |
| `AtaChapter` | N : 1 (`ataChapter`) | Taxonomy: ATA chapter |
| `HazardTag` ↔ `FindingHazardTag` | N : M | Taxonomy: hazard tags |
| `CauseCode` | via `RcaInvestigation.causeCodeId` | The determined cause (RCA conclusion) |
| `FindingLink` | self-ref (`linksFrom` / `linksTo`) | Cross-finding traceability |

Two distinct scoping fields exist and must not be conflated:
- **`departmentId`** — operational department where the finding occurred (required at raise).
- **`targetDivisionId`** — inherited from the source task, used purely for RBAC scoping.

Every state change uses the mandatory dual-write helper
`logFindingAuditAndActivity()` → writes to **`AuditLog`** (compliance) **and** the
source task's **`FeedPost`** (`SYSTEM_EVENT`). When `sourceTaskId` is null the
feed write is skipped. All queries filter `deletedAt: null`.

---

## 2. Finding Lifecycle

```
                  raise (reporter)
   [ source Task ] ───────────────────► Open ◄────────────────────┐
                                         │                         │
                    review (Mgr/Dir): severity + dueDate + taxonomy │
                                         ▼                         │
                                    In Progress                    │
                                         │                         │
            generateFollowUpTasks ───────┘                         │
                                         │                 dismiss (Mgr/Dir)
            all follow-up Tasks reach a FINAL state                │
            (Closed / Rejected / Terminated)                       │
            → checkAndTriggerPendingVerification (auto)            │
                                         ▼                         │
                              Pending Verification ────────────────┘
                                         │
                    close (Mgr/Dir) — passes close-gate checks
                    (RCA Complete + all CORRECTIVE CAPAs Verified)
                                         ▼
                                      Closed
```

### State transitions in detail

**`Open` → `In Progress`** — two paths, both Manager/Director only:
- `PUT /:id/review` — sets `severity` (required), optional `dueDate`, optional ATA
  chapter / hazard tags. Only valid while status is `Open` (rejects "already
  reviewed"). Advances status Open → In Progress. Writes `REVIEWED` (+ `DUE_DATE_SET`,
  `TAXONOMY_SET` when applicable).
- `POST /:id/tasks` — generating follow-up tasks also advances `Open` →
  `In Progress` if still Open.

**`In Progress` → `Pending Verification`** — **automatic, never manual.** When any
follow-up task reaches a final state, `task.controller` calls
`checkAndTriggerPendingVerification()`. When **all** non-deleted follow-up tasks
are final (`Closed` / `Rejected` / `Terminated`), the finding flips to
`Pending Verification`. This hook is best-effort (wrapped in try/catch, never
rethrows) — if it fails the finding silently stays `In Progress`. Requires at
least one follow-up task to exist; never re-triggers once Pending/Closed.

**`Pending Verification` → `Closed`** — `PUT /:id/close` (Manager/Director).
Enforces via `evaluateCloseGate()`:
1. Status must be `Pending Verification`.
2. If an RCA exists → it must be `Complete`.
3. If any CAPA exists → every `CORRECTIVE` CAPA must be `Verified`. **PREVENTIVE
   CAPAs do NOT block closure** — they may be left `Open`, `In Progress`, or
   `Completed`.
4. Legacy findings with no RCA/CAPA close without expansion gates.

**`Open` → `Dismissed`** — `PUT /:id/dismiss` (Manager/Director only). For
findings raised in error or no longer relevant. Requires a reason. Irreversible
terminal status.

**Due-date breach** — computed on read (`dueDate` passed and status ≠ `Closed`).
The first observed breach writes a one-time `DUE_DATE_BREACHED` audit entry; the
API returns a `dueDateBreached` flag on list and detail responses.

---

## 3. CAPA Lifecycle

CAPA actions sit **beside** the finding's follow-up tasks and never mutate Task
fields. Each action is `CORRECTIVE` or `PREVENTIVE`. Via `CapaTaskLink`, each CAPA
can link to one or more Tasks or Work Packages in three roles:
  - **`EXECUTION`** — the Task doing the work
  - **`EFFECTIVENESS`** — the Task verifying the fix worked
  - **`SUPPORTING`** — auxiliary reference

```
   createCapa ──► Open ──(updateCapa)──► In Progress ──► Completed
                    │                                       │
                    │      CORRECTIVE: verifyCapa           │
                    │      (Mgr/Dir; needs EFFECTIVENESS    │
                    │       link in final state)            │
                    │                                       ▼
                    │                                   Verified
                    │
                    │      PREVENTIVE only: waiveCapa
                    │      (Mgr/Dir; requires waivedReason)
                    └────────────────────────────────► Waived
```

### CAPA rules enforced in code
- **Status set via `updateCapa`** is limited to `Open` / `In Progress` /
  `Completed`. Transitioning to `Verified` or `Waived` through the generic update
  is **blocked** (400) — must use the dedicated endpoints.
- **`CapaTaskLink` model** — many-to-many with Role. Replaces the old flat
  `executionTaskId` / `effectivenessTaskId` FK columns. Any non-deleted Task or
  Work Package can be linked.
- **`verifyCapa`** (Manager/Director + access):
  - Requires at least one linked item with role `EFFECTIVENESS`.
  - All EFFECTIVENESS-role links must be in a completion state (Task `Closed` or
    Work Package `Closed`).
  - Stamps `status=Verified`, `verifiedByUserId`, `verifiedAt`.
- **`waiveCapa`** (Manager/Director + access): **PREVENTIVE only** — corrective
  actions can never be waived. Requires a non-empty `waivedReason`. Stamps
  `status=Waived`.
- **`deleteCapa`** (Manager/Director + access): soft-delete (sets `deletedAt`)
  with a `CAPA_DELETED` dual-write.
- **`addCapaLink`** / **`removeCapaLink`** — add or remove individual
  Task/Work Package links (Manager/Director + access).

**PREVENTIVE CAPAs no longer block finding closure.** Only CORRECTIVE CAPAs must
be Verified. See Section 2 for the updated close-gate rules.

---

## 4. RCA Workflow

```
   upsertRca (PUT /:id/rca)
   ├─ method = FIVE_WHYS ─► saveWhySteps (PUT /:id/rca/why-steps) — ordered ladder
   ├─ method = MEDA      ─► saveFactors  (PUT /:id/rca/factors)   — contributing factors
   └─ method = OTHER     ─► narrative `summary` only

   status: Draft ──► Complete   (requires a causeCodeId — the determined cause)
```

- **`upsertRca`** creates/updates the 1:1 investigation header (`method`,
  `summary`, `status`, `causeCodeId`, `conductedByUserId`). `method` must be in
  `RCA_METHODS` (`MEDA` / `FIVE_WHYS` / `OTHER`). A cause code, if supplied, must exist.
- **A `Complete` RCA must have a cause code** — the cause code *is* the RCA
  conclusion. Attempting `Complete` without one → 400.
- **`saveWhySteps`** — valid only when `method = FIVE_WHYS`; replaces the whole
  ladder (deleteMany + createMany), 0-indexed `orderIndex`, each step needs a `question`.
- **`saveFactors`** — valid only when `method = MEDA`; each factor needs a
  `category` from `RCA_MEDA_CATEGORIES` (10 Boeing MEDA categories), optional
  `detail` / `isPrimary`.
- All three write a `RCA_UPDATED` audit entry. The cause code on the RCA is what
  the **trend engine** keys on.

---

## 5. Traceability (Finding Links)

`FindingLink` is a directional self-reference with `linkType` ∈
`{DUPLICATE, RELATED, CAUSED_BY}`.

- **`GET /:id/links`** — returns both `outgoing` (linksFrom) and `incoming`
  (linksTo) with related-finding summaries.
- **`POST /:id/links`** (Manager/Director) — rejects self-links and duplicate
  `(from, related, linkType)` edges; the reviewer must have access to **both** the
  source and the related finding.
- **`DELETE /:id/links/:linkId`** (Manager/Director) — gated by `canAccessFinding`
  on the source finding; only outgoing links (matching `fromFindingId`) can be deleted.

---

## 6. Trend / Recurrence Engine (compute-on-read)

Computed on every `GET /:id` via `computeTrendForSignature()`. No background jobs,
no persisted clusters, no audit log (ephemeral).

**Signature** = `departmentId` + `ataChapterId` + `causeCodeId` (from the RCA) +
`hazardTagIds`.

- If **any** signature dimension is missing (no department, ATA, cause code, or
  zero hazard tags) → not recurring.
- Otherwise counts non-deleted findings sharing the same department + ATA + cause
  code **and** ≥1 common hazard tag, within `TREND_WINDOW_DAYS = 180`.
- The **subject finding is always counted** even if raised before the window
  (`OR: [{createdAt ≥ cutoff}, {id: findingId}]`).
- `isRecurring = matchCount >= TREND_THRESHOLD (3)`. The detail response carries
  `{ isRecurring, matchCount, threshold, windowDays, signature }`, surfaced as an
  amber `TrendBanner` in the UI.

`TREND_THRESHOLD` and `TREND_WINDOW_DAYS` are tunable constants now; Phase 7 moves
them into the admin-managed `PrivilegeConfig`.

---

## 7. RBAC Rights by Finding Element

Centralized in `utils/findingAccess.ts`.

### Visibility scope (`buildFindingScope`)

| Role | Can see |
|---|---|
| **Director / Admin** | All findings |
| **Manager** | Findings targeting their division, **OR** where their division is involved via a follow-up task (task targets their division, or its assignee belongs to their division) — *broadened scope* |
| **Group Leader / Staff** | Findings they reported, OR whose follow-up task they are individually assigned |

### Action rights

| Action | Endpoint | Who |
|---|---|---|
| Raise finding | `POST /api/findings` | Any authenticated user (source task's template must have `allowsFindings`; task non-deleted) |
| View finding / list | `GET /api/findings`, `GET /:id` | Anyone within visibility scope (`canAccessFinding`) |
| Review (severity, due date, taxonomy) | `PUT /:id/review` | **Manager / Director only** |
| Generate follow-up tasks | `POST /:id/tasks` | **Manager / Director only** |
| Complete Stage 2 | `PUT /:id/stage2` | Reporter, any follow-up assignee, Manager, Director |
| Close finding | `PUT /:id/close` | **Manager / Director only** |
| RCA view | `GET /:id/rca` | Anyone with access |
| RCA create/edit (header, why-steps, factors) | `PUT /:id/rca…` | `canEditAnalysis`: Director; reporter; follow-up assignee; **Manager only if in scope**; Admin = view-only |
| CAPA view | `GET /:id/capa` | Anyone with access |
| CAPA create/edit | `POST` / `PUT /:id/capa…` | `canEditAnalysis` (same as RCA edit) |
| CAPA **verify / waive / delete** | `…/verify`, `…/waive`, `DELETE` | **Manager / Director + must have access to the finding** |
| Link view | `GET /:id/links` | Anyone with access |
| Link create / delete | `POST` / `DELETE /:id/links…` | **Manager / Director + access to finding (and related finding on create)** |
| Taxonomy list (pickers) | `GET /api/taxonomy/…` | Any authenticated user (`?activeOnly=true`) |
| Taxonomy create/update | `POST` / `PUT /api/taxonomy/…` | **Admin / Director only** |

Note the deliberate distinction: a **Manager's "edit analysis" right is
scope-bound** (`hasAccess`) rather than global — a manager outside the finding's
division cannot edit its RCA/CAPA or manage its links even though the role matches.

---

## 8. End-to-End Happy Path

1. **Staff** completes an audit task → raises a Finding (`POST /api/findings`)
   with department, event type, optional ATA chapter + hazard tags.
   → `Open`, audit `CREATED`.
2. **Manager** reviews (`PUT /:id/review`): sets severity Level 2, a due date,
   refines taxonomy. → `In Progress`, audit `REVIEWED` (+ `DUE_DATE_SET`, `TAXONOMY_SET`).
3. **Manager** generates follow-up tasks (`POST /:id/tasks`) — created
   `Unassigned`, each with `parentFindingId` and a fresh `schemaSnapshot`; can
   attach to an existing Work Package (WP) or spin up a new INVESTIGATION work package.
   Audit `FOLLOWUP_TASK_CREATED`.
4. Investigators record the **RCA** (`PUT /:id/rca` + why-steps/factors), conclude
   with a **cause code**, mark it `Complete`.
5. They define **CAPA** actions (Corrective / Preventive), linking execution and
   effectiveness follow-up tasks via `CapaTaskLink` (role-based many-to-many).
6. As follow-up tasks close, **Manager** verifies the corrective CAPA (`…/verify`)
   once its linked effectiveness task(s) reach `Closed`. Waive any preventive
   ones as needed (no verification required for PREVENTIVE).
7. When **all** follow-up tasks are final, the finding auto-advances to
   `Pending Verification` (audit `PENDING_VERIFICATION`).
8. **Manager** closes (`PUT /:id/close`): RCA must be `Complete` **and** all
   CORRECTIVE CAPAs must be `Verified`. PREVENTIVE CAPAs do not block closure
   → `Closed`, audit `CLOSED`.
9. Throughout, `GET /:id` recomputes the **trend** flag; if 3+ findings share the
    same dept+ATA+cause+hazard signature (strong signature), or just dept+ATA+cause
    with no hazard tags (partial signature), the recurrence banner appears.

---

## Appendix — Audit `actionType` strings

Lifecycle: `CREATED`, `REVIEWED`, `DUE_DATE_SET`, `FOLLOWUP_TASK_CREATED`,
`PENDING_VERIFICATION`, `CLOSED`, `DUE_DATE_BREACHED`.

Expansion (`FINDING_EXPANSION_ACTIONS`): `RCA_UPDATED`, `CAPA_CREATED`,
`CAPA_UPDATED`, `CAPA_VERIFIED`, `CAPA_WAIVED`, `CAPA_DELETED`, `CAPA_LINK_ADDED`,
`CAPA_LINK_REMOVED`, `FINDING_LINKED`, `FINDING_UNLINKED`, `TAXONOMY_SET`,
`SEVERITY_UPDATED`, `NO_FOLLOWUP_REQUIRED`, `MANUAL_ADVANCE`, `DISMISSED`,
`TAXONOMY_UPDATED`.
