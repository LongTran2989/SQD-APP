'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pin, PinOff, EyeOff, Eye } from 'lucide-react';
import { hidePost, unhidePost, pinPost, unpinPost } from '../../api/feedApi';
import { getApiErrorMessage } from '../../utils/apiError';

interface CommentModerationMenuProps {
  postId: number;
  isHidden: boolean;
  isPinned: boolean;
  // Hide/unhide rights (Director/Admin); pin/unpin rights (scope-gated). Either
  // may be false; when both are false the menu renders nothing.
  canModerate: boolean;
  canPin: boolean;
  // Called after a successful action so the parent can refetch the feed (+ pins).
  onChanged?: () => void;
}

// Compact pin / hide controls for a single COMMENT, shared by FeedPostItem and the
// task/finding activity feeds. The backend re-checks every action's RBAC.
export default function CommentModerationMenu({
  postId,
  isHidden,
  isPinned,
  canModerate,
  canPin,
  onChanged,
}: CommentModerationMenuProps) {
  const [busy, setBusy] = useState(false);
  if (!canModerate && !canPin) return null;

  const run = async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      onChanged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const iconBtn = 'p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40';

  return (
    <span className="inline-flex items-center gap-0.5">
      {canPin && (
        isPinned ? (
          <button type="button" disabled={busy} className={iconBtn} title="Unpin" onClick={() => run(() => unpinPost(postId), 'Unpinned')}>
            <PinOff className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button type="button" disabled={busy} className={iconBtn} title="Pin to feed" onClick={() => run(() => pinPost(postId), 'Pinned')}>
            <Pin className="w-3.5 h-3.5" />
          </button>
        )
      )}
      {canModerate && (
        isHidden ? (
          <button type="button" disabled={busy} className={iconBtn} title="Unhide comment" onClick={() => run(() => unhidePost(postId), 'Comment restored')}>
            <Eye className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button type="button" disabled={busy} className={iconBtn} title="Hide comment" onClick={() => run(() => hidePost(postId), 'Comment hidden')}>
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        )
      )}
    </span>
  );
}
