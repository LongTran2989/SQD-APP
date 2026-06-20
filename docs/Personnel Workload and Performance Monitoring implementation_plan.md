# Personnel Workload and Performance Monitoring

This implementation plan outlines the creation of a dedicated page to monitor personnel workload and historical performance within the SQD-APP. This feature enables managers and directors to assess capacity before assigning new tasks or work packages.

## Goal Description
Build a comprehensive Master-Detail dashboard that aggregates both forward-looking (Workload) and backward-looking (Performance) metrics for users.
- **Workload (Current Capacity)**: Number of active tasks, estimated hours, WPs managed, open CAPAs, active RCAs, and upcoming deadlines.
- **Performance (Historical Evaluation)**: Hours logged, task efficiency, rework/rejection rate, proactivity in raising findings, findings closed, and CAPAs verified.
- **Access Control**: Managers can view users within their division. Directors can view users across all divisions.

## User Review Required
> [!IMPORTANT]
> The data aggregation required for these metrics is extensive. The plan introduces a new backend service that uses Prisma to calculate these metrics per user. Please review the performance implications and the Master-Detail UI layout proposed.

## Proposed Changes

### Backend Changes

#### [NEW] [workload.routes.ts](file:///g:/SQD-APP/backend/src/routes/workload.routes.ts)
- Create a new Express router for workload and performance analytics.
- Define a `GET /api/workload/users` endpoint to fetch aggregated summary metrics for all users visible to the requester (Division for Managers, All for Directors).
- Define a `GET /api/workload/users/:id` endpoint to fetch a detailed breakdown for a specific user.

#### [NEW] [workload.controller.ts](file:///g:/SQD-APP/backend/src/controllers/workload.controller.ts)
- Controller functions to handle HTTP requests, validate access control (checking the requester's role and division vs the target users).

#### [NEW] [workload.service.ts](file:///g:/SQD-APP/backend/src/services/workload.service.ts)
- Service layer utilizing `prisma` to aggregate data.
- **Workload Aggregation Queries**: 
  - `assignedTasks` where status not completed/closed.
  - Sum of `estimatedHours` on active tasks.
  - Active `workPackageAssignments`.
  - Active `ownedCapaActions` and `rcaInvestigations`.
- **Performance Aggregation Queries**:
  - Sum of `sessionHours` from `TimeEntry`.
  - Count of `reportedFindings` and `closedFindings`.
  - Calculation of on-time vs overdue task completions.

### Frontend Changes

#### [NEW] [page.tsx](file:///g:/SQD-APP/frontend/src/app/workload/page.tsx)
- Create the main Workload Monitoring page under `/workload` (or a sub-route like `/analytics/workload`).
- Implement the "Master" view: A Data Table listing users and their high-level summary metrics (e.g., Active Tasks, Est. Hours, Performance Score/Hours Logged).

#### [NEW] [WorkloadDashboard.tsx](file:///g:/SQD-APP/frontend/src/components/workload/WorkloadDashboard.tsx)
- Implement the "Detail" view as a dashboard component (e.g., displayed in a slide-out panel, modal, or dedicated route).
- Contains individual widgets/gauges for:
  - **Task Efficiency Gauge**
  - **Hours Logged Chart**
  - **Findings & CAPA counters**

#### [NEW] [workload.api.ts](file:///g:/SQD-APP/frontend/src/api/workload.api.ts)
- Add frontend API client functions to fetch from `/api/workload/users` and `/api/workload/users/:id`.

## Verification Plan

### Automated Tests
- `npm run test` in backend to ensure the new service queries return expected structures without crashing.
- Add unit tests for `workload.service.ts` mocking the Prisma client to verify aggregation logic.

### Manual Verification
1. Log in as a Manager. Verify only users in the manager's division are visible in the table.
2. Log in as a Director. Verify all users across divisions are visible.
3. Click on a specific user row to open their detailed dashboard.
4. Cross-reference the Active Tasks count and Estimated Hours sum with the user's actual tasks in the standard Task module to ensure accuracy.
