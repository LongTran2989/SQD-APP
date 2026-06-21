'use client';

import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import TaskQuickViewPanel from './TaskQuickViewPanel';
import WpQuickViewPanel from './WpQuickViewPanel';

interface QuickViewApi {
  openTask: (id: number) => void;
  openWp: (id: number) => void;
}

const QuickViewContext = createContext<QuickViewApi | null>(null);

/**
 * Reusable inline preview for tasks and work packages. Mount once (in the
 * dashboard layout); any descendant calls useQuickView().openTask(id) /
 * .openWp(id) to slide a read-only drawer over the page instead of navigating
 * away. Each drawer carries an "Open full …" link for full navigation.
 */
export function useQuickView(): QuickViewApi {
  const ctx = useContext(QuickViewContext);
  if (!ctx) throw new Error('useQuickView must be used within a QuickViewProvider');
  return ctx;
}

export default function QuickViewProvider({ children }: { children: ReactNode }) {
  const [taskId, setTaskId] = useState<number | null>(null);
  const [wpId, setWpId] = useState<number | null>(null);

  // One drawer at a time — opening one closes the other.
  const openTask = useCallback((id: number) => { setWpId(null); setTaskId(id); }, []);
  const openWp = useCallback((id: number) => { setTaskId(null); setWpId(id); }, []);

  // Stable value so consumers don't re-render when a drawer opens/closes.
  const api = useMemo<QuickViewApi>(() => ({ openTask, openWp }), [openTask, openWp]);

  return (
    <QuickViewContext.Provider value={api}>
      {children}
      {taskId != null && <TaskQuickViewPanel taskId={taskId} onClose={() => setTaskId(null)} />}
      {wpId != null && <WpQuickViewPanel wpId={wpId} onClose={() => setWpId(null)} />}
    </QuickViewContext.Provider>
  );
}
