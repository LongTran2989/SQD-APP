'use client';

import Link from 'next/link';
import { Info, ArrowUpRight } from 'lucide-react';
import { FeedPostEnriched } from '../../types';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

function sourceHref(post: FeedPostEnriched): string | null {
  if (post.sourceTaskId) return `/dashboard/tasks/${post.sourceTaskId}`;
  if (post.sourceWpId) return `/dashboard/work-packages/${post.sourceWpId}`;
  return null;
}

// Display-only awareness card placed at levels an escalation skipped, so no
// level is blind to a concern that passed it by. Never actionable.
export default function InfoCard({ post }: { post: FeedPostEnriched }) {
  const href = sourceHref(post);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">For awareness</span>
      </div>

      <p className="text-sm text-slate-600 leading-relaxed">{post.content}</p>

      {post.sourceExcerpt && (
        <blockquote className="mt-2 border-l-2 border-slate-300 pl-2.5 text-xs italic text-slate-500 break-words">
          {post.sourceExcerpt}
        </blockquote>
      )}

      <div className="mt-2.5 flex items-center gap-3">
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
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
