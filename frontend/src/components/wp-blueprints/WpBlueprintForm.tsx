'use client';

import { useState, useEffect } from 'react';
import { X, Info, LayoutTemplate } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { WpType, TemplateSet } from '../../types';
import { getWpTypes } from '../../api/wpApi';
import { getTemplateSets } from '../../api/templateSetApi';
import { getDivisions } from '../../api/taskApi';
import { apiClient } from '../../api/client';
import TemplatePickerModal from '../templates/TemplatePickerModal';
import {
  createWpBlueprint,
  updateWpBlueprint,
  getWpBlueprint,
  WpBlueprintPayload,
} from '../../api/wpBlueprintApi';

interface WpBlueprintFormProps {
  editId?: number;
  onClose: () => void;
  onSaved: () => void;
}

const ADMIN_DIRECTOR = ['Admin', 'Director'];

export default function WpBlueprintForm({ editId, onClose, onSaved }: WpBlueprintFormProps) {
  const { user } = useAuthStore();
  const isGlobal = user ? ADMIN_DIRECTOR.includes(user.role) : false;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('');
  const [divisionId, setDivisionId] = useState<number | ''>(user?.divisionId ?? '');
  const [defaultDuration, setDefaultDuration] = useState<number | ''>(7);
  const [acRegistration, setAcRegistration] = useState('');
  const [customer, setCustomer] = useState('');
  const [authority, setAuthority] = useState('');
  const [targetDepartmentId, setTargetDepartmentId] = useState<number | ''>('');

  // Autogen config (mirrors WorkPackageForm).
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [autoGenMode, setAutoGenMode] = useState<'SINGLE_SHOT' | 'REPEAT'>('SINGLE_SHOT');
  const [autoGenInterval, setAutoGenInterval] = useState<number | ''>('');
  const [autoGenTemplateId, setAutoGenTemplateId] = useState<number | ''>('');
  const [selectedAutoGenTemplate, setSelectedAutoGenTemplate] = useState<{ id: number; templateId: string; title: string } | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [autoGenSetId, setAutoGenSetId] = useState<number | ''>('');
  const [autoGenSource, setAutoGenSource] = useState<'TEMPLATE' | 'SET'>('TEMPLATE');

  // Recurrence config (P7).
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<'CALENDAR' | 'LAST_DONE'>('CALENDAR');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number | ''>('');
  const [recurrenceStartDate, setRecurrenceStartDate] = useState('');

  const [wpTypes, setWpTypes] = useState<WpType[]>([]);
  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [templateSets, setTemplateSets] = useState<TemplateSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [typesData, divsData, deptRes] = await Promise.all([
          getWpTypes(), getDivisions(), apiClient.get('/datasources/departments'),
        ]);
        if (cancelled) return;
        setWpTypes(typesData);
        setDivisions(divsData);
        setDepartments(deptRes.data as { value: string; label: string }[]);

        if (editId) {
          const bp = await getWpBlueprint(editId);
          if (cancelled) return;
          setName(bp.name);
          setDescription(bp.description ?? '');
          setType(bp.type);
          setDivisionId(bp.divisionId);
          setDefaultDuration(bp.defaultDuration);
          setAcRegistration(bp.acRegistration ?? '');
          setCustomer(bp.customer ?? '');
          setAuthority(bp.authority ?? '');
          setTargetDepartmentId(bp.targetDepartmentId ?? '');
          setAutoGenerate(bp.defaultAutoGenerate);
          setAutoGenMode(bp.defaultAutoGenMode ?? 'SINGLE_SHOT');
          setAutoGenInterval(bp.defaultAutoGenInterval ?? '');
          setAutoGenTemplateId(bp.defaultAutoGenTemplateId ?? '');
          // Populate the selected template display object if editing
          if (bp.defaultAutoGenTemplate) {
            setSelectedAutoGenTemplate(bp.defaultAutoGenTemplate);
          }
          setAutoGenSetId(bp.defaultAutoGenSetId ?? '');
          setAutoGenSource(bp.defaultAutoGenSetId ? 'SET' : 'TEMPLATE');
          if (bp.recurrenceType) {
            setRecurrenceEnabled(true);
            setRecurrenceType(bp.recurrenceType);
            setRecurrenceInterval(bp.recurrenceInterval ?? '');
            setRecurrenceStartDate(bp.recurrenceStartDate ? bp.recurrenceStartDate.slice(0, 10) : '');
          }
        }
      } catch {
        if (!cancelled) toast.error('Failed to load form data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [editId]);

  // Saved sets are division-scoped; reload on division change.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!divisionId) { if (!cancelled) setTemplateSets([]); return; }
      try {
        const sets = await getTemplateSets({ activeOnly: true, divisionId: Number(divisionId) });
        if (!cancelled) setTemplateSets(sets);
      } catch {
        if (!cancelled) setTemplateSets([]);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [divisionId]);

  const isCheckType = type === 'CHECK';
  const isAuditType = type === 'AUDIT';
  const useSet = autoGenMode === 'SINGLE_SHOT' && autoGenSource === 'SET';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!type) { toast.error('Type is required'); return; }
    if (!divisionId) { toast.error('Division is required'); return; }
    if (!defaultDuration || Number(defaultDuration) < 1) { toast.error('Default duration must be at least 1 day'); return; }
    if (autoGenerate) {
      if (useSet) { if (!autoGenSetId) { toast.error('Select a saved template set'); return; } }
      else if (!autoGenTemplateId) { toast.error('Auto-generate requires a template'); return; }
      if (autoGenMode === 'REPEAT' && (!autoGenInterval || Number(autoGenInterval) < 1)) {
        toast.error('Repeat mode requires an interval of at least 1 day'); return;
      }
    }
    if (recurrenceEnabled) {
      if (!recurrenceInterval || Number(recurrenceInterval) < 1) { toast.error('Recurrence requires an interval of at least 1 day'); return; }
      if (!recurrenceStartDate) { toast.error('Recurrence requires a start date'); return; }
    }

    const payload: WpBlueprintPayload = {
      name: name.trim(),
      description: description.trim() || null,
      type,
      divisionId: Number(divisionId),
      defaultDuration: Number(defaultDuration),
      acRegistration: isCheckType ? (acRegistration.trim() || null) : null,
      customer: isCheckType ? (customer.trim() || null) : null,
      authority: isCheckType ? (authority.trim() || null) : null,
      targetDepartmentId: isAuditType && targetDepartmentId ? Number(targetDepartmentId) : null,
      defaultAutoGenerate: autoGenerate,
      defaultAutoGenMode: autoGenerate ? autoGenMode : null,
      defaultAutoGenInterval: autoGenerate && autoGenMode === 'REPEAT' && autoGenInterval ? Number(autoGenInterval) : null,
      defaultAutoGenTemplateId: autoGenerate && !useSet && autoGenTemplateId ? Number(autoGenTemplateId) : null,
      defaultAutoGenSetId: autoGenerate && useSet && autoGenSetId ? Number(autoGenSetId) : null,
      recurrenceType: recurrenceEnabled ? recurrenceType : null,
      recurrenceInterval: recurrenceEnabled && recurrenceInterval ? Number(recurrenceInterval) : null,
      recurrenceStartDate: recurrenceEnabled && recurrenceStartDate ? recurrenceStartDate : null,
    };

    setSubmitting(true);
    try {
      if (editId) {
        // Division is immutable; omit it from the update payload.
        const { divisionId: _d, ...rest } = payload;
        void _d;
        await updateWpBlueprint(editId, rest);
        toast.success('Blueprint updated');
      } else {
        await createWpBlueprint(payload);
        toast.success('Blueprint created');
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to save blueprint');
      setSubmitting(false);
    }
  };

  const field = 'w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm';
  const labelCls = 'block text-sm font-semibold text-slate-700 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h2 className="text-base font-bold text-slate-800">{editId ? 'Edit Blueprint' : 'New Blueprint'}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div>
              <label className={labelCls} htmlFor="bp-name">Name *</label>
              <input id="bp-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="e.g. Standard line audit" />
            </div>
            <div>
              <label className={labelCls} htmlFor="bp-desc">Description</label>
              <textarea id="bp-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={field} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls} htmlFor="bp-type">Type *</label>
                <select id="bp-type" value={type} onChange={(e) => setType(e.target.value)} className={field}>
                  <option value="">Select type...</option>
                  {wpTypes.map((t) => <option key={t.id} value={t.code}>{t.code}{t.description ? ` — ${t.description}` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="bp-duration">Default duration (days) *</label>
                <input id="bp-duration" type="number" min={1} step={1} value={defaultDuration}
                  onChange={(e) => setDefaultDuration(e.target.value ? Number(e.target.value) : '')} className={field} />
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="bp-division">Division *</label>
              <select id="bp-division" value={divisionId} disabled={!isGlobal || !!editId}
                onChange={(e) => { setDivisionId(e.target.value ? Number(e.target.value) : ''); setAutoGenSetId(''); }}
                className={`${field} disabled:bg-slate-50 disabled:text-slate-500`}>
                <option value="">Select division...</option>
                {divisions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              {!isGlobal && <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Managers can only create blueprints in their own division.</p>}
              {!!editId && <p className="mt-1.5 text-xs text-slate-500">Division can&apos;t be changed after creation.</p>}
            </div>

            {/* Type-specific context defaults */}
            {isCheckType && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><label className={labelCls} htmlFor="bp-acreg">A/C Registration</label><input id="bp-acreg" type="text" value={acRegistration} onChange={(e) => setAcRegistration(e.target.value)} className={field} /></div>
                <div><label className={labelCls} htmlFor="bp-customer">Customer</label><input id="bp-customer" type="text" value={customer} onChange={(e) => setCustomer(e.target.value)} className={field} /></div>
                <div><label className={labelCls} htmlFor="bp-authority">Authority</label><input id="bp-authority" type="text" value={authority} onChange={(e) => setAuthority(e.target.value)} className={field} /></div>
              </div>
            )}
            {isAuditType && (
              <div>
                <label className={labelCls} htmlFor="bp-dept">Target Department</label>
                <select id="bp-dept" value={targetDepartmentId} onChange={(e) => setTargetDepartmentId(e.target.value ? Number(e.target.value) : '')} className={field}>
                  <option value="">Select department...</option>
                  {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            )}

            {/* Autogen defaults */}
            <div className="border-t border-slate-100 pt-4 space-y-4">
              <label className="inline-flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={autoGenerate} onChange={(e) => setAutoGenerate(e.target.checked)} />
                <div className="relative w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                <span className="text-sm font-semibold text-slate-700">Auto-generate tasks by default</span>
              </label>

              {autoGenerate && (
                <div className="space-y-4">
                  <div>
                    <label className={labelCls} htmlFor="bp-ag-mode">Mode *</label>
                    <select id="bp-ag-mode" value={autoGenMode}
                      onChange={(e) => { const m = e.target.value as 'SINGLE_SHOT' | 'REPEAT'; setAutoGenMode(m); if (m === 'REPEAT') setAutoGenSource('TEMPLATE'); }}
                      className={field}>
                      <option value="SINGLE_SHOT">Single shot — generate once when the WP starts</option>
                      <option value="REPEAT">Repeat — generate every N days while active</option>
                    </select>
                  </div>

                  {autoGenMode === 'SINGLE_SHOT' && (
                    <div>
                      <label className={labelCls}>Source *</label>
                      <div className="inline-flex rounded-xl border border-slate-300 overflow-hidden text-sm">
                        <button type="button" onClick={() => setAutoGenSource('TEMPLATE')} className={`px-4 py-2 font-medium ${autoGenSource === 'TEMPLATE' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Single template</button>
                        <button type="button" onClick={() => setAutoGenSource('SET')} className={`px-4 py-2 font-medium border-l border-slate-300 ${autoGenSource === 'SET' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Saved set</button>
                      </div>
                    </div>
                  )}

                  {!useSet && (
                    <div>
                      <label className={labelCls} htmlFor="bp-ag-template">Template * <span className="font-normal text-slate-500">(Published)</span></label>
                      {selectedAutoGenTemplate ? (
                        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-mono font-semibold text-blue-700">{selectedAutoGenTemplate.templateId}</span>
                            <p className="text-sm text-slate-700 truncate">{selectedAutoGenTemplate.title}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setSelectedAutoGenTemplate(null); setAutoGenTemplateId(''); }}
                            className="p-1 text-slate-400 hover:text-slate-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          id="bp-ag-template"
                          type="button"
                          onClick={() => setTemplatePickerOpen(true)}
                          className="w-full flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl text-sm text-slate-500 hover:text-blue-600 transition-all"
                        >
                          <LayoutTemplate className="w-4 h-4" />
                          Browse and select a template…
                        </button>
                      )}
                    </div>
                  )}

                  {useSet && (
                    <div>
                      <label className={labelCls} htmlFor="bp-ag-set">Saved set *</label>
                      <select id="bp-ag-set" value={autoGenSetId} onChange={(e) => setAutoGenSetId(e.target.value ? Number(e.target.value) : '')} className={field}>
                        <option value="">Select a template set...</option>
                        {templateSets.map((s) => <option key={s.id} value={s.id}>{s.name} ({s._count?.items ?? s.items?.length ?? 0} templates)</option>)}
                      </select>
                      {templateSets.length === 0 && <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> No active sets in this division.</p>}
                    </div>
                  )}

                  {autoGenMode === 'REPEAT' && (
                    <div>
                      <label className={labelCls} htmlFor="bp-ag-interval">Interval (days) *</label>
                      <input id="bp-ag-interval" type="number" min={1} step={1} value={autoGenInterval} onChange={(e) => setAutoGenInterval(e.target.value ? Number(e.target.value) : '')} className={field} placeholder="e.g. 1 for daily" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Recurrence (P7) — auto-launch this blueprint on a schedule */}
            <div className="border-t border-slate-100 pt-4 space-y-4">
              <label className="inline-flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={recurrenceEnabled} onChange={(e) => setRecurrenceEnabled(e.target.checked)} />
                <div className="relative w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                <span className="text-sm font-semibold text-slate-700">Auto-launch on a recurring schedule</span>
              </label>

              {recurrenceEnabled && (
                <div className="space-y-4">
                  <div>
                    <label className={labelCls} htmlFor="bp-rec-type">Recurrence mode *</label>
                    <select id="bp-rec-type" value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value as 'CALENDAR' | 'LAST_DONE')} className={field}>
                      <option value="CALENDAR">Calendar — launch every N days on a fixed cadence</option>
                      <option value="LAST_DONE">Last-done — launch N days after the previous one is closed</option>
                    </select>
                    <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1">
                      <Info className="w-3.5 h-3.5 shrink-0" />
                      {recurrenceType === 'CALENDAR'
                        ? 'Fires on schedule regardless of whether the previous Work Package is finished.'
                        : 'Next launch is scheduled only once the previous Work Package is closed.'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls} htmlFor="bp-rec-interval">Interval (days) *</label>
                      <input id="bp-rec-interval" type="number" min={1} step={1} value={recurrenceInterval}
                        onChange={(e) => setRecurrenceInterval(e.target.value ? Number(e.target.value) : '')} className={field} placeholder="e.g. 30" />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="bp-rec-start">Start date *</label>
                      <input id="bp-rec-start" type="date" value={recurrenceStartDate} onChange={(e) => setRecurrenceStartDate(e.target.value)} className={field} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors">Cancel</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-sm transition-all">
                {submitting ? 'Saving...' : editId ? 'Save Changes' : 'Create Blueprint'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Template Picker for auto-gen template selection */}
      <TemplatePickerModal
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onSelect={(t) => {
          setSelectedAutoGenTemplate(t);
          setAutoGenTemplateId(t.id);
          setTemplatePickerOpen(false);
        }}
      />
    </div>
  );
}
