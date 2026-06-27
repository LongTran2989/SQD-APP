import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';
import { createMutationRateLimiter } from '../middleware/rateLimit.middleware';
import {
  getTasks,
  getMyTasks,
  getUnassignedTasks,
  getTaskStats,
  getTaskAssignees,
  getTaskOptions,
  getTaskById,
  getRelatedFindings,
  createTask,
  createQuickTask,
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
// Aggregates for the Tasks page (must precede '/:id' to avoid being captured by it).
router.get('/stats', getTaskStats);
router.get('/assignees', getTaskAssignees);
router.get('/options', getTaskOptions);

// ─── Single task ────────────────────────────────────────────────────
router.get('/:id', getTaskById);
router.get('/:id/related-findings', getRelatedFindings);
router.post('/', createTask);
router.post('/quick', createQuickTask);
router.patch('/:id/wp', updateTaskWp);
router.patch('/:id/reopen', requirePrivilege('task:reopen'), reopenTask);

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
// Per-user write limiter on the comment endpoint (mirrors feed.routes); reads
// stay unthrottled. See H3 in FEED_FEATURES_AUDIT.md.
const taskCommentLimiter = createMutationRateLimiter();
router.get('/:id/activity', getTaskActivity);
router.post('/:id/activity', taskCommentLimiter, postTaskComment);

// ─── Time Booking (Phase 5.6) ─────────────────────────────────────────
router.post('/:id/time-booking', createTimeBooking);
router.put('/:id/time-booking', updateTimeBooking);

// ─── Time Entries (Phase 6.1) ─────────────────────────────────────────
router.post('/:id/time-entries', createTimeEntry);
router.get('/:id/time-entries', getTimeEntries);
router.get('/:id/time-entries/summary', getTimeEntrySummary);

export default router;
