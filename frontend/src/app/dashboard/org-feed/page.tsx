'use client';

import { useAuthStore } from '../../../store/authStore';
import FeedPanel from '../../../components/feed/FeedPanel';
import { Globe } from 'lucide-react';

// Org-wide feed (the singleton ORG scope). Everyone can read; posting is
// restricted to Director / Admin / Manager (enforced by the backend and
// mirrored by FeedPanel, which hides the composer for other roles).
export default function OrgFeedPage() {
  const { user } = useAuthStore();
  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <Globe className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Org Feed</h1>
          <p className="text-sm text-slate-500">Organisation-wide announcements and escalations.</p>
        </div>
      </div>

      <div className="h-[calc(100vh-12rem)]">
        <FeedPanel scope="ORG" currentUser={user} title="Org Feed" />
      </div>
    </div>
  );
}
