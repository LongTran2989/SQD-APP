'use client';

import { useState } from 'react';
import { FindingDetail } from '../../types';
import { completeStage2 } from '../../api/findingApi';
import toast from 'react-hot-toast';
import { ClipboardCheck } from 'lucide-react';

interface Props {
  finding: FindingDetail;
  editable: boolean; // status Pending Verification AND viewer permitted
  onSaved: () => void;
}

function violatorsToText(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  return '';
}

export default function Stage2Form({ finding, editable, onSaved }: Props) {
  const [errorCode, setErrorCode] = useState(finding.errorCode ?? '');
  const [rootCause, setRootCause] = useState(finding.rootCause ?? '');
  const [correctiveAction, setCorrectiveAction] = useState(finding.correctiveAction ?? '');
  const [recurrence, setRecurrence] = useState<boolean>(finding.recurrence ?? false);
  const [violators, setViolators] = useState(violatorsToText(finding.violatorIds));
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const violatorIds = violators
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await completeStage2(finding.id, {
        errorCode: errorCode || undefined,
        rootCause: rootCause || undefined,
        correctiveAction: correctiveAction || undefined,
        recurrence,
        violatorIds,
      });
      toast.success('Stage 2 saved');
      onSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save Stage 2');
    } finally {
      setSubmitting(false);
    }
  };

  // Read-only view (Closed, or viewer not permitted to edit).
  if (!editable) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <ClipboardCheck className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Stage 2 — Analysis</h3>
        </div>
        <dl className="space-y-3 text-sm">
          <Row label="Error Code" value={finding.errorCode} />
          <Row label="Root Cause" value={finding.rootCause} />
          <Row label="Corrective Action" value={finding.correctiveAction} />
          <Row label="Recurrence" value={finding.recurrence === null ? null : finding.recurrence ? 'Yes' : 'No'} />
          <Row label="Violator IDs" value={violatorsToText(finding.violatorIds) || null} />
        </dl>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <ClipboardCheck className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Stage 2 — Analysis</h3>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Error Code</label>
          <input
            type="text"
            value={errorCode}
            onChange={(e) => setErrorCode(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Root Cause</label>
          <textarea
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            rows={3}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Corrective Action</label>
          <textarea
            value={correctiveAction}
            onChange={(e) => setCorrectiveAction(e.target.value)}
            rows={3}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="block text-xs font-semibold text-slate-500">Recurrence</label>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
              <input type="radio" checked={recurrence === true} onChange={() => setRecurrence(true)} /> Yes
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
              <input type="radio" checked={recurrence === false} onChange={() => setRecurrence(false)} /> No
            </label>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            Violator IDs <span className="text-slate-400 normal-case font-normal">(comma-separated; full personnel search coming later)</span>
          </label>
          <input
            type="text"
            value={violators}
            onChange={(e) => setViolators(e.target.value)}
            placeholder="e.g. VAE00071, VAE00102"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {submitting ? 'Saving…' : 'Save Stage 2'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-32 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-slate-700 flex-1">{value ?? <span className="text-slate-400 italic">Not provided</span>}</dd>
    </div>
  );
}
