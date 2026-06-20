import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getPersonnelWorkload, getPersonnelDetail } from '../controllers/workload.controller';

const router = Router();

// All workload routes require authentication
router.use(authenticateJWT);

// ─── Personnel workload + performance ────────────────────────────────
router.get('/personnel', getPersonnelWorkload);
router.get('/personnel/:userId', getPersonnelDetail);

export default router;
