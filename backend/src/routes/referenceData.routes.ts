import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';
import {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listOperators, createOperator, updateOperator, deleteOperator,
  listAuthorities, createAuthority, updateAuthority, deleteAuthority,
  listAircraftTypes, createAircraftType, deleteAircraftType,
  listRegistrations, createRegistration, updateRegistration, deleteRegistration,
  listAuthorizationTypes, createAuthorizationType, updateAuthorizationType, deleteAuthorizationType,
} from '../controllers/referenceData.controller';

const router = Router();

// Reference data management is Admin-only.
router.use(authenticateJWT, authorizeRoles('Admin'));

// Departments (soft delete)
router.get('/departments', listDepartments);
router.post('/departments', createDepartment);
router.put('/departments/:id', updateDepartment);
router.delete('/departments/:id', deleteDepartment);

// Operators
router.get('/operators', listOperators);
router.post('/operators', createOperator);
router.put('/operators/:code', updateOperator);
router.delete('/operators/:code', deleteOperator);

// Authorities
router.get('/authorities', listAuthorities);
router.post('/authorities', createAuthority);
router.put('/authorities/:code', updateAuthority);
router.delete('/authorities/:code', deleteAuthority);

// Aircraft types (code is PK — no update)
router.get('/aircraft-types', listAircraftTypes);
router.post('/aircraft-types', createAircraftType);
router.delete('/aircraft-types/:code', deleteAircraftType);

// Aircraft registrations
router.get('/registrations', listRegistrations);
router.post('/registrations', createRegistration);
router.put('/registrations/:registration', updateRegistration);
router.delete('/registrations/:registration', deleteRegistration);

// Authorization types
router.get('/authorization-types', listAuthorizationTypes);
router.post('/authorization-types', createAuthorizationType);
router.put('/authorization-types/:id', updateAuthorizationType);
router.delete('/authorization-types/:id', deleteAuthorizationType);

export default router;
