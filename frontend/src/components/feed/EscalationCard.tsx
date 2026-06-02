'use client';

import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { FeedPostEnriched, EscalationFlagStatus } from '../../types';
import { actionEscalation } from '../../api/escalationApi';
import { getApiErrorMessage } from '../../utils/apiError';
import EscalationActionModal, { ModalAction } from './EscalationActionModal';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

// Deep-link to the flagged source, using the denormalised id on the card.
function sourceHref(post: FeedPostEnriched): string | null {
  if (post.sourceTaskId) return `/dashboard/tasks/${post.sourceTaskId}`;
  if (post.sourceWpId) return `/dashboard/work-packages/${post.sourceWpId}`;
  return null;
}

// Badge styling per live flag status (Phase 4 — was hardcoded "Pending", issue #20).
const STATUS_STYLE: Record<EscalationFlagStatus, string> = {
  PENDING: 'bg-amber-200 text-amber-800',
  ACTIONED: 'bg-green-200 text-green-800',
  DISMISSED: 'bg-slate-200 text-slate-600',
};
const STATUS_LABEL: Record<EscalationFlagStatus, string> = {
  PENDING: 'Pending',
  ACTIONED: 'Actioned',
  DISMISSED: 'Dismissed',
};

interface EscalationCardProps {
  post: FeedPostEnriched;
  onActioned?: () => void;
}

export default function EscalationCard({ post, onActioned }: EscalationCardProps) {
  const [busy, setBusy] = useState(false);
  const [modalAction, setModalAction] = useState<ModalAction | null>(null);

  const href = sourceHref(post);
  const status: EscalationFlagStatus = post.flagStatus ?? 'PENDING';
  // post.canAction is computed server-side (canActionFlag) — it already encodes
  // the Manager own-division rule, so a cross-division Manager sees no buttons.
  const showActions = status === 'PENDING' && post.canAction === true && post.flagId != null;

  const runSimple = async (action: 'ACKNOWLEDGE' | 'DISMISS') => {
    if (post.flagId == null) return;
    setBusy(true);
    try {
      await actionEscalation(post.flagId, action);
      toast.success(action === 'ACKNOWLEDGE' ? 'Escalation acknowledged' : 'Escalation dismissed');
      onActioned?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const btn = 'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50';

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wide text-amber-700">Escalation</span>
        <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      <p className="text-sm text-slate-700 leading-relaxed">{post.content}</p>

      {post.sourceExcerpt && (
        <blockquote className="mt-2 border-l-2 border-amber-300 pl-2.5 text-xs italic text-slate-500 break-words">
          {post.sourceExcerpt}
        </blockquote>
      )}

      <div className="mt-2.5 flex items-center gap-3">
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900"
          >
            View source
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        )}
        <span className="ml-auto text-[10px] text-slate-400">{formatTimestamp(post.createdAt)}</span>
      </div>

      {showActions && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-amber-200 pt-3">
          <button onClick={() => runSimple('ACKNOWLEDGE')} disabled={busy} className={`${btn} border-green-300 text-green-700 hover:bg-green-100`}>
            Acknowledge
          </button>
          <button onClick={() => runSimple('DISMISS')} disabled={busy} className={`${btn} border-slate-300 text-slate-600 hover:bg-slate-100`}>
            Dismiss
          </button>
          {post.sourceTaskId != null && (
            <button onClick={() => setModalAction('RAISE_FINDING')} disabled={busy} className={`${btn} border-rose-300 text-rose-700 hover:bg-rose-100`}>
              Raise Finding
            </button>
          )}
          <button onClick={() => setModalAction('CREATE_TASK')} disabled={busy} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-100`}>
            Create Task
          </button>
          {post.sourceTaskId != null && (
            <button onClick={() => setModalAction('REASSIGN_TASK')} disabled={busy} className={`${btn} border-indigo-300 text-indigo-700 hover:bg-indigo-100`}>
              Reassign
            </button>
          )}
          <button onClick={() => setModalAction('DISSEMINATE')} disabled={busy} className={`${btn} border-purple-300 text-purple-700 hover:bg-purple-100`}>
            Disseminate
          </button>
        </div>
      )}

      {modalAction && post.flagId != null && (
        <EscalationActionModal
          flagId={post.flagId}
          action={modalAction}
          sourceTaskId={post.sourceTaskId ?? null}
          sourceWpId={post.sourceWpId ?? null}
          onClose={() => setModalAction(null)}
          onDone={() => { setModalAction(null); onActioned?.(); }}
        />
      )}
    </div>
  );
}
