'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Flag, ArrowUpRight, CheckCircle2, XCircle } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { PendingEscalation, EscalationFlagStatus } from '../../../types';
import { getEscalations } from '../../../api/escalationApi';
import { formatTimestamp, sourceHref, TARGET_SCOPE_LABEL, ACTION_LABEL } from '../../../utils/feedHelpers';
import { ESCALATION_ACTION_ROLES } from '../../../constants/escalationRoles';
import EscalationActions from '../../../components/feed/EscalationActions';

type StatusFilter = 'ALL' | EscalationFlagStatus;

// Per-status presentation. The page retains the full escalation history, so the
// card colour + badge + icon tell PENDING (live queue) from ACTIONED / DISMISSED
// (history) at a glance.
const STATUS_STYLE: Record<
  EscalationFlagStatus,
  { card: string; badge: string; icon: string; quote: string; link: string; divider: string; Icon: typeof Flag }
> = {
  PENDING: {
    card: 'border-amber-200 bg-amber-50',
    badge: 'bg-amber-100 text-amber-700',
    icon: 'text-amber-600',
    quote: 'border-amber-300',
    link: 'text-amber-700 hover:text-amber-900',
    divider: 'border-amber-200',
    Icon: Flag,
  },
  ACTIONED: {
    card: 'border-green-200 bg-green-50',
    badge: 'bg-green-100 text-green-700',
    icon: 'text-green-600',
    quote: 'border-green-300',
    link: 'text-green-700 hover:text-green-900',
    divider: 'border-green-200',
    Icon: CheckCircle2,
  },
  DISMISSED: {
    card: 'border-slate-200 bg-slate-50',
    badge: 'bg-slate-200 text-slate-600',
    icon: 'text-slate-400',
    quote: 'border-slate-300',
    link: 'text-slate-600 hover:text-slate-800',
    divider: 'border-slate-200',
    Icon: XCircle,
  },
};

export default function EscalationsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const allowed = !!user && ESCALATION_ACTION_ROLES.includes(user.role);

  const [escalations, setEscalations] = useState<PendingEscalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  // Redirect non-actioners out (Sidebar already hides the link, this is defence).
  useEffect(() => {
    if (user && !allowed) router.replace('/dashboard');
  }, [user, allowed, router]);

  // Load the list whenever the viewer or filter changes. setState lives in the
  // promise callbacks (FeedPanel pattern) so it never trips set-state-in-effect.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    getEscalations(statusFilter === 'ALL' ? undefined : statusFilter)
      .then((data) => { if (!cancelled) setEscalations(data); })
      .catch(() => { if (!cancelled) setEscalations([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [allowed, statusFilter]);

  // Re-fetch after an action (the row's status flips, so it moves queue → history).
  const reload = () => {
    getEscalations(statusFilter === 'ALL' ? undefined : statusFilter)
      .then(setEscalations)
      .catch(() => {});
  };

  if (!user || !allowed) return null;

  const pending = escalations.filter((e) => e.status === 'PENDING');
  const history = escalations.filter((e) => e.status !== 'PENDING');

  const renderCard = (esc: PendingEscalation) => {
    const style = STATUS_STYLE[esc.status];
    const href = sourceHref(esc);
    const Icon = style.Icon;
    return (
      <div key={esc.id} className={`rounded-xl border ${style.card} px-4 py-3`}>
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className={`w-4 h-4 ${style.icon} flex-shrink-0`} />
          <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${style.badge}`}>
            {esc.status}
          </span>
          <span className="text-xs font-semibold text-slate-600">To {TARGET_SCOPE_LABEL[esc.targetScope]}</span>
          <span className="ml-auto text-[10px] text-slate-400">{formatTimestamp(esc.createdAt)}</span>
        </div>

        {esc.sourceExcerpt && (
          <blockquote className={`border-l-2 ${style.quote} pl-2.5 text-xs italic text-slate-500 break-words`}>
            {esc.sourceExcerpt}
          </blockquote>
        )}

        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
          <span>Flagged by {esc.flaggedBy?.name ?? `User ${esc.flaggedByUserId}`}</span>
          {href && (
            <Link href={href} className={`inline-flex items-center gap-1 font-medium ${style.link}`}>
              View source
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          )}
        </div>

        {esc.status === 'PENDING' ? (
          <div className={`mt-3 border-t ${style.divider} pt-3`}>
            <EscalationActions
              flagId={esc.id}
              sourceTaskId={esc.sourceTaskId}
              sourceWpId={esc.sourceWpId}
              onActioned={reload}
            />
          </div>
        ) : (
          <div className={`mt-3 border-t ${style.divider} pt-2 text-xs text-slate-500`}>
            {(esc.action ? ACTION_LABEL[esc.action] : esc.status === 'DISMISSED' ? 'Dismissed' : 'Actioned')}
            {' by '}
            {esc.reviewedBy?.name ?? 'someone'}
            {esc.actionedAt && <span className="text-slate-400"> · {formatTimestamp(esc.actionedAt)}</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
          <Flag className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Escalations</h1>
          <p className="text-sm text-slate-500">Your pending queue and the full escalation history.</p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setLoading(true); setStatusFilter(e.target.value as StatusFilter); }}
          className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-200"
        >
          <option value="ALL">All</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIONED">Actioned</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : escalations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400 text-sm">
          {statusFilter === 'ALL' ? 'No escalations yet.' : 'No escalations match this filter.'}
        </div>
      ) : statusFilter === 'ALL' ? (
        // ALL view: split the live queue from the retained history.
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Pending ({pending.length})</div>
            {pending.length === 0 ? (
              <div className="rounded-xl border border-slate-100 bg-white px-4 py-6 text-center text-xs text-slate-400">
                All caught up — no pending escalations.
              </div>
            ) : (
              pending.map(renderCard)
            )}
          </div>
          {history.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400">History ({history.length})</div>
              {history.map(renderCard)}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">{escalations.map(renderCard)}</div>
      )}
    </div>
  );
}
