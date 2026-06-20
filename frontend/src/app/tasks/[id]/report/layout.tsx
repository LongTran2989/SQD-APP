'use client';

import { useRequireAuth } from '../../../../hooks/useRequireAuth';

// Deliberately outside /dashboard: dashboard/layout.tsx wraps everything in a
// fixed-height `h-screen overflow-hidden` flex shell (for its sticky
// sidebar/header), which clips multi-page output when the browser prints. This
// layout has no such ancestor, so Ctrl+P pagination works correctly. No
// Sidebar/Header here — it's a standalone, scrollable, printable view.
export default function TaskReportLayout({ children }: { children: React.ReactNode }) {
  const { ready } = useRequireAuth();

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return <div className="min-h-screen bg-white">{children}</div>;
}
