'use client';

import { Settings } from 'lucide-react';
import { FeedPostEnriched } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface FeedPostItemProps {
  post: FeedPostEnriched;
  currentUserId: number;
}

// Renders a single feed entry. Phase 2 handles COMMENT + SYSTEM_EVENT; the
// ESCALATION_CARD / INFO_CARD types fall through to a neutral card and are
// fleshed out in Phase 3.
export default function FeedPostItem({ post, currentUserId }: FeedPostItemProps) {
  if (post.type === 'SYSTEM_EVENT') {
    return (
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Settings className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 min-w-0">
          <p className="text-xs text-slate-500 italic leading-relaxed">{post.content}</p>
          <p className="text-[10px] text-slate-400 mt-1">{formatTimestamp(post.createdAt)}</p>
        </div>
      </div>
    );
  }

  // COMMENT (and, for now, any future card types render as a neutral note).
  const authorName = post.author?.name ?? 'Unknown';
  const isSelf = post.authorId === currentUserId;

  return (
    <div className={`flex items-start gap-2.5 ${isSelf ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5 ${
          isSelf ? 'bg-blue-600 text-white' : 'bg-indigo-100 text-indigo-700'
        }`}
      >
        {getInitials(authorName)}
      </div>

      <div className={`flex-1 min-w-0 ${isSelf ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`flex items-center gap-2 mb-1 ${isSelf ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-semibold text-slate-700">{isSelf ? 'You' : authorName}</span>
          <span className="text-[10px] text-slate-400">{formatTimestamp(post.createdAt)}</span>
        </div>
        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed max-w-full break-words ${
            isSelf ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-slate-100 text-slate-800 rounded-tl-sm'
          }`}
        >
          {post.content}
        </div>
      </div>
    </div>
  );
}
