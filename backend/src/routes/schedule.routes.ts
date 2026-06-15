import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  getSchedule,
  upsertEntries,
  deleteEntry,
  publishSchedule,
  getLock,
  acquireLock,
  releaseLock,
  takeoverLock,
  conflictCheck,
  copyWeek,
  listPatterns,
  createPattern,
  applyPattern,
  getWorkload,
} from '../controllers/schedule.controller';

const router = Router();

router.use(authenticateJWT);

// Conflict check & workload (no divisionId param — must come before /:divisionId routes)
router.get('/conflict-check', conflictCheck);
router.get('/patterns', listPatterns);
router.post('/patterns', createPattern);
router.get('/workload/:userId', getWorkload);

// Division-scoped schedule
router.get('/:divisionId', getSchedule);
router.put('/:divisionId/entries', upsertEntries);
router.delete('/:divisionId/entries/:entryId', deleteEntry);
router.post('/:divisionId/publish', publishSchedule);
router.post('/:divisionId/copy-week', copyWeek);

// Lock management
router.get('/:divisionId/lock', getLock);
router.post('/:divisionId/lock', acquireLock);
router.delete('/:divisionId/lock', releaseLock);
router.post('/:divisionId/lock/takeover', takeoverLock);

// Patterns
router.post('/:divisionId/patterns/:patternId/apply', applyPattern);

export default router;
