'use client';

import { useState, useEffect, useRef } from 'react';
import { TaskEnriched, TaskActivityEnriched, EscalationTargetScope, User } from '../../types';
import { postTaskComment } from '../../api/taskApi';
import toast from 'react-hot-toast';
import { Settings, MessageCircle, Send } from 'lucide-react';
import FlagButton from '../feed/FlagButton';
import NewUpdatesPill from '../ui/NewUpdatesPill';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { feedKey } from '../../store/realtimeStore';
import { formatTimestamp, getInitials } from '../../utils/feedHelpers';

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

  // Live activity on this task's feed → "new updates" pill + focus-refetch,
  // using the parent's refetch (no-op when the parent doesn't supply one).
  const { hasNew, refresh } = useRealtimeRefresh(feedKey('TASK', task.id), () => onRefresh?.());

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
      const newActivity = await postTaskComment(task.id, comment.trim());
      onNewActivity(newActivity);
      setComment('');
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
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 flex-shrink-0">
        <MessageCircle className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Activity Feed</h2>
        <span className="ml-auto text-xs text-slate-400">{activities.length} entries</span>
      </div>

      {/* Feed list */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
      >
        {onRefresh && <NewUpdatesPill show={hasNew} onClick={refresh} />}
        {activities.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-8">
            No activity yet. Actions and comments will appear here.
          </div>
        ) : (
          activities.map((entry) => {
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
                  isSelf ? 'bg-blue-600 text-white' : 'bg-indigo-100 text-indigo-700'
                }`}>
                  {getInitials(authorName)}
                </div>

                {/* Bubble */}
                <div className={`flex-1 min-w-0 ${isSelf ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div className={`flex items-center gap-2 mb-1 ${isSelf ? 'flex-row-reverse' : ''}`}>
                    <span className="text-xs font-semibold text-slate-700">{isSelf ? 'You' : authorName}</span>
                    <span className="text-[10px] text-slate-400">{formatTimestamp(entry.createdAt)}</span>
                    <FlagButton postId={entry.id} targets={taskFlagTargets} />
                  </div>
                  <div className={`px-3.5 py-2.5 rounded-2xl text-sm text-slate-700 leading-relaxed max-w-full break-words ${
                    isSelf
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-slate-100 text-slate-800 rounded-tl-sm'
                  }`}>
                    {entry.content}
                  </div>
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
                placeholder="Write a comment... (Ctrl+Enter to send)"
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
        </div>
      )}
    </div>
  );
}
