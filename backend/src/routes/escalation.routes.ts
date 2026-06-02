import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getEscalations } from '../controllers/escalation.controller';

const router = Router();

// All escalation routes require authentication.
router.use(authenticateJWT);

// The viewer's actionable escalation queue (drives the Header bell badge + list).
router.get('/', getEscalations);

export default router;
