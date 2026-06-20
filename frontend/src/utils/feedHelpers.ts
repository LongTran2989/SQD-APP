import { FeedPostEnriched, EscalationTargetScope, EscalationAction } from '../types';

// Shared escalation/info-card presentation helpers. Centralised so the timestamp
// format, deep-link rule, and target-scope labels live in one place (were
// duplicated across EscalationCard / InfoCard / FlagButton / the list page).

/** Human-readable label for an escalation target scope. */
export const TARGET_SCOPE_LABEL: Record<EscalationTargetScope, string> = {
  WP: 'Work Package',
  DIVISION: 'Division Feed',
  ORG: 'Organisation Feed',
};

/** Past-tense label for a completed escalation action (history summary line). */
export const ACTION_LABEL: Record<EscalationAction, string> = {
  ACKNOWLEDGE: 'Acknowledged',
  DISMISS: 'Dismissed',
  RAISE_FINDING: 'Raised Finding',
  CREATE_TASK: 'Created Task',
  REASSIGN_TASK: 'Reassigned Task',
  DISSEMINATE: 'Disseminated',
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

/** "2h ago" / "Yesterday" style relative time; falls back to formatTimestamp beyond a week. */
export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatTimestamp(iso);
}

/** Up-to-two-letter uppercase initials for an avatar (e.g. "Long Tran" → "LT"). */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Deep-link to a flagged source, using the denormalised id on the card. */
export function sourceHref(post: Pick<FeedPostEnriched, 'sourceTaskId' | 'sourceWpId'>): string | null {
  if (post.sourceTaskId) return `/dashboard/tasks/${post.sourceTaskId}`;
  if (post.sourceWpId) return `/dashboard/work-packages/${post.sourceWpId}`;
  return null;
}
