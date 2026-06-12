import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  listAtaChapters,
  upsertAtaChapter,
  listCauseCodes,
  upsertCauseCode,
  listHazardTags,
  upsertHazardTag,
  listEventTypes,
  upsertEventType,
  listWpTypes,
  upsertWpType,
} from '../controllers/taxonomy.controller';

const router = Router();
router.use(authenticateJWT);

// ─── ATA chapters ────────────────────────────────────────────────────
router.get('/ata-chapters', listAtaChapters);
router.post('/ata-chapters', upsertAtaChapter);
router.put('/ata-chapters/:id', upsertAtaChapter);

// ─── Cause codes ─────────────────────────────────────────────────────
router.get('/cause-codes', listCauseCodes);
router.post('/cause-codes', upsertCauseCode);
router.put('/cause-codes/:id', upsertCauseCode);

// ─── Hazard tags ─────────────────────────────────────────────────────
router.get('/hazard-tags', listHazardTags);
router.post('/hazard-tags', upsertHazardTag);
router.put('/hazard-tags/:id', upsertHazardTag);

// ─── Event types ─────────────────────────────────────────────────────
router.get('/event-types', listEventTypes);
router.post('/event-types', upsertEventType);
router.put('/event-types/:id', upsertEventType);

// ─── WP types ────────────────────────────────────────────────────────
router.get('/wp-types', listWpTypes);
router.post('/wp-types', upsertWpType);
router.put('/wp-types/:id', upsertWpType);

export default router;
