'use client';

import { useState, useEffect } from 'react';
import { FindingDetail, RcaMethod, RcaStatus, CauseCode } from '../../types';
import { upsertRca, saveWhySteps, saveFactors } from '../../api/findingApi';
import { listCauseCodes } from '../../api/taxonomyApi';
import { RCA_METHOD_OPTIONS, RCA_MEDA_CATEGORIES } from '../../constants/findingExpansion';
import toast from 'react-hot-toast';
import { apiErrorMessage } from '../../api/errorMessage';
import { Search, Plus, Trash2 } from 'lucide-react';

interface Props {
  finding: FindingDetail;
  editable: boolean;
  onSaved: () => void;
}

interface WhyRow { question: string; answer: string }
interface FactorRow { category: string; detail: string; isPrimary: boolean }

export default function RcaPanel({ finding, editable, onSaved }: Props) {
  const rca = finding.rca;
  const [method, setMethod] = useState<RcaMethod>(rca?.method ?? 'FIVE_WHYS');
  const [status, setStatus] = useState<RcaStatus>(rca?.status ?? 'Draft');
  const [summary, setSummary] = useState(rca?.summary ?? '');
  const [causeCodeId, setCauseCodeId] = useState<string>(rca?.causeCodeId ? String(rca.causeCodeId) : '');
  const [causeCodes, setCauseCodes] = useState<CauseCode[]>([]);
  const [savingHeader, setSavingHeader] = useState(false);

  const [whyRows, setWhyRows] = useState<WhyRow[]>(
    rca?.whySteps.length ? rca.whySteps.map((s) => ({ question: s.question, answer: s.answer ?? '' })) : [{ question: '', answer: '' }]
  );
  const [factorRows, setFactorRows] = useState<FactorRow[]>(
    rca?.factors.length ? rca.factors.map((f) => ({ category: f.category, detail: f.detail ?? '', isPrimary: f.isPrimary })) : [{ category: RCA_MEDA_CATEGORIES[0], detail: '', isPrimary: false }]
  );
  const [savingChild, setSavingChild] = useState(false);

  useEffect(() => {
    listCauseCodes(true).then(setCauseCodes).catch(() => {});
  }, []);

  // Group cause codes for an <optgroup> picker.
  const grouped = causeCodes.reduce<Record<string, CauseCode[]>>((acc, c) => {
    (acc[`${c.groupCode} — ${c.groupName}`] ||= []).push(c);
    return acc;
  }, {});

  const saveHeader = async () => {
    if (status === 'Complete' && !causeCodeId) {
      toast.error('Select a cause code before marking the RCA Complete');
      return;
    }
    setSavingHeader(true);
    try {
      await upsertRca(finding.id, {
        method,
        summary: summary || null,
        status,
        causeCodeId: causeCodeId ? Number(causeCodeId) : null,
      });
      toast.success('RCA saved');
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save RCA'));
    } finally {
      setSavingHeader(false);
    }
  };

  const saveLadder = async () => {
    const steps = whyRows.filter((r) => r.question.trim()).map((r) => ({ question: r.question.trim(), answer: r.answer.trim() || null }));
    setSavingChild(true);
    try {
      await saveWhySteps(finding.id, steps);
      toast.success('5-Whys ladder saved');
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save ladder'));
    } finally {
      setSavingChild(false);
    }
  };

  const saveMeda = async () => {
    const factors = factorRows.filter((r) => r.category).map((r) => ({ category: r.category, detail: r.detail.trim() || null, isPrimary: r.isPrimary }));
    setSavingChild(true);
    try {
      await saveFactors(finding.id, factors);
      toast.success('Contributing factors saved');
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save factors'));
    } finally {
      setSavingChild(false);
    }
  };

  // ── Read-only view ──────────────────────────────────────────────────────────
  if (!editable) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Root Cause Analysis</h3>
        </div>
        {!rca ? (
          <p className="text-sm text-slate-400 italic">No root cause analysis recorded.</p>
        ) : (
          <dl className="space-y-3 text-sm">
            <Row label="Method" value={RCA_METHOD_OPTIONS.find((m) => m.value === rca.method)?.label ?? rca.method} />
            <Row label="Status" value={rca.status} />
            <Row label="Cause Code" value={rca.causeCode ? `${rca.causeCode.code} — ${rca.causeCode.name}` : null} />
            <Row label="Summary" value={rca.summary} />
            {rca.method === 'FIVE_WHYS' && rca.whySteps.length > 0 && (
              <div>
                <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">5-Whys</dt>
                <ol className="list-decimal list-inside space-y-1 text-slate-700">
                  {rca.whySteps.map((s) => (
                    <li key={s.id}><span className="font-medium">{s.question}</span>{s.answer ? ` — ${s.answer}` : ''}</li>
                  ))}
                </ol>
              </div>
            )}
            {rca.method === 'MEDA' && rca.factors.length > 0 && (
              <div>
                <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Contributing Factors</dt>
                <ul className="space-y-1 text-slate-700">
                  {rca.factors.map((f) => (
                    <li key={f.id}>{f.isPrimary ? '★ ' : ''}<span className="font-medium">{f.category}</span>{f.detail ? ` — ${f.detail}` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
          </dl>
        )}
      </div>
    );
  }

  // ── Editable view ───────────────────────────────────────────────────────────
  const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Search className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Root Cause Analysis</h3>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as RcaMethod)} className={inputCls}>
              {RCA_METHOD_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as RcaStatus)} className={inputCls}>
              <option value="Draft">Draft</option>
              <option value="Complete">Complete</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Cause Code (the determined cause)</label>
          <select value={causeCodeId} onChange={(e) => setCauseCodeId(e.target.value)} className={inputCls}>
            <option value="">Select cause code…</option>
            {Object.entries(grouped).map(([group, codes]) => (
              <optgroup key={group} label={group}>
                {codes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Summary / Conclusion</label>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
        </div>

        <button onClick={saveHeader} disabled={savingHeader} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
          {savingHeader ? 'Saving…' : 'Save RCA'}
        </button>

        {/* 5-Whys ladder */}
        {method === 'FIVE_WHYS' && (
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">5-Whys Ladder</p>
            <div className="space-y-2">
              {whyRows.map((row, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-xs font-bold text-slate-400 pt-2.5 w-6">{i + 1}.</span>
                  <div className="flex-1 space-y-1">
                    <input value={row.question} onChange={(e) => setWhyRows((rs) => rs.map((r, j) => j === i ? { ...r, question: e.target.value } : r))} placeholder={`Why ${i + 1}?`} className={inputCls} />
                    <input value={row.answer} onChange={(e) => setWhyRows((rs) => rs.map((r, j) => j === i ? { ...r, answer: e.target.value } : r))} placeholder="Answer" className={inputCls} />
                  </div>
                  <button onClick={() => setWhyRows((rs) => rs.filter((_, j) => j !== i))} className="p-2 text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button onClick={() => setWhyRows((rs) => [...rs, { question: '', answer: '' }])} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"><Plus className="w-4 h-4" /> Add why</button>
              <button onClick={saveLadder} disabled={savingChild} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">Save ladder</button>
            </div>
          </div>
        )}

        {/* MEDA factors */}
        {method === 'MEDA' && (
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">MEDA Contributing Factors</p>
            <div className="space-y-2">
              {factorRows.map((row, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <select value={row.category} onChange={(e) => setFactorRows((rs) => rs.map((r, j) => j === i ? { ...r, category: e.target.value } : r))} className={inputCls}>
                      {RCA_MEDA_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input value={row.detail} onChange={(e) => setFactorRows((rs) => rs.map((r, j) => j === i ? { ...r, detail: e.target.value } : r))} placeholder="Detail" className={inputCls} />
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={row.isPrimary} onChange={(e) => setFactorRows((rs) => rs.map((r, j) => j === i ? { ...r, isPrimary: e.target.checked } : r))} /> Primary factor
                    </label>
                  </div>
                  <button onClick={() => setFactorRows((rs) => rs.filter((_, j) => j !== i))} className="p-2 text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button onClick={() => setFactorRows((rs) => [...rs, { category: RCA_MEDA_CATEGORIES[0], detail: '', isPrimary: false }])} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"><Plus className="w-4 h-4" /> Add factor</button>
              <button onClick={saveMeda} disabled={savingChild} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">Save factors</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide w-32 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-slate-700 flex-1 whitespace-pre-wrap break-words">{value ?? <span className="text-slate-400 italic">Not provided</span>}</dd>
    </div>
  );
}
