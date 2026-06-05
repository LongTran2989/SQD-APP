import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  listAtaChapters,
  upsertAtaChapter,
  listCauseCodes,
  upsertCauseCode,
  listHazardTags,
  upsertHazardTag,
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

export default router;
