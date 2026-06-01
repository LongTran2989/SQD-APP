import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  getTaskFeed,
  postTaskComment,
  getWpFeed,
  postWpComment,
  escalatePost,
  getDivisionFeed,
  postDivisionMessage,
  getOrgFeed,
  postOrgMessage,
  getPendingFlags,
  actOnFlag
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

// ─── Division Board ─────────────────────────────────────────────────
router.get('/division/:divisionId', getDivisionFeed);
router.post('/division/:divisionId', postDivisionMessage);

// ─── Org Feed ───────────────────────────────────────────────────────
router.get('/org', getOrgFeed);
router.post('/org', postOrgMessage);

// ─── Flag Actions ───────────────────────────────────────────────────
router.put('/flags/:flagId/action', actOnFlag);
router.get('/flags/pending', getPendingFlags);

export default router;
