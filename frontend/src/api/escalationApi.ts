import { apiClient } from './client';
import { EscalationTargetScope, PendingEscalation } from '../types';

// Flag a COMMENT for escalation to a higher scope. Any authenticated user may
// flag; the backend validates the origin→target pair and places the cards.
export const flagPost = (postId: number, targetScope: EscalationTargetScope): Promise<unknown> =>
  apiClient.post(`/feeds/posts/${postId}/flag`, { targetScope }).then((r) => r.data);

// The viewer's actionable escalation queue (Director/Admin: all; Manager:
// own-division WP/Division + all Org; others: none). Drives the Header bell.
export const getPendingEscalations = (): Promise<PendingEscalation[]> =>
  apiClient.get('/escalations', { params: { status: 'PENDING' } }).then((r) => r.data);
