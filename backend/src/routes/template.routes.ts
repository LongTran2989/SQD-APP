import { Router } from 'express';
import { getTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate } from '../controllers/template.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';

const router = Router();

// Only authenticated users can view templates
router.get('/', authenticateJWT, getTemplates);
router.get('/:id', authenticateJWT, getTemplateById);

// Only Admins, Directors, and Managers can create, update, or delete templates
router.post('/', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), createTemplate);
router.put('/:id', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), updateTemplate);
router.delete('/:id', authenticateJWT, authorizeRoles('Admin', 'Director', 'Manager'), deleteTemplate);

export default router;
