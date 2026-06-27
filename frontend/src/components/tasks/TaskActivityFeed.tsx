'use client';

import { useState, useEffect, useRef } from 'react';
import { TaskEnriched, TaskActivityEnriched, FeedPostType, EscalationTargetScope, User, MentionUser } from '../../types';
import { postTaskComment, getTaskActivityPage } from '../../api/taskApi';
import toast from 'react-hot-toast';
import { Settings, MessageCircle, Send } from 'lucide-react';
import FlagButton from '../feed/FlagButton';
import FeedFilterBar from '../feed/FeedFilterBar';
import CommentModerationMenu from '../feed/CommentModerationMenu';
import MentionField from '../feed/MentionField';
import MentionsLine from '../feed/MentionsLine';
import CommentContent from '../feed/CommentContent';
import NewUpdatesPill from '../ui/NewUpdatesPill';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { feedKey } from '../../store/realtimeStore';
import { formatTimestamp, getInitials } from '../../utils/feedHelpers';

// Task feeds carry comments and system events (no escalation cards on the feed).
const TASK_FILTER_OPTIONS: FeedPostType[] = ['COMMENT', 'SYSTEM_EVENT'];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskActivityFeedProps {
  task: TaskEnriched;
  activities: TaskActivityEnriched[];
  currentUser: User;
  onNewActivity: (activity: TaskActivityEnriched) => void;
  // When true the comment composer is hidden — e.g. the Finding detail page
  // shows the source task's feed read-only.
  readOnly?: boolean;
  // Parent-owned refetch of this task's activity. When provided, live feed
  // signals surface a "new updates" pill / focus-refetch instead of silently
  // going stale.
  onRefresh?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaskActivityFeed({
  task,
  activities,
  currentUser,
  onNewActivity,
  readOnly = false,
  onRefresh,
}: TaskActivityFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [mentionSel, setMentionSel] = useState<MentionUser[]>([]);
  // Older entries loaded via "Load earlier" — kept separate from the parent-owned
  // `activities` (the newest page) so the parent's refresh logic stays untouched.
  // cursor: undefined = unknown (button shown optimistically), number = more
  // available, null = start of feed reached.
  const [earlier, setEarlier] = useState<TaskActivityEnriched[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hidden, setHidden] = useState<Set<FeedPostType>>(new Set());
  // Director/Admin "Show hidden" moderation view: a self-fetched newest page that
  // INCLUDES soft-hidden comments (the parent-owned `activities` never carries
  // hidden ones). When active it replaces the normal merged list (load-earlier off).
  const [showHidden, setShowHidden] = useState(false);
  const [modView, setModView] = useState<TaskActivityEnriched[] | null>(null);

  const canModerate = currentUser.role === 'Director' || currentUser.role === 'Admin';

  // The parent re-fetches the newest page on task change; drop any locally loaded
  // older entries (and the moderation view) so we never show a stale/mismatched
  // history for a new task. Reset during render (React's "adjust state when a prop
  // changes" pattern) so we avoid a setState-in-effect cascade.
  const [trackedTaskId, setTrackedTaskId] = useState(task.id);
  if (trackedTaskId !== task.id) {
    setTrackedTaskId(task.id);
    setEarlier([]);
    setCursor(undefined);
    setShowHidden(false);
    setModView(null);
  }

  // Fetch the moderation view when Show-hidden is on. We never clear it here (that
  // would be a setState-in-effect); `merged` simply ignores modView while
  // showHidden is off, and the task-change render guard resets it across tasks.
  useEffect(() => {
    if (!(showHidden && canModerate)) return;
    let cancelled = false;
    getTaskActivityPage(task.id, { includeHidden: true, limit: 100 })
      .then((p) => { if (!cancelled) setModView(p.activities); })
      .catch(() => { if (!cancelled) setModView([]); });
    return () => { cancelled = true; };
  }, [showHidden, canModerate, task.id]);

  // Live activity on this task's feed → "new updates" pill + focus-refetch,
  // using the parent's refetch (no-op when the parent doesn't supply one).
  const { hasNew, refresh } = useRealtimeRefresh(feedKey('TASK', task.id), () => onRefresh?.());

  // After a hide/unhide: refresh the parent (drops the hidden comment from the
  // normal view) and, if open, the moderation view.
  const onModerated = () => {
    onRefresh?.();
    if (showHidden && canModerate) {
      getTaskActivityPage(task.id, { includeHidden: true, limit: 100 }).then((p) => setModView(p.activities)).catch(() => {});
    }
  };

  // Merge older + newest page, de-duping by id (the newest page wins), then apply
  // the client-side type filter. `earlier` are strictly older than `activities`.
  // When the moderation view is active it takes over (already a full newest page).
  const activityIds = new Set(activities.map((a) => a.id));
  const merged = showHidden && modView != null
    ? modView
    : [...earlier.filter((e) => !activityIds.has(e.id)), ...activities];
  const visibleActivities = merged.filter((a) => !hidden.has(a.type as FeedPostType));

  const handleLoadEarlier = async () => {
    if (cursor === null || loadingEarlier) return;
    const before = (earlier[0]?.id ?? activities[0]?.id);
    if (before == null) { setCursor(null); return; }
    setLoadingEarlier(true);
    const el = feedRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await getTaskActivityPage(task.id, { before });
      setEarlier((prev) => [...page.activities, ...prev]);
      setCursor(page.nextCursor);
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } catch {
      /* transient — leave as-is */
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

  // Auto-scroll to bottom on mount and when activities change
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activities.length]);

  // OQ-6: Comment box visible for all statuses to authorised users. Reviewer
  // rights come from the server (privilege-aware); the assignee can also comment.
  const canComment =
    !readOnly &&
    (task.isReviewer || currentUser.id === task.assignedToUserId);

  // A task comment can escalate to its WP (only if the task is in one), its
  // Division, or the Org. Backend re-validates and places the cards.
  const taskFlagTargets: EscalationTargetScope[] = task.wpId
    ? ['WP', 'DIVISION', 'ORG']
    : ['DIVISION', 'ORG'];

  const handlePostComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      const newActivity = await postTaskComment(task.id, comment.trim(), mentionSel.map((m) => m.id));
      onNewActivity(newActivity);
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
        <span className="ml-auto text-xs text-slate-400">{merged.length} entries</span>
        <div className="w-full flex items-center justify-between gap-2">
          <FeedFilterBar hidden={hidden} onToggle={toggleHidden} options={TASK_FILTER_OPTIONS} />
          {canModerate && (
            <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="accent-rose-500" />
              Show hidden
            </label>
          )}
        </div>
      </div>

      {/* Feed list */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
      >
        {onRefresh && <NewUpdatesPill show={hasNew} onClick={refresh} />}
        {!showHidden && cursor !== null && merged.length > 0 && (
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
        {visibleActivities.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-8">
            No activity yet. Actions and comments will appear here.
          </div>
        ) : (
          visibleActivities.map((entry) => {
            const isSystem = entry.type === 'SYSTEM_EVENT';

            if (isSystem) {
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5"
                >
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
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5 ${
                  isSelf ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {getInitials(authorName)}
                </div>

                {/* Bubble */}
                <div className={`flex-1 min-w-0 ${isSelf ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div className={`flex items-center gap-2 mb-1 ${isSelf ? 'flex-row-reverse' : ''}`}>
                    <span className="text-xs font-semibold text-slate-700">{isSelf ? 'You' : authorName}</span>
                    <span className="text-[10px] text-slate-400">{formatTimestamp(entry.createdAt)}</span>
                    {entry.hidden && (
                      <span className="text-[10px] font-medium text-rose-500 italic" title="Hidden — visible to Director/Admin only">Hidden</span>
                    )}
                    <FlagButton postId={entry.id} targets={taskFlagTargets} />
                    <CommentModerationMenu
                      postId={entry.id}
                      isHidden={!!entry.hidden}
                      isPinned={false}
                      canModerate={canModerate}
                      canPin={false}
                      onChanged={onModerated}
                    />
                  </div>
                  <div className={`px-3.5 py-2.5 rounded-2xl text-sm text-slate-700 leading-relaxed max-w-full break-words ${
                    entry.hidden
                      ? 'bg-slate-50 text-slate-400 italic border border-dashed border-slate-200'
                      : isSelf
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-slate-100 text-slate-800 rounded-tl-sm'
                  }`}>
                    <CommentContent content={entry.content} entityLinks={entry.entityLinks} />
                  </div>
                  <MentionsLine mentions={entry.mentions} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Comment input */}
      {canComment && (
        <div className="border-t border-slate-100 p-4 flex-shrink-0">
          <div className="flex gap-2.5 items-end">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 text-xs font-bold text-white">
              {getInitials(currentUser.name)}
            </div>
            <div className="flex-1 relative">
              <textarea
                id="comment-input"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a comment… (#CODE links a task/WP/finding · Ctrl+Enter to send)"
                rows={2}
                className="w-full px-3.5 py-2.5 pr-12 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <button
                id="post-comment-btn"
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
      )}
    </div>
  );
}
