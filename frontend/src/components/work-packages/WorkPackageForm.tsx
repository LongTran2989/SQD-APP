'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { WpType, Template, TemplateSet } from '../../types';
import { getWpTypes } from '../../api/wpApi';
import { getTemplateSets } from '../../api/templateSetApi';
import { getDivisions } from '../../api/taskApi';
import { apiClient } from '../../api/client';
import TemplatePickerModal from '../templates/TemplatePickerModal';
import toast from 'react-hot-toast';
import { Info, LayoutTemplate, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WpFormValues {
  name: string;
  type: string;
  divisionId: number | '';
  timeframeFrom: string;
  timeframeTo: string;
  acRegistration: string;
  customer: string;
  authority: string;
  targetDepartmentId: number | '';
  // Auto-generate config. Source is a single template OR (SINGLE_SHOT only) a
  // saved set — exactly one of autoGenTemplateId / autoGenSetId is set.
  autoGenerate: boolean;
  autoGenMode: 'SINGLE_SHOT' | 'REPEAT';
  autoGenInterval: number | '';
  autoGenTemplateId: number | '';
  autoGenSetId: number | '';
}

interface WorkPackageFormProps {
  initial?: Partial<WpFormValues>;
  submitting: boolean;
  onSubmit: (values: WpFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkPackageForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
  submitLabel = 'Create Work Package',
}: WorkPackageFormProps) {
  const { user } = useAuthStore();

  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const [divisionId, setDivisionId] = useState<number | ''>(initial?.divisionId ?? user?.divisionId ?? '');
  const [timeframeFrom, setTimeframeFrom] = useState(initial?.timeframeFrom ?? '');
  const [timeframeTo, setTimeframeTo] = useState(initial?.timeframeTo ?? '');
  const [acRegistration, setAcRegistration] = useState(initial?.acRegistration ?? '');
  const [customer, setCustomer] = useState(initial?.customer ?? '');
  const [authority, setAuthority] = useState(initial?.authority ?? '');
  const [targetDepartmentId, setTargetDepartmentId] = useState<number | ''>(initial?.targetDepartmentId ?? '');

  // Auto-generate config.
  const [autoGenerate, setAutoGenerate] = useState<boolean>(initial?.autoGenerate ?? false);
  const [autoGenMode, setAutoGenMode] = useState<'SINGLE_SHOT' | 'REPEAT'>(initial?.autoGenMode ?? 'SINGLE_SHOT');
  const [autoGenInterval, setAutoGenInterval] = useState<number | ''>(initial?.autoGenInterval ?? '');
  const [autoGenTemplateId, setAutoGenTemplateId] = useState<number | ''>(initial?.autoGenTemplateId ?? '');
  const [autoGenSetId, setAutoGenSetId] = useState<number | ''>(initial?.autoGenSetId ?? '');
  // 'TEMPLATE' = single template, 'SET' = saved set (SINGLE_SHOT only).
  const [autoGenSource, setAutoGenSource] = useState<'TEMPLATE' | 'SET'>(initial?.autoGenSetId ? 'SET' : 'TEMPLATE');

  const [wpTypes, setWpTypes] = useState<WpType[]>([]);
  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [selectedAutoGenTemplate, setSelectedAutoGenTemplate] = useState<Template | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateSets, setTemplateSets] = useState<TemplateSet[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [typesData, divsData, deptRes] = await Promise.all([
          getWpTypes(),
          getDivisions(),
          apiClient.get('/datasources/departments'),
        ]);
        setWpTypes(typesData);
        setDivisions(divsData);
        setDepartments(deptRes.data as { value: string; label: string }[]);
      } catch {
        toast.error('Failed to load form data');
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, []);

  // Saved sets are division-scoped; reload the active set list whenever the
  // chosen division changes (and reset a stale selection).
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!type) { toast.error('WP Type is required'); return; }
    if (!divisionId) { toast.error('Division is required'); return; }
    if (!timeframeFrom) { toast.error('Start date is required'); return; }
    if (!timeframeTo) { toast.error('End date is required'); return; }
    if (timeframeFrom >= timeframeTo) { toast.error('Start date must be before end date'); return; }
    // Saved sets are SINGLE_SHOT only; REPEAT always uses a single template.
    const useSet = autoGenMode === 'SINGLE_SHOT' && autoGenSource === 'SET';
    if (autoGenerate) {
      if (useSet) {
        if (!autoGenSetId) { toast.error('Select a saved template set'); return; }
      } else {
        if (!autoGenTemplateId) { toast.error('Auto-generate requires a template'); return; }
      }
      if (autoGenMode === 'REPEAT' && (!autoGenInterval || Number(autoGenInterval) < 1)) {
        toast.error('Repeat mode requires an interval of at least 1 day'); return;
      }
    }

    onSubmit({
      name: name.trim(), type, divisionId, timeframeFrom, timeframeTo,
      acRegistration: acRegistration.trim(), customer: customer.trim(), authority: authority.trim(), targetDepartmentId,
      autoGenerate, autoGenMode, autoGenInterval,
      autoGenTemplateId: useSet ? '' : autoGenTemplateId,
      autoGenSetId: useSet ? autoGenSetId : '',
    });
  };

  const isAuditType = type === 'AUDIT';
  const showContextFields = type === 'CHECK';

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Core details */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">Work Package Details</h2>

        {/* Name */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-name">
            Name *
          </label>
          <input
            id="wp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q3 Line Maintenance Audit"
            required
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-type">
            Type *
          </label>
          <select
            id="wp-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
          >
            <option value="">Select type...</option>
            {wpTypes.map((t) => (
              <option key={t.id} value={t.code}>
                {t.code}{t.description ? ` — ${t.description}` : ''}
              </option>
            ))}
          </select>
          {wpTypes.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" /> No WP types configured. An Admin must add types first.
            </p>
          )}
        </div>

        {/* Division */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-division">
            Division *
          </label>
          <select
            id="wp-division"
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value ? Number(e.target.value) : '')}
            required
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
          >
            <option value="">Select division...</option>
            {divisions.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        {/* CHECK-only context fields */}
        {showContextFields && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-acreg">A/C Registration</label>
              <input id="wp-acreg" type="text" value={acRegistration} onChange={(e) => setAcRegistration(e.target.value)}
                placeholder="e.g. VN-A361"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-customer">Customer</label>
              <input id="wp-customer" type="text" value={customer} onChange={(e) => setCustomer(e.target.value)}
                placeholder="e.g. Vietnam Airlines"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-authority">Authority</label>
              <input id="wp-authority" type="text" value={authority} onChange={(e) => setAuthority(e.target.value)}
                placeholder="e.g. CAAV"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm" />
            </div>
          </div>
        )}

        {/* AUDIT-only target department */}
        {isAuditType && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-target-dept">Target Department</label>
            <select id="wp-target-dept" value={targetDepartmentId}
              onChange={(e) => setTargetDepartmentId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm">
              <option value="">Select department...</option>
              {departments.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Timeframe */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">Timeframe</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-from">
              Start Date *
            </label>
            <input
              id="wp-from"
              type="date"
              value={timeframeFrom}
              onChange={(e) => setTimeframeFrom(e.target.value)}
              required
              max="9999-12-31"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-to">
              End Date *
            </label>
            <input
              id="wp-to"
              type="date"
              value={timeframeTo}
              min={timeframeFrom || undefined}
              max="9999-12-31"
              onChange={(e) => setTimeframeTo(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            />
          </div>
        </div>
      </div>

      {/* Automatic task generation */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">Automatic Task Generation</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Spawn tasks from a template automatically — once, or on a repeating cadence while the WP is active.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
            />
            <div className="relative w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
          </label>
        </div>

        {autoGenerate && (
          <div className="space-y-4 pt-2 border-t border-slate-100">
            {/* Mode */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-autogen-mode">Mode *</label>
              <select
                id="wp-autogen-mode"
                value={autoGenMode}
                onChange={(e) => {
                  const mode = e.target.value as 'SINGLE_SHOT' | 'REPEAT';
                  setAutoGenMode(mode);
                  // Saved sets are SINGLE_SHOT only; REPEAT forces single-template.
                  if (mode === 'REPEAT') setAutoGenSource('TEMPLATE');
                }}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
              >
                <option value="SINGLE_SHOT">Single shot — generate once when the WP starts</option>
                <option value="REPEAT">Repeat — generate every N days while active</option>
              </select>
            </div>

            {/* Source toggle — saved sets only available for SINGLE_SHOT */}
            {autoGenMode === 'SINGLE_SHOT' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Source *</label>
                <div className="inline-flex rounded-xl border border-slate-300 overflow-hidden text-sm">
                  <button type="button" onClick={() => setAutoGenSource('TEMPLATE')}
                    className={`px-4 py-2 font-medium transition-colors ${autoGenSource === 'TEMPLATE' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    Single template
                  </button>
                  <button type="button" onClick={() => setAutoGenSource('SET')}
                    className={`px-4 py-2 font-medium transition-colors border-l border-slate-300 ${autoGenSource === 'SET' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    Saved set
                  </button>
                </div>
              </div>
            )}

            {/* Single-template source */}
            {!(autoGenMode === 'SINGLE_SHOT' && autoGenSource === 'SET') && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-autogen-template">
                  Template * <span className="font-normal text-slate-500">(must be Published)</span>
                </label>
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
                    id="wp-autogen-template"
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

            {/* Saved-set source (SINGLE_SHOT only) */}
            {autoGenMode === 'SINGLE_SHOT' && autoGenSource === 'SET' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-autogen-set">
                  Saved set * <span className="font-normal text-slate-500">(active sets in this division)</span>
                </label>
                <select
                  id="wp-autogen-set"
                  value={autoGenSetId}
                  onChange={(e) => setAutoGenSetId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                >
                  <option value="">Select a template set...</option>
                  {templateSets.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s._count?.items ?? s.items?.length ?? 0} templates)</option>
                  ))}
                </select>
                {templateSets.length === 0 && (
                  <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" /> No active template sets in this division. Create one under Template Sets.
                  </p>
                )}
              </div>
            )}

            {/* Interval — REPEAT only */}
            {autoGenMode === 'REPEAT' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-autogen-interval">
                  Interval (days) *
                </label>
                <input
                  id="wp-autogen-interval"
                  type="number"
                  min={1}
                  step={1}
                  value={autoGenInterval}
                  onChange={(e) => setAutoGenInterval(e.target.value ? Number(e.target.value) : '')}
                  placeholder="e.g. 1 for daily"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-sm transition-all"
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>

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
  </>
  );
}
