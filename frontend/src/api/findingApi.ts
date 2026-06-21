import { apiClient } from './client';
import {
  Finding,
  FindingDetail,
  FindingsListResponse,
  FindingListItem,
  FindingSeverity,
  RcaInvestigation,
  RcaMethod,
  RcaStatus,
  RcaWhyStep,
  RcaContributingFactor,
  CapaAction,
  CapaType,
  CapaStatus,
  CapaTaskLink,
  FindingLinkType,
  FindingLinkRecord,
  ResponseActionType,
} from '../types';

// ─── List & detail ──────────────────────────────────────────────────────────

export interface FindingListParams {
  status?: string;
  severity?: string;
  divisionId?: number;
  reportedBy?: number;
  taskId?: number;
  page?: number;
  pageSize?: number;
}

export const listFindings = (params: FindingListParams = {}): Promise<FindingsListResponse> =>
  apiClient.get('/findings', { params }).then((r) => r.data);

export const getFindingById = (id: number): Promise<FindingDetail> =>
  apiClient.get(`/findings/${id}`).then((r) => r.data);

// All findings raised on a given source task (used by the Task detail page).
export const getFindingsByTask = (taskId: number): Promise<FindingListItem[]> =>
  apiClient.get('/findings', { params: { taskId, pageSize: 100 } }).then((r) => r.data.findings);

// ─── Create (raise) ─────────────────────────────────────────────────────────

export interface RaiseFindingPayload {
  taskId?: number;
  targetDivisionId?: number;
  eventType: string;
  departmentId: number;
  description: string;
  aircraftRegistrationCode?: string;
  regulatoryReference?: string;
  fieldId?: string;
  ataChapterId?: number;
  hazardTagIds?: number[];
}

export const raiseFinding = (payload: RaiseFindingPayload): Promise<Finding> =>
  apiClient.post('/findings', payload).then((r) => r.data);

// ─── Review ───────────────────────────────────────────────────────────────────

export const reviewFinding = (
  id: number,
  payload: { severity: FindingSeverity; dueDate?: string; ataChapterId?: number; hazardTagIds?: number[] }
): Promise<Finding> =>
  apiClient.put(`/findings/${id}/review`, payload).then((r) => r.data);

// ─── Follow-up task generation ──────────────────────────────────────────────

export interface FollowUpTaskInput {
  templateId: number;
  title: string;
  wpId?: number;
  createNewWp?: boolean;
  newWpName?: string;
  responseActionType?: ResponseActionType;
  targetDepartmentIds?: number[];
  note?: string;
  procedureRef?: string;
}

export const generateFollowUpTasks = (
  id: number,
  tasks: FollowUpTaskInput[]
): Promise<{ findingId: number; createdTasks: { id: number; taskId: string }[] }> =>
  apiClient.post(`/findings/${id}/tasks`, { tasks }).then((r) => r.data);

// ─── Close + workflow escapes ────────────────────────────────────────────────

export const closeFinding = (id: number, closureNote: string): Promise<Finding> =>
  apiClient.put(`/findings/${id}/close`, { closureNote }).then((r) => r.data);

export const advanceFinding = (id: number): Promise<Finding> =>
  apiClient.put(`/findings/${id}/advance`).then((r) => r.data);

// ─── Admin: stuck findings (best-effort Pending-Verification trigger missed) ──

export interface StuckFinding {
  id: number;
  description: string;
  status: string;
  severity: FindingSeverity | null;
  dueDate: string | null;
  reportedByUser?: { id: number; name: string } | null;
  targetDivision?: { id: number; name: string; code: string } | null;
  department?: { id: number; name: string } | null;
  followUpTasks: { id: number; taskId: string | null; status: string }[];
}

// Admin/Director only — findings still "In Progress" whose follow-up tasks are
// all final (the auto-advance hook did not fire). 403 for everyone else.
export const getStuckFindings = (): Promise<StuckFinding[]> =>
  apiClient.get('/findings/admin/stuck').then((r) => r.data);

export const forcePendingVerification = (id: number): Promise<Finding> =>
  apiClient.put(`/findings/${id}/force-pending-verification`).then((r) => r.data);

export const dismissFinding = (id: number, reason: string): Promise<Finding> =>
  apiClient.put(`/findings/${id}/dismiss`, { reason }).then((r) => r.data);

export const updateFindingSeverity = (
  id: number,
  payload: { severity: FindingSeverity; reason: string }
): Promise<Finding> =>
  apiClient.put(`/findings/${id}/severity`, payload).then((r) => r.data);

export const updateFindingTaxonomy = (
  id: number,
  payload: { ataChapterId?: number | null; hazardTagIds?: number[] }
): Promise<Finding> =>
  apiClient.put(`/findings/${id}/taxonomy`, payload).then((r) => r.data);

// ─── RCA (Root Cause Analysis) ────────────────────────────────────────────────

export const getRca = (id: number): Promise<RcaInvestigation | null> =>
  apiClient.get(`/findings/${id}/rca`).then((r) => r.data);

export const upsertRca = (
  id: number,
  payload: { method: RcaMethod; summary?: string | null; status?: RcaStatus; causeCodeId?: number | null }
): Promise<RcaInvestigation> =>
  apiClient.put(`/findings/${id}/rca`, payload).then((r) => r.data);

export const saveWhySteps = (
  id: number,
  steps: { question: string; answer?: string | null }[]
): Promise<RcaWhyStep[]> =>
  apiClient.put(`/findings/${id}/rca/why-steps`, { steps }).then((r) => r.data);

export const saveFactors = (
  id: number,
  factors: { category: string; detail?: string | null; isPrimary?: boolean }[]
): Promise<RcaContributingFactor[]> =>
  apiClient.put(`/findings/${id}/rca/factors`, { factors }).then((r) => r.data);

// ─── CAPA (Corrective / Preventive Actions) ──────────────────────────────────

export interface CapaPayload {
  type: CapaType;
  description: string;
  ownerUserId?: number | null;
  deadline?: string | null;
}

export const listCapa = (id: number): Promise<CapaAction[]> =>
  apiClient.get(`/findings/${id}/capa`).then((r) => r.data);

export const createCapa = (id: number, payload: CapaPayload): Promise<CapaAction> =>
  apiClient.post(`/findings/${id}/capa`, payload).then((r) => r.data);

export const updateCapa = (
  id: number,
  capaId: number,
  payload: Partial<CapaPayload> & { status?: CapaStatus }
): Promise<CapaAction> =>
  apiClient.put(`/findings/${id}/capa/${capaId}`, payload).then((r) => r.data);

export const verifyCapa = (id: number, capaId: number, effectivenessNote: string): Promise<CapaAction> =>
  apiClient.put(`/findings/${id}/capa/${capaId}/verify`, { effectivenessNote }).then((r) => r.data);

export const waiveCapa = (id: number, capaId: number, waivedReason: string): Promise<CapaAction> =>
  apiClient.put(`/findings/${id}/capa/${capaId}/waive`, { waivedReason }).then((r) => r.data);

export const deleteCapa = (id: number, capaId: number): Promise<void> =>
  apiClient.delete(`/findings/${id}/capa/${capaId}`).then((r) => r.data);

export const addCapaLink = (
  findingId: number,
  capaId: number,
  payload: { mandatory: boolean; taskId?: number; wpId?: number }
): Promise<CapaTaskLink> =>
  apiClient.post(`/findings/${findingId}/capa/${capaId}/links`, payload).then((r) => r.data);

export const removeCapaLink = (
  findingId: number,
  capaId: number,
  linkId: number
): Promise<void> =>
  apiClient.delete(`/findings/${findingId}/capa/${capaId}/links/${linkId}`).then((r) => r.data);

// ─── Traceability (cross-finding links) ──────────────────────────────────────

export const getFindingLinks = (id: number): Promise<{ outgoing: FindingLinkRecord[]; incoming: FindingLinkRecord[] }> =>
  apiClient.get(`/findings/${id}/links`).then((r) => r.data);

export const createFindingLink = (
  id: number,
  payload: { relatedFindingId: number; linkType: FindingLinkType; note?: string }
): Promise<FindingLinkRecord> =>
  apiClient.post(`/findings/${id}/links`, payload).then((r) => r.data);

export const deleteFindingLink = (id: number, linkId: number): Promise<void> =>
  apiClient.delete(`/findings/${id}/links/${linkId}`).then((r) => r.data);
