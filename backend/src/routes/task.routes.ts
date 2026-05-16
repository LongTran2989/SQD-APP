import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  getTasks,
  getMyTasks,
  getTaskById,
  createTask,
  updateTaskData,
  updateTaskStatus,
  addTaskComment
} from '../controllers/task.controller';

const router = Router();

// All task routes require authentication
router.use(authenticateJWT);

router.get('/', getTasks);
router.get('/my-tasks', getMyTasks);
router.get('/:id', getTaskById);
router.post('/', createTask);
router.put('/:id/data', updateTaskData);
router.put('/:id/status', updateTaskStatus);
router.post('/:id/comments', addTaskComment);

export default router;
