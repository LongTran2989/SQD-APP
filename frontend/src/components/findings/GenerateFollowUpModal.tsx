'use client';

import { useState, useEffect } from 'react';
import { Template, WorkPackageEnriched, ResponseActionType } from '../../types';
import { generateFollowUpTasks, FollowUpTaskInput } from '../../api/findingApi';
import { getWorkPackages } from '../../api/wpApi';
import { getDatasource } from '../../api/taskApi';
import { apiClient } from '../../api/client';
import toast from 'react-hot-toast';
import { X, Plus, Trash2, ListPlus } from 'lucide-react';
import { MULTI_DEPT_SINGLE_TASK_TYPES } from '../../constants/findingExpansion';

interface Props {
  findingId: number;
  onClose: () => void;
  onGenerated: () => void;
}

type WpMode = 'none' | 'existing' | 'new';

interface RowDraft {
  _key: number;
  templateId: number | '';
  title: string;
  wpMode: WpMode;
  wpId: number | '';
  newWpName: string;
  responseActionType: ResponseActionType | '';
  targetDepartmentIds: number[];
}

let _key = 0;
const nextKey = () => ++_key;

function emptyRow(): RowDraft {
  return { _key: nextKey(), templateId: '', title: '', wpMode: 'none', wpId: '', newWpName: '', responseActionType: '', targetDepartmentIds: [] };
}

export default function GenerateFollowUpModal({ findingId, onClose, onGenerated }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [openWps, setOpenWps] = useState<WorkPackageEnriched[]>([]);
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [rows, setRows] = useState<RowDraft[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient
      .get('/templates')
      .then((r) => setTemplates((r.data as Template[]).filter((t) => t.status === 'Published')))
      .catch(() => {});
    getWorkPackages()
      .then((wps) => setOpenWps(wps.filter((w) => w.computedStatus === 'Open' || w.computedStatus === 'In Progress')))
      .catch(() => {});
    getDatasource('departments').then(setDepartments).catch(() => {});
  }, []);

  const updateRow = (key: number, patch: Partial<RowDraft>) =>
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (key: number) => setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r._key !== key)));

  // Auto-fill the title from the chosen template (only if the user hasn't typed one).
  const handleTemplateChange = (row: RowDraft, templateId: number | '') => {
    const tpl = templates.find((t) => t.id === templateId);
    const patch: Partial<RowDraft> = { templateId };
    if (tpl && (!row.title || row.title === '')) patch.title = tpl.title;
    updateRow(row._key, patch);
  };

  const handleGenerate = async () => {
    // Validate
    if (rows.length > 20) {
      return toast.error('A maximum of 20 follow-up tasks may be generated at once');
    }
    for (const r of rows) {
      if (!r.templateId) return toast.error('Select a template for each task');
      if (!r.title.trim()) return toast.error('Each task needs a title');
      if (r.wpMode === 'existing' && !r.wpId) return toast.error('Select a Work Package to attach to');
      if (r.wpMode === 'new' && !r.newWpName.trim()) return toast.error('Enter a name for the new Work Package');
      if (r.responseActionType) {
        if (r.targetDepartmentIds.length === 0) {
          return toast.error(`Select at least one department for ${r.responseActionType}`);
        }
        if (!MULTI_DEPT_SINGLE_TASK_TYPES.includes(r.responseActionType) && r.targetDepartmentIds.length > 1) {
          return toast.error(`${r.responseActionType}: add one row per department for multiple targets`);
        }
      }
    }

    const payload: FollowUpTaskInput[] = rows.map((r) => ({
      templateId: Number(r.templateId),
      title: r.title.trim(),
      ...(r.wpMode === 'existing' ? { wpId: Number(r.wpId) } : {}),
      ...(r.wpMode === 'new' ? { createNewWp: true, newWpName: r.newWpName.trim() } : {}),
      ...(r.responseActionType ? {
        responseActionType: r.responseActionType,
        targetDepartmentIds: r.targetDepartmentIds,
      } : {}),
    }));

    setSubmitting(true);
    try {
      const res = await generateFollowUpTasks(findingId, payload);
      toast.success(`${res.createdTasks.length} follow-up task(s) created`);
      onGenerated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to generate follow-up tasks');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ListPlus className="w-5 h-5 text-blue-500" />
            <h3 className="text-base font-bold text-slate-800">Generate Follow-up Tasks</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {rows.map((row, idx) => (
            <div key={row._key} className="border border-slate-200 rounded-xl p-4 space-y-3 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Task {idx + 1}</span>
                {rows.length > 1 && (
                  <button onClick={() => removeRow(row._key)} className="p-1 text-slate-400 hover:text-red-500 rounded-lg" title="Remove">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Response Action Type</label>
                <select
                  value={row.responseActionType}
                  onChange={(e) => updateRow(row._key, {
                    responseActionType: e.target.value as ResponseActionType | '',
                    targetDepartmentIds: [],
                    templateId: '',
                  })}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">(None — generic follow-up)</option>
                  <option value="IR">IR — Investigation Report (internal)</option>
                  <option value="CAR">CAR — Corrective Action Request</option>
                  <option value="NCR">NCR — Non-Conformance Report</option>
                  <option value="QR">QR — Quality Request (CAPA)</option>
                  <option value="QN">QN — Quality Notice (Director approval required)</option>
                  <option value="Dissemination">Dissemination — Sharing / Notification</option>
                </select>
                {row.responseActionType && (
                  <p className="mt-1 text-xs text-slate-400">
                    {row.responseActionType === 'IR' && 'Internal SQD investigation. RCA/CAPA entered directly.'}
                    {['CAR', 'NCR'].includes(row.responseActionType) && 'External: target dept investigates and returns RCA/CAPA. Add one row per department.'}
                    {row.responseActionType === 'QR' && 'Quality Request is itself the corrective action. One row per department.'}
                    {row.responseActionType === 'QN' && 'Informational notice. Director must approve before issue. Select all target departments.'}
                    {row.responseActionType === 'Dissemination' && 'Sharing finding with relevant parties. Select all target departments.'}
                  </p>
                )}
              </div>

              {row.responseActionType && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    Target Department(s) *
                    {!MULTI_DEPT_SINGLE_TASK_TYPES.includes(row.responseActionType) && ' (one per row for multiple depts)'}
                  </label>
                  {!MULTI_DEPT_SINGLE_TASK_TYPES.includes(row.responseActionType) ? (
                    <select
                      value={row.targetDepartmentIds[0] ?? ''}
                      onChange={(e) => updateRow(row._key, {
                        targetDepartmentIds: e.target.value ? [Number(e.target.value)] : []
                      })}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select department…</option>
                      {departments.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                      {departments.map((d) => (
                        <label key={d.value} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.targetDepartmentIds.includes(Number(d.value))}
                            onChange={(e) => {
                              const id = Number(d.value);
                              const ids = e.target.checked
                                ? [...row.targetDepartmentIds, id]
                                : row.targetDepartmentIds.filter((x) => x !== id);
                              updateRow(row._key, { targetDepartmentIds: ids });
                            }}
                          />
                          {d.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Template (Published) *</label>
                <select
                  value={row.templateId}
                  onChange={(e) => handleTemplateChange(row, e.target.value ? Number(e.target.value) : '')}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select template…</option>
                  {(row.responseActionType
                    ? templates.filter((t) => t.type === row.responseActionType)
                    : templates
                  ).map((t) => (
                    <option key={t.id} value={t.id}>{t.templateId} — {t.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Title *</label>
                <input
                  type="text"
                  value={row.title}
                  onChange={(e) => updateRow(row._key, { title: e.target.value })}
                  placeholder="Task title"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Work Package</label>
                <div className="flex flex-wrap gap-3 mb-2">
                  {(['none', 'existing', 'new'] as WpMode[]).map((mode) => (
                    <label key={mode} className="inline-flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`wpmode-${row._key}`}
                        checked={row.wpMode === mode}
                        onChange={() => updateRow(row._key, { wpMode: mode })}
                      />
                      {mode === 'none' ? 'No WP' : mode === 'existing' ? 'Attach to existing' : 'Create new'}
                    </label>
                  ))}
                </div>
                {row.wpMode === 'existing' && (
                  <select
                    value={row.wpId}
                    onChange={(e) => updateRow(row._key, { wpId: e.target.value ? Number(e.target.value) : '' })}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Work Package…</option>
                    {openWps.map((w) => (
                      <option key={w.id} value={w.id}>{w.wpId} — {w.name}</option>
                    ))}
                  </select>
                )}
                {row.wpMode === 'new' && (
                  <input
                    type="text"
                    value={row.newWpName}
                    onChange={(e) => updateRow(row._key, { newWpName: e.target.value })}
                    placeholder="New Work Package name"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <Plus className="w-4 h-4" />
            Add another task
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {submitting ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}
