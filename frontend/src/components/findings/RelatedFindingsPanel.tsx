'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FindingDetail, FindingLinkType, FindingLinkRecord, LinkedFindingRef } from '../../types';
import { createFindingLink, deleteFindingLink } from '../../api/findingApi';
import { LINK_TYPE_OPTIONS } from '../../constants/findingExpansion';
import { LinkTypeBadge } from './FindingBadges';
import toast from 'react-hot-toast';
import { apiErrorMessage } from '../../api/errorMessage';
import { GitBranch, Plus, Trash2 } from 'lucide-react';

interface Props {
  finding: FindingDetail;
  canEdit: boolean; // Manager / Director
  onChanged: () => void;
}

const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function RelatedFindingsPanel({ finding, canEdit, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [relatedId, setRelatedId] = useState('');
  const [linkType, setLinkType] = useState<FindingLinkType>('RELATED');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const rid = Number(relatedId);
    if (!rid) return toast.error('Enter a related finding ID');
    setSaving(true);
    try {
      await createFindingLink(finding.id, { relatedFindingId: rid, linkType, note: note.trim() || undefined });
      toast.success('Findings linked');
      setAdding(false); setRelatedId(''); setNote('');
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to link findings'));
    } finally {
      setSaving(false);
    }
  };

  const removeLink = async (linkId: number) => {
    try { await deleteFindingLink(finding.id, linkId); toast.success('Link removed'); onChanged(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Failed to remove link')); }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Related Findings</h3>
        </div>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus className="w-4 h-4" /> Link finding
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 mb-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Related finding #</label>
              <input type="number" value={relatedId} onChange={(e) => setRelatedId(e.target.value)} placeholder="e.g. 42" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Relationship</label>
              <select value={linkType} onChange={(e) => setLinkType(e.target.value as FindingLinkType)} className={inputCls}>
                {LINK_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls} />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 font-medium">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">{saving ? 'Linking…' : 'Link'}</button>
          </div>
        </div>
      )}

      {finding.linksFrom.length === 0 && finding.linksTo.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No related findings.</p>
      ) : (
        <div className="space-y-2">
          {finding.linksFrom.map((l) => (
            <LinkRow key={`o-${l.id}`} link={l} target={l.relatedFinding} canEdit={canEdit} onRemove={() => removeLink(l.id)} />
          ))}
          {finding.linksTo.map((l) => (
            <LinkRow key={`i-${l.id}`} link={l} target={l.fromFinding} incoming canEdit={false} onRemove={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
}

function LinkRow({ link, target, incoming, canEdit, onRemove }: { link: FindingLinkRecord; target?: LinkedFindingRef; incoming?: boolean; canEdit: boolean; onRemove: () => void }) {
  if (!target) return null;
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <LinkTypeBadge linkType={link.linkType} />
        {incoming && <span className="text-xs text-slate-400">(incoming)</span>}
        <Link href={`/dashboard/findings/${target.id}`} className="text-sm text-slate-700 truncate hover:text-blue-600">
          <span className="font-mono font-semibold text-blue-600">#{target.id}</span> — {target.description}
        </Link>
      </div>
      {canEdit && (
        <button onClick={onRemove} className="p-1 text-slate-300 hover:text-red-500 flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
      )}
    </div>
  );
}
