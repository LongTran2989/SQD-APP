import { Router } from 'express';
import { getSecuritySettings, updateSecuritySettings } from '../controllers/securitySettings.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

// Security policy panel, gated on the dedicated `settings:security` privilege
// (default-granted to Director + Admin, configurable in the privilege matrix).
router.use(authenticateJWT);
router.get('/', requirePrivilege('settings:security'), getSecuritySettings);
router.put('/', requirePrivilege('settings:security'), updateSecuritySettings);

export default router;
