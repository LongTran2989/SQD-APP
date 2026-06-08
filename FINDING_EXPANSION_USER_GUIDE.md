# Finding Expansion — User Guide

> **Who this is for:** everyone who works with Findings in SQD-APP — Staff, Group Leaders, Managers, Admins, Directors.
> **What it covers:** Root Cause Analysis (RCA), Corrective and Preventive Actions (CAPA), cross-finding links, trend alerts, and who can do what at each stage.

---

## 1. What is Finding Expansion?

After a Finding is raised and reviewed, there are three analytical tools you can attach to it:

| Tool | What it is for |
|---|---|
| **Root Cause Analysis (RCA)** | Record a structured investigation — *why* the problem occurred |
| **CAPA (Corrective / Preventive Actions)** | Track what you are doing about it and verify it worked |
| **Finding Links** | Connect this finding to related or duplicate findings for traceability |

On top of these tools, the system automatically watches for **recurring patterns** — if the same type of problem keeps appearing, a warning banner appears on the finding.

---

## 2. The Finding lifecycle (refresher)

```
  Raised  ──►  Open  ──►  In Progress  ──►  Pending Verification  ──►  Closed
                                │
                                └──►  Dismissed  (if raised in error)
```

- **Open → In Progress**: a Manager or Director reviews the finding (sets severity, due date, taxonomy).
- **In Progress → Pending Verification**: triggered **automatically** when all follow-up tasks reach a final state.
- **Pending Verification → Closed**: a Manager or Director closes the finding — but only once the close-gate checks pass (RCA complete, all Corrective CAPAs verified — see §5).
- **Any status → Dismissed**: a Manager or Director dismisses it with a reason. This is permanent.

RCA and CAPA work can happen any time the finding is `In Progress` or `Pending Verification`.

---

## 3. Root Cause Analysis (RCA)

### 3.1 Choosing a method

There are three investigation methods. Choose when you create (or first save) the RCA:

| Method | Best for |
|---|---|
| **FIVE_WHYS** | Drilling into a single cause by asking "why" five times |
| **MEDA** | Aviation industry-standard (Boeing MEDA); structured contributing-factor analysis |
| **OTHER** | Free-text narrative (no structured steps or factors) |

You cannot change the method once why-steps or factors have been saved — start a new investigation or clear the sub-items first.

### 3.2 Creating and editing the RCA header

On the Finding detail page, open the **RCA** panel and fill in:

- **Method** (required, see above)
- **Summary** — a free-text narrative (optional for MEDA/FIVE_WHYS, primary content for OTHER)
- **Cause Code** — select from the Admin-maintained cause code list (required before you can mark the RCA **Complete**)
- **Status** — `Draft` while in progress; `Complete` when the investigation is concluded

> **Important:** An RCA must be `Complete` before the finding can be closed.

### 3.3 5-Whys ladder (FIVE_WHYS method only)

After saving the header with `method = FIVE_WHYS`, a **Why-Steps** section appears.

Each step has:
- **Question** (required) — e.g. "Why did the seal fail?"
- **Answer** (optional) — e.g. "Because it was installed beyond its service life."

Add as many steps as needed. **Saving replaces the entire ladder** — do not leave unsaved steps and navigate away.

### 3.4 Contributing factors (MEDA method only)

After saving the header with `method = MEDA`, a **Contributing Factors** section appears.

Each factor has:
- **Category** (required) — one of 10 Boeing MEDA categories: Information, Ground Support Equipment/Tools/Safety Equipment, Aircraft Design/Configuration/Parts, Job/Task, Knowledge/Skills, Individual Factors, Environment/Facilities, Organizational Factors, Leadership/Supervision, Communication.
- **Detail** (optional) — free-text description
- **Primary factor?** — tick the box for the root cause contributor

Saving replaces the entire factor set.

### 3.5 Who can edit the RCA?

| Who | Can edit? |
|---|---|
| Director | ✅ Always |
| The person who raised the finding | ✅ Always |
| Anyone assigned to a follow-up task on this finding | ✅ |
| Anyone whose task is linked via a CAPA task-link | ✅ |
| Manager | ✅ (global — any finding) |
| Admin | 👁 View only |
| Group Leader / Staff (uninvolved) | 👁 View only |

---

## 4. CAPA — Corrective and Preventive Actions

### 4.1 Corrective vs. Preventive

| Type | Purpose | Blocking closure? |
|---|---|---|
| **CORRECTIVE** | Fix the immediate problem | ✅ Yes — must be Verified before closing |
| **PREVENTIVE** | Stop the problem recurring in future | ❌ No — may stay open; monitored post-closure |

### 4.2 CAPA status flow

```
  Open  ──►  In Progress  ──►  Completed
                                    │
             (CORRECTIVE)           │── verify ──►  Verified
             (PREVENTIVE only)      └── waive  ──►  Waived
```

You advance status (Open → In Progress → Completed) by editing the CAPA. Transitioning to **Verified** or **Waived** requires the dedicated buttons — not the edit form.

### 4.3 Creating a CAPA action

In the **CAPA** panel on the Finding detail page:

1. Click **Add CAPA action**.
2. Choose **Type**: `CORRECTIVE` or `PREVENTIVE`.
3. Write a **Description** (required).
4. Optionally assign an **Owner** (the person responsible) and a **Deadline**.
5. Save.

### 4.4 Linking tasks and work packages to a CAPA

Each CAPA can be linked to one or more Tasks or Work Packages in a specific role:

| Role | Meaning |
|---|---|
| **EXECUTION** | The Task / WP doing the remediation work |
| **EFFECTIVENESS** | The Task / WP that will verify the fix worked |
| **SUPPORTING** | An auxiliary reference (related audit, checklist, etc.) |

To add a link: open the CAPA action, click **Link Task / WP**, pick the role, then search for the Task or Work Package.

> **Why EFFECTIVENESS links matter:** you must have at least one `EFFECTIVENESS`-role link — and that task or WP must be **Closed** — before you can verify the CAPA (§4.5).

### 4.5 Verifying a Corrective CAPA

When the corrective work is done and the effectiveness evidence is in:

1. Confirm at least one **EFFECTIVENESS**-linked Task or Work Package is `Closed`.
2. Click **Verify** on the CAPA action (Managers and Directors only).
3. The CAPA moves to `Verified` and stamps your name and timestamp.

### 4.6 Waiving a Preventive CAPA

If a preventive action is no longer applicable (e.g. superseded by a process change):

1. Click **Waive** on the CAPA action (Managers and Directors only; **Preventive only**).
2. Enter a **waived reason** (required).
3. The CAPA moves to `Waived`.

> Corrective CAPAs can never be waived — they must be verified or the finding cannot close.

### 4.7 Deleting a CAPA action

Managers and Directors can soft-delete a CAPA action (it is removed from the active list but preserved in the compliance audit log). This is permanent from the user's perspective.

### 4.8 Who can create and edit CAPA?

Same access rules as RCA (§3.5). The same people who can edit the RCA can create and update CAPA items.

**Verify, waive, and delete** require Manager or Director role plus the same edit-analysis access.

---

## 5. Closing a Finding — the gate checks

When a Finding reaches `Pending Verification`, a Manager or Director can close it. The system enforces two checks before allowing closure:

| Check | Rule |
|---|---|
| **RCA gate** | If an RCA has been started, it must be in `Complete` status |
| **CAPA gate** | Every **Corrective** CAPA must be `Verified`. Preventive CAPAs are ignored. |

If there is no RCA and no CAPA at all, the finding can close without any expansion checks.

If either check fails, the close button will show the specific reason:
- *"RCA must be marked Complete before closing"*
- *"Corrective action #N must be Verified before closing"*

---

## 6. Finding Links — cross-finding traceability

Finding Links let you connect related findings for auditability. They are **directional**: you create a link from one finding to another.

### 6.1 Link types

| Type | Meaning |
|---|---|
| **DUPLICATE** | This finding is the same event as another |
| **RELATED** | These findings share a common theme or context |
| **CAUSED_BY** | This finding was caused by another finding |

### 6.2 Creating a link (Managers and Directors only)

1. On the Finding detail page, open the **Links** panel.
2. Click **Link to another finding**.
3. Search for the target finding (enter its ID or description).
4. Choose the link type.
5. Save.

Both findings are visible to all authenticated users, so you can link findings across divisions.

### 6.3 Viewing links

The Links panel shows two lists:
- **Outgoing links** — links you created from this finding to others
- **Incoming links** — links other findings have created pointing to this one

Each entry shows the related finding's description, severity, status, and event type.

### 6.4 Removing a link

Only the outgoing links (those you created from this finding) can be removed. Incoming links are managed from the other finding.

---

## 7. Trend / Recurrence alert

The system automatically checks every finding for recurring patterns each time you view it. If a finding matches a known recurring signature, an **amber banner** appears at the top of the detail page.

### What counts as a recurrence?

A finding is flagged as recurring when it shares the same **Department + ATA Chapter + Cause Code** with at least 2 other findings in the last 180 days — and the finding has been raised 3 or more times in total (including itself).

Two signature strengths are shown:

| Strength | What it means |
|---|---|
| **Strong** | Department + ATA + Cause Code + at least one matching Hazard Tag |
| **Partial** | Department + ATA + Cause Code only (no hazard tags on this finding) |

> The recurrence check only works once an RCA has been completed with a **Cause Code**. Findings without a determined cause are not included in the count.

**Why this matters in aviation:** a repeated cause pattern may indicate a systemic issue (training gap, tooling deficiency, process failure) requiring a higher-level response beyond an individual finding.

---

## 8. Quick reference: who can do what

| Action | Staff / GL | Manager | Director |
|---|---|---|---|
| View all findings | ✅ | ✅ | ✅ |
| Raise a finding | ✅ | ✅ | ✅ |
| Review (set severity, due date) | ❌ | ✅ own-div | ✅ all |
| Generate follow-up tasks | ❌ | ✅ own-div | ✅ all |
| Edit RCA / CAPA (if involved*) | ✅ | ✅ | ✅ |
| Edit RCA / CAPA (uninvolved) | ❌ | ✅ | ✅ |
| Verify a Corrective CAPA | ❌ | ✅ | ✅ |
| Waive a Preventive CAPA | ❌ | ✅ | ✅ |
| Delete a CAPA action | ❌ | ✅ | ✅ |
| Create / remove finding links | ❌ | ✅ own-div | ✅ all |
| Dismiss a finding | ❌ | ✅ own-div | ✅ all |
| Close a finding | ❌ | ✅ own-div | ✅ all |
| Manage taxonomy (ATA / cause codes / hazard tags) | ❌ | ❌ | ✅ (+ Admin) |

\* *"Involved"* = you raised the finding, are assigned to one of its follow-up tasks, or are assigned to a task linked via a CAPA task-link.

---

## 9. FAQ / Troubleshooting

**Why can't I close the finding even though all tasks are done?**
The close-gate requires the RCA to be `Complete` and every Corrective CAPA to be `Verified`. Check the RCA status and each CAPA item's status on the detail page.

**Can I change the RCA method after saving?**
Yes — edit the RCA header and change the method. Any previously saved why-steps (for FIVE_WHYS) or factors (for MEDA) remain in the database but are no longer shown or used once you switch method.

**Why does "Pending Verification" happen automatically, but closing requires a manual action?**
The automatic transition happens when the work is evidenced (all follow-up tasks are done). The manual closure is a deliberate sign-off — a Manager or Director must confirm the RCA and CAPAs are satisfactory before the record is sealed.

**I can see a finding from another division. Is that correct?**
Yes. All authenticated users can view all findings. This is intentional — cross-divisional awareness supports safety culture. However, only Managers scoped to that division (and Directors) can take write actions (dismiss, update severity, manage links) on it.

**The trend banner shows "partial" — what does that mean?**
Your finding has a Department + ATA Chapter + Cause Code but no Hazard Tags. The system can still detect a recurrence pattern, but the match is broader (it counts any finding with the same dept+ATA+cause, regardless of hazard tags).

**I waived a Preventive CAPA by mistake. Can I undo it?**
No. Waive is a permanent transition. If you need to reverse it, contact a system administrator who can assist with data correction.
