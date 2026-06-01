import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  createFinding,
  listFindings,
  getFindingById,
  reviewFinding,
  generateFollowUpTasks,
  completeStage2,
  closeFinding
} from '../controllers/finding.controller';

const router = Router();

// All finding routes require authentication
router.use(authenticateJWT);

// ─── List + create ──────────────────────────────────────────────────
router.get('/', listFindings);
router.post('/', createFinding);

// ─── Single finding ─────────────────────────────────────────────────
router.get('/:id', getFindingById);

// ─── Review workflow ─────────────────────────────────────────────────
router.put('/:id/review', reviewFinding);
router.post('/:id/tasks', generateFollowUpTasks);

// ─── Two-stage closure ───────────────────────────────────────────────
router.put('/:id/stage2', completeStage2);
router.put('/:id/close', closeFinding);

export default router;
