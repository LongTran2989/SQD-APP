'use client';

import { useState, useEffect } from 'react';
import { X, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { WpType, Template, TemplateSet } from '../../types';
import { getWpTypes } from '../../api/wpApi';
import { getTemplateSets } from '../../api/templateSetApi';
import { getDivisions } from '../../api/taskApi';
import { apiClient } from '../../api/client';
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
  const [autoGenSetId, setAutoGenSetId] = useState<number | ''>('');
  const [autoGenSource, setAutoGenSource] = useState<'TEMPLATE' | 'SET'>('TEMPLATE');

  const [wpTypes, setWpTypes] = useState<WpType[]>([]);
  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateSets, setTemplateSets] = useState<TemplateSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [typesData, divsData, deptRes, tplRes] = await Promise.all([
          getWpTypes(), getDivisions(), apiClient.get('/datasources/departments'), apiClient.get('/templates'),
        ]);
        setWpTypes(typesData);
        setDivisions(divsData);
        setDepartments(deptRes.data as { value: string; label: string }[]);
        setTemplates((tplRes.data as Template[]).filter((t) => t.status === 'Published'));

        if (editId) {
          const bp = await getWpBlueprint(editId);
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
          setAutoGenSetId(bp.defaultAutoGenSetId ?? '');
          setAutoGenSource(bp.defaultAutoGenSetId ? 'SET' : 'TEMPLATE');
        }
      } catch {
        toast.error('Failed to load form data');
      } finally {
        setLoading(false);
      }
    };
    load();
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

  const divisionTemplates = templates.filter((t) => t.divisionId === divisionId);
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
                      <select id="bp-ag-template" value={autoGenTemplateId} onChange={(e) => setAutoGenTemplateId(e.target.value ? Number(e.target.value) : '')} className={field}>
                        <option value="">Select a published template...</option>
                        {divisionTemplates.map((t) => <option key={t.id} value={t.id}>{t.templateId} — {t.title}</option>)}
                      </select>
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

            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors">Cancel</button>
              <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-sm transition-all">
                {submitting ? 'Saving...' : editId ? 'Save Changes' : 'Create Blueprint'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
