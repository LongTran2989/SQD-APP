'use client';

import { useState, useEffect, useMemo } from 'react';
import { raiseFinding, getDuplicateCandidates, DuplicateCandidate } from '../../api/findingApi';
import { getDatasource, getDivisions as getDivisionsApi } from '../../api/taskApi';
import { listAtaChapters, listHazardTags, listEventTypes } from '../../api/taxonomyApi';
import { apiErrorMessage } from '../../api/errorMessage';
import { AtaChapter, HazardTag, EventType } from '../../types';
import toast from 'react-hot-toast';
import { X, AlertTriangle, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { FINDING_EVENT_TYPES } from '../../constants/findingEventTypes';
import SearchableSelect from '../ui/SearchableSelect';
import { FindingStatusBadge } from './FindingBadges';

interface Props {
  taskId?: number;
  onClose: () => void;
  onRaised: () => void;
}

export default function RaiseFindingPanel({ taskId, onClose, onRaised }: Props) {
  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [targetDivisionId, setTargetDivisionId] = useState('');
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [ataChapters, setAtaChapters] = useState<AtaChapter[]>([]);
  const [hazardTags, setHazardTags] = useState<HazardTag[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>(FINDING_EVENT_TYPES as unknown as string[]);
  const [eventType, setEventType] = useState('');
  const [eventTypeOther, setEventTypeOther] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [ataChapterId, setAtaChapterId] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [aircraftRegistrationCode, setAircraftRegistrationCode] = useState('');
  const [operatorCode, setOperatorCode] = useState('');
  const [allRegistrations, setAllRegistrations] = useState<{ value: string; label: string; operatorCode?: string | null }[]>([]);
  const [operators, setOperators] = useState<{ value: string; label: string }[]>([]);
  const [regulatoryReference, setRegulatoryReference] = useState('');
  const [description, setDescription] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [duplicateOfId, setDuplicateOfId] = useState<number | null>(null);

  useEffect(() => {
    getDatasource('departments').then(setDepartments).catch(() => {});
    getDatasource('operators').then(setOperators).catch(() => {});
    getDatasource('registrations').then(setAllRegistrations).catch(() => {});
    listAtaChapters(true).then(setAtaChapters).catch(() => {});
    listHazardTags(true).then(setHazardTags).catch(() => {});
    listEventTypes(true)
      .then((types: EventType[]) => {
        const codes = types.map((t) => t.code);
        if (!codes.includes('Other')) codes.push('Other');
        setEventTypes(codes);
      })
      .catch(() => {});
    if (!taskId) {
      getDivisionsApi().then(setDivisions).catch(() => {});
    }
  }, [taskId]);

  const filteredRegistrations = useMemo(
    () => operatorCode ? allRegistrations.filter((r) => r.operatorCode === operatorCode) : allRegistrations,
    [allRegistrations, operatorCode],
  );

  // Raise-time duplicate detection: once a department is chosen (and the division
  // is known), surface active findings the raiser might be duplicating. Debounced.
  // A stale duplicate selection is dropped when the candidate list it came from
  // no longer contains it.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (!departmentId || (!taskId && !targetDivisionId)) {
        setCandidates([]);
        return;
      }
      getDuplicateCandidates({
        departmentId: Number(departmentId),
        ...(taskId ? { taskId } : { targetDivisionId: Number(targetDivisionId) }),
      })
        .then((list) => {
          setCandidates(list);
          setDuplicateOfId((cur) => (cur != null && !list.some((c) => c.id === cur) ? null : cur));
        })
        .catch(() => setCandidates([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [departmentId, taskId, targetDivisionId]);

  const handleSelectOperator = (code: string) => {
    setOperatorCode(code);
    // clear aircraft if it no longer belongs to this operator
    if (code && aircraftRegistrationCode) {
      const reg = allRegistrations.find((r) => r.value === aircraftRegistrationCode);
      if (reg && reg.operatorCode !== code) setAircraftRegistrationCode('');
    }
  };

  const handleSelectRegistration = (reg: string) => {
    setAircraftRegistrationCode(reg);
    if (reg) {
      const found = allRegistrations.find((r) => r.value === reg);
      if (found?.operatorCode) setOperatorCode(found.operatorCode);
    }
  };

  const toggleTag = (id: number) =>
    setSelectedTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const resolvedEventType = eventType === 'Other' ? eventTypeOther.trim() : eventType;

  const handleSubmit = async () => {
    if (!taskId && !targetDivisionId) return toast.error('Division is required');
    if (!eventType) return toast.error('Event type is required');
    if (eventType === 'Other' && !eventTypeOther.trim()) return toast.error('Please specify the event type');
    if (!departmentId) return toast.error('Department is required');
    if (!description.trim()) return toast.error('Description is required');

    setSubmitting(true);
    try {
      const finding = await raiseFinding({
        ...(taskId ? { taskId } : { targetDivisionId: Number(targetDivisionId) }),
        eventType: resolvedEventType,
        departmentId: Number(departmentId),
        description: description.trim(),
        aircraftRegistrationCode: aircraftRegistrationCode || undefined,
        regulatoryReference: regulatoryReference.trim() || undefined,
        fieldId: fieldId.trim() || undefined,
        ataChapterId: ataChapterId ? Number(ataChapterId) : undefined,
        hazardTagIds: selectedTagIds.length ? selectedTagIds : undefined,
        ...(duplicateOfId != null ? { duplicateOfFindingId: duplicateOfId } : {}),
      });
      toast.success(
        duplicateOfId != null
          ? `Finding #${finding.id} raised and marked as duplicate of #${duplicateOfId}`
          : `Finding #${finding.id} raised`
      );
      onRaised();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to raise finding'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="bg-white w-full max-w-md h-full shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-base font-bold text-slate-800">Raise Finding</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {!taskId && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Division <span className="text-red-400">*</span>
              </label>
              <select
                value={targetDivisionId}
                onChange={(e) => setTargetDivisionId(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select division…</option>
                {divisions.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Event Type <span className="text-red-400">*</span>
            </label>
            <select
              value={eventType}
              onChange={(e) => { setEventType(e.target.value); setEventTypeOther(''); }}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select event type…</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {eventType === 'Other' && (
              <input
                type="text"
                value={eventTypeOther}
                onChange={(e) => setEventTypeOther(e.target.value)}
                placeholder="Specify event type…"
                className="mt-2 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Department <span className="text-red-400">*</span>
            </label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select department…</option>
              {departments.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Raise-time duplicate detection — offer to link instead of duplicate */}
          {candidates.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 uppercase tracking-wide">
                <Layers className="w-3.5 h-3.5" />
                Possible duplicates
              </div>
              <p className="text-xs text-amber-700/80">
                {candidates.length} active finding{candidates.length > 1 ? 's' : ''} already open in this department. If this is the same issue, mark it as a duplicate instead of opening a new investigation.
              </p>
              <div className="space-y-1.5">
                {candidates.map((c) => {
                  const selected = duplicateOfId === c.id;
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${selected ? 'border-amber-400 bg-amber-100/70' : 'border-amber-100 bg-white'}`}
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="font-mono font-semibold text-amber-700 text-xs flex-shrink-0">#{c.id}</span>
                        <FindingStatusBadge status={c.status} />
                        <span className="text-xs text-slate-600 truncate">{c.description}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDuplicateOfId(selected ? null : c.id)}
                        className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors ${selected ? 'bg-amber-600 text-white border-amber-600' : 'text-amber-700 border-amber-300 hover:bg-amber-100'}`}
                      >
                        {selected ? 'Selected' : 'Mark as duplicate'}
                      </button>
                    </div>
                  );
                })}
              </div>
              {duplicateOfId != null && (
                <p className="text-xs text-amber-800">
                  This finding will be recorded against the task and parked as a duplicate of #{duplicateOfId} — managed there.{' '}
                  <button type="button" onClick={() => setDuplicateOfId(null)} className="underline font-semibold">Clear</button>
                </p>
              )}
            </div>
          )}

          {/* Optional fields collapsed by default to keep the required fields
              (Event Type, Department, Description) front and centre. */}
          <button
            type="button"
            onClick={() => setShowOptional((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 uppercase tracking-wide"
          >
            {showOptional ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Additional details (optional)
          </button>

          {showOptional && (
          <>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              ATA Chapter
            </label>
            <select
              value={ataChapterId}
              onChange={(e) => setAtaChapterId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select ATA chapter… (optional)</option>
              {ataChapters.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Hazard Tags
            </label>
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
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Operator
            </label>
            <SearchableSelect
              options={operators}
              value={operatorCode}
              onChange={handleSelectOperator}
              placeholder="Filter by operator… (optional)"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Aircraft Registration
            </label>
            <SearchableSelect
              options={filteredRegistrations}
              value={aircraftRegistrationCode}
              onChange={handleSelectRegistration}
              placeholder="Select registration… (optional)"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Regulatory Reference
            </label>
            <input
              type="text"
              value={regulatoryReference}
              onChange={(e) => setRegulatoryReference(e.target.value)}
              placeholder="e.g. EASA Part-M (optional)"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Field Reference
            </label>
            <input
              type="text"
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value)}
              placeholder="Which form field triggered this (optional)"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Describe the non-conformance…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {submitting ? 'Raising…' : duplicateOfId != null ? `Raise as duplicate of #${duplicateOfId}` : 'Raise Finding'}
          </button>
        </div>
      </div>
    </div>
  );
}
