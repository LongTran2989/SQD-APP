'use client';

import { useState } from 'react';
import { FindingDetail, FindingSeverity } from '../../types';
import { reviewFinding, dismissFinding, updateFindingSeverity } from '../../api/findingApi';
import { SeverityBadge } from './FindingBadges';
import { formatDueDate } from '../../utils/dateFormat';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { ShieldCheck } from 'lucide-react';

interface Props {
  finding: FindingDetail;
  canReview: boolean; // Manager/Director and status === 'Open'
  onReviewed: () => void;
}

const SEVERITIES: FindingSeverity[] = ['Observation', 'Level 1', 'Level 2'];

// Default corrective-action timescales (days) per severity. Mirrors the seed
// DEFAULT_FINDING_WORKFLOW_CONFIG on the backend, which remains authoritative —
// this is a convenience prefill + "required" hint only. Severities listed here
// require a due date at review time.
const SEVERITY_SLA_DAYS: Record<string, number> = { 'Level 1': 7, 'Level 2': 30 };

function isoDatePlusDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function ReviewPanel({ finding, canReview, onReviewed }: Props) {
  const { user } = useAuthStore();
  const isMgrDir = user ? ['Manager', 'Director', 'Admin'].includes(user.role) : false;

  const [severity, setSeverity] = useState<FindingSeverity | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [dueDateAutoFilled, setDueDateAutoFilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dueDateRequired = !!severity && severity in SEVERITY_SLA_DAYS;

  const handleSeverityChange = (next: FindingSeverity | '') => {
    setSeverity(next);
    // Prefill the SLA due date when the field is empty or still holds a prior
    // auto-fill (never clobber a value the reviewer typed themselves).
    const slaDays = next ? SEVERITY_SLA_DAYS[next] : undefined;
    if (slaDays != null && (!dueDate || dueDateAutoFilled)) {
      setDueDate(isoDatePlusDays(slaDays));
      setDueDateAutoFilled(true);
    }
  };

  // Dismiss states
  const [showDismissModal, setShowDismissModal] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [dismissing, setDismissing] = useState(false);

  // Correct severity states
  const [showCorrectModal, setShowCorrectModal] = useState(false);
  const [correctSeverity, setCorrectSeverity] = useState<FindingSeverity | ''>('');
  const [correctReason, setCorrectReason] = useState('');
  const [correcting, setCorrecting] = useState(false);

  const handleSubmit = async () => {
    if (!severity) {
      toast.error('Please select a severity');
      return;
    }
    if (dueDateRequired && !dueDate) {
      toast.error(`A due date is required for a ${severity} finding`);
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

  const handleDismiss = async () => {
    if (!dismissReason.trim()) {
      toast.error('Please enter a reason for dismissal');
      return;
    }
    setDismissing(true);
    try {
      await dismissFinding(finding.id, dismissReason);
      toast.success('Finding dismissed');
      setShowDismissModal(false);
      onReviewed();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to dismiss finding');
    } finally {
      setDismissing(false);
    }
  };

  const handleCorrect = async () => {
    if (!correctSeverity) {
      toast.error('Please select a severity');
      return;
    }
    if (!correctReason.trim()) {
      toast.error('Please enter a reason for correction');
      return;
    }
    setCorrecting(true);
    try {
      await updateFindingSeverity(finding.id, { severity: correctSeverity, reason: correctReason });
      toast.success('Severity corrected');
      setShowCorrectModal(false);
      onReviewed();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to correct severity');
    } finally {
      setCorrecting(false);
    }
  };

  const showCorrectBtn = isMgrDir && finding.status !== 'Closed' && finding.status !== 'Dismissed';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Review</h3>
      </div>

      {!canReview ? (
        // Already reviewed (or viewer cannot act): show set values read-only.
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Severity</span>
              <SeverityBadge severity={finding.severity} />
            </div>
            {showCorrectBtn && (
              <button
                type="button"
                onClick={() => {
                  setCorrectSeverity(finding.severity ?? '');
                  setShowCorrectModal(true);
                }}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors"
              >
                Correct Severity
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-28">Due Date</span>
            <span className={`text-sm ${finding.dueDateBreached ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
              {formatDueDate(finding.dueDate)}
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
              onChange={(e) => handleSeverityChange(e.target.value as FindingSeverity)}
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
              Due Date (SLA) {dueDateRequired && <span className="text-red-400">*</span>}
            </label>
            <input
              type="date"
              max="9999-12-31"
              value={dueDate}
              onChange={(e) => { setDueDate(e.target.value); setDueDateAutoFilled(false); }}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {dueDateRequired && (
              <p className="mt-1 text-xs text-slate-400">Pre-filled from the {severity} SLA — adjust if needed.</p>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit Review'}
            </button>
          </div>
          {/* Destructive, irreversible action — separated from the primary flow
              and de-emphasised to avoid an accidental dismiss. */}
          <div className="pt-3 mt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowDismissModal(true)}
              className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
            >
              Dismiss this finding instead
            </button>
            <p className="mt-0.5 text-xs text-slate-400">Use only for findings raised in error — this is permanent.</p>
          </div>
        </div>
      )}

      {/* Dismiss Modal */}
      {showDismissModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-bold text-slate-800 mb-3">Dismiss Finding #{finding.id}?</h3>
            <p className="text-sm text-slate-500 mb-4">
              Please enter the reason for dismissing this finding. This action cannot be undone.
            </p>
            <textarea
              required
              rows={3}
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="e.g. Duplicate of Finding #12..."
              className="w-full text-sm border border-slate-200 rounded-lg p-2.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDismissModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                disabled={dismissing}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {dismissing ? 'Dismissing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Correct Severity Modal */}
      {showCorrectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-bold text-slate-800 mb-3">Correct Severity for Finding #{finding.id}</h3>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  New Severity <span className="text-red-400">*</span>
                </label>
                <select
                  value={correctSeverity}
                  onChange={(e) => setCorrectSeverity(e.target.value as FindingSeverity)}
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
                  Reason <span className="text-red-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                  placeholder="Reason for correction..."
                  className="w-full text-sm border border-slate-200 rounded-lg p-2.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCorrectModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCorrect}
                disabled={correcting}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {correcting ? 'Saving…' : 'Correct'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
