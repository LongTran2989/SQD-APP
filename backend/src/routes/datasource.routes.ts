import { Router } from 'express';
import { getDataSource } from '../controllers/datasource.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Authenticated users can fetch data source options for dynamic dropdowns
router.get('/:source', authenticateJWT, getDataSource);

export default router;
