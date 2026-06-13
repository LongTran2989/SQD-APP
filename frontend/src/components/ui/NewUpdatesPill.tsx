'use client';

import { ArrowUp } from 'lucide-react';

interface NewUpdatesPillProps {
  show: boolean;
  onClick: () => void;
  label?: string;
}

/**
 * Twitter-style "new updates" affordance: a small sticky pill that appears when
 * live activity has arrived but is held back so the reader isn't interrupted.
 * Clicking it loads the new content. Renders nothing when there's nothing new.
 */
export default function NewUpdatesPill({ show, onClick, label = 'New updates' }: NewUpdatesPillProps) {
  if (!show) return null;
  return (
    <div className="sticky top-2 z-10 flex justify-center pointer-events-none">
      <button
        onClick={onClick}
        className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-full shadow-md transition-colors"
      >
        <ArrowUp className="w-3.5 h-3.5" />
        {label}
      </button>
    </div>
  );
}
