# SQD-APP: Business Workflow & Logic Rules

This document outlines the core business logic, application workflow, and Data Visibility (RBAC) rules for the Aircraft Maintenance Quality Assurance system. 

It is critical that the backend APIs enforce these rules exactly as described.

## 1. Templates & Form Logic
- **JSON Branching:** Templates use a `formSchema` JSON payload to support complex "Google Forms-like" branching logic (e.g., "If 'Damage Found' is 'Yes', show 'Upload Photo' field").
- **Configurability:** The template creator decides two key flags: 
  1. `RequiresApproval`: Does a manager need to review this task before it closes?
  2. `AllowsFindings`: Can the staff member raise a defect/finding while executing this task?

## 2. Task Assignment & Transfer
- **Hierarchical Assignment:** A Director can assign a task to a generic Division (e.g., "Base Maintenance"). The Manager of that division then re-assigns it to a specific Staff member.
- **Task Transfer:** A Manager can transfer an active task from one Staff member to another.
- **Action Comments:** Whenever a task is assigned, transferred, or rejected, the user has the option to provide a **Comment** explaining their reasoning (e.g., "Transferring because John is on sick leave"). This comment MUST be saved in the `AuditLog`.
- **Target Tracking:** Tasks must track the `TargetDivisionID` (the division actually being audited) to generate metrics on which departments have the highest error rates.

## 3. The Findings & Follow-Up Loop
- **Raising Findings:** Staff can raise multiple findings from a single Task. Findings must be classified by Severity (Low, Medium, High, Critical) and Category (Safety, Documentation, Tools).
- **Standalone Findings:** A user can also log into the system and raise a finding independently, without a source task.
- **Follow-Up Actions (CARs):** Anyone (including the Staff member who found it) can trigger a "Follow-Up Action" from a Finding. This generates a new Task (e.g., a Corrective Action Report) linked to the `ParentFindingID`.
- **Constraint:** Findings CANNOT be raised from other findings. They can only be raised from Tasks or created from scratch.

## 4. The Immutable Audit Trail
- The `AuditLog` table is the source of truth for compliance. 
- **Rule:** Every critical state change MUST be recorded in the `AuditLog` table. This includes:
  - Task Creation / Assignment
  - Task Reassignment / Transfer (must include the reason in the `Comment` or `Details` field)
  - Task Submission
  - Task Approval / Rejection (rejections usually have a comment)
  - Finding Raised
  - Follow-up Created
- Logs must contain the exact timestamp and the `performedByUserId`.

## 5. Data Visibility Rules (RBAC)
When building backend queries (GET requests), the system must automatically enforce these filters:
- **Staff:** Can only view Tasks, Findings, and Follow-Ups where they are explicitly listed as the `AssignedTo` or `ReportedBy` user.
- **Managers & Group Leaders:** Can view all records associated with their specific `DivisionID` (either as the assigned division or the target division).
- **Directors:** Have global read access. They can view all records across all departments and divisions for high-level reporting and surveillance.
