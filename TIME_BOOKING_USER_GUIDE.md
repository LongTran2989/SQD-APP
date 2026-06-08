# Time Booking — User Guide

> **Who this is for:** Task assignees (Staff, Group Leaders, Managers) who need to log hours after completing a task, and Managers/Directors who use the Analytics page to track efficiency.
> **What it covers:** logging time, collaborators, over-budget reasons, viewing your booking on the task detail page, and using the Analytics dashboard.

---

## 1. What is Time Booking?

When a task reaches a final state — **Closed**, **Rejected**, or **Terminated** — the system requires the assignee to log the actual hours spent before a star rating can be submitted.

Time Booking captures:
- Hours logged by the **assignee**
- Hours logged by **collaborators** (other people who contributed)
- An optional note on each entry
- An **over-budget reason** when hours significantly exceed the estimate (see §3)

Every submission is stored permanently in an append-only audit trail, so managers always have a full history of how time was recorded.

---

## 2. Logging a time booking

### 2.1 When does it appear?

The Time Booking panel appears on the task detail page once the task is in a final state (Closed, Rejected, or Terminated). If you have not yet submitted a booking, an amber warning banner will be shown at the top of the task.

### 2.2 Submitting your booking

1. Open the task detail page.
2. Scroll to the **Time Booking** section.
3. Enter your **hours logged** (required — must be greater than zero).
4. Add an optional **note** about your work.
5. If others contributed, click **Add collaborator** (see §2.3).
6. Click **Submit**.

The panel will show a summary once submitted — actual hours, estimated hours (if the template has one), and a coloured badge indicating whether you were over or under budget.

### 2.3 Adding collaborators

Collaborators are other users who worked on the task alongside you. To add one:

1. Click **Add collaborator**.
2. Select the user from the dropdown.
3. Enter their hours.
4. Add an optional note.

> You cannot add yourself as a collaborator. Each collaborator can only appear once per submission.

### 2.4 Editing an existing booking

The assignee, an Admin, or a Director can update a booking after submission:

1. Click **Edit** on the Time Booking panel.
2. Update any fields.
3. Click **Save changes**.

Each update creates a new entry in the audit trail — the history is never overwritten.

---

## 3. Over-budget reasons

If total hours exceed **120% of the template's estimated hours**, you must select a reason before you can submit:

| Reason | When to use |
|---|---|
| **Complex task** | The scope or technical difficulty was greater than expected |
| **Wait time needed** | Delays outside your control (parts, approvals, access) added time |
| **Additional work found** | Undiscovered issues required extra work during the task |
| **Other** | None of the above — you must describe the reason in the notes field |

> The "Other" option requires a non-empty explanation in the notes field.

**Why is this enforced?** Over-budget patterns help managers identify templates with consistently low estimates, systemic process issues, or recurring delays — improving planning accuracy over time.

---

## 4. What the budget badge means

Once a time booking is submitted, a badge shows how actual hours compared to the estimate:

| Badge | Meaning |
|---|---|
| **Green** (e.g. `−0.5h under`) | Actual hours were at or below the estimate |
| **Red** (e.g. `+2.0h over`) | Actual hours exceeded the estimate |

If the task's source template had no estimated hours set, the badge is not shown (there is no baseline to compare against).

---

## 5. Rating a task (why booking comes first)

The star-rating widget is locked until a time booking has been submitted. This ensures that every rated task has associated time data, which makes the analytics meaningful.

Once you submit a booking, the rating widget becomes available immediately.

---

## 6. Analytics (Managers, Directors, Admins only)

Managers, Directors, and Admins can view the **Analytics** page from the sidebar (`BarChart2` icon). It shows two sections:

### 6.1 Template Efficiency

A table showing, for each task template that has been used:

| Column | What it shows |
|---|---|
| **Template ID** | The short code for the template (e.g. `QA-T001`) |
| **Title** | The template's display name |
| **Tasks** | Number of completed tasks (Closed / Rejected / Terminated) |
| **Avg Actual** | Average actual hours across all tasks with a time booking |
| **Avg Estimated** | The template's current estimated hours setting |
| **Efficiency** | Ratio of actual ÷ estimated: `1.00×` means on-budget; below is under; above is over |
| **Over-Budget** | Count of tasks that exceeded 120% of the estimate |
| **Top Reason** | Most-cited over-budget reason across those tasks |

The efficiency badge is green when ≤ 1.0× and red when > 1.0×.

> **Note:** The Avg Estimated column shows the template's **current** estimated hours setting. If the estimate was recently updated, this baseline applies to all historical rows — that is intentional.

### 6.2 Staff Performance

A table showing, for each staff member who has had tasks rated:

| Column | What it shows |
|---|---|
| **Name** | Staff member's display name |
| **Avg Rating** | Average star rating across all their rated tasks |
| **Tasks Rated** | Number of tasks where a rating was given |
| **Avg Efficiency** | Average actual÷estimated ratio across their tasks |

Staff are sorted by average rating (highest first).

### 6.3 Incomplete Bookings notice

An amber banner at the top of the Analytics page shows the count of **Closed tasks with no time booking** in your scope. These tasks are excluded from efficiency calculations.

If you see a high number here, follow up with assignees who have not yet submitted their bookings.

### 6.4 Scope and filters

- **Managers** see only tasks in their own division — no filter needed.
- **Directors and Admins** see the whole system by default. You can narrow by division using the `divisionId` query parameter, and filter by date range using `from` and `to` (ISO date strings applied to the task's completion date).

---

## 7. FAQ / Troubleshooting

**Why can't I submit a rating?**
A time booking must be submitted first. Scroll to the Time Booking section on the task detail page and complete it.

**I submitted the wrong hours. Can I fix it?**
Yes — click **Edit** on the Time Booking panel. The original entry is preserved in the audit log; your correction is recorded as a new entry.

**I can't see the Analytics page in the sidebar.**
Analytics is only visible to Managers, Directors, and Admins. If you are a Staff member or Group Leader, this page is not available to you.

**The Efficiency column shows "N/A" for some templates.**
This means either no tasks with a time booking exist for that template, or the template has no `estimatedHours` set. Both components (actual hours and an estimate) are required to compute a ratio.

**What does the `incompleteBookings` count include?**
It counts `Closed` tasks (not Rejected or Terminated) that have no time booking. It is scoped to your division (for Managers) or system-wide (for Directors/Admins). It does not filter by any template selection.

**A task I know is closed isn't showing in the analytics.**
Check whether a time booking has been submitted. Tasks without a booking are excluded from all efficiency calculations (though they do appear in the Incomplete Bookings count).
