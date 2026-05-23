import { Router } from 'express';
import {
  getWorkPackages,
  getWorkPackageById,
  createWorkPackage,
  updateWorkPackage,
  updateWorkPackageStatus,
  assignUserToWp,
  removeUserFromWp,
  getWpTypes,
  createWpType
} from '../controllers/wp.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';

const router = Router();

// All WP routes require authentication
router.use(authenticateJWT);

// WpType CRUD — must be before /:id to avoid route conflict
router.get('/types', getWpTypes);
router.post('/types', authorizeRoles('Admin'), createWpType);

// WP listing and detail
router.get('/', getWorkPackages);
router.get('/:id', getWorkPackageById);

// WP creation — Manager, Director, Admin
router.post('/', authorizeRoles('Admin', 'Director', 'Manager'), createWorkPackage);

// WP update — Manager, Director, Admin (ownership also checked in controller)
router.put('/:id', authorizeRoles('Admin', 'Director', 'Manager'), updateWorkPackage);

// WP status changes — checked in controller (creator, Admin, Director)
router.put('/:id/status', updateWorkPackageStatus);

// WP assignment — Manager, Director, Admin (further checks in controller)
router.post('/:id/assign', authorizeRoles('Admin', 'Director', 'Manager'), assignUserToWp);
router.delete('/:id/assign/:userId', authorizeRoles('Admin', 'Director', 'Manager'), removeUserFromWp);

export default router;
