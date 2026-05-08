import { Router } from 'express';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  publishTemplate,
  lockTemplate,
  unlockTemplate,
  deleteTemplate
} from '../controllers/template.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';

const router = Router();

// All authenticated users can view templates
router.get('/', authenticateJWT, getTemplates);
router.get('/:id', authenticateJWT, getTemplateById);

// Only Admins, Directors, and Managers can create, update, delete, publish
router.post('/', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), createTemplate);
router.put('/:id', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), updateTemplate);
router.delete('/:id', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), deleteTemplate);

// Publish (archive + revision bump)
router.post('/:id/publish', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), publishTemplate);

// Pessimistic locking
router.post('/:id/lock', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), lockTemplate);
router.post('/:id/unlock', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), unlockTemplate);

export default router;
