'use client';

import { useState, useEffect, useRef } from 'react';
import { FeedPostEnriched, FeedPostType, User, MentionUser } from '../../types';
import { getFeedPage, postFeedComment } from '../../api/feedApi';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { feedKey } from '../../store/realtimeStore';
import { formatTimestamp, getInitials } from '../../utils/feedHelpers';
import FeedFilterBar from '../feed/FeedFilterBar';
import CommentModerationMenu from '../feed/CommentModerationMenu';
import MentionField from '../feed/MentionField';
import MentionsLine from '../feed/MentionsLine';
import NewUpdatesPill from '../ui/NewUpdatesPill';
import toast from 'react-hot-toast';
import { Settings, MessageCircle, Send } from 'lucide-react';

// Finding feeds only carry comments and system events (no escalation cards).
const FINDING_FILTER_OPTIONS: FeedPostType[] = ['COMMENT', 'SYSTEM_EVENT'];

interface FindingActivityFeedProps {
  findingId: number;
  currentUser: User;
  onRefresh?: () => void;
}

export default function FindingActivityFeed({ findingId, currentUser, onRefresh }: FindingActivityFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [posts, setPosts] = useState<FeedPostEnriched[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hidden, setHidden] = useState<Set<FeedPostType>>(new Set());
  const [showHidden, setShowHidden] = useState(false); // Director/Admin: reveal soft-hidden comments
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [mentionSel, setMentionSel] = useState<MentionUser[]>([]);

  const canModerate = currentUser.role === 'Director' || currentUser.role === 'Admin';

  // Load the newest page on mount (and when Show-hidden toggles). setState lives in
  // promise callbacks (not synchronously in the effect body) to satisfy
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    getFeedPage('FINDING', findingId, { includeHidden: showHidden })
      .then((page) => { if (!cancelled) { setPosts(page.posts); setCursor(page.nextCursor); } })
      .catch(() => { if (!cancelled) { setPosts([]); setCursor(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [findingId, showHidden]);

  // Auto-scroll to newest only when the BOTTOM entry changes (initial load or an
  // appended post) — never when older posts are prepended via "Load earlier".
  const lastIdRef = useRef<number | null>(null);
  useEffect(() => {
    const lastId = posts.length ? posts[posts.length - 1].id : null;
    if (lastId !== lastIdRef.current) {
      if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
      lastIdRef.current = lastId;
    }
  }, [posts]);

  // Reload helper (called by realtime refresh + parent onRefresh).
  const reloadFeed = () => {
    getFeedPage('FINDING', findingId, { includeHidden: showHidden })
      .then((page) => { setPosts(page.posts); setCursor(page.nextCursor); })
      .catch(() => {});
    onRefresh?.();
  };

  const handleLoadEarlier = async () => {
    if (cursor == null || loadingEarlier) return;
    setLoadingEarlier(true);
    const el = feedRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await getFeedPage('FINDING', findingId, { before: cursor, includeHidden: showHidden });
      setPosts((prev) => [...page.posts, ...prev]);
      setCursor(page.nextCursor);
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } catch {
      /* transient */
    } finally {
      setLoadingEarlier(false);
    }
  };

  const toggleHidden = (t: FeedPostType) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });

  const visiblePosts = posts.filter((p) => !hidden.has(p.type));

  const { hasNew, refresh } = useRealtimeRefresh(feedKey('FINDING', findingId), reloadFeed);

  const handlePostComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      const newPost = await postFeedComment('FINDING', findingId, comment.trim(), mentionSel.map((m) => m.id));
      setPosts((prev) => [...prev, newPost]);
      setComment('');
      setMentionSel([]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handlePostComment();
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-slate-100 flex-shrink-0">
        <MessageCircle className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Activity Feed</h2>
        <span className="ml-auto text-xs text-slate-400">{posts.length} entries</span>
        <div className="w-full flex items-center justify-between gap-2">
          <FeedFilterBar hidden={hidden} onToggle={toggleHidden} options={FINDING_FILTER_OPTIONS} />
          {canModerate && (
            <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="accent-rose-500" />
              Show hidden
            </label>
          )}
        </div>
      </div>

      {/* Feed list */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        <NewUpdatesPill show={hasNew} onClick={refresh} />
        {!loading && cursor != null && (
          <div className="flex justify-center">
            <button
              onClick={handleLoadEarlier}
              disabled={loadingEarlier}
              className="px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-full border border-blue-200 transition-colors disabled:opacity-50"
            >
              {loadingEarlier ? 'Loading…' : 'Load earlier'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500" />
          </div>
        ) : visiblePosts.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-8">
            No activity yet. Actions and comments will appear here.
          </div>
        ) : (
          visiblePosts.map((entry) => {
            const isSystem = entry.type === 'SYSTEM_EVENT';

            if (isSystem) {
              return (
                <div key={entry.id} className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Settings className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <div className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 min-w-0">
                    <p className="text-xs text-slate-500 italic leading-relaxed">{entry.content}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{formatTimestamp(entry.createdAt)}</p>
                  </div>
                </div>
              );
            }

            // COMMENT entry
            const authorName = entry.author?.name ?? 'Unknown';
            const isSelf = entry.authorId === currentUser.id;

            return (
              <div key={entry.id} className={`flex items-start gap-2.5 ${isSelf ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5 ${
                  isSelf ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {getInitials(authorName)}
                </div>
                <div className={`flex-1 min-w-0 ${isSelf ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div className={`flex items-center gap-2 mb-1 ${isSelf ? 'flex-row-reverse' : ''}`}>
                    <span className="text-xs font-semibold text-slate-700">{isSelf ? 'You' : authorName}</span>
                    <span className="text-[10px] text-slate-400">{formatTimestamp(entry.createdAt)}</span>
                    {entry.hidden && (
                      <span className="text-[10px] font-medium text-rose-500 italic" title="Hidden — visible to Director/Admin only">Hidden</span>
                    )}
                    <CommentModerationMenu
                      postId={entry.id}
                      isHidden={!!entry.hidden}
                      isPinned={false}
                      canModerate={canModerate}
                      canPin={false}
                      onChanged={reloadFeed}
                    />
                  </div>
                  <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed max-w-full break-words ${
                    entry.hidden
                      ? 'bg-slate-50 text-slate-400 italic border border-dashed border-slate-200'
                      : isSelf
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-slate-100 text-slate-800 rounded-tl-sm'
                  }`}>
                    {entry.content}
                  </div>
                  <MentionsLine mentions={entry.mentions} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Comment composer — open to all authenticated users */}
      <div className="border-t border-slate-100 p-4 flex-shrink-0">
        <div className="flex gap-2.5 items-end">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 text-xs font-bold text-white">
            {getInitials(currentUser.name)}
          </div>
          <div className="flex-1 relative">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a comment… (Ctrl+Enter to send)"
              rows={2}
              className="w-full px-3.5 py-2.5 pr-12 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <button
              onClick={handlePostComment}
              disabled={!comment.trim() || posting}
              className="absolute right-2 bottom-2 p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition-all"
              title="Post comment (Ctrl+Enter)"
            >
              {posting ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
        <div className="mt-2 pl-10">
          <MentionField selected={mentionSel} onChange={setMentionSel} />
        </div>
      </div>
    </div>
  );
}
