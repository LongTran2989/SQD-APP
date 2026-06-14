import { TaskStatus } from '../types';

// Canonical terminal ("final") Task statuses. Mirrors the backend authority
// (backend/src/constants/taskStatus.ts) — a task in one of these states is done:
// no further data entry, status transitions, or re-linking. Centralised here so
// every component gates on the same list and a backend change is a single edit.
export const FINAL_TASK_STATUSES: TaskStatus[] = ['Closed', 'Rejected', 'Terminated'];
