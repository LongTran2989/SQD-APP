import { apiClient } from './client';
import { EscalationAction, EscalationActionPayload, EscalationTargetScope, PendingEscalation } from '../types';

// Broadcast that the viewer's pending-escalation queue may have changed (a new
// flag was raised, or a flag was actioned). The Header bell listens for this so
// its badge refreshes immediately instead of waiting for the next 60s poll. The
// api wrapper is the single choke point — callers don't need to remember to fire.
export const ESCALATIONS_CHANGED_EVENT = 'escalations:changed';
function broadcastEscalationsChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ESCALATIONS_CHANGED_EVENT));
  }
}

// Flag a COMMENT for escalation to a higher scope. Any authenticated user may
// flag; the backend validates the origin→target pair and places the cards.
export const flagPost = (postId: number, targetScope: EscalationTargetScope): Promise<unknown> =>
  apiClient.post(`/feeds/posts/${postId}/flag`, { targetScope }).then((r) => {
    broadcastEscalationsChanged();
    return r.data;
  });

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
  apiClient.post(`/escalations/${flagId}/action`, { action, payload: payload ?? {} }).then((r) => {
    broadcastEscalationsChanged();
    return r.data;
  });
