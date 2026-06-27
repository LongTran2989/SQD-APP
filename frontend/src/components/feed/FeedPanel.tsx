'use client';

import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { MessageCircle, Send, Pin } from 'lucide-react';
import { FeedPostEnriched, FeedScope, FeedPostType, EscalationTargetScope, User, MentionUser } from '../../types';
import { getFeedPage, getPinnedFeed, postFeedComment, canPostToFeed } from '../../api/feedApi';
import { getApiErrorMessage } from '../../utils/apiError';
import FeedPostItem from './FeedPostItem';
import FeedFilterBar from './FeedFilterBar';
import MentionField from './MentionField';
import NewUpdatesPill from '../ui/NewUpdatesPill';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { feedKey } from '../../store/realtimeStore';
import { getInitials } from '../../utils/feedHelpers';

interface FeedPanelProps {
  scope: FeedScope;
  scopeId?: number | null; // omit for ORG
  currentUser: User;
  title?: string;
  // Hide the composer regardless of RBAC (e.g. a read-only embed).
  readOnly?: boolean;
}

// Generic, self-loading feed panel for any scope. Reuses FeedPostItem for
// rendering and the feedApi RBAC mirror to gate the composer. The task feed
// keeps its own dedicated component (TaskActivityFeed) — this drives the
// WP / Division Board / Org feeds introduced in Phase 2.
export default function FeedPanel({ scope, scopeId, currentUser, title = 'Feed', readOnly = false }: FeedPanelProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [posts, setPosts] = useState<FeedPostEnriched[]>([]);
  const [pinned, setPinned] = useState<FeedPostEnriched[]>([]);
  const [cursor, setCursor] = useState<number | null>(null); // next `before` for older posts; null = start of feed
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hidden, setHidden] = useState<Set<FeedPostType>>(new Set());
  const [showHidden, setShowHidden] = useState(false); // Director/Admin: reveal soft-hidden comments
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [mentionSel, setMentionSel] = useState<MentionUser[]>([]);

  // Moderation rights (Phase D). Hide/unhide is Director/Admin; pin/unpin mirrors
  // posting rights and is only offered on the pinnable (WP/Division/Org) scopes.
  const canModerate = currentUser.role === 'Director' || currentUser.role === 'Admin';
  const isPinnableScope = scope === 'WP' || scope === 'DIVISION' || scope === 'ORG';
  const canPin = isPinnableScope && canPostToFeed(currentUser.role, currentUser.divisionId, scope, scopeId);

  const loadPinned = () => {
    if (!isPinnableScope) return;
    getPinnedFeed(scope, scopeId).then(setPinned).catch(() => {});
  };

  // Load the newest page on mount / scope change (and when Show-hidden toggles).
  // setState lives in the promise callbacks (not synchronously in the effect body)
  // — mirrors the Sidebar's badge-polling pattern. A 404 / transient error just
  // leaves an empty feed.
  useEffect(() => {
    let cancelled = false;
    getFeedPage(scope, scopeId, { includeHidden: showHidden })
      .then((page) => { if (!cancelled) { setPosts(page.posts); setCursor(page.nextCursor); } })
      .catch(() => { if (!cancelled) { setPosts([]); setCursor(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, scopeId, showHidden]);

  // Pinned strip loads independently of pagination/hidden state.
  useEffect(() => {
    let cancelled = false;
    if (isPinnableScope) {
      getPinnedFeed(scope, scopeId).then((p) => { if (!cancelled) setPinned(p); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [scope, scopeId, isPinnableScope]);

  // Older posts are prepended above the current page; the scroll container keeps
  // its position (we only grow the top), so the reader isn't yanked.
  const handleLoadEarlier = async () => {
    if (cursor == null || loadingEarlier) return;
    setLoadingEarlier(true);
    const el = feedRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await getFeedPage(scope, scopeId, { before: cursor, includeHidden: showHidden });
      setPosts((prev) => [...page.posts, ...prev]);
      setCursor(page.nextCursor);
      // Preserve the reader's view by restoring the scroll offset after growth.
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } catch {
      /* transient — leave the feed as-is */
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

  const canPost = !readOnly && canPostToFeed(currentUser.role, currentUser.divisionId, scope, scopeId);

  // A comment may only be escalated UPWARD. WP comments → Division / Org; Division
  // comments → Org; Org comments can't escalate. (Task comments are flagged from
  // the dedicated task feed, which knows the task's WP.)
  const flagTargets: EscalationTargetScope[] =
    scope === 'WP' ? ['DIVISION', 'ORG'] : scope === 'DIVISION' ? ['ORG'] : [];

  // Re-fetch after an escalation so the source-feed SYSTEM_EVENT (and any card
  // landing on this same feed) appears. Mirrors the load effect's setState.
  const reloadFeed = () => {
    getFeedPage(scope, scopeId, { includeHidden: showHidden })
      .then((page) => { setPosts(page.posts); setCursor(page.nextCursor); })
      .catch(() => {});
  };

  // After a hide/unhide/pin/unpin: refresh both the feed and the pinned strip.
  const onModerated = () => { reloadFeed(); loadPinned(); };

  // Live activity: surface a "new updates" pill (and refetch on tab refocus)
  // rather than yanking new posts in while the user is reading.
  const { hasNew, refresh } = useRealtimeRefresh(feedKey(scope, scopeId), reloadFeed);

  const handlePost = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      const created = await postFeedComment(scope, scopeId, comment.trim(), mentionSel.map((m) => m.id));
      setPosts((prev) => [...prev, created]);
      setComment('');
      setMentionSel([]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to post comment'));
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handlePost();
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-slate-100 flex-shrink-0">
        <MessageCircle className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">{title}</h2>
        <span className="ml-auto text-xs text-slate-400">{posts.length} entries</span>
        <div className="w-full flex items-center justify-between gap-2">
          <FeedFilterBar hidden={hidden} onToggle={toggleHidden} />
          {canModerate && (
            <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="accent-rose-500" />
              Show hidden
            </label>
          )}
        </div>
      </div>

      {/* Pinned strip */}
      {pinned.length > 0 && (
        <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/50 space-y-3 flex-shrink-0 max-h-48 overflow-y-auto">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
            <Pin className="w-3 h-3" /> Pinned
          </div>
          {pinned.map((post) => (
            <FeedPostItem
              key={`pin-${post.id}`}
              post={post}
              currentUserId={currentUser.id}
              canModerate={canModerate}
              canPin={canPin}
              onModerated={onModerated}
            />
          ))}
        </div>
      )}

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
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visiblePosts.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-8">
            No activity yet. Comments and events will appear here.
          </div>
        ) : (
          visiblePosts.map((post) => (
            <FeedPostItem
              key={post.id}
              post={post}
              currentUserId={currentUser.id}
              flagTargets={flagTargets}
              onFlagged={reloadFeed}
              onActioned={reloadFeed}
              canModerate={canModerate}
              canPin={canPin}
              onModerated={onModerated}
            />
          ))
        )}
      </div>

      {/* Composer */}
      {canPost && (
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
                placeholder="Write a comment... (Ctrl+Enter to send)"
                rows={2}
                className="w-full px-3.5 py-2.5 pr-12 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <button
                onClick={handlePost}
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
      )}
    </div>
  );
}
