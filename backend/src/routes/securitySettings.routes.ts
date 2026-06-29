import { Router } from 'express';
import { getSecuritySettings, updateSecuritySettings } from '../controllers/securitySettings.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

// Admin-only security policy panel. Gated on `settings:privileges` (in the Admin
// floor, so Admin can never be locked out), consistent with the privilege panel.
router.use(authenticateJWT);
router.get('/', requirePrivilege('settings:privileges'), getSecuritySettings);
router.put('/', requirePrivilege('settings:privileges'), updateSecuritySettings);

export default router;
