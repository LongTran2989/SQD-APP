// Single source of truth for the Task API contract literals shared with the
// frontend. The frontend mirrors these in frontend/src/constants/taskStatus.ts;
// a guard test (backend/src/__tests__/contractSync.test.ts) fails if the two
// ever drift. THIS is the authority — change it here first, then the mirror.

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

// Terminal ("final") Task statuses. A task in one of these states is done: no
// further data entry, status transitions, or WP re-linking is permitted (the
// Admin/Director re-open is the sole documented exception, in reopenTask).
//
// Kept as string[] so `.includes(task.status: string)` type-checks at the many
// controller call sites. NOTE: Time booking deliberately uses a *different,
// broader* eligibility set (it also allows "In Review") — that set is named
// separately in timebooking.controller and must not be conflated with this one.
export const FINAL_TASK_STATUSES: string[] = ['Closed', 'Rejected', 'Terminated'];

// Statuses in which the assigned user may save TaskData (saveTaskData) or edit
// an attachment caption on their own task (attachmentService.updateCaptionService).
// Single source of truth so the two checks can never drift.
export const TASK_DATA_EDITABLE_STATUSES: string[] = ['Assigned', 'In Progress', 'Follow-up Required'];

// Review decision verbs accepted by PUT /tasks/:id/review.
export const REVIEW_ACTIONS = ['approve', 'reject', 'follow-up'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

// Deadline-extension decision verbs accepted by PUT /tasks/:id/deadline/decide.
export const DEADLINE_DECISIONS = ['approve', 'deny'] as const;
export type DeadlineDecision = (typeof DEADLINE_DECISIONS)[number];
