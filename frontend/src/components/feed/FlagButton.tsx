'use client';

import { useState, useRef, useEffect } from 'react';
import { Flag, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { EscalationTargetScope } from '../../types';
import { flagPost } from '../../api/escalationApi';
import { getApiErrorMessage } from '../../utils/apiError';
import { TARGET_SCOPE_LABEL as TARGET_LABEL } from '../../utils/feedHelpers';

interface FlagButtonProps {
  postId: number;
  targets: EscalationTargetScope[];
  onFlagged?: () => void;
}

// HTTP 409 means the target is already pending — treat it as "already done" for
// UI purposes (no new flag, but the target should appear flagged).
const ALREADY_PENDING = 409;

export default function FlagButton({ postId, targets, onFlagged }: FlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Tracks which targets have been successfully escalated (or are already pending).
  // Persists through parent feed reloads since the key on FeedPostItem is post.id.
  const [flaggedTargets, setFlaggedTargets] = useState<Set<EscalationTargetScope>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when the user clicks outside.
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (targets.length === 0) return null;

  const allFlagged = targets.every((t) => flaggedTargets.has(t));

  const handleFlag = async (target: EscalationTargetScope) => {
    if (flaggedTargets.has(target)) return;
    setBusy(true);
    try {
      await flagPost(postId, target);
      setFlaggedTargets((prev) => new Set([...prev, target]));
      toast.success(`Escalated to ${TARGET_LABEL[target]}`);
      setOpen(false);
      onFlagged?.();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === ALREADY_PENDING) {
        // Mark as flagged in the UI — it's pending, just not by this action.
        setFlaggedTargets((prev) => new Set([...prev, target]));
      }
      toast.error(getApiErrorMessage(err, 'Failed to escalate'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => { if (!allFlagged) setOpen((v) => !v); }}
        className={`p-1 transition-colors ${
          allFlagged
            ? 'text-amber-500 cursor-default'
            : 'text-slate-400 hover:text-amber-600'
        }`}
        title={allFlagged ? 'Already escalated' : 'Escalate this comment'}
        aria-label={allFlagged ? 'Already escalated' : 'Escalate this comment'}
      >
        <Flag className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Escalate to</p>
          {targets.map((t) => {
            const done = flaggedTargets.has(t);
            return (
              <button
                key={t}
                type="button"
                disabled={busy || done}
                onClick={() => handleFlag(t)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 ${
                  done
                    ? 'text-slate-400 cursor-default'
                    : 'text-slate-700 hover:bg-amber-50 disabled:opacity-50'
                }`}
              >
                <span>{TARGET_LABEL[t]}</span>
                {done && <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
