'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import Sidebar from '../../components/layout/Sidebar';
import Header from '../../components/layout/Header';
import RealtimeProvider from '../../realtime/RealtimeProvider';
import QuickViewProvider from '../../components/quickview/QuickViewProvider';

import { Toaster } from 'react-hot-toast';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { ready } = useRequireAuth();

  useEffect(() => {
    if (ready) {
      const user = useAuthStore.getState().user;
      if (user?.employeeId) {
        // Delay setting the title to ensure it overrides Next.js static metadata upon hydration/navigation
        const timeout = setTimeout(() => {
          document.title = `${user.employeeId} - SQD APP`;
        }, 50);
        return () => clearTimeout(timeout);
      }
    }
  }, [ready, pathname]);

  // Prevent hydration mismatch and hide content until auth check completes
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-900">
      <Toaster position="top-right" />
      {/* Opens the single live SSE stream for the signed-in user. */}
      <RealtimeProvider />
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <QuickViewProvider>
            {children}
          </QuickViewProvider>
        </main>
      </div>
    </div>
  );
}
