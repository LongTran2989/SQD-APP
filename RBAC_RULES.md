# SQD-APP — RBAC Rules Reference

Complete, code-verified list of the Role-Based Access Control rules. Every rule below was traced to its enforcement point in the backend (`src/controllers/*`, `src/utils/privilegeAccess.ts`, `src/utils/findingAccess.ts`, `src/services/escalationService.ts`, `src/constants/privileges.ts`).

> **Two-layer model.** Access = **privilege key** (role-level, DB-overridable via `PrivilegeConfig`, falling back to `DEFAULT_PRIVILEGES`) **+ hardcoded grants** (relationship, division-scope, transparency). The privilege *catalog* is data-driven; **division-scope comparisons, relationship bypasses, feed transparency, and the Director-approval safety gate are hardcoded by design** and cannot be toggled off.

---

## 1. The golden rule — view-transparent, action-scoped

- **Viewing is open to everyone.** Every authenticated user can view **all** Tasks, Work Packages and Findings system-wide, and **read every feed** (Task / WP / Division / Org / Finding) — regardless of division or assignment. This is deliberate aviation-safety transparency.
- **Acting is restricted.** Assignment, review, closure, status changes, escalation-actioning and moderation are gated by role, privilege, division and relationship, per the rules below.

---

## 2. Roles & default privileges

Authoritative list: `ROLE_NAMES` = Director, Admin, Manager, Group Leader, Staff, Senior Advisor. Default grants from `DEFAULT_PRIVILEGES`:

| Capability (privilege key) | Director | Admin | Manager | Group Leader | Staff | Senior Advisor |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Create tasks `task:create` | ✅ | ✅ | ✅ | — | — | — |
| Assign across any division `task:assign_any` | ✅ | ✅ | — | — | — | — |
| Assign within own division `task:assign_div` | ✅* | ✅* | ✅ | — | — | — |
| Review any division `task:review_any` | ✅ | — | — | — | — | — |
| Review own division `task:review_div` | ✅* | — | ✅ | — | — | — |
| Re-open / inactivate tasks | ✅ | ✅ | — | — | — | — |
| Re-link any task to a WP `task:relink_any` | ✅ | ✅ | ✅ | — | — | — |
| Template create/edit/publish/delete/archive/transfer | ✅ | ✅ | ✅ | — | — | — |
| WP create / edit `wp:create` `wp:edit` | ✅ | ✅ | ✅ | — | — | — |
| WP change status (close/reopen) `wp:manage_status` | ✅ | ✅ | **—** | — | — | — |
| Assign users to WPs `wp:assign` | ✅ | ✅ | ✅ | — | — | — |
| Review findings `finding:review` (severity/close/dismiss/links) | ✅ | **—** | ✅ | — | — | — |
| Finding analysis `finding:manage_analysis` | ✅ | — | ✅ | — | — | — |
| Finding admin `finding:admin` | ✅ | ✅ | — | — | — | — |
| Analytics `analytics:view` | ✅ | ✅ | ✅ | — | — | — |
| Review/action escalations `escalation:review` | ✅ | ✅ | ✅ | — | — | — |
| Time-booking override `timebooking:override` | ✅ | ✅ | — | — | — | — |
| Delete any attachment `attachment:delete_any` | ✅ | ✅ | ✅ | — | — | — |
| Create users `user:create` | ✅ | ✅ | — | — | — | — |
| Manage roles `user:manage_roles` | — | ✅ | — | — | — | — |
| Manage privilege config `settings:privileges` | — | ✅ | — | — | — | — |

`*` Directors/Admins hold the broader `_any` variant, which subsumes `_div`.

**Key consequences of the defaults:**
- **Admin is NOT a task reviewer and NOT a finding reviewer** (only `finding:admin`). Admins administer; they do not sign off quality work. Admins also **cannot be assigned tasks**.
- **Manager does NOT hold `wp:manage_status` by default** → a Manager can only close/reopen a WP **they created** (creator bypass, §5), not arbitrary division WPs.
- **Group Leader, Staff, Senior Advisor have no privilege keys by default.** Their abilities come entirely from **hardcoded relationship/role grants** (self-assign, perform own task, raise findings, book own time, WP-membership task create/assign). Senior Advisor additionally gets **global dashboard/data visibility** (oversight) alongside Director/Admin.
- Any of the above can be **re-granted per role by an Admin** through `PrivilegeConfig` (except the hardcoded scope rules).

**Cross-division reach** (`hasCrossDivisionReach`) = role is **Director or Admin**, *or* the actor holds **`task:assign_any`**. This single signal governs every "can I act outside my own division?" check below.

---

## 3. Task assignment rules

### 3.1 Assign an **Unassigned** task to someone (`PUT /tasks/:id/assign`)
1. Task **must be `Unassigned`** (use reassign otherwise).
2. Actor must hold **`task:assign_any`** or **`task:assign_div`**, **OR** be a **member of the task's Work Package** (relationship bypass).
3. The assignee **cannot be an Admin**.
4. **Division lock:** unless the actor has **cross-division reach** (`task:assign_any`), the **assignee must be in the actor's own division** — `assignee.divisionId === actor.divisionId`.

> **So:** a Manager (or a WP-member Staff/Group Leader) can only hand a task to **their own-division** colleagues. Only Directors/Admins (or a custom role granted `assign_any`) can assign across divisions.

> **Edge case (known open item DEF-4):** the division lock compares the **assignee's** division to the **actor's** division — it does **not** re-check the **task's `targetDivisionId`**. A Manager with `assign_div` can therefore assign a task *targeted at another division* as long as the chosen assignee is in the Manager's own division. Flagged for product confirmation.

### 3.2 Self-assign — "Perform This Task" (`PUT /tasks/:id/self-assign`)
1. Task **must be `Unassigned`**.
2. Actor **cannot be an Admin**.
3. **Division lock:** unless the actor is a **Director**, the task's **`targetDivisionId` must equal the actor's division**.

> **So:** any Staff / Group Leader / Manager may pull an unassigned task **from their own division's pool**. Directors may self-assign any unassigned task.

### 3.3 Reassign an already-assigned task (`PUT /tasks/:id/reassign`)
1. **Blocked** on final states (`Closed`, `Rejected`, `Terminated`) and on `Inactive`.
2. Actor must have **reviewer rights** on the task (§4.1) — i.e. Issuer, or `review_any`, or `review_div`+same division.
3. A **reason is mandatory**; **all TaskData is preserved**; status resets to `Assigned`.
4. **Division lock** on the new assignee: same as §3.1.4 (own division unless `assign_any`); new assignee cannot be Admin.

### 3.4 Create a task (`POST /tasks`, and finding follow-ups)
1. Actor must hold **`task:create`**, **OR** be a **WP member** creating the task **in that WP for their own division** (`wpAssignment && targetDivisionId === divisionId`).
2. Unless cross-division reach, the task's **`targetDivisionId` must be the actor's own division**.
3. If assigning at creation time, the §3.1.4 division lock applies to the assignee.

---

## 4. Task review & lifecycle rules

### 4.1 Who is a reviewer (`isReviewer`)
A user may review a task if **any** of:
- they are the task's **Issuer** (relationship grant — always, hardcoded), **or**
- they hold **`task:review_any`** (any division), **or**
- they hold **`task:review_div`** **and** their division equals the task's `targetDivisionId`.

### 4.2 Review action (`PUT /tasks/:id/review`, action = approve | reject | follow-up)
1. Task **must be `In Review`**.
2. **Segregation of duties (hard rule):** the **person who performed the task (its assignee) can NEVER review it** — even if they are the Issuer or a Manager. Aviation QA integrity requirement.
3. **Director-only gate:** if the task has `requiresDirectorApproval` (e.g. QN response-action tasks), **only a Director** may review/approve — this overrides the Issuer exception and blocks Managers.
4. A **comment is mandatory** for `reject` and `follow-up`.
5. Outcomes: **approve → `Closed`**, **reject → `Rejected`**, **follow-up → `Follow-up Required`**.

### 4.3 Other lifecycle actions
- **Re-open** a closed task: requires **`task:reopen`** (Director/Admin).
- **Inactivate / reactivate** a task: requires **`task:inactivate`** (Director/Admin).
- **Transfer issuer rights** (`PUT /tasks/:id/transfer-issuer`): only the **current Issuer** may transfer; target must be a **Manager or Director**; blocked on final/`Inactive` states. *(Known open item DEF-3: no division-scope check on the target.)*
- **Save task data / submit for review:** only the **assigned user** may edit data or submit; data is editable only in non-final, non-review statuses.

---

## 5. Work Package rules

- **Create WP** (`wp:create`): Manager / Director / Admin. **Division lock:** without cross-division reach, `divisionId` must be the actor's own division (auto-generated tasks inherit `wp.divisionId`).
- **Edit WP** (`wp:edit`): holder **and** (Director/Admin **or** same division as the WP).
- **Change WP status — close / reopen / inactivate** (`PUT /wp/:id/status`): the **WP creator** (relationship bypass) **or** a holder of **`wp:manage_status`**; on the privilege path, non-creators without cross-division reach must be **same division** as the WP.
  - **So:** by default only **Directors/Admins** (who hold `wp:manage_status`) can close *any* WP; a **Manager can close only WPs they created**.
- **Assign a user to a WP** (`wp:assign`, `POST /wp/:id/assignments`): Manager / Director / Admin. **Division lock:** without cross-division reach, the **target user must be in the actor's own division**.

### 5.1 Multi-division Work Packages — the cross-division case
A WP belongs to exactly **one** division (`wp.divisionId`), but its **membership can span divisions**:

1. **How a WP gets multi-division staff:** only an actor with **cross-division reach (Director/Admin, or `assign_any`)** can assign **out-of-division** users to a WP. A plain **Manager can only add their own-division** members (§5, division lock). So a mixed-division WP exists **only because a Director/Admin populated it**.
2. **Task assignment stays division-locked per actor.** Even inside a multi-division WP:
   - A Manager (or WP-member) **without `assign_any`** can still only assign that WP's tasks to **their own-division** members (§3.1.4) — they cannot assign to the WP's other-division members.
   - **Self-assign** still requires the **task's `targetDivisionId` = the actor's division** (§3.2). A division-B member of a WP cannot self-assign a division-A-targeted task in that same WP.
   - Only a **Director/Admin** can freely assign a WP's tasks to any member regardless of division.
3. **WP-membership bypass is division-bounded.** Being a WP member grants the *ability to create/assign within that WP*, but the **own-division lock still applies** to who you may create-for or assign-to.

> **Net effect:** cross-division WPs are supported for *collaboration/visibility*, but **operational routing (who does the work) remains division-scoped** unless a Director/Admin acts. There is no privilege that lets a Manager route work to another division's staff.

---

## 6. Findings rules

- **Raise a finding** from a task: **any user**, provided the source template has **`allowsFindings = true`** and the task is **not** in a final state (`Closed` / `Terminated` / `Inactive`). Minimum fields: Event Type, Department, Description. The finding inherits the task's `targetDivisionId`.
- **Review a finding** — assign severity (`Observation` / `Level 1` / `Level 2`), set due date, dismiss, close, manage links (`finding:review`): **Manager or Director** (Admin excluded). Transitions `Open → In Progress`.
  - **Manager division scope (`assertManagerDivisionScope`):** a Manager may only review a finding whose **`targetDivisionId` is their division**, *or* which has a **follow-up task targeting / assigned within their division**. Directors are unscoped.
- **Generate follow-up (corrective-action) tasks** from a finding: the reviewer (Manager/Director). Each is created `Unassigned`, linked via `parentFindingId`, then assigned through the normal task-assignment flow (§3).
- **Pending Verification (automatic):** when **every** follow-up task linked to a finding reaches a final state, the finding auto-transitions `In Progress → Pending Verification` (best-effort, wired into task review/submit).
- **Close a finding** (`Pending Verification → Closed`): Manager/Director sign-off (`finding:review`), subject to the same Manager division scope.
- **Finding visibility (read):** Director/Admin see all; **Managers see all** (visibility is open) but **act** only within their division scope; the "my findings" lists surface the reporter, follow-up assignees, and CAPA-linked task/WP owners.
- **RCA / CAPA:** RCA authored by the reporter or a Manager/Director; CAPA verification requires all **mandatory** linked tasks/WPs to be closed first.

---

## 7. Unified Feed & Escalation rules

- **Read any feed:** all authenticated users (transparency).
- **Post a comment:** Task / WP feeds — anyone; **Division Board** — own-division members (Director/Admin any); **Org Feed** — Director / Admin / Manager only.
- **Flag a comment (escalate):** **any user** may flag. Valid escalations move **upward only**: Task→WP, WP→Division, Task→Division, WP→Org, Task→Org, Division→Org. At most **one PENDING flag per (comment, target)**.
- **Action an escalation** (`canActionFlag`): **Director/Admin** may action any flag (cross-division reach); a holder of **`escalation:review`** (default **Manager**) may action **Org** flags (any) and **WP/Division** flags **only within their own division** (`flag.divisionId === user.divisionId`).
- **See vs. action:** everyone *sees* escalation cards on the feeds; only the roles above can *action* them. The header **bell** (shown only to actioner roles) counts each viewer's **PENDING** actionable flags.
- **Moderation:** **hide/unhide** a comment — **Director/Admin only** (record kept, never deleted). **Pin** a comment — Director/Admin anywhere, Manager on the Org Feed, division members on their own board.

---

## 8. Other guarded actions

- **Time booking:** the **assignee** logs actual hours once a task is in a final state; revisable by the **assignee, Admin, or Director** (`timebooking:override` for the latter). Every write appends an immutable `TimeEntry`.
- **Templates:** create/edit/publish/delete/archive/transfer require the matching `template:*` key (Manager/Director/Admin); publish clears `draftSchema`; owner-only edit on the draft.
- **Analytics:** `analytics:view` (Manager/Director/Admin; Managers scoped to their division, Directors system-wide). Senior Advisor sees dashboards globally.
- **User management:** create users `user:create` (Director/Admin); assign roles `user:manage_roles` (Admin). A Director may create Director/Admin accounts; a Manager may only create users **within their own division** (and never Director/Admin).
- **Settings:** privilege config `settings:privileges` (Admin only); taxonomy/notifications/security per their keys.

---

## 9. Hardcoded vs. configurable — quick reference

| Stays hardcoded (cannot be toggled) | Configurable via `PrivilegeConfig` |
|---|---|
| Issuer = reviewer relationship grant | Which roles hold each `PrivilegeKey` |
| Assignee-can't-review segregation of duties | e.g. grant a Group Leader `task:assign_div` |
| Division-scope comparisons (own-division locks) | e.g. give Manager `wp:manage_status` |
| WP-membership task create/assign bypass | e.g. give a custom role `escalation:review` |
| Director-only approval gate (`requiresDirectorApproval`) | Finding / analytics / settings grants |
| Feed read-transparency & Org-feed post roles | |
| Cross-division reach = Director/Admin/`assign_any` | |
