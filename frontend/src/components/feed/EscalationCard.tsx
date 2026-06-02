'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { FeedPostEnriched } from '../../types';

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

// Actionable escalation card. Phase 3 renders the shell (headline, excerpt,
// deep-link, status); the action buttons (acknowledge / raise finding / …) are
// wired in Phase 4.
export default function EscalationCard({ post }: { post: FeedPostEnriched }) {
  const href = sourceHref(post);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wide text-amber-700">Escalation</span>
        <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 text-[10px] font-bold uppercase tracking-wide">
          Pending
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
    </div>
  );
}
