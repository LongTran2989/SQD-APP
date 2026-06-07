'use client';

import { useState } from 'react';
import { FindingDetail, CapaAction, CapaType, CapaLinkRole, CapaTaskLink } from '../../types';
import { createCapa, verifyCapa, waiveCapa, deleteCapa, addCapaLink, removeCapaLink, CapaPayload } from '../../api/findingApi';
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
      </div>
      <CapaLinkedItemsList capaId={capa.id} findingId={findingId} items={capa.linkedItems} isMgrDir={isMgrDir} onChanged={onChanged} />
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

function CapaLinkedItemsList({
  capaId, findingId, items, isMgrDir, onChanged
}: {
  capaId: number; findingId: number; items: CapaTaskLink[];
  isMgrDir: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [addingLink, setAddingLink] = useState(false);

  const doRemove = async (linkId: number) => {
    if (!window.confirm('Remove this linked item?')) return;
    setBusy(true);
    try { await removeCapaLink(findingId, capaId, linkId); onChanged(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Failed to remove link')); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-2 space-y-1">
      {items.map((link) => (
        <div key={link.id} className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Link2 className="w-3 h-3" />
            <span className="font-medium text-slate-400 uppercase">{link.role}</span>
            {link.task && <span>{link.task.taskId} <span className="text-slate-300">({link.task.status})</span></span>}
            {link.wp && <span>{link.wp.wpId} <span className="text-slate-300">({link.wp.status})</span></span>}
          </span>
          {isMgrDir && (
            <button onClick={() => doRemove(link.id)} disabled={busy} className="text-slate-300 hover:text-red-400">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {isMgrDir && !addingLink && (
        <button onClick={() => setAddingLink(true)} className="text-xs text-blue-500 hover:text-blue-600 inline-flex items-center gap-1 mt-1">
          <Plus className="w-3 h-3" /> Link task / WP
        </button>
      )}
      {addingLink && (
        <CapaLinkForm findingId={findingId} capaId={capaId}
          onCancel={() => setAddingLink(false)}
          onSaved={() => { setAddingLink(false); onChanged(); }} />
      )}
    </div>
  );
}

function CapaLinkForm({
  findingId, capaId, onCancel, onSaved
}: {
  findingId: number; capaId: number; onCancel: () => void; onSaved: () => void;
}) {
  const [role, setRole] = useState<CapaLinkRole>('EXECUTION');
  const [refType, setRefType] = useState<'task' | 'wp'>('task');
  const [refId, setRefId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const id = Number(refId);
    if (!id) return toast.error('Enter a valid numeric ID');
    setSaving(true);
    try {
      await addCapaLink(findingId, capaId, {
        role,
        taskId: refType === 'task' ? id : undefined,
        wpId: refType === 'wp' ? id : undefined,
      });
      toast.success('Link added');
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to add link'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-1">
      <select value={role} onChange={(e) => setRole(e.target.value as CapaLinkRole)}
        className="text-xs border border-slate-200 rounded px-2 py-1">
        <option value="EXECUTION">Execution</option>
        <option value="EFFECTIVENESS">Effectiveness</option>
        <option value="SUPPORTING">Supporting</option>
      </select>
      <select value={refType} onChange={(e) => setRefType(e.target.value as 'task' | 'wp')}
        className="text-xs border border-slate-200 rounded px-2 py-1">
        <option value="task">Task ID</option>
        <option value="wp">WP ID</option>
      </select>
      <input value={refId} onChange={(e) => setRefId(e.target.value)}
        placeholder="DB numeric ID" className="text-xs border border-slate-200 rounded px-2 py-1 w-24" />
      <button onClick={submit} disabled={saving}
        className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50">
        {saving ? '…' : 'Add'}
      </button>
      <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
    </div>
  );
}

function CapaForm({ finding, onCancel, onSaved }: { finding: FindingDetail; onCancel: () => void; onSaved: () => void }) {
  const [type, setType] = useState<CapaType>('CORRECTIVE');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!description.trim()) return toast.error('Description is required');
    setSaving(true);
    try {
      const payload: CapaPayload = {
        type,
        description: description.trim(),
        deadline: deadline || null,
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
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 font-medium">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">{saving ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  );
}
