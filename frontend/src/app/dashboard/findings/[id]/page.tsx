'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../../store/authStore';
import { FindingDetail } from '../../../../types';
import { getFindingById, closeFinding } from '../../../../api/findingApi';
import { SeverityBadge, FindingStatusBadge, ResponseActionBadge } from '../../../../components/findings/FindingBadges';
import ReviewPanel from '../../../../components/findings/ReviewPanel';
import GenerateFollowUpModal from '../../../../components/findings/GenerateFollowUpModal';
import RcaPanel from '../../../../components/findings/RcaPanel';
import CapaPanel from '../../../../components/findings/CapaPanel';
import RelatedFindingsPanel from '../../../../components/findings/RelatedFindingsPanel';
import TrendBanner from '../../../../components/findings/TrendBanner';
import TaskStatusBadge from '../../../../components/tasks/TaskStatusBadge';
import FindingActivityFeed from '../../../../components/findings/FindingActivityFeed';
import toast from 'react-hot-toast';
import { ArrowLeft, AlertTriangle, ClipboardList, Plus, CheckCircle2, X } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const MGR_DIR = ['Manager', 'Director'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function FindingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const findingId = Number(params.id);

  const [finding, setFinding] = useState<FindingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showGenerate, setShowGenerate] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    if (!findingId) return;
    setLoading(true);
    try {
      const f = await getFindingById(findingId);
      setFinding(f);
      setError(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to load finding');
    } finally {
      setLoading(false);
    }
  }, [findingId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleClose = async () => {
    setClosing(true);
    try {
      await closeFinding(findingId);
      toast.success('Finding closed');
      router.push('/dashboard/findings');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to close finding');
      setClosing(false);
      setShowCloseConfirm(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !finding || !user) {
    return (
      <div className="max-w-3xl mx-auto p-12 text-center">
        <AlertTriangle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-700 mb-2">Unable to load finding</h2>
        <p className="text-slate-500 mb-6">{error ?? 'Finding not found.'}</p>
        <Link href="/dashboard/findings" className="text-blue-600 hover:text-blue-700 font-medium">
          ← Back to Findings
        </Link>
      </div>
    );
  }

  const isMgrDir = ['Director', 'Admin'].includes(user.role) || (user.role === 'Manager' && user.divisionId === finding.targetDivisionId);
  const canReview = isMgrDir && finding.status === 'Open';
  const canGenerate = isMgrDir && (finding.status === 'Open' || finding.status === 'In Progress');
  const isReporter = finding.reportedByUserId === user.id;
  const isFollowUpAssignee = finding.followUpTasks.some((t) => t.assignedToUserId === user.id);
  const canClose = isMgrDir && finding.status === 'Pending Verification';
  // Expansion sections become available once the finding has been reviewed.
  const analysisVisible = finding.status !== 'Open';
  const analysisEditable = finding.status !== 'Closed' && (isReporter || isFollowUpAssignee || isMgrDir);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Back link */}
      <Link href="/dashboard/findings" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" />
        Back to Findings
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Trend banner — recurrent-pattern alert */}
          <TrendBanner trend={finding.trend} />

          {/* Section 1 — Header */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded text-sm font-bold font-mono border border-slate-200">
                  Finding #{finding.id}
                </span>
                <FindingStatusBadge status={finding.status} />
                <SeverityBadge severity={finding.severity} />
              </div>
              <div className="text-sm">
                <span className="text-slate-400">Due: </span>
                <span className={finding.dueDateBreached ? 'text-red-600 font-semibold' : 'text-slate-700'}>
                  {formatDate(finding.dueDate)}
                </span>
              </div>
            </div>
            {finding.sourceTask && (
              <div className="mt-3">
                <Link
                  href={`/dashboard/tasks/${finding.sourceTask.id}`}
                  className="inline-flex items-center gap-1.5 text-sm font-mono font-semibold text-blue-600 hover:text-blue-700"
                >
                  <ClipboardList className="w-4 h-4" />
                  Source Task {finding.sourceTask.taskId}
                </Link>
              </div>
            )}
          </div>

          {/* Section 2 — Stage 1 fields (read-only) */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">Details</h3>
            <dl className="space-y-3 text-sm">
              <Field label="Event Type" value={finding.eventType} />
              <Field label="Department" value={finding.department?.name ?? null} />
              <Field label="ATA Chapter" value={finding.ataChapter ? `${finding.ataChapter.code} — ${finding.ataChapter.title}` : null} />
              <Field label="Hazard Tags" value={finding.hazardTags.length ? finding.hazardTags.map((h) => h.hazardTag.label).join(', ') : null} />
              <Field label="Aircraft Reg." value={finding.aircraftRegistration?.registration ?? null} />
              <Field label="Regulatory Ref." value={finding.regulatoryReference} />
              <Field label="Description" value={finding.description} />
            </dl>
            <p className="text-xs text-slate-400 mt-4">
              Reported by {finding.reportedByUser?.name ?? 'Unknown'} on {formatDate(finding.createdAt)}
            </p>
          </div>

          {/* Section 3 — Review */}
          <ReviewPanel finding={finding} canReview={canReview} onReviewed={load} />

          {/* Section 4 — Follow-up Tasks */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Follow-up Tasks</h3>
              {canGenerate && (
                <button
                  onClick={() => setShowGenerate(true)}
                  className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Generate Follow-up Task
                </button>
              )}
            </div>
            {finding.followUpTasks.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No follow-up tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {finding.followUpTasks.map((t) => (
                  <Link
                    key={t.id}
                    href={`/dashboard/tasks/${t.id}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-semibold text-blue-600 flex-shrink-0">{t.taskId}</span>
                        <span className="text-sm text-slate-700 truncate">{t.title ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {t.responseActionType && (
                          <ResponseActionBadge type={t.responseActionType} />
                        )}
                        {t.requiresDirectorApproval && (
                          <span className="text-xs text-purple-600 font-medium">Director approval required</span>
                        )}
                        {(() => {
                          const ra = finding.responseActions?.find((a) => a.taskId === t.id);
                          if (!ra?.targetDepartments?.length) return null;
                          return (
                            <span className="text-xs text-slate-500">
                              → {ra.targetDepartments.map((d) => d.name).join(', ')}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-slate-400">{t.assignedToUser?.name ?? 'Unassigned'}</span>
                      <TaskStatusBadge status={t.status} size="sm" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Section 5b — Root Cause Analysis */}
          {analysisVisible && <RcaPanel finding={finding} editable={analysisEditable} onSaved={load} />}

          {/* Section 5c — CAPA */}
          {analysisVisible && <CapaPanel finding={finding} canEdit={analysisEditable} isMgrDir={isMgrDir} onChanged={load} />}

          {/* Section 5d — Related findings */}
          <RelatedFindingsPanel finding={finding} canEdit={isMgrDir && finding.status !== 'Closed'} onChanged={load} />

          {/* Section 6 — Close */}
          {canClose && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">Close Finding</h3>
              <p className="text-sm text-slate-500 mb-4">
                All follow-up tasks are complete and Stage 2 analysis is filled in. Sign off to close this finding.
              </p>
              <button
                onClick={() => setShowCloseConfirm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Close Finding
              </button>
            </div>
          )}
        </div>

        {/* ── Right column — Finding activity feed ── */}
        <div className="lg:col-span-1">
          <div className="h-[calc(100vh-12rem)] sticky top-6">
            <FindingActivityFeed findingId={findingId} currentUser={user} onRefresh={load} />
          </div>
        </div>
      </div>

      {/* Generate modal */}
      {showGenerate && (
        <GenerateFollowUpModal
          findingId={finding.id}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => {
            setShowGenerate(false);
            load();
          }}
        />
      )}

      {/* Close confirm modal */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-slate-800">Close this finding?</h3>
              <button onClick={() => setShowCloseConfirm(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-6">
              This signs off Finding #{finding.id} as resolved. This action records a compliance audit entry.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowCloseConfirm(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">
                Cancel
              </button>
              <button
                onClick={handleClose}
                disabled={closing}
                className="inline-flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {closing ? 'Closing…' : 'Confirm Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-32 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-slate-700 flex-1 whitespace-pre-wrap break-words">
        {value ?? <span className="text-slate-400 italic">Not provided</span>}
      </dd>
    </div>
  );
}
