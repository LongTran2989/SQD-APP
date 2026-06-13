'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRealtimeStore, FeedKey } from '../store/realtimeStore';

/**
 * Wires a self-loading feed view to the realtime "new updates" UX without ever
 * yanking content out from under the reader:
 *
 *  - `hasNew` flips true when a feed signal for `key` arrives after the view's
 *    last refresh — drive the "N new updates" pill with it.
 *  - `refresh()` runs the caller's existing refetch and clears `hasNew`.
 *  - On tab refocus (visibilitychange / window focus) the view refetches
 *    automatically, since signals are missed while the tab is hidden.
 *
 * `refetch` is captured in a ref so callers can pass an inline closure without
 * re-subscribing every render.
 */
export function useRealtimeRefresh(key: FeedKey, refetch: () => void) {
  const signal = useRealtimeStore((s) => s.feedSignals[key] ?? 0);
  const [seen, setSeen] = useState(signal);

  // Keep the latest refetch in a ref (updated in an effect, never during render)
  // so subscribers can pass an inline closure without re-wiring listeners.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  const hasNew = signal > seen;

  const refresh = useCallback(() => {
    refetchRef.current();
    // Mark every signal up to the current one as consumed.
    setSeen(useRealtimeStore.getState().feedSignals[key] ?? 0);
  }, [key]);

  // Refetch when the user returns to the tab (signals don't arrive while hidden).
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        refetchRef.current();
        setSeen(useRealtimeStore.getState().feedSignals[key] ?? 0);
      }
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [key]);

  return { hasNew, refresh };
}
