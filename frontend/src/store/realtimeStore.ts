import { create } from 'zustand';

// Key identifying a single feed (e.g. "TASK:142", "WP:7", "ORG"). Used to route
// feed signals to the views that care about them.
export type FeedKey = string;

export function feedKey(scope: string, scopeId: number | null | undefined): FeedKey {
  return scopeId == null ? scope : `${scope}:${scopeId}`;
}

interface RealtimeState {
  // Whether the live SSE stream is currently connected (purely informational).
  connected: boolean;
  // Cached unread-notification count driving the inbox bell badge.
  unreadCount: number;
  // Monotonic counter per feed key. A view compares the value it last "saw"
  // against the current value to know whether new activity has arrived.
  feedSignals: Record<FeedKey, number>;

  setConnected: (v: boolean) => void;
  setUnreadCount: (n: number) => void;
  bumpUnread: (delta?: number) => void;
  bumpFeed: (key: FeedKey) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  connected: false,
  unreadCount: 0,
  feedSignals: {},

  setConnected: (v) => set({ connected: v }),
  setUnreadCount: (n) => set({ unreadCount: Math.max(0, n) }),
  bumpUnread: (delta = 1) => set((s) => ({ unreadCount: Math.max(0, s.unreadCount + delta) })),
  bumpFeed: (key) =>
    set((s) => ({ feedSignals: { ...s.feedSignals, [key]: (s.feedSignals[key] ?? 0) + 1 } })),
}));
