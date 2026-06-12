import { Router } from 'express';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  publishTemplate,
  transferOwnership,
  deleteTemplate,
  archiveTemplate,
  unarchiveTemplate
} from '../controllers/template.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

// All authenticated users can view templates
router.get('/', authenticateJWT, getTemplates);
router.get('/:id', authenticateJWT, getTemplateById);

// Create / edit / delete — privilege-gated (Phase 7)
router.post('/', authenticateJWT, requirePrivilege('template:create'), createTemplate);
router.put('/:id', authenticateJWT, requirePrivilege('template:edit'), updateTemplate);
router.delete('/:id', authenticateJWT, requirePrivilege('template:delete'), deleteTemplate);

// Publish (archive + revision bump)
router.post('/:id/publish', authenticateJWT, requirePrivilege('template:publish'), publishTemplate);

// Archive
router.patch('/:id/archive', authenticateJWT, requirePrivilege('template:archive'), archiveTemplate);

// Unarchive
router.patch('/:id/unarchive', authenticateJWT, requirePrivilege('template:unarchive'), unarchiveTemplate);

// Ownership transfer
router.post('/:id/transfer', authenticateJWT, requirePrivilege('template:transfer'), transferOwnership);

export default router;
