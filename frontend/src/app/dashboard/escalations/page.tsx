'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Flag, ArrowUpRight } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { PendingEscalation, EscalationTargetScope } from '../../../types';
import { getPendingEscalations } from '../../../api/escalationApi';
import { formatTimestamp, sourceHref } from '../../../utils/feedHelpers';
import EscalationActions from '../../../components/feed/EscalationActions';

// Only roles with an actionable queue may open this page (the list endpoint also
// RBAC-filters server-side; this avoids showing GL/Staff an empty shell).
const ESCALATION_ROLES = ['Director', 'Admin', 'Manager'];

const TARGET_LABEL: Record<EscalationTargetScope, string> = {
  WP: 'Work Package',
  DIVISION: 'Division Board',
  ORG: 'Org Feed',
};

export default function EscalationsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const allowed = !!user && ESCALATION_ROLES.includes(user.role);

  const [escalations, setEscalations] = useState<PendingEscalation[]>([]);
  const [loading, setLoading] = useState(true);

  // Redirect non-actioners out (Sidebar already hides the link, this is defence).
  useEffect(() => {
    if (user && !allowed) router.replace('/dashboard');
  }, [user, allowed, router]);

  // Load the queue on mount. setState lives in the promise callbacks (FeedPanel
  // pattern) so it never trips react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    getPendingEscalations()
      .then((data) => { if (!cancelled) setEscalations(data); })
      .catch(() => { if (!cancelled) setEscalations([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed]);

  const reload = () => {
    getPendingEscalations()
      .then(setEscalations)
      .catch(() => {});
  };

  if (!user || !allowed) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
          <Flag className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Escalations</h1>
          <p className="text-sm text-slate-500">Pending escalations awaiting your action.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : escalations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400 text-sm">
          No pending escalations.
        </div>
      ) : (
        <div className="space-y-3">
          {escalations.map((esc) => {
            const href = sourceHref(esc);
            return (
              <div key={esc.id} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Flag className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span className="text-xs font-bold uppercase tracking-wide text-amber-700">
                    To {TARGET_LABEL[esc.targetScope]}
                  </span>
                  <span className="ml-auto text-[10px] text-slate-400">{formatTimestamp(esc.createdAt)}</span>
                </div>

                {esc.sourceExcerpt && (
                  <blockquote className="border-l-2 border-amber-300 pl-2.5 text-xs italic text-slate-500 break-words">
                    {esc.sourceExcerpt}
                  </blockquote>
                )}

                <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                  <span>Flagged by {esc.flaggedBy?.name ?? `User ${esc.flaggedByUserId}`}</span>
                  {href && (
                    <Link href={href} className="inline-flex items-center gap-1 font-medium text-amber-700 hover:text-amber-900">
                      View source
                      <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>

                <div className="mt-3 border-t border-amber-200 pt-3">
                  <EscalationActions
                    flagId={esc.id}
                    sourceTaskId={esc.sourceTaskId}
                    sourceWpId={esc.sourceWpId}
                    canRaiseFinding={esc.sourceTaskId != null}
                    onActioned={reload}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
