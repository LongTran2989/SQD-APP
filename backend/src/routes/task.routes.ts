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

// Per-user write limiter shared across the state-changing task endpoints (create,
// assign, save-data, submit, review, lifecycle, deadline, rate). Keyed on userId;
// auto-disabled under test / DISABLE_RATE_LIMIT. Reads stay unthrottled. The
// activity-comment route keeps its own bucket so commenting never starves actions.
const taskMutationLimiter = createMutationRateLimiter();

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
router.post('/', taskMutationLimiter, createTask);
router.post('/quick', taskMutationLimiter, createQuickTask);
router.patch('/:id/wp', taskMutationLimiter, updateTaskWp);
router.patch('/:id/reopen', taskMutationLimiter, requirePrivilege('task:reopen'), reopenTask);

// ─── Assignment ─────────────────────────────────────────────────────
router.put('/:id/assign', taskMutationLimiter, assignTask);
router.put('/:id/self-assign', taskMutationLimiter, selfAssignTask);
router.put('/:id/reassign', taskMutationLimiter, reassignTask);
router.put('/:id/transfer-issuer', taskMutationLimiter, transferIssuerRights);

// ─── Task execution ─────────────────────────────────────────────────
router.put('/:id/data', taskMutationLimiter, saveTaskData);
router.put('/:id/submit', taskMutationLimiter, submitTask);

// ─── Review workflow ─────────────────────────────────────────────────
router.put('/:id/review', taskMutationLimiter, reviewTask);
router.put('/:id/post-rejection', taskMutationLimiter, postRejectionAction);

// ─── Lifecycle management ────────────────────────────────────────────
router.put('/:id/inactive', taskMutationLimiter, inactivateTask);
router.put('/:id/reactivate', taskMutationLimiter, reactivateTask);

// ─── Deadline management ─────────────────────────────────────────────
router.put('/:id/deadline', taskMutationLimiter, setDeadline);
router.put('/:id/deadline/request', taskMutationLimiter, requestDeadlineExtension);
router.put('/:id/deadline/decide', taskMutationLimiter, decideDeadlineExtension);

// ─── Rating ──────────────────────────────────────────────────────────
router.put('/:id/rate', taskMutationLimiter, rateTask);

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
