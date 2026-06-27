import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { createMutationRateLimiter } from '../middleware/rateLimit.middleware';
import {
  getFeed,
  postFeedComment,
  hidePost,
  unhidePost,
  pinPost,
  unpinPost,
  getPinnedFeed,
} from '../controllers/feed.controller';
import { flagPost } from '../controllers/escalation.controller';

const router = Router();

// All feed routes require authentication.
router.use(authenticateJWT);

// Per-user write limiter shared across this router's mutations (comments + flags).
// Mounted after auth so req.user is populated. Reads are never throttled.
const feedWriteLimiter = createMutationRateLimiter();

// Escalation: flag a COMMENT. Registered BEFORE the generic /:scope routes so the
// literal "posts" segment is never captured as a :scope param (Express 5).
router.post('/posts/:id/flag', feedWriteLimiter, flagPost);

// Moderation (Phase D): hide/unhide (Director/Admin) + pin/unpin (scope-gated).
// Same "literal first segment before /:scope" rule as the flag route.
router.post('/posts/:id/hide', feedWriteLimiter, hidePost);
router.post('/posts/:id/unhide', feedWriteLimiter, unhidePost);
router.post('/posts/:id/pin', feedWriteLimiter, pinPost);
router.post('/posts/:id/unpin', feedWriteLimiter, unpinPost);

// Pinned-posts read. The literal "pinned" prefix is registered BEFORE the generic
// /:scope routes so it is never captured as a :scope param.
router.get('/pinned/:scope/:scopeId', getPinnedFeed);
router.get('/pinned/:scope', getPinnedFeed); // ORG (scopeId omitted)

// Reads. ORG is the singleton feed (no scopeId); the others take a polymorphic
// scopeId (taskId / wpId / divisionId). Two explicit routes avoid the Express 5
// optional-param pitfalls.
router.get('/:scope/:scopeId', getFeed);
router.get('/:scope', getFeed); // ORG (scopeId omitted)

// Comment creation, same scopeId handling as reads.
router.post('/:scope/:scopeId/posts', feedWriteLimiter, postFeedComment);
router.post('/:scope/posts', feedWriteLimiter, postFeedComment); // ORG (scopeId omitted)

export default router;
