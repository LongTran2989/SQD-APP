import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getSummary, getWorkPackages, getTasks, getFeed, getOngoingWorks } from '../controllers/dashboard.controller';

const router = Router();

// All dashboard routes require authentication
router.use(authenticateJWT);

router.get('/summary', getSummary);
router.get('/work-packages', getWorkPackages);
router.get('/tasks', getTasks);
router.get('/master-calendar', getOngoingWorks);
router.get('/feed', getFeed);

export default router;
