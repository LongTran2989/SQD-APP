import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';
import {
  getTasks,
  getMyTasks,
  getUnassignedTasks,
  getTaskById,
  createTask,
  updateTaskWp,
  reopenTask,
  assignTask,
  selfAssignTask,
  saveTaskData,
  submitTask,
  reviewTask,
  postRejectionAction,
  reassignTask,
  transferIssuerRights,
  inactivateTask,
  reactivateTask,
  setDeadline,
  requestDeadlineExtension,
  decideDeadlineExtension,
  rateTask,
  getTaskActivity,
  postTaskComment
} from '../controllers/task.controller';
import { createTimeBooking, updateTimeBooking, createTimeEntry, getTimeEntries, getTimeEntrySummary } from '../controllers/timebooking.controller';

const router = Router();

// All task routes require authentication
router.use(authenticateJWT);

// ─── List endpoints ─────────────────────────────────────────────────
router.get('/', getTasks);
router.get('/my-tasks', getMyTasks);
router.get('/unassigned', getUnassignedTasks);

// ─── Single task ────────────────────────────────────────────────────
router.get('/:id', getTaskById);
router.post('/', createTask);
router.patch('/:id/wp', updateTaskWp);
router.patch('/:id/reopen', authorizeRoles('Admin', 'Director'), reopenTask);

// ─── Assignment ─────────────────────────────────────────────────────
router.put('/:id/assign', assignTask);
router.put('/:id/self-assign', selfAssignTask);
router.put('/:id/reassign', reassignTask);
router.put('/:id/transfer-issuer', transferIssuerRights);

// ─── Task execution ─────────────────────────────────────────────────
router.put('/:id/data', saveTaskData);
router.put('/:id/submit', submitTask);

// ─── Review workflow ─────────────────────────────────────────────────
router.put('/:id/review', reviewTask);
router.put('/:id/post-rejection', postRejectionAction);

// ─── Lifecycle management ────────────────────────────────────────────
router.put('/:id/inactive', inactivateTask);
router.put('/:id/reactivate', reactivateTask);

// ─── Deadline management ─────────────────────────────────────────────
router.put('/:id/deadline', setDeadline);
router.put('/:id/deadline/request', requestDeadlineExtension);
router.put('/:id/deadline/decide', decideDeadlineExtension);

// ─── Rating ──────────────────────────────────────────────────────────
router.put('/:id/rate', rateTask);

// ─── Activity feed (Phase 5.3 endpoints included here per plan) ──────
router.get('/:id/activity', getTaskActivity);
router.post('/:id/activity', postTaskComment);

// ─── Time Booking (Phase 5.6) ─────────────────────────────────────────
router.post('/:id/time-booking', createTimeBooking);
router.put('/:id/time-booking', updateTimeBooking);

// ─── Time Entries (Phase 6.1) ─────────────────────────────────────────
router.post('/:id/time-entries', createTimeEntry);
router.get('/:id/time-entries', getTimeEntries);
router.get('/:id/time-entries/summary', getTimeEntrySummary);

export default router;
