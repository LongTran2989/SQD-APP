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
} from '../controllers/user.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

// Self-service routes (any authenticated user, own record only)
router.patch('/me/preferences', authenticateJWT, updateMyPreferences);
router.patch('/me/password', authenticateJWT, changePassword);

// Admin: list and manage users
// NOTE: listUsers does an OR privilege check (user:create | user:manage_roles) internally.
router.get('/', authenticateJWT, listUsers);
router.post('/', authenticateJWT, requirePrivilege('user:create'), createUser);
router.put('/:id', authenticateJWT, requirePrivilege('user:manage_roles'), updateUser);
router.delete('/:id', authenticateJWT, requirePrivilege('user:manage_roles'), deleteUser);
router.patch('/:id/reset-password', authenticateJWT, requirePrivilege('user:manage_roles'), adminResetPassword);

// Legacy: role-only update (kept for backward compat with any existing callers)
router.put('/:id/role', authenticateJWT, requirePrivilege('user:manage_roles'), updateUserRole);

export default router;
