import { formatTimestamp } from '../../utils/feedHelpers';

// Shared building blocks for the quick-view drawers (Task / WP / Finding) so the
// row layout, date format, and "latest activity" list live in one place.

export function formatQvDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function QvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-slate-700 flex-1 break-words">{value}</dd>
    </div>
  );
}

// Common shape across TaskActivityEnriched (task feed) and FeedPostEnriched
// (finding feed) — both carry type / content / author / createdAt.
export interface QvFeedEntry {
  id: number;
  type: string; // 'SYSTEM_EVENT' | 'COMMENT'
  content: string;
  author?: { id: number; name: string | null } | null;
  createdAt: string;
}

// Compact, read-only "latest activity" list. Pass entries already sliced and
// ordered newest-first; renders an empty-state when there are none.
export function QvFeed({ entries }: { entries: QvFeedEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-400 italic">No activity yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id} className="text-xs">
          <p className={`leading-relaxed break-words ${entry.type === 'SYSTEM_EVENT' ? 'text-slate-500 italic' : 'text-slate-700'}`}>
            {entry.type !== 'SYSTEM_EVENT' && (
              <span className="font-semibold text-slate-600">{entry.author?.name ?? 'Unknown'}: </span>
            )}
            {entry.content}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">{formatTimestamp(entry.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}
