'use client';

import { useState, useEffect, useMemo } from 'react';
import { FindingDetail, AtaChapter, HazardTag } from '../../types';
import { updateFindingDetails } from '../../api/findingApi';
import { getDatasource } from '../../api/taskApi';
import { listAtaChapters, listHazardTags } from '../../api/taxonomyApi';
import { apiErrorMessage } from '../../api/errorMessage';
import SearchableSelect from '../ui/SearchableSelect';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { formatFindingRef } from '../../utils/findingFormat';

interface Props {
  finding: FindingDetail;
  onClose: () => void;
  onSaved: () => void;
}

const inputCls =
  'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5';

// Enrich a finding's optional context after it was raised. These fields feed the
// trend engine (Department + ATA + Cause Code + Hazard Tags) and monitoring.
export default function EditDetailsModal({ finding, onClose, onSaved }: Props) {
  const [ataChapters, setAtaChapters] = useState<AtaChapter[]>([]);
  const [hazardTags, setHazardTags] = useState<HazardTag[]>([]);
  const [operators, setOperators] = useState<{ value: string; label: string }[]>([]);
  const [allRegistrations, setAllRegistrations] = useState<{ value: string; label: string; operatorCode?: string | null }[]>([]);

  const [ataChapterId, setAtaChapterId] = useState(finding.ataChapterId ? String(finding.ataChapterId) : '');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(finding.hazardTags.map((h) => h.hazardTagId));
  const [operatorCode, setOperatorCode] = useState(finding.aircraftRegistration?.operatorCode ?? '');
  const [aircraftRegistrationCode, setAircraftRegistrationCode] = useState(finding.aircraftRegistrationCode ?? '');
  const [regulatoryReference, setRegulatoryReference] = useState(finding.regulatoryReference ?? '');
  const [fieldId, setFieldId] = useState(finding.fieldId ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAtaChapters(true).then(setAtaChapters).catch(() => {});
    listHazardTags(true).then(setHazardTags).catch(() => {});
    getDatasource('operators').then(setOperators).catch(() => {});
    getDatasource('registrations').then(setAllRegistrations).catch(() => {});
  }, []);

  const filteredRegistrations = useMemo(
    () => (operatorCode ? allRegistrations.filter((r) => r.operatorCode === operatorCode) : allRegistrations),
    [allRegistrations, operatorCode],
  );

  const toggleTag = (id: number) =>
    setSelectedTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const handleSelectRegistration = (reg: string) => {
    setAircraftRegistrationCode(reg);
    if (reg) {
      const found = allRegistrations.find((r) => r.value === reg);
      if (found?.operatorCode) setOperatorCode(found.operatorCode);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateFindingDetails(finding.id, {
        ataChapterId: ataChapterId ? Number(ataChapterId) : null,
        hazardTagIds: selectedTagIds,
        aircraftRegistrationCode: aircraftRegistrationCode || null,
        regulatoryReference: regulatoryReference.trim() || null,
        fieldId: fieldId.trim() || null,
      });
      toast.success('Details updated');
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to update details'));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-base font-bold text-slate-800">Edit details — Finding {formatFindingRef(finding)}</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-xs text-slate-500">
            These optional fields feed monitoring and trend analysis. Add what you know — none are required.
          </p>

          <div>
            <label className={labelCls}>ATA Chapter</label>
            <select value={ataChapterId} onChange={(e) => setAtaChapterId(e.target.value)} className={inputCls}>
              <option value="">Select ATA chapter… (optional)</option>
              {ataChapters.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Hazard Tags</label>
            {hazardTags.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No hazard tags configured.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {hazardTags.map((t) => {
                  const on = selectedTagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className={labelCls}>Operator</label>
            <SearchableSelect options={operators} value={operatorCode} onChange={setOperatorCode} placeholder="Filter by operator… (optional)" />
          </div>

          <div>
            <label className={labelCls}>Aircraft Registration</label>
            <SearchableSelect options={filteredRegistrations} value={aircraftRegistrationCode} onChange={handleSelectRegistration} placeholder="Select registration… (optional)" />
          </div>

          <div>
            <label className={labelCls}>Regulatory Reference</label>
            <input type="text" value={regulatoryReference} onChange={(e) => setRegulatoryReference(e.target.value)} placeholder="e.g. EASA Part-M (optional)" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Field Reference</label>
            <input type="text" value={fieldId} onChange={(e) => setFieldId(e.target.value)} placeholder="Which form field triggered this (optional)" className={inputCls} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </div>
    </div>
  );
}
