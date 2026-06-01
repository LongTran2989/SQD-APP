# SQD-APP: Business Workflow & Logic Rules

This document outlines the high-level business logic and application workflow for the Aircraft Maintenance Quality Assurance system. For deep technical architecture and schema details, refer to `CLAUDE_HANDOVER.md`.

## 1. Templates & Form Logic
- **JSON Branching:** Templates use a `formSchema` JSON payload to support complex "Google Forms-like" branching logic (e.g., "If 'Damage Found' is 'Yes', show 'Upload Photo' field").
- **Configurability:** The template creator decides two key flags: 
  1. `RequiresApproval`: Does a manager need to review this task before it closes?
  2. `AllowsFindings`: Can the staff member raise a defect/finding while executing this task?
- **Draft Encapsulation:** Draft changes to templates are completely encapsulated from published forms to ensure existing tasks never break during edits.

## 2. Work Packages (WP)
- **Purpose:** A WP is a container grouping related Tasks under a defined timeframe and type (e.g., CHECK, AUDIT, INVESTIGATION).
- **Timeframes & Auto-Generation:** Managers create a WP and assign users. If the type is CHECK, the system can auto-generate a daily task from a base Template for the duration of the WP.
- **Scoping:** Staff members assigned to a WP can create tasks within the WP and assign them to any user in the same Division.

## 3. Task Execution & Assignment
- **Lifecycle:** A task originates from a Template. Tasks can be created explicitly with an assignee, or left Unassigned in a pool for eligible users to click "Perform This Task" (self-serve).
- **Task Data Immutable Snapshot:** When a Task is created, it captures a snapshot of the Template schema. If the Template is deleted or changed, the Task remains completely unaffected.
- **Review Loop:** Completed tasks go to `In Review`. A reviewer (Issuer, Manager, or Director) can Approve (closing it), Reject, or send it back for Follow-up. 
- **Activity Feed:** Every task maintains a chronological, immutable feed (`TaskActivity`) of system events (status changes, deadlines) and human comments.
- **Time Booking:** Once a Task reaches a final state (`Closed`, `Rejected`, or `Terminated`), the assignee can log actual hours worked, including collaborators. A budget-vs-actual comparison is shown when the source Template had an `estimatedHours` value. The booking is revisable by the assignee, Admin, or Director. Each create/update is written to both the `AuditLog` and the Task's `TaskActivity` feed.

## 4. Findings & Corrective Action Loop
- **Raising Findings:** Any user can raise one or more findings from a Task, provided the source template has `allowsFindings = true` and the task is not in a final state (Closed/Terminated/Inactive). A finding requires Event Type, Department, and Description at minimum. Aircraft Registration, Regulatory Reference, and Field Reference are optional.
- **Severity & Review:** A Manager/Director reviews the finding and assigns a severity (`Observation`, `Level 1`, `Level 2`) and a due date. This transitions the finding from `Open` to `In Progress`.
- **Follow-Up Tasks:** The reviewer generates one or more corrective-action Tasks from existing Templates. Each task is created as `Unassigned` and linked to the finding via `parentFindingId`. An Issuer/Manager/Director then assigns them through the standard task assignment flow.
- **Pending Verification Hook:** When every follow-up Task linked to a finding reaches a final state (Closed, Rejected, or Terminated), the finding automatically transitions to `Pending Verification`. This is a best-effort background operation wired into the task review/submission actions.
- **Stage 2 Analysis:** The reporter (or a Manager/Director) fills in analytical fields on the finding: Root Cause, Corrective Action taken, Error Code, Category, and Recurrence flag.
- **Closure:** A Manager/Director signs off and closes the finding from `Pending Verification` → `Closed`.
- **RBAC Visibility:** Director/Admin see all findings system-wide. Managers see findings in their division. Group Leaders and Staff see only findings they raised or are assigned a follow-up task on.
- **Sidebar Badge:** The Findings nav item shows an amber badge with the count of Open + In Progress findings within the viewer's RBAC scope.

## 5. The Immutable Audit Trail
- The `AuditLog` table is the source of truth for compliance. 
- **Rule:** Every critical state change MUST be recorded in the `AuditLog` table. This is separate from the `TaskActivity` feed (which is operational communication). The `AuditLog` is an immutable, system-wide compliance record.

## 6. Data Visibility Rules (RBAC)
- **All users (system-wide transparency):** All authenticated users can view all Work Packages and Tasks across the system, regardless of division or assignment. This supports operational transparency in an aviation maintenance environment where awareness of ongoing work matters for safety.
- **Action rights remain role-scoped:** Viewing is open; acting is restricted. Only the Issuer, Director, and Managers of the same Division can review/approve/reject/reassign Tasks. Only Managers/Directors can assign users to WPs or close them.
- **Staff:** Can self-assign `Unassigned` tasks. Can create Tasks within WPs they are assigned to, and assign those Tasks to any user in the same Division.
- **Group Leaders / Managers:** Have action rights scoped to their Division. Managers can assign tasks and WPs across their entire division.
- **Directors:** Have global action rights across all departments and divisions. They can assign tasks to anyone system-wide and act as reviewers globally.
- **Global Privilege Config:** Granular privilege toggles are configured by Admins to modify standard roles (Phase 7).
