import { Router } from 'express';
import {
  listWpBlueprints,
  getWpBlueprintById,
  createWpBlueprint,
  updateWpBlueprint,
  disableWpBlueprint,
  launchBlueprint,
} from '../controllers/wpBlueprint.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

router.use(authenticateJWT);

// Listing + detail are open to any authenticated user (transparency model).
router.get('/', listWpBlueprints);
router.get('/:id', getWpBlueprintById);

// Mutations + launch reuse wp:create; division-scope is enforced in the controller.
router.post('/', requirePrivilege('wp:create'), createWpBlueprint);
router.put('/:id', requirePrivilege('wp:create'), updateWpBlueprint);
router.delete('/:id', requirePrivilege('wp:create'), disableWpBlueprint);
router.post('/:id/launch', requirePrivilege('wp:create'), launchBlueprint);

export default router;
