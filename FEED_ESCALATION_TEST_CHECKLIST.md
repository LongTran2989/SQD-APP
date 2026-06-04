# Feed & Escalation — Manual Testing Checklist

> **Feature:** Feeds (Task / WP / Division / Org) + the Escalation loop (flag → cards → action)
> **Branch:** `claude/sqd-feed-escalation-plan-4dYZa`
> **Last updated:** 2026-06-03

---

## 0. Pre-flight / Environment

- [ ] PostgreSQL is **online** (`service postgresql status` → `online`)
- [ ] Backend running on **http://localhost:5000** (`cd backend && npm run dev`)
- [ ] Frontend running on **http://localhost:3000** (`cd frontend && npm run dev`)
- [ ] Dev DB (`sqd_qa_db`) has schema pushed + seed run (63 users, 4 divisions)
- [ ] You can log in (seed users require **employeeId**, not email)

### Test accounts (password `Abc@123` for all seed users)

> First login forces a password change. To skip it for a smoke test, clear the flag in the DB:
> `UPDATE "User" SET "forcePasswordChange"=false WHERE "employeeId"='VAExxxxx';`

| Role | Example employeeId | Division | Can action escalations? |
|---|---|---|---|
| Director | `VAE00071` | QA (4) | ✅ all |
| Admin | _(pick one from seed)_ | — | ✅ all |
| Manager | _(pick one from seed)_ | own div | ✅ own-div WP/Div + all Org |
| Group Leader | _(pick one)_ | own div | ❌ (sees cards only) |
| Staff | `VAE00057` | — | ❌ (sees cards only) |

---

## 1. Feed reading (all four scopes)

### 1.1 Org Feed (`/dashboard/org-feed`)
- [ ] Page loads; header shows globe icon + "Org Feed"
- [ ] Existing posts render (COMMENT, SYSTEM_EVENT, ESCALATION_CARD, INFO_CARD)
- [ ] Entry count in header matches visible entries
- [ ] Feed auto-scrolls to the newest entry on load
- [ ] **No flag button on Org comments** (top level — nothing to escalate to) ✅ *by design*

### 1.2 Division Board (`/dashboard/division-board`)
- [ ] Defaults to the viewer's own division
- [ ] Director / Admin see a **division switcher**; other roles do not
- [ ] Switching division reloads the feed for that division
- [ ] A user with no division sees "You are not assigned to a division."
- [ ] Comments here show a **flag button** (can escalate to Org)

### 1.3 Work Package feed
- [ ] Open a WP detail page → feed renders
- [ ] Comments show a **flag button** (can escalate to Division **or** Org)

### 1.4 Task feed (TaskActivityFeed)
- [ ] Open a task detail page → activity feed renders
- [ ] Task comments can be flagged (escalate to WP / Division / Org as applicable)

---

## 2. Posting comments (RBAC-gated composer)

- [ ] Composer is **visible** for roles allowed to post on that scope
- [ ] Composer is **hidden** (read-only) for roles not allowed to post
- [ ] Typing + clicking **Send** posts the comment; it appears immediately
- [ ] **Ctrl+Enter** (or Cmd+Enter) also posts
- [ ] Empty / whitespace-only comment cannot be posted (Send disabled)
- [ ] Posting failure shows an error toast (does not silently drop)
- [ ] Own comments render right-aligned ("You"); others left-aligned with initials

---

## 3. Flagging a comment (escalation creation)

### 3.1 Flag button picker
- [ ] Flag icon appears next to eligible comments only
- [ ] Clicking it opens the target picker ("Escalate to …")
- [ ] Picker lists only **valid upward** targets:
  - WP comment → Division, Org
  - Division comment → Org
  - Org comment → _(no button)_
- [ ] Clicking outside the picker closes it
- [ ] Selecting a target fires the flag → **success toast** "Escalated to <target>"

### 3.2 Dedup / re-flag guard (Issue #3 fix)
- [ ] After a successful flag, that target shows a **green checkmark ✓** and is disabled
- [ ] When **all** eligible targets are flagged, the flag icon turns **amber** and won't reopen
- [ ] Re-flagging the **same comment + same target** while PENDING → **409 error toast** ("already pending")
- [ ] After a 409, the UI also marks that target as done (checkmark)
- [ ] Flagging the **same comment to a different target** is allowed (independent flag)

### 3.3 Cards & events appear after a flag
- [ ] An **ESCALATION_CARD** lands on the target feed (e.g. Org Feed)
- [ ] A **SYSTEM_EVENT** ("X escalated this comment to …") lands on the **source** feed
- [ ] Card shows: source excerpt, "raised by <name>", status badge **PENDING**, "View source" deep-link
- [ ] "View source" navigates to the originating task / WP

---

## 4. Bell badge (Header)

### 4.1 Visibility (RBAC gate #22)
- [ ] **Director / Admin / Manager**: bell is interactive, badge reflects pending count
- [ ] **Group Leader / Staff**: bell shows **no badge** (no actionable queue)

### 4.2 Live count behaviour (Issue #2)
- [ ] On login (as actioner), badge shows the current pending count
- [ ] After **flagging** a comment → badge increments **immediately** (no 60s wait)
- [ ] After **actioning** a flag → badge **decrements immediately**
- [ ] Count caps display at **9+** when > 9
- [ ] Switching users (same role) refetches the new user's count
- [ ] Clicking the bell navigates to `/dashboard/escalations`

---

## 5. Escalations page (`/dashboard/escalations`)

### 5.1 Access control
- [ ] Director / Admin / Manager: page loads with the queue
- [ ] "Escalations" appears in the **Sidebar** for these roles only
- [ ] Group Leader / Staff: **no Sidebar link**, and direct URL **redirects to `/dashboard`**

### 5.2 Queue contents
- [ ] Loading spinner shows briefly, then the list (or empty state)
- [ ] Empty state: "No pending escalations."
- [ ] Each row shows: target scope label, source excerpt, "Flagged by <name>", timestamp
- [ ] "View source" deep-link present when there's a source task/WP
- [ ] Only **PENDING** flags appear; actioned/dismissed flags are gone

### 5.3 RBAC scoping of the queue
- [ ] **Director / Admin**: see **all** pending flags
- [ ] **Manager**: see all **Org** flags + own-division **WP/Division** flags only
- [ ] Manager does **not** see another division's WP/Division flags

---

## 6. Escalation actions (the 6 actions)

> Available from both the **escalations page** and the **ESCALATION_CARD** on a feed (when `canAction`).
> After any action, the flag leaves PENDING, the row/card updates, and the bell count drops.

### 6.1 ACKNOWLEDGE
- [ ] Marks flag **ACTIONED**; SYSTEM_EVENT "X acknowledged this escalation."
- [ ] Card badge flips PENDING → **Actioned** (green)
- [ ] Row disappears from the escalations page; bell count drops

### 6.2 DISMISS
- [ ] Marks flag **DISMISSED**; SYSTEM_EVENT "X dismissed this escalation."
- [ ] Card badge flips to **Dismissed** (grey)
- [ ] Re-flagging that comment+target afterwards is **allowed** (201)

### 6.3 RAISE_FINDING
- [ ] Available **only** when the source is a **task comment**
- [ ] Non-task source → button absent / 400 "only available for … task comment"
- [ ] Opens the finding modal; on submit creates a Finding
- [ ] SYSTEM_EVENT "X raised Finding #N from this escalation."; flag → ACTIONED

### 6.4 CREATE_TASK
- [ ] Opens the create-task modal with **published templates** only
- [ ] Respects own-division template scoping for non-Director/Admin
- [ ] On submit creates a Task; SYSTEM_EVENT "X created Task … from this escalation."; flag → ACTIONED

### 6.5 REASSIGN_TASK
- [ ] Available only when the escalation has a **source task**
- [ ] No source task → 400 "no source task to reassign"
- [ ] Requires a **reason** (mandatory); on submit reassigns; flag → ACTIONED

### 6.6 DISSEMINATE
- [ ] Posts an **ESCALATION_CARD to the Org Feed** (reuses the same flag — no second flag)
- [ ] Optional division tagging works
- [ ] SYSTEM_EVENT "X disseminated this escalation to the Org Feed."; flag → ACTIONED

---

## 7. RBAC matrix — action authority (canActionFlag)

| Viewer | Org flag | Own-div WP/Div flag | Other-div WP/Div flag |
|---|---|---|---|
| Director | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ |
| Manager | ✅ | ✅ | ❌ |
| Group Leader | ❌ | ❌ | ❌ |
| Staff | ❌ | ❌ | ❌ |

- [ ] A cross-division **Manager** sees the card but **no action buttons** (`canAction=false`)
- [ ] GL / Staff see cards on feeds (transparency) but never action buttons
- [ ] The action **endpoint** rejects unauthorized actors even if the UI is bypassed (403/forbidden)

---

## 8. Data integrity / compliance (spot checks)

- [ ] Every flag/action wrote to **both** `AuditLog` **and** a `SYSTEM_EVENT` feed post (dual-write Rule 3)
- [ ] Soft-deleted users/tasks/WPs don't appear in feeds or queues (Rule 2)
- [ ] An actioned/dismissed flag is **not re-actionable** (final state)
- [ ] Card `sourceExcerpt`/deep-links point at the correct origin

---

## 9. Edge cases & error handling

- [ ] Flagging an Org comment via API directly → 400 "cannot be escalated further"
- [ ] Flagging a non-comment post → 400 "Only comments can be escalated"
- [ ] Flagging a non-existent post → 404
- [ ] Concurrent double-flag (two tabs, same comment+target) → one wins, the other gets 409 (not 500)
- [ ] Network/server error during any action → error toast, state unchanged
- [ ] Navigating away mid-load doesn't throw (cancelled-effect guard)

---

## 10. Cross-browser / session

- [ ] Bell badge stays consistent across two tabs after a flag/action
- [ ] Logout clears the badge; login as a different role re-gates correctly
- [ ] Page refresh on `/dashboard/escalations` re-loads the queue correctly

---

### Sign-off

- [ ] All sections above pass
- [ ] No console errors in the browser devtools during the run
- [ ] Backend log shows no unhandled 500s during the run

**Tester:** ___________  **Date:** ___________  **Result:** ☐ Pass ☐ Fail
