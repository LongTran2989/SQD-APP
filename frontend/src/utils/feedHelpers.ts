import { FeedPostEnriched } from '../types';

// Shared escalation/info-card presentation helpers. Centralised so the timestamp
// format and the deep-link rule live in one place (were duplicated byte-for-byte
// in EscalationCard + InfoCard, and now reused by the escalations list page too).

/** Compact `dd Mon HH:MM` (en-GB) timestamp for feed cards. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

/** Deep-link to a flagged source, using the denormalised id on the card. */
export function sourceHref(post: Pick<FeedPostEnriched, 'sourceTaskId' | 'sourceWpId'>): string | null {
  if (post.sourceTaskId) return `/dashboard/tasks/${post.sourceTaskId}`;
  if (post.sourceWpId) return `/dashboard/work-packages/${post.sourceWpId}`;
  return null;
}
