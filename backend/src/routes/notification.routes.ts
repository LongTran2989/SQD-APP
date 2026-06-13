import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from '../controllers/notification.controller';

const router = Router();

// All notification routes require authentication and are scoped to the caller.
router.use(authenticateJWT);

router.get('/', listNotifications);
router.get('/unread-count', getUnreadCount);
router.patch('/:id/read', markRead);
router.post('/read-all', markAllRead);

export default router;
