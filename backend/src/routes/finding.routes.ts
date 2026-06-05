import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  createFinding,
  listFindings,
  getFindingById,
  reviewFinding,
  generateFollowUpTasks,
  completeStage2,
  closeFinding
} from '../controllers/finding.controller';
import { getRca, upsertRca, saveWhySteps, saveFactors } from '../controllers/rca.controller';
import { listCapa, createCapa, updateCapa, verifyCapa, waiveCapa, deleteCapa } from '../controllers/capa.controller';
import { getFindingLinks, createFindingLink, deleteFindingLink } from '../controllers/findingLink.controller';

const router = Router();

// All finding routes require authentication
router.use(authenticateJWT);

// ─── List + create ──────────────────────────────────────────────────
router.get('/', listFindings);
router.post('/', createFinding);

// ─── Single finding ─────────────────────────────────────────────────
router.get('/:id', getFindingById);

// ─── Review workflow ─────────────────────────────────────────────────
router.put('/:id/review', reviewFinding);
router.post('/:id/tasks', generateFollowUpTasks);

// ─── Two-stage closure ───────────────────────────────────────────────
router.put('/:id/stage2', completeStage2);
router.put('/:id/close', closeFinding);

// ─── RCA (Root Cause Analysis) ───────────────────────────────────────
router.get('/:id/rca', getRca);
router.put('/:id/rca', upsertRca);
router.put('/:id/rca/why-steps', saveWhySteps);
router.put('/:id/rca/factors', saveFactors);

// ─── CAPA (Corrective / Preventive Actions) ──────────────────────────
router.get('/:id/capa', listCapa);
router.post('/:id/capa', createCapa);
router.put('/:id/capa/:capaId', updateCapa);
router.put('/:id/capa/:capaId/verify', verifyCapa);
router.put('/:id/capa/:capaId/waive', waiveCapa);
router.delete('/:id/capa/:capaId', deleteCapa);

// ─── Traceability (cross-finding links) ──────────────────────────────
router.get('/:id/links', getFindingLinks);
router.post('/:id/links', createFindingLink);
router.delete('/:id/links/:linkId', deleteFindingLink);

export default router;
