// Single source of truth for the set of terminal ("final") Task statuses.
// A task in one of these states is done: no further data entry, status
// transitions, or WP re-linking is permitted. Re-open (Admin/Director) is the
// sole documented exception and lives in task.controller.reopenTask.
//
// NOTE: This is the authoritative definition. Do NOT redefine it locally in a
// controller. Time booking deliberately uses a *different, broader* eligibility
// set (it also allows "In Review") — that set is named separately in
// timebooking.controller and must not be conflated with this one.
export const FINAL_TASK_STATUSES: string[] = ['Closed', 'Rejected', 'Terminated'];
