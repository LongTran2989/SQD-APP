import { Router } from 'express';
import { getPreview, executeSyncHandler } from '../controllers/googleSheetSync.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege, requireAnyPrivilege } from '../middleware/rbac.middleware';

const router = Router();

router.use(authenticateJWT);

// GET /preview: wp:create gate — fetch, diff, and return the preview.
// POST /execute: requireAnyPrivilege('wp:create', 'wp:edit') — the endpoint performs
// both CREATE (toCreate/collisions) and UPDATE (toUpdate) operations (C5).
router.get('/preview', requirePrivilege('wp:create'), getPreview);
router.post('/execute', requireAnyPrivilege('wp:create', 'wp:edit'), executeSyncHandler);

export default router;
