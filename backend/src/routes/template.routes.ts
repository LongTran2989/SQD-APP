import { Router } from 'express';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  publishTemplate,
  transferOwnership,
  deleteTemplate,
  archiveTemplate
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

// Archive
router.patch('/:id/archive', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), archiveTemplate);

// Ownership transfer
router.post('/:id/transfer', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), transferOwnership);

export default router;
