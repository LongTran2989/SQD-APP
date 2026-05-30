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

## 4. Findings & Corrective Action Loop
- **Raising Findings:** Staff can raise multiple findings from a single Task. A finding requires key information (e.g., Event Type, Aircraft Registration, Dept).
- **Severity & Review:** A Manager/Director reviews the finding and assigns a severity (Observation, Level 1, Level 2).
- **Follow-Up Tasks:** The reviewer generates Corrective Action follow-up Tasks linked to the finding. 
- **Closure:** Once all follow-up Tasks close, the finding moves to `Pending Verification`. The original reporter then completes analytical fields (Root Cause, Corrective Action taken) before final sign-off.

## 5. The Immutable Audit Trail
- The `AuditLog` table is the source of truth for compliance. 
- **Rule:** Every critical state change MUST be recorded in the `AuditLog` table. This is separate from the `TaskActivity` feed (which is operational communication). The `AuditLog` is an immutable, system-wide compliance record.

## 6. Data Visibility Rules (RBAC)
- **Staff:** Can view Tasks and Findings where they are the assignee or issuer.
- **Group Leaders / Managers:** Have visibility over records scoped to their specific Division. Managers can assign tasks and WPs across their entire division.
- **Directors:** Have global read access across all departments and divisions. They can assign tasks to anyone system-wide and act as reviewers globally.
- **Global Privilege Config:** Granular privilege toggles are configured by Admins to modify standard roles.
