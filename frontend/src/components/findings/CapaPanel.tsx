'use client';

import { useState } from 'react';
import { FindingDetail, CapaAction, CapaType } from '../../types';
import { createCapa, verifyCapa, waiveCapa, deleteCapa, CapaPayload } from '../../api/findingApi';
import { CapaTypeBadge, CapaStatusBadge } from './FindingBadges';
import toast from 'react-hot-toast';
import { apiErrorMessage } from '../../api/errorMessage';
import { ShieldCheck, Plus, Trash2, CheckCircle2, Ban, Link2 } from 'lucide-react';

interface Props {
  finding: FindingDetail;
  canEdit: boolean;    // reporter / follow-up assignee / Manager / Director
  isMgrDir: boolean;   // verify / waive / delete
  onChanged: () => void;
}

const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function CapaPanel({ finding, canEdit, isMgrDir, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const corrective = finding.capaActions.filter((c) => c.type === 'CORRECTIVE');
  const preventive = finding.capaActions.filter((c) => c.type === 'PREVENTIVE');

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Corrective &amp; Preventive Actions</h3>
        </div>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus className="w-4 h-4" /> Add CAPA
          </button>
        )}
      </div>

      {adding && (
        <CapaForm finding={finding} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <CapaColumn title="Corrective (fix the symptom)" actions={corrective} finding={finding} isMgrDir={isMgrDir} onChanged={onChanged} />
        <CapaColumn title="Preventive (fix the system)" actions={preventive} finding={finding} isMgrDir={isMgrDir} onChanged={onChanged} />
      </div>
    </div>
  );
}

function CapaColumn({ title, actions, finding, isMgrDir, onChanged }: { title: string; actions: CapaAction[]; finding: FindingDetail; isMgrDir: boolean; onChanged: () => void }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{title}</p>
      {actions.length === 0 ? (
        <p className="text-sm text-slate-400 italic">None.</p>
      ) : (
        <div className="space-y-2">
          {actions.map((c) => <CapaCard key={c.id} capa={c} findingId={finding.id} isMgrDir={isMgrDir} onChanged={onChanged} />)}
        </div>
      )}
    </div>
  );
}

function CapaCard({ capa, findingId, isMgrDir, onChanged }: { capa: CapaAction; findingId: number; isMgrDir: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const doVerify = async () => {
    setBusy(true);
    try { await verifyCapa(findingId, capa.id); toast.success('CAPA verified'); onChanged(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Failed to verify')); }
    finally { setBusy(false); }
  };
  const doWaive = async () => {
    const reason = window.prompt('Reason for waiving this preventive action?');
    if (!reason) return;
    setBusy(true);
    try { await waiveCapa(findingId, capa.id, reason); toast.success('CAPA waived'); onChanged(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Failed to waive')); }
    finally { setBusy(false); }
  };
  const doDelete = async () => {
    if (!window.confirm('Delete this CAPA action?')) return;
    setBusy(true);
    try { await deleteCapa(findingId, capa.id); toast.success('CAPA deleted'); onChanged(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Failed to delete')); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <CapaTypeBadge type={capa.type} />
          <CapaStatusBadge status={capa.status} />
        </div>
        {isMgrDir && (
          <button onClick={doDelete} disabled={busy} className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
        )}
      </div>
      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{capa.description}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-slate-400">
        {capa.ownerUser && <span>Owner: {capa.ownerUser.name}</span>}
        {capa.deadline && <span>Due: {new Date(capa.deadline).toLocaleDateString('en-GB')}</span>}
        {capa.executionTask && <span className="inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> Exec {capa.executionTask.taskId}</span>}
        {capa.effectivenessTask && <span className="inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> Verify {capa.effectivenessTask.taskId} ({capa.effectivenessTask.status})</span>}
      </div>
      {capa.status === 'Verified' && capa.verifiedByUser && (
        <p className="text-xs text-green-600 mt-1">Verified by {capa.verifiedByUser.name}</p>
      )}
      {capa.status === 'Waived' && capa.waivedReason && (
        <p className="text-xs text-amber-600 mt-1">Waived: {capa.waivedReason}</p>
      )}
      {isMgrDir && capa.status !== 'Verified' && capa.status !== 'Waived' && (
        <div className="flex items-center gap-3 mt-2">
          <button onClick={doVerify} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> Verify</button>
          {capa.type === 'PREVENTIVE' && (
            <button onClick={doWaive} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700"><Ban className="w-3.5 h-3.5" /> Waive</button>
          )}
        </div>
      )}
    </div>
  );
}

function CapaForm({ finding, onCancel, onSaved }: { finding: FindingDetail; onCancel: () => void; onSaved: () => void }) {
  const [type, setType] = useState<CapaType>('CORRECTIVE');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [executionTaskId, setExecutionTaskId] = useState('');
  const [effectivenessTaskId, setEffectivenessTaskId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!description.trim()) return toast.error('Description is required');
    setSaving(true);
    try {
      const payload: CapaPayload = {
        type,
        description: description.trim(),
        deadline: deadline || null,
        executionTaskId: executionTaskId ? Number(executionTaskId) : null,
        effectivenessTaskId: effectivenessTaskId ? Number(effectivenessTaskId) : null,
      };
      await createCapa(finding.id, payload);
      toast.success('CAPA action added');
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to add CAPA'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 mb-2 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as CapaType)} className={inputCls}>
            <option value="CORRECTIVE">Corrective</option>
            <option value="PREVENTIVE">Preventive</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Deadline</label>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Execution task</label>
          <select value={executionTaskId} onChange={(e) => setExecutionTaskId(e.target.value)} className={inputCls}>
            <option value="">None</option>
            {finding.followUpTasks.map((t) => <option key={t.id} value={t.id}>{t.taskId}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Effectiveness task</label>
          <select value={effectivenessTaskId} onChange={(e) => setEffectivenessTaskId(e.target.value)} className={inputCls}>
            <option value="">None</option>
            {finding.followUpTasks.map((t) => <option key={t.id} value={t.id}>{t.taskId} ({t.status})</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 font-medium">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">{saving ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  );
}
