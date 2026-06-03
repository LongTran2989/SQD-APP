import { FeedPostEnriched, EscalationTargetScope } from '../types';

// Shared escalation/info-card presentation helpers. Centralised so the timestamp
// format, deep-link rule, and target-scope labels live in one place (were
// duplicated across EscalationCard / InfoCard / FlagButton / the list page).

/** Human-readable label for an escalation target scope. */
export const TARGET_SCOPE_LABEL: Record<EscalationTargetScope, string> = {
  WP: 'Work Package',
  DIVISION: 'Division Board',
  ORG: 'Org Feed',
};

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
