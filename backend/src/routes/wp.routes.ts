import { Router } from 'express';
import {
  getWorkPackages,
  getWorkPackageById,
  createWorkPackage,
  updateWorkPackage,
  updateWorkPackageStatus,
  assignUserToWp,
  removeUserFromWp,
} from '../controllers/wp.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';

const router = Router();

// All WP routes require authentication
router.use(authenticateJWT);

// WP listing and detail
router.get('/', getWorkPackages);
router.get('/:id', getWorkPackageById);

// WP creation — Manager, Director, Admin
router.post('/', requirePrivilege('wp:create'), createWorkPackage);

// WP update — authorization handled in controller (managers/creator/global edit all
// fields; assigned users may edit only the timeframe).
router.put('/:id', updateWorkPackage);

// WP status changes — checked in controller (creator, Admin, Director)
router.put('/:id/status', updateWorkPackageStatus);

// WP assignment — Manager, Director, Admin (further checks in controller)
router.post('/:id/assign', requirePrivilege('wp:assign'), assignUserToWp);
router.delete('/:id/assign/:userId', requirePrivilege('wp:assign'), removeUserFromWp);

export default router;
