import { Router } from 'express';
import { login, register, updatePassword, forgotPassword, resetPassword } from '../controllers/auth.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { authorizeRoles } from '../middleware/rbac.middleware';

const router = Router();

router.post('/login', login);
router.post('/register', authenticateJWT, authorizeRoles('Director', 'Admin'), register);

router.post('/update-password', authenticateJWT, updatePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
