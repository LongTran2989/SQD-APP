'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { AlertOctagon, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { getStuckFindings, forcePendingVerification, StuckFinding } from '../../api/findingApi';
import toast from 'react-hot-toast';

// Admin/Director-only "needs attention" widget. Surfaces findings whose
// auto-advance to Pending Verification did not fire (best-effort hook), so they
// no longer depend on someone polling the admin endpoint. Renders nothing for
// other roles or when there is nothing stuck.
export function StuckFindingsWidget() {
  const user = useAuthStore((state) => state.user);
  const isAdminDir = user?.role === 'Director' || user?.role === 'Admin';

  const [stuck, setStuck] = useState<StuckFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancingId, setAdvancingId] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!isAdminDir) return;
    getStuckFindings()
      .then((rows) => setStuck(rows))
      .catch(() => setStuck([]))
      .finally(() => setLoading(false));
  }, [isAdminDir]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdvance = async (id: number) => {
    setAdvancingId(id);
    try {
      await forcePendingVerification(id);
      toast.success(`Finding #${id} advanced to Pending Verification`);
      setStuck((prev) => prev.filter((f) => f.id !== id));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to advance finding');
    } finally {
      setAdvancingId(null);
    }
  };

  // Silent when not applicable: wrong role, still loading, or nothing stuck.
  if (!isAdminDir || loading || stuck.length === 0) return null;

  return (
    <div className="p-5 rounded-xl shadow-sm border bg-amber-50 border-amber-200">
      <div className="flex items-center space-x-3 mb-4">
        <div className="p-2 rounded-lg bg-amber-100">
          <AlertOctagon className="w-5 h-5 text-amber-600" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800">Findings needing attention</h2>
          <p className="text-xs text-slate-500">
            {stuck.length} finding{stuck.length !== 1 ? 's' : ''} should be in Pending Verification — all follow-up tasks are complete.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {stuck.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between gap-3 bg-white rounded-xl border border-amber-100 px-3 py-2"
          >
            <Link href={`/dashboard/findings/${f.id}`} className="min-w-0 flex-1 group">
              <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-600">Finding #{f.id}</span>
              <span className="block text-xs text-slate-500 truncate">
                {f.targetDivision?.code ? `${f.targetDivision.code} · ` : ''}{f.description}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => handleAdvance(f.id)}
              disabled={advancingId === f.id}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {advancingId === f.id ? 'Advancing…' : 'Advance'}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
