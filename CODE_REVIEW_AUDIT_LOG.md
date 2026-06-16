# Code Review & Security Audit Log
*Running log of all `/code-review`, `/security-review`, and manual audit sessions.
Each entry records: date, branch, scope, findings (severity + status), and any deferred flags.*

---

## How to use this document

- **Add an entry** every time a `/code-review` or `/security-review` is accepted by the user.
- Each finding carries a status: ✅ Fixed | ⏭ Deferred (reason noted) | ✔ Accepted-as-is (intentional).
- Cross-reference `CLAUDE_HANDOVER.md` §2 for the feature narrative; this file is the authoritative list of **what was reviewed, what was found, and what remains open**.
- Always update this file **before** closing a session in which a review was accepted.

---

## Session: 2026-06-16 — File Upload Infrastructure Code Review (high effort)

**Branch:** `claude/file-upload-infrastructure-28r4m5`
**Scope:** The File Upload feature only (commits `f49fac5` + `a8480b2`) — `backend/src/services/attachmentService.ts`, `controllers/attachment.controller.ts`, `routes/attachment.routes.ts`, `services/storage/*`, `constants/fileUpload.ts`, `constants/privileges.ts`, `frontend/src/components/ui/FileUploadField.tsx`, `api/attachmentApi.ts`, `FILE_UPLOAD_DEV_GUIDE.md`, `deploy.sh`.
**Tests after all fixes:** 444 / 444 passing (19 suites). Frontend `tsc`/lint/`next build` clean.
**Method:** 8 finder angles → verify pass. All 10 surviving findings fixed (user accepted "apply all fixes").

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| FU-1 | High (bug) | `FileUploadField.tsx` | Mount load-effect called `emit(list)` → `onChange` → `handleDataChange`, marking the task form **dirty on view** (even in read-only statuses) and overwriting saved `TaskData`. | ✅ Fixed — `emit` only after an upload/delete, never on the initial read |
| FU-2 | Medium (doc) | `FILE_UPLOAD_DEV_GUIDE.md` | Guide claimed downloads "re-check RBAC on every download"; `download`/`list` actually require only authentication. | ✅ Fixed — doc rewritten to describe the transparency model honestly + name the single seam (`assertEntityExists`) to tighten later |
| FU-3 | Medium (altitude) | `attachmentService.ts` | Delete RBAC used a hardcoded `['Director','Admin','Manager']` array, bypassing the Phase-7 privilege matrix; not Admin-configurable. | ✅ Fixed — new `attachment:delete_any` `PrivilegeKey` (default D/A/M) resolved via `hasPrivilege` |
| FU-4 | Medium (efficiency) | `attachmentApi.ts` | `getUploadConfig()` fetched once per `FileUploadField` mount → N identical requests on a multi-file-field form. | ✅ Fixed — module-scope cached Promise (retryable on failure) |
| FU-5 | Medium (efficiency/VPS) | `attachment.routes.ts` / `LocalDiskAdapter.ts` | `multer.memoryStorage()` buffered whole files in RAM; adapter then wrote to disk → peak RAM = Σ concurrent uploads on the small VPS. | ✅ Fixed — `diskStorage` temp file + `putFile` (rename, EXDEV copy fallback); controller `unlink`s temp in `finally`; `getStream` drops the extra `access()` syscall |
| FU-6 | Low (security) | `attachmentService.ts` | MIME type trusted from client `req.file.mimetype` (spoofable). | ✅ Mitigated/Documented — download forces `Content-Disposition: attachment` (no inline render → not an XSS vector); doc now states the allow-list is advisory, not content-sniffed |
| FU-7 | Low (correctness) | `attachmentService.ts` | Non-transactional existence/quota check; orphan object if the process dies between `putFile` and the tx. | ✔ Accepted-as-is — acknowledged race for an internal tool; documented in the dev guide |
| FU-8 | Low (cleanup) | `attachment.controller.ts` | Upload response hand-spread the 9 public fields already enumerated by `PUBLIC_SELECT`. | ✅ Fixed — shared `toPublic()` projector |
| FU-9 | Low (cleanup) | `fileUpload.ts` | `ALL_BUCKETS` was a parallel literal of `ENTITY_BUCKET`'s values. | ✅ Fixed — derived via `new Set(Object.values(ENTITY_BUCKET))` |
| FU-10 | Low (cleanup) | `FileUploadField.tsx` | Redundant `error` state alongside the toast (never auto-cleared); `formatBytes` rounded differently from the backend. | ✅ Fixed — dropped `error` state (toast only); frontend `formatBytes` rounding aligned to backend |

**Rule-10 follow-up (noted, not a regression):** `FILE_UPLOAD_CONFIG` is seeded + read per request and is now clamped to the 100 MB hard ceiling, but there is still **no write endpoint** — limits are only changeable via a direct DB upsert until a settings-panel `PUT` is added. Tracked as DEF-5 below.

| ID | Priority | Item | Reason for deferral |
|----|----------|------|---------------------|
| DEF-5 | Low | No `PUT` endpoint for `FILE_UPLOAD_CONFIG`; "Admin-configurable" (Rule 10) currently means a manual DB upsert. | Settings-panel endpoint is a follow-up feature, not a review bug. Default policy + clamp behave correctly meanwhile. |
| DEF-6 | Low | `download`/`list` are auth-only (no per-entity scope), consistent with the app's transparency model. If finding/task/WP visibility is ever tightened, attachments won't follow until a scope check is added at `assertEntityExists`. | Matches current product design (`buildFindingScope → {}`); revisit only if visibility is locked down. |

---

## Session: 2026-06-14 — Task Slice Code Review + Security Review

**Branch:** `claude/exciting-rubin-hqkxma`
**Scope:** Full task management vertical slice — `frontend/src/`, `backend/src/controllers/task.controller.ts`, `backend/src/utils/privilegeAccess.ts`
**Tests after all fixes:** 423 / 423 passing (17 suites)

---

### Part A — Frontend Code Review (10 bugs)

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| FE-1 | Medium | `taskApi.ts` | `decideDeadlineExtension` used wrong decision strings `'approved'/'denied'` instead of the backend-authoritative `'approve'/'deny'`. Every approve/deny call was rejected with 400. | ✅ Fixed — aligned to backend literals |
| FE-2 | Medium | `TaskActionBar.tsx` | `computeCanRate` read `assignedToUser.role.name` but the API returns role as a flat string, not a nested object. Director rating was always broken. | ✅ Fixed — `rawRole?.name ?? rawRole` extraction |
| FE-3 | Medium | `TaskActionBar.tsx` | `ratingValue` state could be stale after a new task loaded (didn't reset when `task.rating` prop changed). | ✅ Fixed — render-time state adjustment pattern (React 18+) |
| FE-4 | Low | `TaskActionBar.tsx` | `getUsers()` was fetched unconditionally on mount regardless of role, causing unnecessary N+1 API calls for roles that never see a user-picker. | ✅ Fixed — gated to roles that can see user-picker actions |
| FE-5 | Low | `TaskActionBar.tsx` | `getUsers()` fetch errors were swallowed silently — user saw an empty dropdown with no feedback. | ✅ Fixed — caught + surfaced via `toast.error` |
| FE-6 | Low | `TaskActionBar.tsx` | Dead guard `if (task.status === 'Inactive') return null` at line 65 — `Inactive` never reaches `TaskActionBar` (filtered upstream). | ✅ Fixed — removed dead branch |
| FE-7 | Medium | `TaskActionBar.tsx` | `computeIsReviewer()` was a client-side re-implementation of reviewer RBAC that was already out of date with Phase 7 privilege rules. Kept diverging silently. | ✅ Fixed — removed entirely; uses server-computed `task.isReviewer` |
| FE-8 | Low | `TaskCreateForm.tsx` | `setSubmitting(false)` was only in the `catch` block — if `onSaved()` threw, the form froze in a permanent "submitting" state. | ✅ Fixed — moved to `finally` |
| FE-9 | Low | `TaskFormPanel.tsx` | `field.options` array was in the `DynamicSelect` useEffect dependency array — a new array reference on every render caused repeated datasource refetches. | ✅ Fixed — removed `field.options` from deps |
| FE-10 | Low | `CreateTaskModal.tsx` | No Escape key or backdrop-click handler — WCAG 2.1.2 requires dismissible components to be closeable without the mouse. | ✅ Fixed — added `keydown` listener + backdrop `onClick` |

**Architectural improvements (3 items, planned then implemented same session):**

| # | Item | Status |
|---|------|--------|
| ARCH-1 | Shared source of truth for task API contract literals (`TASK_STATUSES`, `FINAL_TASK_STATUSES`, `REVIEW_ACTIONS`, `DEADLINE_DECISIONS`) with a guard test (`contractSync.test.ts`) to prevent frontend/backend drift | ✅ Done — `frontend/src/constants/taskStatus.ts` mirrors `backend/src/constants/taskStatus.ts`; guard test added |
| ARCH-2 | Server-compute the `isReviewer` flag and include it in all task API responses via `enrichTask()` helper | ✅ Done — `task.controller.ts:enrichTask()` appends `isReviewer` to every task response |
| ARCH-3 | Remove the duplicated client-side reviewer predicate that was out of sync with backend Phase 7 privilege checks | ✅ Done — `computeIsReviewer()` removed from `TaskActionBar.tsx`; all `canX` derivations now consume `task.isReviewer` |

---

### Part B — Backend Code Review (10 bugs in `task.controller.ts`)

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| BE-1 | Medium | `generateTaskId` included `deletedAt: null` filter, so the sequence counter skipped soft-deleted IDs — creating a new task in a division where a task was soft-deleted could collide with or reuse an old `taskId`. | ✅ Fixed — removed `deletedAt` filter |
| BE-2 | Medium | Non-atomic dual-write: 9 status-change handlers (`assignTask`, `selfAssignTask`, `submitTask`, `reviewTask`, `postRejectionAction`, `inactivateTask`, `reactivateTask`, `setDeadline`, `transferIssuerRights`) did `task.update` + `logAuditAndActivity` as two separate writes — a crash between them would leave one without the other. | ✅ Fixed — all wrapped in `prisma.$transaction` |
| BE-3 | Medium | Non-atomic `saveTaskData`: `taskData.upsert` + `task.update` + `logAuditAndActivity` were three separate writes. | ✅ Fixed — wrapped in `prisma.$transaction` |
| BE-4 | High | Missing division-scope check on reassignment in `reassignTaskService` and `postRejectionAction` reassign branch — cross-division reassignment was possible without `task:assign_any`. | ✅ Fixed — mirrors `assignTask`'s canonical lock |
| BE-5 | Medium | `setDeadline` accepted non-date strings (e.g. `"banana"`) — `new Date("banana")` is `Invalid Date`, `task.update` with that → Prisma 500. No guard existed. | ✅ Fixed — `isNaN(newDeadline.getTime())` → 400 |
| BE-6 | Low | `reactivateTask` fallback status was always `'Assigned'` regardless of whether the task had an assignee. A previously-Unassigned task would be reactivated to `'Assigned'`. | ✅ Fixed — `task.assignedToUserId ? 'Assigned' : 'Unassigned'` fallback |
| BE-7 | Low | `parseInt` without `parseTaskId` helper in 16 handlers — non-numeric route params (`/tasks/abc/...`) reached Prisma as `NaN` → 500 instead of a clean 400. `assignTask` also had a missing radix. | ✅ Fixed — `parseTaskId` helper added; all sites migrated |
| BE-8 | Medium | `decideDeadlineExtension` read-modify-write had no row lock — concurrent approve/deny calls could read the same stale `deadlineExtensions` blob, silently losing one write. | ✅ Fixed — `SELECT id FROM "Task" WHERE id = $id FOR UPDATE` inside transaction |
| BE-9 | Low | `transferIssuerRights` had no `Inactive` state block — the comment in the plan called it out but it was missing. | ✅ Fixed — added guard alongside the `FINAL_TASK_STATUSES` check |
| BE-10 | Low | `inactivateTask` accepted whitespace-only reasons (`reason: "   "`). `saveTaskData` had a dead `isFirstSave` branch that always ran the same path. | ✅ Fixed — whitespace trim check; dead branch collapsed |

---

### Part C — Security Review (`task.controller.ts` ↔ `privilegeAccess.ts`)

| # | Severity | Area | Finding | Status |
|---|----------|------|---------|--------|
| SEC-1 | **HIGH** | Privilege escalation | `createTaskService` gated the assignee division lock on `role === 'Manager'` only. The WP-assignment create bypass (Group Leader/Staff) could assign a task to a user in another division at creation. | ✅ Fixed — gated on `hasPrivilege(actor, 'task:assign_any')`, mirroring `assignTask`. Regression test T04c added. |
| SEC-2 | Medium | RBAC — issuer transfer | `transferIssuerRights` allowed transfer to any non-deleted user. Since `issuerId === userId` grants reviewer rights, handing issuer to a Staff/Group Leader gave them unintended review access. | ✅ Fixed — restricted to Manager/Director targets only. Role fetched from DB, not JWT. Regression test T54a added. |
| SEC-3 | Low | Input validation | `reassignTask` used raw `parseInt(req.params.id)` instead of `parseTaskId` → non-numeric id reached Prisma as `NaN` → 500. | ✅ Fixed — now uses `parseTaskId` + 400 guard |
| SEC-4 | Low | Input validation | `decideDeadlineExtension` bounds check (`< 0 || >= length`) passed a float index (e.g. `0.5`) — `extensions[0.5]` is `undefined`, `.decision` → 500. | ✅ Fixed — `Number.isInteger(extensionIndex)` required; 400 if not |
| SEC-5 | Medium | Storage / DoS | Dynamic form fields (`text`, `textarea`, `rich_text`) had no cap at any layer. `saveTaskData` accepted arbitrary JSON payloads with zero size validation. | ✅ Fixed — backend: 512 KB serialized cap + 100k chars per string value. Frontend: `maxLength` UX guardrail on text/textarea. |
| SEC-6 | Medium | Storage / DoS | Free-text controller inputs were unbounded: `title`, `reason` (reassign/inactivate/reopen/deadline), `comment` (review), `content` (comment). Only `issuanceNote` was already capped. | ✅ Fixed — `title` 300, `reason` 2000, `comment`/`content` 5000. Shared `lengthError()` helper. |
| SEC-7 | Medium | Division scope | Manager can create a task targeting a division other than their own. | ✔ Accepted-as-is — Intentional: a Manager in Div A can plant an Unassigned task targeting Div B, then use the org feed or escalation to notify Div B's Manager to assign it. |
| SEC-8 | Info | IDOR | All mutating endpoints re-fetch the task with `deletedAt: null` and run RBAC checks before acting. A spoofed ID hits those gates, not data. | ✔ Confirmed safe |
| SEC-9 | Info | Transparent model | `getTaskById`, `getTaskActivity`, and `postTaskComment` allow any authenticated user to read/comment on any task across divisions. | ✔ Accepted-as-is — Intentional. Documented in code as "Transparent viewing/commenting model". |

---

### Part C — Deferred / Flags for Future Review

| ID | Priority | Item | Reason for deferral |
|----|----------|------|---------------------|
| DEF-1 | Low | Rich text stored as HTML via Tiptap. Currently rendered via `EditorContent` (not `dangerouslySetInnerHTML`), so XSS is constrained to what the editor produces. If HTML is ever rendered elsewhere (migrations, CSV import, other components), it must be sanitised with DOMPurify before display. | No immediate risk; requires a concrete new rendering path to act on. See Gotcha #22 in `CLAUDE_HANDOVER.md`. |
| DEF-2 | Low | No keyboard navigation in `SearchableSelect` — fails WCAG keyboard-only requirements. | Internal tool; address before any external/accessibility audit. See Gotcha #21 in `CLAUDE_HANDOVER.md`. |
| DEF-3 | Low | `transferIssuerRights` has no division-scope check on the new issuer target (only role is checked). A Manager could hand issuer rights to a Director in another division. | Low risk: Director-scope is intentionally global. Revisit if the product ever requires division-locked issuer assignment. |
| DEF-4 | Info | `task:assign_div` privilege holders can currently use `assignTask` to assign into their own division but there is no check that the task itself is targeted at that division. A `task:assign_div` Manager could assign to themselves on a task targeted at another division. | Boundary condition; needs product confirmation before locking. |

---

## Earlier Reviews (referenced in `CLAUDE_HANDOVER.md §2`)

| Date | Branch | Scope | Summary |
|------|--------|-------|---------|
| 2026-06-13 | `claude/sqd-app-sse-notifications-yj7n32` | SSE realtime + Notification system | `/security-review` + high-effort `/code-review`. Findings: per-recipient write isolation, 429 cap before handshake, exhaustive dispatch, `unref()` purge interval, dead-socket pruning, `markRead` response. All fixed. 396 tests green. |
| 2026-06-09 | `claude/compassionate-gauss-335xa3` | Finding Response Actions + Standalone Findings | `/security-review` + `/code-review`. Findings: RBAC (H-1), state machine (H-2), DoS cap (H-3), input validation (M-1, L-2, L-3), audit accuracy (L-1), N+1 pre-validation. All fixed. 322 tests green. |
| 2026-06-10 | `claude/vigilant-mendel-3sajt0` | Phase 8 Time-Booking Workflow Refinements | `/code-review`. Findings: LOGGABLE_STATUSES constant, `In Review` banner copy. All fixed. No new tests (UX-only changes). |
| 2026-06-12 | `claude/exciting-darwin-gyohuf` | Phase 7 Deferred Items (User Management, Settings, Taxonomy) | `/security-review` + `/code-review`. Findings: session revocation on credential change (H1), route-level privilege guard (M1), default password not disclosed in UI (M2), whitespace-only name validation (M3), max-length on taxonomy inputs (L1), numeric divisionId validation (L2), Prisma singleton (L3). All fixed. |
| 2026-05-29 | Pre-Phase-5 | Auth controller | Manual audit. 5 findings (updatePassword, enumeration, rate limiting, JWT fallback, plaintext token). All fixed in `claude/amazing-ritchie-soasus`. See §11 of `CLAUDE_HANDOVER.md`. |
