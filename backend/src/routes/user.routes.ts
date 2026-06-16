import { Router } from 'express';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  changePassword,
  adminResetPassword,
  updateUserRole,
  updateMyPreferences,
  updateMyProfile,
} from '../controllers/user.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege, requireAnyPrivilege } from '../middleware/rbac.middleware';

const router = Router();

// Self-service routes (any authenticated user, own record only)
router.patch('/me/profile', authenticateJWT, updateMyProfile);
router.patch('/me/preferences', authenticateJWT, updateMyPreferences);
router.patch('/me/password', authenticateJWT, changePassword);

// Admin: list and manage users.
// Listing is reachable by either user privilege; the route guard enforces this
// (defence in depth) and the controller repeats the check.
router.get('/', authenticateJWT, requireAnyPrivilege('user:create', 'user:manage_roles'), listUsers);
router.post('/', authenticateJWT, requirePrivilege('user:create'), createUser);
router.put('/:id', authenticateJWT, requirePrivilege('user:manage_roles'), updateUser);
router.delete('/:id', authenticateJWT, requirePrivilege('user:manage_roles'), deleteUser);
router.patch('/:id/reset-password', authenticateJWT, requirePrivilege('user:manage_roles'), adminResetPassword);

// Legacy: role-only update (kept for backward compat with any existing callers)
router.put('/:id/role', authenticateJWT, requirePrivilege('user:manage_roles'), updateUserRole);

export default router;
