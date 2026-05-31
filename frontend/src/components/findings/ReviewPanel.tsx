'use client';

import { useState } from 'react';
import { FindingDetail, FindingSeverity } from '../../types';
import { reviewFinding } from '../../api/findingApi';
import { SeverityBadge } from './FindingBadges';
import toast from 'react-hot-toast';
import { ShieldCheck } from 'lucide-react';

interface Props {
  finding: FindingDetail;
  canReview: boolean; // Manager/Director and status === 'Open'
  onReviewed: () => void;
}

const SEVERITIES: FindingSeverity[] = ['Observation', 'Level 1', 'Level 2'];

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ReviewPanel({ finding, canReview, onReviewed }: Props) {
  const [severity, setSeverity] = useState<FindingSeverity | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!severity) {
      toast.error('Please select a severity');
      return;
    }
    setSubmitting(true);
    try {
      await reviewFinding(finding.id, { severity, dueDate: dueDate || undefined });
      toast.success('Finding reviewed');
      onReviewed();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to review finding');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Review</h3>
      </div>

      {!canReview ? (
        // Already reviewed (or viewer cannot act): show set values read-only.
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Severity</span>
            <SeverityBadge severity={finding.severity} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Due Date</span>
            <span className={`text-sm ${finding.dueDateBreached ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
              {formatDate(finding.dueDate)}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Severity <span className="text-red-400">*</span>
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as FindingSeverity)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select severity…</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Due Date (SLA)
            </label>
            <input
              type="date"
              max="9999-12-31"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit Review'}
          </button>
        </div>
      )}
    </div>
  );
}
