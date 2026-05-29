'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import Sidebar from '../../components/layout/Sidebar';
import Header from '../../components/layout/Header';

import { Toaster } from 'react-hot-toast';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isAuthenticated) {
      router.push('/login');
    } else {
      const user = useAuthStore.getState().user;
      if (user?.employeeId) {
        // Delay setting the title to ensure it overrides Next.js static metadata upon hydration/navigation
        const timeout = setTimeout(() => {
          document.title = `${user.employeeId} - SQD APP`;
        }, 50);
        return () => clearTimeout(timeout);
      }
    }
  }, [isAuthenticated, router, pathname]);

  // Prevent hydration mismatch and hide content until auth check completes
  if (!mounted || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-900">
      <Toaster position="top-right" />
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
