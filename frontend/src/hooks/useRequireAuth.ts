'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/authStore';

// Waits for the persisted auth store to hydrate, then redirects to /login if
// the user isn't authenticated. Shared by every layout that gates a route
// behind login (dashboard/layout.tsx, tasks/[id]/report/layout.tsx) so the
// hydration-wait dance lives in exactly one place.
export function useRequireAuth(): { ready: boolean } {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [mounted, setMounted] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setHasHydrated(true);
    } else {
      const unsub = useAuthStore.persist.onFinishHydration(() => {
        setHasHydrated(true);
      });
      return unsub;
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    if (hasHydrated && !isAuthenticated) {
      router.push('/login');
    }
  }, [hasHydrated, isAuthenticated, router]);

  return { ready: mounted && hasHydrated && isAuthenticated };
}
