import { Router } from 'express';
import {
  listTemplateSets,
  getTemplateSetById,
  createTemplateSet,
  updateTemplateSet,
  disableTemplateSet,
} from '../controllers/templateSet.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

router.use(authenticateJWT);

// Listing + detail are open to any authenticated user (transparency model).
router.get('/', listTemplateSets);
router.get('/:id', getTemplateSetById);

// Mutations reuse wp:create; division-scope is further enforced in the controller.
router.post('/', requirePrivilege('wp:create'), createTemplateSet);
router.put('/:id', requirePrivilege('wp:create'), updateTemplateSet);
router.delete('/:id', requirePrivilege('wp:create'), disableTemplateSet);

export default router;
