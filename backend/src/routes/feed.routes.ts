import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  getTaskFeed,
  postTaskComment,
  getWpFeed,
  postWpComment,
  escalatePost
} from '../controllers/feed.controller';

const router = Router();

// All feed routes require authentication.
router.use(authenticateJWT);

// ─── Task Feed ──────────────────────────────────────────────────────
router.get('/task/:taskId', getTaskFeed);
router.post('/task/:taskId', postTaskComment);

// ─── WP Feed ────────────────────────────────────────────────────────
router.get('/wp/:wpId', getWpFeed);
router.post('/wp/:wpId', postWpComment);

// ─── Escalation ─────────────────────────────────────────────────────
router.post('/posts/:postId/escalate', escalatePost);

export default router;
