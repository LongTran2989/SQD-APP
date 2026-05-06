import { Router } from 'express';
import { updateUserRole } from '../controllers/user.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';

const router = Router();

// Only Admin can modify user privileges
router.put('/:id/role', authenticateJWT, authorizeRoles('Admin'), updateUserRole);

export default router;
