'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw, CheckCircle2, AlertTriangle, Clock, ListChecks, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getSheetSyncPreview, executeSheetSync } from '../api/sheetSyncApi';
import { PreviewData, PreviewItem, SyncResult, CollisionDecision } from '../api/sheetSyncTypes';
import { apiErrorMessage } from '../api/errorMessage';

type Phase = 'fetching-preview' | 'preview' | 'executing' | 'result';

interface SheetSyncModalProps {
  onClose: () => void;
}

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const blueprintType = (tatDays: number) => (tatDays <= 2 ? 'PC-EQ' : 'CHECK');

export default function SheetSyncModal({ onClose }: SheetSyncModalProps) {
  const [phase, setPhase] = useState<Phase>('fetching-preview');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CollisionDecision>>({});
  const [result, setResult] = useState<SyncResult | null>(null);
  const [showNoChange, setShowNoChange] = useState(false);

  // Dismiss on Escape (but never while a sync is mid-flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'executing') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const loadPreview = useCallback(async () => {
    setPhase('fetching-preview');
    try {
      const data = await getSheetSyncPreview();
      setPreview(data);
      // Default every collision to 'skip' (safe default — no surprise creates).
      const init: Record<string, CollisionDecision> = {};
      for (const c of data.collisions) init[c.wpNo] = 'skip';
      setDecisions(init);
      setPhase('preview');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to fetch the schedule'));
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const confirm = async () => {
    if (!preview) return;
    setPhase('executing');
    try {
      const res = await executeSheetSync(preview, decisions);
      setResult(res);
      setPhase('result');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Sync failed'));
      setPhase('preview');
    }
  };

  const nothingToDo =
    !!preview &&
    preview.toCreate.length === 0 &&
    preview.toUpdate.length === 0 &&
    preview.collisions.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => phase !== 'executing' && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center">
              <RefreshCw className="w-4 h-4 text-violet-600" />
            </div>
            <h2 className="text-base font-bold text-slate-800">Sync Check Schedule</h2>
          </div>
          <button
            onClick={onClose}
            disabled={phase === 'executing'}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {(phase === 'fetching-preview' || phase === 'executing') && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
              <p className="text-sm">{phase === 'fetching-preview' ? 'Fetching the latest schedule…' : 'Applying changes…'}</p>
            </div>
          )}

          {phase === 'preview' && preview && (
            <div className="space-y-5">
              {/* Preflight errors — rows skipped before diffing (e.g. duplicate active WP names) */}
              {(preview.preflightErrors?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-red-100 bg-red-50/50 p-3">
                  <p className="text-xs font-semibold text-red-700 mb-2">{preview.preflightErrors!.length} row(s) could not be processed:</p>
                  <ul className="space-y-1">
                    {preview.preflightErrors!.map((e) => (
                      <li key={e.wpNo} className="text-xs text-red-600"><span className="font-semibold">{e.wpNo}:</span> {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              {nothingToDo && (
                <div className="text-center py-10 text-slate-500">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                  <p className="text-sm">Everything is already in sync. No changes to apply.</p>
                </div>
              )}

              {/* New WPs */}
              {preview.toCreate.length > 0 && (
                <Section title="New Work Packages" count={preview.toCreate.length} color="emerald" icon={<CheckCircle2 className="w-4 h-4" />}>
                  {preview.toCreate.map((it) => (
                    <RowCard key={`c-${it.wpNo}`} item={it}>
                      <span className="text-xs text-slate-500">{it.station} · {blueprintType(it.tatDays)}</span>
                      <span className="text-xs text-slate-600">{fmt(it.timeframeFrom)} → {fmt(it.timeframeTo)}</span>
                    </RowCard>
                  ))}
                </Section>
              )}

              {/* Reschedules */}
              {preview.toUpdate.length > 0 && (
                <Section title="To Reschedule" count={preview.toUpdate.length} color="amber" icon={<Clock className="w-4 h-4" />}>
                  {preview.toUpdate.map((it) => (
                    <div key={`u-${it.wpNo}`}>
                      <RowCard item={it}>
                        {(it.currentTimeframeFrom || it.currentTimeframeTo) && (
                          <span className="text-xs text-slate-400 line-through">{fmt(it.currentTimeframeFrom)} → {fmt(it.currentTimeframeTo)}</span>
                        )}
                        <span className="text-xs font-medium text-amber-700">{fmt(it.timeframeFrom)} → {fmt(it.timeframeTo)}</span>
                        {it.currentAcRegistration !== undefined && it.currentAcRegistration !== it.acRegistration && (
                          <span className="text-xs text-slate-500">
                            AC: <span className="line-through text-slate-400">{it.currentAcRegistration || '—'}</span>
                            {' → '}
                            <span className="font-medium text-amber-700">{it.acRegistration || '—'}</span>
                          </span>
                        )}
                        {it.currentCustomer !== undefined && it.currentCustomer !== it.customer && (
                          <span className="text-xs text-slate-500">
                            Customer: <span className="line-through text-slate-400">{it.currentCustomer || '—'}</span>
                            {' → '}
                            <span className="font-medium text-amber-700">{it.customer || '—'}</span>
                          </span>
                        )}
                        {it.currentStation !== undefined && it.currentStation !== it.station && (
                          <span className="text-xs text-slate-500">
                            Station: <span className="line-through text-slate-400">{it.currentStation || '—'}</span>
                            {' → '}
                            <span className="font-medium text-amber-700">{it.station}</span>
                          </span>
                        )}
                      </RowCard>
                      {it.warning && (
                        <div className="mt-1 mx-1 flex items-start gap-1.5 rounded-md bg-red-50 border border-red-100 px-2.5 py-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-red-700">{it.warning}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </Section>
              )}

              {/* Collisions */}
              {preview.collisions.length > 0 && (
                <Section title="Collisions" count={preview.collisions.length} color="red" icon={<AlertTriangle className="w-4 h-4" />}>
                  <p className="text-xs text-slate-500 mb-2">These match a Closed/Inactive WP. Skip them, or create a new revision.</p>
                  {preview.collisions.map((it) => (
                    <div key={`x-${it.wpNo}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{it.wpNo}</p>
                        <p className="text-xs text-slate-500">{it.station} · {fmt(it.timeframeFrom)} → {fmt(it.timeframeTo)}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <ToggleBtn active={decisions[it.wpNo] !== 'create-new'} onClick={() => setDecisions((d) => ({ ...d, [it.wpNo]: 'skip' }))}>Skip</ToggleBtn>
                        <ToggleBtn active={decisions[it.wpNo] === 'create-new'} onClick={() => setDecisions((d) => ({ ...d, [it.wpNo]: 'create-new' }))}>Create {it.wpNo}-REV2</ToggleBtn>
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* No change */}
              {preview.noChange.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <button onClick={() => setShowNoChange((s) => !s)} className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-700">
                    <ListChecks className="w-4 h-4" /> {preview.noChange.length} already in sync (no change) {showNoChange ? '▴' : '▾'}
                  </button>
                  {showNoChange && (
                    <ul className="mt-2 space-y-1 pl-6">
                      {preview.noChange.map((it) => (
                        <li key={`n-${it.wpNo}`} className="text-xs text-slate-400">{it.wpNo}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === 'result' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Created" value={result.created} color="emerald" />
                <Stat label="Updated" value={result.updated} color="amber" />
                <Stat label="Skipped" value={result.skipped} color="slate" />
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-lg border border-red-100 bg-red-50/50 p-3">
                  <p className="text-xs font-semibold text-red-700 mb-2">{result.errors.length} row(s) had errors:</p>
                  <ul className="max-h-48 overflow-y-auto space-y-1">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-xs text-red-600"><span className="font-semibold">{e.wpNo}:</span> {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          {phase === 'preview' && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
              <button
                onClick={confirm}
                disabled={nothingToDo}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm &amp; Sync
              </button>
            </>
          )}
          {phase === 'result' && (
            <button onClick={onClose} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── small presentational helpers ────────────────────────────────────────────

const COLOR: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  slate: 'bg-slate-100 text-slate-700',
};

function Section({ title, count, color, icon, children }: { title: string; count: number; color: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${COLOR[color]}`}>{icon}{count}</span>
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function RowCard({ item, children }: { item: PreviewItem; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
      <p className="text-sm font-semibold text-slate-800 truncate min-w-0" title={item.description || item.wpNo}>{item.wpNo}</p>
      <div className="flex flex-col items-end text-right flex-shrink-0">{children}</div>
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${active ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-100 p-3 text-center">
      <p className={`text-2xl font-bold ${color === 'emerald' ? 'text-emerald-600' : color === 'amber' ? 'text-amber-600' : 'text-slate-600'}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}
