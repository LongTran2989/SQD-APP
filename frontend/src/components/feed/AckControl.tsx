'use client';

import { useState } from 'react';
import { Check, CheckCircle2 } from 'lucide-react';
import { ackPost } from '../../api/feedApi';

interface AckControlProps {
  postId: number;
  ackCount?: number;
  acknowledged?: boolean;
  onChanged?: () => void;
}

// Compact "I have read this" control for a comment (Phase G). Idempotent: once the
// viewer has acknowledged it becomes a static receipt showing the total count.
export default function AckControl({ postId, ackCount = 0, acknowledged = false, onChanged }: AckControlProps) {
  const [busy, setBusy] = useState(false);

  const ack = async () => {
    if (acknowledged || busy) return;
    setBusy(true);
    try {
      await ackPost(postId);
      onChanged?.();
    } catch {
      /* best-effort */
    } finally {
      setBusy(false);
    }
  };

  if (acknowledged) {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-green-600">
        <CheckCircle2 className="w-3 h-3" />
        Acknowledged{ackCount > 1 ? ` · ${ackCount} total` : ''}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={ack}
      disabled={busy}
      className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-green-600 disabled:opacity-50"
    >
      <Check className="w-3 h-3" />
      Acknowledge{ackCount > 0 ? ` · ${ackCount}` : ''}
    </button>
  );
}
