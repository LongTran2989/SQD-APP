'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, CheckCheck } from 'lucide-react';
import { AppNotification, NotificationLinkScope } from '../../types';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../api/notificationApi';
import { useRealtimeStore } from '../../store/realtimeStore';

// Maps a notification's deep-link target to its dashboard route.
function linkHref(scope: NotificationLinkScope | null, id: number | null): string | null {
  if (!scope) return null;
  switch (scope) {
    case 'TASK':
      return id == null ? null : `/dashboard/tasks/${id}`;
    case 'WP':
      return id == null ? null : `/dashboard/work-packages/${id}`;
    case 'FINDING':
      return id == null ? null : `/dashboard/findings/${id}`;
    case 'ESCALATION':
      return '/dashboard/escalations';
    default:
      return null;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationBell() {
  const router = useRouter();
  const unreadCount = useRealtimeStore((s) => s.unreadCount);
  const setUnreadCount = useRealtimeStore((s) => s.setUnreadCount);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Prime the badge on first mount in case the SSE stream hasn't sent its first
  // signal yet (e.g. immediately after login).
  useEffect(() => {
    getUnreadCount().then(setUnreadCount).catch(() => {});
  }, [setUnreadCount]);

  // (Re)load the open list whenever the dropdown opens or new activity arrives.
  // Resets loading/error state on each fetch so stale state never persists.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setFetchError(false);
    listNotifications({ limit: 15 })
      .then((page) => { if (!cancelled) { setItems(page.items); setFetchError(false); } })
      .catch(() => { if (!cancelled) { setItems([]); setFetchError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, unreadCount]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleItemClick = async (n: AppNotification) => {
    setOpen(false);
    if (!n.readAt) {
      // Optimistically drop the badge, then persist.
      setUnreadCount(Math.max(0, unreadCount - 1));
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, readAt: new Date().toISOString() } : it)));
      markNotificationRead(n.id).catch(() => {});
    }
    const href = linkHref(n.linkScope, n.linkId);
    if (href) router.push(href);
  };

  const handleMarkAll = async () => {
    setUnreadCount(0);
    setItems((prev) => prev.map((it) => ({ ...it, readAt: it.readAt ?? new Date().toISOString() })));
    markAllNotificationsRead().catch(() => {});
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors relative"
        title={unreadCount > 0 ? `${unreadCount} unread notification(s)` : 'Notifications'}
      >
        <Inbox className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center bg-blue-600 text-white text-[10px] font-bold rounded-full border-2 border-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[28rem] bg-white rounded-xl border border-slate-200 shadow-lg z-20 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
            <h3 className="text-sm font-bold text-slate-700">Notifications</h3>
            <button
              onClick={handleMarkAll}
              className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
              title="Mark all as read"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : fetchError ? (
              <div className="text-center text-slate-400 text-sm py-10">Could not load notifications.</div>
            ) : items.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-10">You&apos;re all caught up.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-2.5 ${
                    n.readAt ? '' : 'bg-blue-50/40'
                  }`}
                >
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.readAt ? 'bg-transparent' : 'bg-blue-500'}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-700 truncate">{n.title}</span>
                    {n.body && <span className="block text-xs text-slate-500 line-clamp-2">{n.body}</span>}
                    <span className="block text-[10px] text-slate-400 mt-0.5">{relativeTime(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
