import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getEscalations, actionEscalation } from '../controllers/escalation.controller';

const router = Router();

// All escalation routes require authentication.
router.use(authenticateJWT);

// The viewer's actionable escalation queue (drives the Header bell badge + list).
router.get('/', getEscalations);

// Action a PENDING flag (acknowledge / dismiss / raise-finding / create-task /
// reassign / disseminate). Explicit numeric :id + literal "action" — no Express-5
// optional-param issue.
router.post('/:id/action', actionEscalation);

export default router;
