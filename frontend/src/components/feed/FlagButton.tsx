'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import toast from 'react-hot-toast';
import { EscalationTargetScope } from '../../types';
import { flagPost } from '../../api/escalationApi';
import { getApiErrorMessage } from '../../utils/apiError';

const TARGET_LABEL: Record<EscalationTargetScope, string> = {
  WP: 'Work Package',
  DIVISION: 'Division Board',
  ORG: 'Org Feed',
};

interface FlagButtonProps {
  postId: number;
  // The scopes this comment may be escalated to (computed by the parent feed
  // from its own scope + context). An empty list hides the button.
  targets: EscalationTargetScope[];
  // Called after a successful flag so the parent can refresh the feed.
  onFlagged?: () => void;
}

// Lets any authenticated user escalate a COMMENT. Clicking opens a small picker
// of the eligible target scopes; selecting one creates the flag immediately.
export default function FlagButton({ postId, targets, onFlagged }: FlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (targets.length === 0) return null;

  const handleFlag = async (target: EscalationTargetScope) => {
    setBusy(true);
    try {
      await flagPost(postId, target);
      toast.success(`Escalated to ${TARGET_LABEL[target]}`);
      setOpen(false);
      onFlagged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to escalate'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-1 text-slate-400 hover:text-amber-600 transition-colors"
        title="Escalate this comment"
        aria-label="Escalate this comment"
      >
        <Flag className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Escalate to</p>
          {targets.map((t) => (
            <button
              key={t}
              type="button"
              disabled={busy}
              onClick={() => handleFlag(t)}
              className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-amber-50 disabled:opacity-50"
            >
              {TARGET_LABEL[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
