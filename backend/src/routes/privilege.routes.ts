import { Router } from 'express';
import { getPrivileges, updatePrivileges } from '../controllers/privilege.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

// Admin-only privilege management panel (Phase 7). The Admin floor in
// privilegeAccess guarantees Admin can never lose access to these endpoints.
router.use(authenticateJWT);
router.get('/', requirePrivilege('settings:privileges'), getPrivileges);
router.put('/', requirePrivilege('settings:privileges'), updatePrivileges);

export default router;
