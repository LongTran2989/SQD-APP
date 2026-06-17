import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getSummary, getWorkPackages, getFeed } from '../controllers/dashboard.controller';

const router = Router();

// All dashboard routes require authentication
router.use(authenticateJWT);

router.get('/summary', getSummary);
router.get('/work-packages', getWorkPackages);
router.get('/feed', getFeed);

export default router;
