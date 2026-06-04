# Feed & Escalation — User Guide

> **Who this is for:** everyone who uses SQD-APP — Staff, Group Leaders, Managers, Admins, Directors.
> **What it covers:** how to read feeds, post comments, flag a concern (escalate), and — for Managers and above — how to action the escalations that reach you.

---

## 1. What are Feeds?

A **Feed** is a running conversation + event log. SQD-APP has **four feed levels**, from narrowest to widest:

| Feed | Where you find it | What it's for |
|---|---|---|
| **Task feed** | On any task's detail page | Discussion + system events about that one task |
| **Work Package feed** | On any work package's detail page | Discussion across all tasks in that WP |
| **Division Board** | Sidebar → *Division Board* | Division-wide discussion and notices |
| **Org Feed** | Sidebar → *Org Feed* | Organisation-wide announcements |

Each feed mixes three kinds of entries:
- 💬 **Comments** — written by people
- ⚙️ **System events** — automatic notes (status changes, "X escalated this comment…")
- 🚩 **Escalation / Info cards** — generated when someone raises a concern (see §4)

> **Everyone can read every feed.** This is deliberate — in aviation maintenance, awareness of ongoing work matters for safety. *Posting* and *actioning*, however, follow role rules (below).

---

## 2. Reading a feed

1. Open the relevant page (task, work package, Division Board, or Org Feed).
2. The newest entries are at the bottom; the feed scrolls there automatically.
3. Your own comments appear on the right (blue); others' on the left (grey).

**Division Board tip:** you land on your own division by default. Directors and Admins get a dropdown to switch to any division.

---

## 3. Posting a comment

If you're allowed to post, a text box appears at the bottom of the feed.

1. Type your message.
2. Click **Send** — or press **Ctrl + Enter** (Cmd + Enter on Mac).

**Who can post where:**

| Feed | Who can post |
|---|---|
| Task / Work Package | Everyone |
| Division Board | Anyone in **that** division (Directors/Admins: any division) |
| Org Feed | Directors, Admins, Managers only |

If you don't see a text box, you don't have posting rights on that feed — but you can still read it and flag comments.

---

## 4. Flagging a comment (raising an escalation)

If a comment raises a concern that a **higher level** should see, you can **flag** it. Anyone can flag.

### How to flag

1. Find the comment.
2. Click the small **🚩 flag icon** next to it.
3. Pick where to send it ("Escalate to …"). You can only escalate **upward**:
   - A **Work Package** comment → Division Board or Org Feed
   - A **Division** comment → Org Feed
   - A **Task** comment → its WP, Division, or Org Feed
   - **Org Feed comments cannot be flagged** — it's already the top level, so there's no flag icon there. *(This is normal, not a bug.)*
4. You'll see a confirmation, and the flagged target gets a green checkmark ✓.

### What happens when you flag

- An **Escalation Card** appears on the feed you sent it to.
- If your flag "skips" a level, an **Info Card** is left on each skipped level — so no level is blind to a concern that passed it by. *(Example: flagging a Task comment all the way to Org leaves info cards on the WP feed and the Division Board.)*
- Cards show only a **short excerpt** of the comment plus a **"View source"** link back to the original — never a full copy.

### One flag per concern

- You **can't** flag the same comment to the **same** place twice while it's still pending — you'll see *"already pending for this comment."* The flag icon also shows that target as already done (✓).
- You **can** flag the same comment to a **different** place.
- Once a flag has been actioned or dismissed, you may flag that comment again if a new concern arises.

---

## 5. The bell 🔔 — your escalation queue (Managers, Admins, Directors)

If you're a **Manager, Admin, or Director**, the bell in the top bar shows how many escalations are **waiting for you to act on**:

- **Director / Admin** — see **all** pending escalations.
- **Manager** — see all **Org-level** escalations **plus** Work-Package / Division escalations **in your own division**.
- **Group Leaders & Staff** have no action queue, so they see **no bell count** and no Escalations page. (They still see the cards on the feeds.)

The count updates **immediately** when a flag is raised or actioned — you don't have to refresh.

Click the bell → it opens the **Escalations** page (also in the Sidebar).

---

## 6. Actioning an escalation (Managers, Admins, Directors)

Open the **Escalations** page (Sidebar → *Escalations*, or click the bell). Each pending item shows the excerpt, where it came from, who flagged it, and when.

You can act in one of six ways. Each action is permanent (the escalation then leaves your queue):

| Action | What it does |
|---|---|
| **Acknowledge** | "Seen and noted." Marks it handled, no further object created. |
| **Dismiss** | Closes it as not requiring action. |
| **Raise Finding** | Opens a Finding from the source. *Only available when the escalation came from a **task** comment whose template allows findings.* |
| **Create Task** | Spins up a new task (you pick the template, assignee, deadline, etc.). |
| **Reassign Task** | Reassigns the source task to someone else (a reason is required). *Only when the escalation has a source task.* |
| **Disseminate** | Pushes the escalation card out to the **Org Feed** for organisation-wide visibility (you can tag specific divisions). |

After you act:
- The card's status badge flips from **Pending** (amber) to **Actioned** (green) or **Dismissed** (grey).
- The item disappears from your Escalations page and the bell count drops.
- A system event is recorded on the feed, and the action is written to the compliance audit log.

> You can also action an escalation **directly from its card** on a feed — the same buttons appear there when you have the rights.

---

## 7. Quick reference: what each role can do

| | Read feeds | Comment | Flag a comment | Action escalations |
|---|---|---|---|---|
| **Staff** | ✅ all | Task/WP; own-division board | ✅ | ❌ |
| **Group Leader** | ✅ all | Task/WP; own-division board | ✅ | ❌ |
| **Manager** | ✅ all | + Org Feed | ✅ | ✅ own-division WP/Div + all Org |
| **Admin** | ✅ all | + Org Feed | ✅ | ✅ all |
| **Director** | ✅ all | + Org Feed | ✅ | ✅ all |

---

## 8. FAQ / Troubleshooting

**Why is there no flag icon on the Org Feed?**
The Org Feed is the top level — there's nowhere higher to escalate to. By design.

**I flagged a comment but the bell didn't change.**
The bell only shows a count for Managers, Admins, and Directors. If you're one of those and still see nothing, make sure you flagged from a feed that *has* a flag icon (the Org Feed doesn't), and that the target is one you're allowed to action (a Manager won't see another division's WP/Division flags).

**I tried to flag the same comment again and got an error.**
That comment already has a pending escalation to that target. Wait for it to be actioned/dismissed, or flag it to a different level.

**I'm a Manager but I can't see the action buttons on a card.**
You can only action escalations in your own division (plus all Org-level ones). A card from another division will show to you (transparency) but without buttons.

**Can I undo an action?**
No. Acknowledge / Dismiss / etc. are final for that flag. If a new concern arises, flag the comment again to open a fresh escalation.
