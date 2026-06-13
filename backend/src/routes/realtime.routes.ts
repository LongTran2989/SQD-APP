import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { streamEvents } from '../controllers/realtime.controller';

const router = Router();

// EventSource cannot set custom headers but DOES send the httpOnly auth cookie
// (CORS is configured credentials:true), so the standard JWT middleware applies.
router.get('/stream', authenticateJWT, streamEvents);

export default router;
