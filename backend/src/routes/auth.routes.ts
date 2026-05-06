import { Router } from 'express';
import { login, register } from '../controllers/auth.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';

const router = Router();

router.post('/login', login);
// Protecting register route so only Admins and Directors can create new users
router.post('/register', authenticateJWT, authorizeRoles('Director', 'Admin'), register);

export default router;
