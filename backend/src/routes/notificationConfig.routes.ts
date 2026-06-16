import { Router } from 'express';
import {
  getNotificationConfig,
  updateNotificationConfig,
} from '../controllers/notificationConfig.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

// Admin/Director notification configuration panel. Guarded by the
// settings:notifications privilege (granted to Admin + Director by default).
router.use(authenticateJWT);
router.get('/', requirePrivilege('settings:notifications'), getNotificationConfig);
router.put('/:eventKey', requirePrivilege('settings:notifications'), updateNotificationConfig);

export default router;
