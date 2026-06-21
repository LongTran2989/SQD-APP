'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WorkPackageDetail } from '../../types';
import { getWorkPackageById } from '../../api/wpApi';
import WorkPackageStatusBadge from '../work-packages/WorkPackageStatusBadge';
import { X, ExternalLink, AlertTriangle, Package } from 'lucide-react';

interface Props {
  wpId: number;
  onClose: () => void;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Preview a work package inline anywhere it is referenced — no navigation.
// Mirrors TaskQuickViewPanel; mounted once by QuickViewProvider.
export default function WpQuickViewPanel({ wpId, onClose }: Props) {
  const [wp, setWp] = useState<WorkPackageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getWorkPackageById(wpId)
      .then((w) => { if (active) { setWp(w); setError(null); } })
      .catch(() => { if (active) setError('Failed to load work package'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [wpId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Package className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <h3 className="text-base font-bold text-slate-800 truncate">
              {wp ? wp.wpId : 'Work Package'}
            </h3>
            {wp && <WorkPackageStatusBadge status={wp.computedStatus} size="sm" />}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-7 w-7 border-t-2 border-b-2 border-blue-500" />
            </div>
          ) : error || !wp ? (
            <div className="text-center py-10">
              <AlertTriangle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">{error ?? 'Work package not found.'}</p>
            </div>
          ) : (
            <>
              <h4 className="text-base font-semibold text-slate-800">{wp.name}</h4>
              <dl className="space-y-3 text-sm">
                <Row label="Type" value={wp.type} />
                <Row label="Division" value={wp.division?.name ?? '—'} />
                <Row label="Timeframe" value={`${formatDate(wp.timeframeFrom)} → ${formatDate(wp.timeframeTo)}`} />
                <Row label="Tasks" value={String(wp.tasks.length)} />
                <Row label="Members" value={wp.assignments.length ? wp.assignments.map((a) => a.user.name).join(', ') : 'Unassigned'} />
                {wp.acRegistration && <Row label="Aircraft" value={wp.acRegistration} />}
              </dl>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Close</button>
          <Link
            href={`/dashboard/work-packages/${wpId}`}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Open full WP
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-slate-700 flex-1 break-words">{value}</dd>
    </div>
  );
}
