'use client';

import { useEffect, useState, useCallback } from 'react';
import { Tags, Plus, Pencil, Lock, Loader2, AlertTriangle, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { apiErrorMessage } from '../../api/errorMessage';
import {
  listWpTypes, createWpType, updateWpType,
  listEventTypes, createEventType, updateEventType,
  listAtaChapters, createAtaChapter, updateAtaChapter,
  listCauseCodes, createCauseCode, updateCauseCode,
  listHazardTags, createHazardTag, updateHazardTag,
} from '../../api/taxonomyApi';

type Row = { id: number; isActive: boolean } & Record<string, unknown>;

interface ColumnDef { key: string; header: string; mono?: boolean }
interface FieldDef { key: string; label: string; required?: boolean }

interface TaxonomyConfig {
  id: string;
  label: string;
  writePrivilege: 'settings:taxonomy' | 'settings:wptype';
  columns: ColumnDef[];
  fields: FieldDef[];
  list: () => Promise<Row[]>;
  create: (payload: Record<string, string>) => Promise<Row>;
  update: (id: number, payload: Record<string, unknown>) => Promise<Row>;
}

const asRows = <T,>(p: Promise<T[]>): Promise<Row[]> => p as unknown as Promise<Row[]>;
const asRow = <T,>(p: Promise<T>): Promise<Row> => p as unknown as Promise<Row>;

const TAXONOMIES: TaxonomyConfig[] = [
  {
    id: 'wp-types',
    label: 'WP Types',
    writePrivilege: 'settings:wptype',
    columns: [
      { key: 'code', header: 'Code', mono: true },
      { key: 'description', header: 'Description' },
    ],
    fields: [
      { key: 'code', label: 'Code', required: true },
      { key: 'description', label: 'Description' },
    ],
    list: () => asRows(listWpTypes(false)),
    create: (p) => asRow(createWpType(p as { code: string; description?: string })),
    update: (id, p) => asRow(updateWpType(id, p)),
  },
  {
    id: 'event-types',
    label: 'Event Types',
    writePrivilege: 'settings:taxonomy',
    columns: [
      { key: 'code', header: 'Code', mono: true },
      { key: 'description', header: 'Description' },
    ],
    fields: [
      { key: 'code', label: 'Code', required: true },
      { key: 'description', label: 'Description' },
    ],
    list: () => asRows(listEventTypes(false)),
    create: (p) => asRow(createEventType(p as { code: string; description?: string })),
    update: (id, p) => asRow(updateEventType(id, p)),
  },
  {
    id: 'ata-chapters',
    label: 'ATA Chapters',
    writePrivilege: 'settings:taxonomy',
    columns: [
      { key: 'code', header: 'Code', mono: true },
      { key: 'title', header: 'Title' },
    ],
    fields: [
      { key: 'code', label: 'Code', required: true },
      { key: 'title', label: 'Title', required: true },
    ],
    list: () => asRows(listAtaChapters(false)),
    create: (p) => asRow(createAtaChapter(p as { code: string; title: string })),
    update: (id, p) => asRow(updateAtaChapter(id, p)),
  },
  {
    id: 'cause-codes',
    label: 'Cause Codes',
    writePrivilege: 'settings:taxonomy',
    columns: [
      { key: 'code', header: 'Code', mono: true },
      { key: 'name', header: 'Name' },
      { key: 'groupCode', header: 'Group', mono: true },
      { key: 'groupName', header: 'Group Name' },
    ],
    fields: [
      { key: 'code', label: 'Code', required: true },
      { key: 'name', label: 'Name', required: true },
      { key: 'groupCode', label: 'Group Code', required: true },
      { key: 'groupName', label: 'Group Name', required: true },
    ],
    list: () => asRows(listCauseCodes(false)),
    create: (p) => asRow(createCauseCode(p as { code: string; name: string; groupCode: string; groupName: string })),
    update: (id, p) => asRow(updateCauseCode(id, p)),
  },
  {
    id: 'hazard-tags',
    label: 'Hazard Tags',
    writePrivilege: 'settings:taxonomy',
    columns: [
      { key: 'label', header: 'Label' },
      { key: 'description', header: 'Description' },
    ],
    fields: [
      { key: 'label', label: 'Label', required: true },
      { key: 'description', label: 'Description' },
    ],
    list: () => asRows(listHazardTags(false)),
    create: (p) => asRow(createHazardTag(p as { label: string; description?: string })),
    update: (id, p) => asRow(updateHazardTag(id, p)),
  },
];

interface UpsertModalProps {
  config: TaxonomyConfig;
  editing: Row | null;
  onClose: () => void;
  onSaved: () => void;
}

function UpsertModal({ config, editing, onClose, onSaved }: UpsertModalProps) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of config.fields) {
      const v = editing?.[f.key];
      init[f.key] = v == null ? '' : String(v);
    }
    return init;
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    for (const f of config.fields) {
      if (f.required && !form[f.key]?.trim()) {
        toast.error(`${f.label} is required`);
        return;
      }
    }

    setSaving(true);
    try {
      if (editing) {
        const payload: Record<string, unknown> = {};
        for (const f of config.fields) payload[f.key] = form[f.key];
        await config.update(editing.id, payload);
        toast.success(`${config.label} updated`);
      } else {
        const payload: Record<string, string> = {};
        for (const f of config.fields) {
          if (form[f.key].trim()) payload[f.key] = form[f.key].trim();
        }
        await config.create(payload);
        toast.success(`${config.label} created`);
      }
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-800">
            {editing ? `Edit ${config.label.replace(/s$/, '')}` : `New ${config.label.replace(/s$/, '')}`}
          </h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {config.fields.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {f.label} {f.required && <span className="text-red-500">*</span>}
              </label>
              <input
                className={inputCls}
                value={form[f.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.label}
              />
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg font-medium">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded-lg font-medium flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editing ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TaxonomySettings() {
  const user = useAuthStore((s) => s.user);
  const canAccess = user?.role === 'Admin' || user?.role === 'Director';

  const [activeTab, setActiveTab] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; editing: Row | null }>({ open: false, editing: null });
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const config = TAXONOMIES[activeTab];

  const fetchRows = useCallback(() => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    config.list()
      .then(setRows)
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load')))
      .finally(() => setLoading(false));
  }, [canAccess, config]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const toggleActive = async (row: Row) => {
    setTogglingId(row.id);
    try {
      await config.update(row.id, { isActive: !row.isActive });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)));
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to update status'));
    } finally {
      setTogglingId(null);
    }
  };

  if (!canAccess) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <Lock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-800">Access restricted</h1>
          <p className="text-sm text-slate-500 mt-1">Only Admins and Directors can manage reference taxonomies.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Tags className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Taxonomy Management</h2>
            <p className="text-sm text-slate-500">Manage reference data used across findings and work packages</p>
          </div>
        </div>
        <button
          onClick={() => setModal({ open: true, editing: null })}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          New {config.label.replace(/s$/, '')}
        </button>
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-slate-200">
        {TAXONOMIES.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              i === activeTab
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Tags className="w-8 h-8 mb-2" />
            <p className="text-sm">No {config.label.toLowerCase()} yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  {config.columns.map((c) => (
                    <th key={c.key} className="text-left font-semibold text-slate-600 px-5 py-3">{c.header}</th>
                  ))}
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Status</th>
                  <th className="text-right font-semibold text-slate-600 px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={`border-b border-slate-50 hover:bg-slate-50/40 ${!row.isActive ? 'opacity-60' : ''}`}>
                    {config.columns.map((c) => (
                      <td key={c.key} className={`px-5 py-3 ${c.mono ? 'font-mono text-xs text-slate-500' : 'text-slate-700'}`}>
                        {row[c.key] == null || row[c.key] === '' ? '—' : String(row[c.key])}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      {row.isActive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-100 text-green-700">
                          <Check className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-500">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setModal({ open: true, editing: row })}
                          title="Edit"
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleActive(row)}
                          disabled={togglingId === row.id}
                          title={row.isActive ? 'Disable' : 'Enable'}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                            row.isActive
                              ? 'text-amber-600 hover:bg-amber-50'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {togglingId === row.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : row.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.open && (
        <UpsertModal
          config={config}
          editing={modal.editing}
          onClose={() => setModal({ open: false, editing: null })}
          onSaved={() => {
            setModal({ open: false, editing: null });
            fetchRows();
          }}
        />
      )}
    </div>
  );
}
