import { apiClient } from './client';
import { EscalationAction, EscalationActionPayload, EscalationTargetScope, PendingEscalation } from '../types';

// Flag a COMMENT for escalation to a higher scope. Any authenticated user may
// flag; the backend validates the origin→target pair and places the cards.
export const flagPost = (postId: number, targetScope: EscalationTargetScope): Promise<unknown> =>
  apiClient.post(`/feeds/posts/${postId}/flag`, { targetScope }).then((r) => r.data);

// The viewer's actionable escalation queue (Director/Admin: all; Manager:
// own-division WP/Division + all Org; others: none). Drives the Header bell.
export const getPendingEscalations = (): Promise<PendingEscalation[]> =>
  apiClient.get('/escalations', { params: { status: 'PENDING' } }).then((r) => r.data);

// Action a PENDING flag (Director/Admin any; Manager own-div WP/Division + all
// Org). The backend reuses the existing createFinding / createTask / reassignTask
// workflows and flips the flag out of PENDING; it is the single source of truth
// for RBAC, so the UI gating is only a convenience.
export const actionEscalation = (
  flagId: number,
  action: EscalationAction,
  payload?: EscalationActionPayload
): Promise<unknown> =>
  apiClient.post(`/escalations/${flagId}/action`, { action, payload: payload ?? {} }).then((r) => r.data);
