import { Router } from 'express';
import { login, logout, register, updatePassword, forgotPassword, resetPassword } from '../controllers/auth.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { requirePrivilege } from '../middleware/rbac.middleware';
import { createAuthRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// Independent buckets per sensitive, unauthenticated endpoint.
const loginLimiter = createAuthRateLimiter();
const forgotPasswordLimiter = createAuthRateLimiter();
const resetPasswordLimiter = createAuthRateLimiter();

router.post('/login', loginLimiter, login);
router.post('/logout', authenticateJWT, logout);
router.post('/register', authenticateJWT, requirePrivilege('user:create'), register);

router.post('/update-password', authenticateJWT, updatePassword);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPassword);

export default router;
