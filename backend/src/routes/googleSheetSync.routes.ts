import { Router } from 'express';
import { getPreview, executeSyncHandler } from '../controllers/googleSheetSync.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

router.use(authenticateJWT);

// Both endpoints reuse wp:create (a Manager/Director/Admin grant). The sync only
// ever creates/reschedules Work Packages, so wp:create is the right gate.
router.get('/preview', requirePrivilege('wp:create'), getPreview);
router.post('/execute', requirePrivilege('wp:create'), executeSyncHandler);

export default router;
