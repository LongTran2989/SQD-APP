import React from 'react';
import { Activity, MessageSquare, AlertCircle, Info } from 'lucide-react';
import { FeedPost } from '../../api/dashboardApi';

interface ActivityFeedWidgetProps {
  posts: FeedPost[];
  isLoading: boolean;
}

export function ActivityFeedWidget({ posts, isLoading }: ActivityFeedWidgetProps) {
  return (
    <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-slate-100 flex flex-col h-full overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
        <div className="p-2 bg-indigo-50 rounded-lg">
          <Activity className="w-5 h-5 text-indigo-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">Activity Feed</h2>
      </div>

      <div className="p-5 overflow-y-auto flex-1 max-h-[400px]">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse flex gap-4">
                <div className="w-10 h-10 bg-slate-200 rounded-full shrink-0"></div>
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                  <div className="h-3 bg-slate-200 rounded w-1/4"></div>
                </div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 py-8">
            <Info className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No recent activity</p>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <div key={post.id} className="flex gap-4 group">
                <div className="shrink-0 mt-1">
                  {post.type === 'COMMENT' ? (
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-500">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                  ) : post.type === 'SYSTEM_EVENT' ? (
                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 text-blue-500">
                      <Info className="w-4 h-4" />
                    </div>
                  ) : post.type === 'ESCALATION_CARD' ? (
                    <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center border border-red-100 text-red-500">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-100"></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800 break-words">
                    {post.author && <span className="font-semibold mr-1">{post.author.name}</span>}
                    <span className={post.type === 'COMMENT' ? 'text-slate-600' : ''}>{post.content}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 font-medium flex items-center gap-2">
                    {new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] uppercase tracking-wider">
                      {post.scope} {post.scopeId ? `#${post.scopeId}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
