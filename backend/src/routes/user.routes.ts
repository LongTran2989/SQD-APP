import { Router } from 'express';
import { updateUserRole, updateMyPreferences } from '../controllers/user.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';

const router = Router();

// Self-service UI preferences (any authenticated user, own record only)
router.patch('/me/preferences', authenticateJWT, updateMyPreferences);

// Only Admin can modify user privileges
router.put('/:id/role', authenticateJWT, authorizeRoles('Admin'), updateUserRole);

export default router;
