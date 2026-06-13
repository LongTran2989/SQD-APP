import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getTimeBookingAnalytics, getFindingsAnalytics } from '../controllers/analytics.controller';

const router = Router();

// All analytics routes require authentication
router.use(authenticateJWT);

// ─── Time-booking analytics ──────────────────────────────────────────
router.get('/time-booking', getTimeBookingAnalytics);

// ─── Findings analytics ──────────────────────────────────────────────
router.get('/findings', getFindingsAnalytics);

export default router;
