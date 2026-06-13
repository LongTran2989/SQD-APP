'use client';

import { useEffect } from 'react';
import { API_BASE_URL } from '../api/client';
import { useRealtimeStore, feedKey } from '../store/realtimeStore';
import { getUnreadCount } from '../api/notificationApi';
import { ESCALATIONS_CHANGED_EVENT } from '../api/escalationApi';

/**
 * Opens a single Server-Sent-Events stream for the signed-in user and fans the
 * lightweight SIGNALS it receives into the realtime store. The server never
 * sends payloads — every signal just tells the client "something changed, go
 * refetch via REST", so all RBAC scoping and the dual-write are reused.
 *
 * Mounted inside the authenticated dashboard layout, so it only ever runs for a
 * logged-in user; EventSource carries the httpOnly auth cookie automatically.
 * EventSource also reconnects on its own after a drop — on each (re)connect we
 * resync the unread count so the badge can never drift.
 */
export default function RealtimeProvider() {
  const setConnected = useRealtimeStore((s) => s.setConnected);
  const setUnreadCount = useRealtimeStore((s) => s.setUnreadCount);
  const bumpFeed = useRealtimeStore((s) => s.bumpFeed);

  useEffect(() => {
    const url = `${API_BASE_URL}/events/stream`;
    const source = new EventSource(url, { withCredentials: true });

    const refreshUnread = () => {
      getUnreadCount()
        .then(setUnreadCount)
        .catch(() => {});
    };

    // Connection (re)established — resync the badge from the source of truth.
    const onReady = () => {
      setConnected(true);
      refreshUnread();
    };

    // A new inbox notification was written for this user.
    const onNotification = () => {
      refreshUnread();
      // An ESCALATION_QUEUED notification also affects the escalation bell; a
      // cheap broadcast lets that existing badge refresh too (harmless if the
      // notification was something else — the queue simply re-reads as before).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(ESCALATIONS_CHANGED_EVENT));
      }
    };

    // The actionable escalation queue changed — nudge the existing bell.
    const onEscalation = () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(ESCALATIONS_CHANGED_EVENT));
      }
    };

    // New activity on a feed — bump its signal so any open view of that feed can
    // surface a "new updates" pill / soft-refetch.
    const onFeed = (e: MessageEvent) => {
      try {
        const { scope, scopeId } = JSON.parse(e.data) as { scope: string; scopeId: number | null };
        bumpFeed(feedKey(scope, scopeId));
      } catch {
        /* ignore malformed frames */
      }
    };

    source.addEventListener('ready', onReady);
    source.addEventListener('notification', onNotification);
    source.addEventListener('escalation', onEscalation);
    source.addEventListener('feed', onFeed);
    source.onerror = () => setConnected(false); // EventSource auto-reconnects

    return () => {
      source.removeEventListener('ready', onReady);
      source.removeEventListener('notification', onNotification);
      source.removeEventListener('escalation', onEscalation);
      source.removeEventListener('feed', onFeed);
      source.close();
      setConnected(false);
    };
  }, [setConnected, setUnreadCount, bumpFeed]);

  return null;
}
