'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { FeedPostEnriched, EscalationFlagStatus } from '../../types';
import { formatTimestamp, sourceHref } from '../../utils/feedHelpers';
import EscalationActions from './EscalationActions';

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
  const href = sourceHref(post);
  const status: EscalationFlagStatus = post.flagStatus ?? 'PENDING';
  // post.canAction is computed server-side (canActionFlag) — it already encodes
  // the Manager own-division rule, so a cross-division Manager sees no buttons.
  const showActions = status === 'PENDING' && post.canAction === true && post.flagId != null;

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

      {showActions && post.flagId != null && (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <EscalationActions
            flagId={post.flagId}
            sourceTaskId={post.sourceTaskId ?? null}
            sourceWpId={post.sourceWpId ?? null}
            canRaiseFinding={post.sourceTaskId != null}
            onActioned={onActioned}
          />
        </div>
      )}
    </div>
  );
}
