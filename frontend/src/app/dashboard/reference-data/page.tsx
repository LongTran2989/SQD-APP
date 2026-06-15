'use client';

import { useEffect, useState, useCallback } from 'react';
import { Database, Plus, Pencil, Trash2, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../store/authStore';
import { apiErrorMessage } from '../../../api/errorMessage';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import {
  listRefDepartments, createRefDepartment, updateRefDepartment, deleteRefDepartment,
  listRefOperators, createRefOperator, updateRefOperator, deleteRefOperator,
  listRefAuthorities, createRefAuthority, updateRefAuthority, deleteRefAuthority,
  listRefAircraftTypes, createRefAircraftType, deleteRefAircraftType,
  listRefRegistrations, createRefRegistration, updateRefRegistration, deleteRefRegistration,
  listRefAuthorizationTypes, createRefAuthorizationType, updateRefAuthorizationType, deleteRefAuthorizationType,
} from '../../../api/referenceDataApi';
import {
  Operator, Authority, AircraftType, AircraftRegistration, AuthorizationType,
} from '../../../types';

type Row = Record<string, unknown>;

interface ColumnDef { key: string; header: string; mono?: boolean }
// A field on the add/edit form. `kind` 'select' renders a SearchableSelect whose
// options are resolved at render time from the loaded reference lists.
interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  // Identifier (PK) fields cannot be edited once created.
  pkField?: boolean;
  kind?: 'text' | 'select';
  selectSource?: 'operators' | 'authorities' | 'aircraftTypes';
  clearable?: boolean;
}

interface TabConfig {
  id: string;
  label: string;
  /** PK column key — used as React key and identifier in update/delete calls. */
  idKey: string;
  /** True when the entity supports editing (false for code-PK aircraft types). */
  editable: boolean;
  /** Soft-delete entities show a gentler confirm copy. */
  softDelete?: boolean;
  columns: ColumnDef[];
  fields: FieldDef[];
  list: () => Promise<Row[]>;
  create: (payload: Record<string, string>) => Promise<Row>;
  update?: (id: string, payload: Record<string, string>) => Promise<Row>;
  remove: (id: string) => Promise<void>;
}

const asRows = <T,>(p: Promise<T[]>): Promise<Row[]> => p as unknown as Promise<Row[]>;
const asRow = <T,>(p: Promise<T>): Promise<Row> => p as unknown as Promise<Row>;

const TABS: TabConfig[] = [
  {
    id: 'departments',
    label: 'Departments',
    idKey: 'id',
    editable: true,
    softDelete: true,
    columns: [{ key: 'name', header: 'Name' }],
    fields: [{ key: 'name', label: 'Department Name', required: true }],
    list: () => asRows(listRefDepartments()),
    create: (p) => asRow(createRefDepartment({ name: p.name })),
    update: (id, p) => asRow(updateRefDepartment(Number(id), { name: p.name })),
    remove: (id) => deleteRefDepartment(Number(id)),
  },
  {
    id: 'operators',
    label: 'Operators',
    idKey: 'iataCode',
    editable: true,
    columns: [
      { key: 'iataCode', header: 'IATA', mono: true },
      { key: 'name', header: 'Operator' },
    ],
    fields: [
      { key: 'iataCode', label: 'IATA Code', required: true, pkField: true },
      { key: 'name', label: 'Operator Name', required: true },
    ],
    list: () => asRows(listRefOperators()),
    create: (p) => asRow(createRefOperator({ iataCode: p.iataCode, name: p.name })),
    update: (id, p) => asRow(updateRefOperator(id, { name: p.name })),
    remove: (id) => deleteRefOperator(id),
  },
  {
    id: 'authorities',
    label: 'Authorities',
    idKey: 'code',
    editable: true,
    columns: [
      { key: 'code', header: 'Code', mono: true },
      { key: 'fullName', header: 'Authority' },
    ],
    fields: [
      { key: 'code', label: 'Code', required: true, pkField: true },
      { key: 'fullName', label: 'Full Name', required: true },
    ],
    list: () => asRows(listRefAuthorities()),
    create: (p) => asRow(createRefAuthority({ code: p.code, fullName: p.fullName })),
    update: (id, p) => asRow(updateRefAuthority(id, { fullName: p.fullName })),
    remove: (id) => deleteRefAuthority(id),
  },
  {
    id: 'aircraft-types',
    label: 'Aircraft Types',
    idKey: 'code',
    editable: false,
    columns: [{ key: 'code', header: 'Code', mono: true }],
    fields: [{ key: 'code', label: 'Type Code', required: true, pkField: true }],
    list: () => asRows(listRefAircraftTypes()),
    create: (p) => asRow(createRefAircraftType({ code: p.code })),
    remove: (id) => deleteRefAircraftType(id),
  },
  {
    id: 'registrations',
    label: 'Registrations',
    idKey: 'registration',
    editable: true,
    columns: [
      { key: 'registration', header: 'Reg.', mono: true },
      { key: 'description', header: 'Description' },
      { key: 'aircraftTypeCode', header: 'Type', mono: true },
      { key: 'operatorCode', header: 'Operator', mono: true },
      { key: 'authorityCode', header: 'Authority', mono: true },
      { key: 'serialNumber', header: 'Serial', mono: true },
    ],
    fields: [
      { key: 'registration', label: 'Registration', required: true, pkField: true },
      { key: 'description', label: 'Description' },
      { key: 'aircraftTypeCode', label: 'Aircraft Type', kind: 'select', selectSource: 'aircraftTypes', clearable: true },
      { key: 'operatorCode', label: 'Operator', kind: 'select', selectSource: 'operators', clearable: true },
      { key: 'authorityCode', label: 'Authority', kind: 'select', selectSource: 'authorities', clearable: true },
      { key: 'serialNumber', label: 'Serial Number' },
    ],
    list: () => asRows(listRefRegistrations()),
    create: (p) => asRow(createRefRegistration(p)),
    update: (id, p) => asRow(updateRefRegistration(id, { ...p, registration: id })),
    remove: (id) => deleteRefRegistration(id),
  },
  {
    id: 'authorization-types',
    label: 'Authorization Types',
    idKey: 'id',
    editable: true,
    columns: [
      { key: 'code', header: 'Code', mono: true },
      { key: 'description', header: 'Full Name' },
      { key: 'category', header: 'Category' },
    ],
    fields: [
      { key: 'code', label: 'Code', required: true, pkField: true },
      { key: 'description', label: 'Full Name' },
      { key: 'category', label: 'Category' },
    ],
    list: () => asRows(listRefAuthorizationTypes()),
    create: (p) => asRow(createRefAuthorizationType({ code: p.code, description: p.description, category: p.category })),
    update: (id, p) => asRow(updateRefAuthorizationType(Number(id), { description: p.description, category: p.category })),
    remove: (id) => deleteRefAuthorizationType(Number(id)),
  },
];

export default function ReferenceDataPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'Admin';

  const [activeTab, setActiveTab] = useState(TABS[0].id);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  // Reference lists for select fields (operators/authorities/types on the
  // registration form).
  const [operators, setOperators] = useState<Operator[]>([]);
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const [aircraftTypes, setAircraftTypes] = useState<AircraftType[]>([]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const tab = TABS.find((t) => t.id === activeTab)!;

  const loadRows = useCallback(() => {
    setLoading(true);
    tab.list()
      .then(setRows)
      .catch((e) => toast.error(apiErrorMessage(e, 'Failed to load')))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    if (!isAdmin) return;
    setQuery('');
    loadRows();
  }, [isAdmin, loadRows]);

  // Load select sources once (used by the registration form).
  useEffect(() => {
    if (!isAdmin) return;
    listRefOperators().then(setOperators).catch(() => {});
    listRefAuthorities().then(setAuthorities).catch(() => {});
    listRefAircraftTypes().then(setAircraftTypes).catch(() => {});
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="p-8">
        <p className="text-slate-500">Reference Data management is available to Admins only.</p>
      </div>
    );
  }

  const openCreate = () => {
    setEditingId(null);
    setForm({});
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditingId(String(row[tab.idKey]));
    const initial: Record<string, string> = {};
    tab.fields.forEach((f) => {
      const v = row[f.key];
      initial[f.key] = v == null ? '' : String(v);
    });
    setForm(initial);
    setModalOpen(true);
  };

  const handleSave = async () => {
    // Required-field validation
    for (const f of tab.fields) {
      if (f.required && !((form[f.key] ?? '').trim())) {
        toast.error(`${f.label} is required`);
        return;
      }
    }
    setSaving(true);
    try {
      if (editingId && tab.update) {
        await tab.update(editingId, form);
        toast.success(`${tab.label.replace(/s$/, '')} updated`);
      } else {
        await tab.create(form);
        toast.success(`${tab.label.replace(/s$/, '')} created`);
      }
      setModalOpen(false);
      loadRows();
      // refresh select sources if we changed one of them
      if (tab.id === 'operators') listRefOperators().then(setOperators).catch(() => {});
      if (tab.id === 'authorities') listRefAuthorities().then(setAuthorities).catch(() => {});
      if (tab.id === 'aircraft-types') listRefAircraftTypes().then(setAircraftTypes).catch(() => {});
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: Row) => {
    const id = String(row[tab.idKey]);
    const label = row[tab.columns[0].key];
    const msg = tab.softDelete
      ? `Archive department "${label}"? It will be hidden but its history is preserved.`
      : `Delete "${label}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    try {
      await tab.remove(id);
      toast.success(tab.softDelete ? 'Archived' : 'Deleted');
      loadRows();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Delete failed'));
    }
  };

  const selectOptions = (source?: string) => {
    if (source === 'operators') return operators.map((o) => ({ value: o.iataCode, label: `${o.iataCode} — ${o.name}` }));
    if (source === 'authorities') return authorities.map((a) => ({ value: a.code, label: `${a.code} — ${a.fullName}` }));
    if (source === 'aircraftTypes') return aircraftTypes.map((t) => ({ value: t.code, label: t.code }));
    return [];
  };

  const filtered = query.trim()
    ? rows.filter((r) =>
        tab.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(query.toLowerCase()))
      )
    : rows;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <Database className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Reference Data</h1>
          <p className="text-sm text-slate-500">Manage departments and aviation reference tables.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === t.id
                ? 'bg-white text-blue-700 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${tab.label.toLowerCase()}…`}
          className="flex-1 max-w-xs text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-16 text-slate-400 text-sm">No records.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  {tab.columns.map((c) => (
                    <th key={c.key} className="px-4 py-2.5 font-semibold">{c.header}</th>
                  ))}
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row) => (
                  <tr key={String(row[tab.idKey])} className="hover:bg-slate-50">
                    {tab.columns.map((c) => (
                      <td key={c.key} className={`px-4 py-2.5 text-slate-700 ${c.mono ? 'font-mono' : ''}`}>
                        {row[c.key] == null || row[c.key] === '' ? <span className="text-slate-300">—</span> : String(row[c.key])}
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {tab.editable && (
                          <button
                            onClick={() => openEdit(row)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(row)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title={tab.softDelete ? 'Archive' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4" />
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
      <p className="text-xs text-slate-400 mt-2">{filtered.length} record(s)</p>

      {/* Add / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">
                {editingId ? 'Edit' : 'Add'} {tab.label.replace(/s$/, '')}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {tab.fields.map((f) => {
                const disabled = !!editingId && !!f.pkField;
                return (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                      {f.label}{f.required && <span className="text-red-500"> *</span>}
                    </label>
                    {f.kind === 'select' ? (
                      <SearchableSelect
                        options={selectOptions(f.selectSource)}
                        value={form[f.key] ?? ''}
                        onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}
                        clearable={f.clearable}
                        clearLabel="None"
                        placeholder="Select…"
                      />
                    ) : (
                      <input
                        type="text"
                        value={form[f.key] ?? ''}
                        disabled={disabled}
                        onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                        className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          disabled ? 'bg-slate-50 text-slate-400 border-slate-200' : 'border-slate-300'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
