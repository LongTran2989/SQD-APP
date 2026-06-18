'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, ArrowUp, ArrowDown, Trash2, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { Template } from '../../types';
import { getDivisions } from '../../api/taskApi';
import { apiClient } from '../../api/client';
import {
  createTemplateSet,
  updateTemplateSet,
  getTemplateSet,
  TemplateSetItemPayload,
} from '../../api/templateSetApi';

interface TemplateSetFormProps {
  /** When set, the modal edits this set; otherwise it creates a new one. */
  editId?: number;
  onClose: () => void;
  onSaved: () => void;
}

// Local editable row (mirrors TemplateSetItemPayload but with form-friendly strings).
interface ItemRow {
  templateId: number | '';
  deadlineOffsetDays: number | '';
  estimatedHours: number | '';
  skillLevel: number | '';
  requiresApproval: boolean;
  defaultNote: string;
}

const emptyRow = (): ItemRow => ({
  templateId: '', deadlineOffsetDays: '', estimatedHours: '', skillLevel: '', requiresApproval: false, defaultNote: '',
});

const ADMIN_DIRECTOR = ['Admin', 'Director'];

export default function TemplateSetForm({ editId, onClose, onSaved }: TemplateSetFormProps) {
  const { user } = useAuthStore();
  const isGlobal = user ? ADMIN_DIRECTOR.includes(user.role) : false;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [divisionId, setDivisionId] = useState<number | ''>(user?.divisionId ?? '');
  const [rows, setRows] = useState<ItemRow[]>([emptyRow()]);

  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Published templates in the chosen division populate every row's picker.
  const divisionTemplates = useMemo(
    () => templates.filter((t) => t.status === 'Published' && t.divisionId === divisionId),
    [templates, divisionId]
  );

  useEffect(() => {
    const load = async () => {
      try {
        const [divs, tplRes] = await Promise.all([getDivisions(), apiClient.get('/templates')]);
        setDivisions(divs);
        setTemplates(tplRes.data as Template[]);

        if (editId) {
          const set = await getTemplateSet(editId);
          setName(set.name);
          setDescription(set.description ?? '');
          setDivisionId(set.divisionId);
          setRows(
            (set.items ?? []).map((it) => ({
              templateId: it.templateId,
              deadlineOffsetDays: it.deadlineOffsetDays ?? '',
              estimatedHours: it.estimatedHours ?? '',
              skillLevel: it.skillLevel ?? '',
              requiresApproval: it.requiresApproval ?? false,
              defaultNote: it.defaultNote ?? '',
            }))
          );
        }
      } catch {
        toast.error('Failed to load form data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [editId]);

  const updateRow = (i: number, patch: Partial<ItemRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setRows((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!divisionId) { toast.error('Division is required'); return; }
    const filled = rows.filter((r) => r.templateId !== '');
    if (filled.length === 0) { toast.error('Add at least one template'); return; }

    const items: TemplateSetItemPayload[] = filled.map((r, orderIndex) => ({
      templateId: Number(r.templateId),
      orderIndex,
      deadlineOffsetDays: r.deadlineOffsetDays === '' ? null : Number(r.deadlineOffsetDays),
      estimatedHours: r.estimatedHours === '' ? null : Number(r.estimatedHours),
      skillLevel: r.skillLevel === '' ? null : Number(r.skillLevel),
      requiresApproval: r.requiresApproval,
      defaultNote: r.defaultNote.trim() || null,
    }));

    setSubmitting(true);
    try {
      if (editId) {
        await updateTemplateSet(editId, { name: name.trim(), description: description.trim() || null, items });
        toast.success('Template set updated');
      } else {
        await createTemplateSet({ name: name.trim(), description: description.trim() || null, divisionId: Number(divisionId), items });
        toast.success('Template set created');
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to save template set');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h2 className="text-base font-bold text-slate-800">{editId ? 'Edit Template Set' : 'New Template Set'}</h2>
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
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="ts-name">Name *</label>
              <input id="ts-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Annual base-check task set"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="ts-desc">Description</label>
              <textarea id="ts-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="ts-division">Division *</label>
              <select
                id="ts-division"
                value={divisionId}
                disabled={!isGlobal || !!editId}
                onChange={(e) => { setDivisionId(e.target.value ? Number(e.target.value) : ''); setRows([emptyRow()]); }}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="">Select division...</option>
                {divisions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              {!isGlobal && (
                <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5" /> Managers can only create sets in their own division.
                </p>
              )}
              {!!editId && (
                <p className="mt-1.5 text-xs text-slate-500">Division can&apos;t be changed after creation.</p>
              )}
            </div>

            {/* Ordered item builder */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Templates (in order)</h3>
                <button type="button" onClick={addRow}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  <Plus className="w-4 h-4" /> Add template
                </button>
              </div>

              {divisionTemplates.length === 0 && divisionId !== '' && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5" /> No published templates in this division.
                </p>
              )}

              {rows.map((row, i) => (
                <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-3 bg-slate-50/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 w-5 text-center">{i + 1}</span>
                    <select
                      value={row.templateId}
                      onChange={(e) => updateRow(i, { templateId: e.target.value ? Number(e.target.value) : '' })}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    >
                      <option value="">Select a published template...</option>
                      {divisionTemplates.map((t) => <option key={t.id} value={t.id}>{t.templateId} — {t.title}</option>)}
                    </select>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md disabled:opacity-30" aria-label="Move up">
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md disabled:opacity-30" aria-label="Move down">
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md disabled:opacity-30" aria-label="Remove">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-7">
                    <label className="text-xs text-slate-500">
                      Deadline offset (days)
                      <input type="number" min={0} value={row.deadlineOffsetDays}
                        onChange={(e) => updateRow(i, { deadlineOffsetDays: e.target.value ? Number(e.target.value) : '' })}
                        className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white text-sm" />
                    </label>
                    <label className="text-xs text-slate-500">
                      Est. hours
                      <input type="number" min={0} step={0.5} value={row.estimatedHours}
                        onChange={(e) => updateRow(i, { estimatedHours: e.target.value ? Number(e.target.value) : '' })}
                        className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white text-sm" />
                    </label>
                    <label className="text-xs text-slate-500">
                      Skill level
                      <input type="number" min={0} value={row.skillLevel}
                        onChange={(e) => updateRow(i, { skillLevel: e.target.value ? Number(e.target.value) : '' })}
                        className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white text-sm" />
                    </label>
                    <label className="text-xs text-slate-500 flex items-center gap-2 sm:col-span-1 col-span-2 pt-5">
                      <input type="checkbox" checked={row.requiresApproval}
                        onChange={(e) => updateRow(i, { requiresApproval: e.target.checked })} />
                      Requires approval
                    </label>
                    <label className="text-xs text-slate-500 col-span-2 sm:col-span-3">
                      Default note
                      <input type="text" value={row.defaultNote}
                        onChange={(e) => updateRow(i, { defaultNote: e.target.value })}
                        className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white text-sm" />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={submitting}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-sm transition-all">
                {submitting ? 'Saving...' : editId ? 'Save Changes' : 'Create Set'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
