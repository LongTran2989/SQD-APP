import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getFeed, postFeedComment } from '../controllers/feed.controller';
import { flagPost } from '../controllers/escalation.controller';

const router = Router();

// All feed routes require authentication.
router.use(authenticateJWT);

// Escalation: flag a COMMENT. Registered BEFORE the generic /:scope routes so the
// literal "posts" segment is never captured as a :scope param (Express 5).
router.post('/posts/:id/flag', flagPost);

// Reads. ORG is the singleton feed (no scopeId); the others take a polymorphic
// scopeId (taskId / wpId / divisionId). Two explicit routes avoid the Express 5
// optional-param pitfalls.
router.get('/:scope/:scopeId', getFeed);
router.get('/:scope', getFeed); // ORG (scopeId omitted)

// Comment creation, same scopeId handling as reads.
router.post('/:scope/:scopeId/posts', postFeedComment);
router.post('/:scope/posts', postFeedComment); // ORG (scopeId omitted)

export default router;
