'use client';

import { FeedPostType } from '../../types';

// Client-side type filter for a feed (Phase B). State is the set of HIDDEN types
// (default empty = everything shown), so turning a chip off never risks an empty
// "nothing selected" feed. Filtering is applied by the parent over its loaded
// posts; the backend also accepts a `types` query param for server-side use.
const ALL_OPTIONS: { type: FeedPostType; label: string }[] = [
  { type: 'COMMENT', label: 'Comments' },
  { type: 'SYSTEM_EVENT', label: 'Events' },
  { type: 'ESCALATION_CARD', label: 'Escalations' },
  { type: 'INFO_CARD', label: 'Info' },
];

interface FeedFilterBarProps {
  hidden: Set<FeedPostType>;
  onToggle: (type: FeedPostType) => void;
  // Restrict which chips are shown (e.g. task/finding feeds have no card types).
  options?: FeedPostType[];
}

export default function FeedFilterBar({ hidden, onToggle, options }: FeedFilterBarProps) {
  const opts = ALL_OPTIONS.filter((o) => !options || options.includes(o.type));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opts.map((o) => {
        const shown = !hidden.has(o.type);
        return (
          <button
            key={o.type}
            type="button"
            onClick={() => onToggle(o.type)}
            aria-pressed={shown}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
              shown
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-slate-50 border-slate-200 text-slate-400 line-through'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
