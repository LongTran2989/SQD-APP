// Frontend MIRROR of the backend Task API contract literals
// (backend/src/constants/taskStatus.ts is the authority). A backend guard test
// (backend/src/__tests__/contractSync.test.ts) fails if these drift, so update
// this file whenever the backend authority changes. Keep values and order identical.

// All Task statuses, in lifecycle order.
export const TASK_STATUSES = [
  'Unassigned',
  'Assigned',
  'In Progress',
  'In Review',
  'Follow-up Required',
  'Closed',
  'Rejected',
  'Terminated',
  'Inactive',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Terminal ("final") Task statuses — a task here is done (Admin re-open aside).
export const FINAL_TASK_STATUSES: TaskStatus[] = ['Closed', 'Rejected', 'Terminated'];

// Review decision verbs accepted by PUT /tasks/:id/review.
export const REVIEW_ACTIONS = ['approve', 'reject', 'follow-up'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

// Deadline-extension decision verbs accepted by PUT /tasks/:id/deadline/decide.
export const DEADLINE_DECISIONS = ['approve', 'deny'] as const;
export type DeadlineDecision = (typeof DEADLINE_DECISIONS)[number];
