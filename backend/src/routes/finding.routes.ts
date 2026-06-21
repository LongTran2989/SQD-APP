import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import {
  createFinding,
  getDuplicateCandidates,
  listFindings,
  getFindingById,
  reviewFinding,
  generateFollowUpTasks,
  closeFinding,
  advanceFinding,
  getStuckFindings,
  forcePendingVerification,
  updateSeverity,
  dismissFinding,
  updateTaxonomy,
  updateFindingDetails
} from '../controllers/finding.controller';
import { getRca, upsertRca, saveWhySteps, saveFactors } from '../controllers/rca.controller';
import { listCapa, createCapa, updateCapa, verifyCapa, waiveCapa, deleteCapa, addCapaLink, removeCapaLink } from '../controllers/capa.controller';
import { getFindingLinks, createFindingLink, deleteFindingLink } from '../controllers/findingLink.controller';

const router = Router();

// All finding routes require authentication
router.use(authenticateJWT);

// ─── List + create ──────────────────────────────────────────────────
router.get('/', listFindings);
router.post('/', createFinding);

// ─── Admin queries (must be before /:id to avoid Express treating "admin" as :id param)
router.get('/admin/stuck', getStuckFindings);

// ─── Raise-time duplicate detection (before /:id for the same reason) ──────────
router.get('/duplicate-candidates', getDuplicateCandidates);

// ─── Single finding ─────────────────────────────────────────────────
router.get('/:id', getFindingById);

// ─── Review workflow ─────────────────────────────────────────────────
router.put('/:id/review', reviewFinding);
router.post('/:id/tasks', generateFollowUpTasks);

// ─── Workflow escapes (F-2, F-7, F-8, F-11, F-12) ──────────────────
router.put('/:id/advance', advanceFinding);
router.put('/:id/force-pending-verification', forcePendingVerification);
router.put('/:id/severity', updateSeverity);
router.put('/:id/dismiss', dismissFinding);
router.put('/:id/taxonomy', updateTaxonomy);
router.put('/:id/details', updateFindingDetails);

// ─── Closure ─────────────────────────────────────────────────────────
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
router.post('/:id/capa/:capaId/links', addCapaLink);
router.delete('/:id/capa/:capaId/links/:linkId', removeCapaLink);
router.delete('/:id/capa/:capaId', deleteCapa);

// ─── Traceability (cross-finding links) ──────────────────────────────
router.get('/:id/links', getFindingLinks);
router.post('/:id/links', createFindingLink);
router.delete('/:id/links/:linkId', deleteFindingLink);

export default router;
