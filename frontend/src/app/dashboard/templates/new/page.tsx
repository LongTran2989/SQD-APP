'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../api/client';
import { FormField, FieldType, DataSource } from '../../../../types';
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  Save,
  Send,
  Type,
  Hash,
  List,
  CheckSquare,
  AlignLeft,
  ChevronDown,
  ChevronUp,
  Eye,
  Pencil,
  Settings2
} from 'lucide-react';
import Link from 'next/link';

const fieldTypeConfig: { type: FieldType; label: string; icon: any; description: string }[] = [
  { type: 'text', label: 'Text Input', icon: Type, description: 'Short text answer' },
  { type: 'textarea', label: 'Text Area', icon: AlignLeft, description: 'Long text answer' },
  { type: 'number', label: 'Number', icon: Hash, description: 'Numeric value' },
  { type: 'select', label: 'Dropdown', icon: List, description: 'Select from options' },
  { type: 'checkbox', label: 'Checkbox', icon: CheckSquare, description: 'Yes/No toggle' },
];

const dataSourceLabels: Record<DataSource, string> = {
  custom: 'Custom List',
  departments: 'Departments (from DB)',
  divisions: 'Divisions (from DB)',
  users: 'Users (from DB)',
  aircrafts: 'Aircraft Types (from DB)',
};

function generateId() {
  return 'field_' + Math.random().toString(36).substring(2, 9);
}

export default function NewTemplatePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [allowsFindings, setAllowsFindings] = useState(true);
  const [fields, setFields] = useState<FormField[]>([]);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [divisionId, setDivisionId] = useState<string>('');

  useEffect(() => {
    const fetchDivisions = async () => {
      try {
        const res = await apiClient.get('/datasources/divisions');
        setDivisions(res.data);
      } catch (err) {
        console.error('Failed to fetch divisions', err);
      }
    };
    fetchDivisions();
  }, []);

  const addField = useCallback((type: FieldType) => {
    const newField: FormField = {
      id: generateId(),
      type,
      label: '',
      required: false,
      placeholder: '',
      ...(type === 'select' ? { dataSource: 'custom' as DataSource, options: [''] } : {}),
    };
    setFields((prev) => [...prev, newField]);
    setActiveFieldId(newField.id);
  }, []);

  const updateField = useCallback((id: string, updates: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, []);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (activeFieldId === id) setActiveFieldId(null);
  }, [activeFieldId]);

  const moveField = useCallback((index: number, direction: 'up' | 'down') => {
    setFields((prev) => {
      const newFields = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newFields.length) return prev;
      [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
      return newFields;
    });
  }, []);

  const addOption = useCallback((fieldId: string) => {
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId ? { ...f, options: [...(f.options || []), ''] } : f
      )
    );
  }, []);

  const updateOption = useCallback((fieldId: string, optionIndex: number, value: string) => {
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId
          ? { ...f, options: (f.options || []).map((o, i) => (i === optionIndex ? value : o)) }
          : f
      )
    );
  }, []);

  const removeOption = useCallback((fieldId: string, optionIndex: number) => {
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId
          ? { ...f, options: (f.options || []).filter((_, i) => i !== optionIndex) }
          : f
      )
    );
  }, []);

  const handleSave = async (status: 'Draft' | 'Published') => {
    setError('');
    if (!title.trim()) {
      setError('Template title is required.');
      return;
    }
    if (fields.length === 0) {
      setError('Add at least one field to the template.');
      return;
    }
    // Validate all fields have labels
    const emptyLabel = fields.find((f) => !f.label.trim());
    if (emptyLabel) {
      setError(`Field "${emptyLabel.id}" is missing a label.`);
      setActiveFieldId(emptyLabel.id);
      return;
    }

    setSaving(true);
    try {
      await apiClient.post('/templates', {
        title: title.trim(),
        description: description.trim() || null,
        formSchema: fields,
        status,
        requiresApproval,
        allowsFindings,
        divisionId: divisionId ? parseInt(divisionId) : undefined,
      });
      router.push('/dashboard/templates');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/templates"
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">New Template</h1>
            <p className="text-sm text-slate-500">Design your QA audit form</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all border ${
              showPreview
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {showPreview ? <Pencil className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showPreview ? 'Editor' : 'Preview'}
          </button>
          <button
            onClick={() => handleSave('Draft')}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-sm transition-all"
          >
            <Save className="w-4 h-4" />
            Save Draft
          </button>
          <button
            onClick={() => handleSave('Published')}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm text-sm transition-all"
          >
            <Send className="w-4 h-4" />
            Publish
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded-r">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {showPreview ? (
        /* ───── PREVIEW PANE ───── */
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="mb-8">
              <h2 className="text-xl font-bold text-slate-800">{title || 'Untitled Template'}</h2>
              {description && <p className="text-slate-500 mt-1">{description}</p>}
            </div>
            {fields.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No fields added yet. Switch to Editor to add fields.</p>
            ) : (
              fields.map((field) => (
                <div key={field.id} className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">
                    {field.label || 'Unlabeled Field'}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {field.type === 'text' && (
                    <input type="text" disabled placeholder={field.placeholder || 'Enter text...'} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-400" />
                  )}
                  {field.type === 'textarea' && (
                    <textarea disabled placeholder={field.placeholder || 'Enter details...'} rows={3} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-400 resize-none" />
                  )}
                  {field.type === 'number' && (
                    <input type="number" disabled placeholder={field.placeholder || '0'} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-400" />
                  )}
                  {field.type === 'select' && (
                    <select disabled className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-400 appearance-none">
                      <option>Select an option...</option>
                      {field.dataSource === 'custom' &&
                        field.options?.filter(Boolean).map((opt, i) => (
                          <option key={i}>{opt}</option>
                        ))}
                      {field.dataSource && field.dataSource !== 'custom' && (
                        <option>— Loaded from {dataSourceLabels[field.dataSource]} —</option>
                      )}
                    </select>
                  )}
                  {field.type === 'checkbox' && (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" disabled className="w-4 h-4 rounded border-slate-300" />
                      <span className="text-sm text-slate-400">{field.label || 'Check this option'}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* ───── EDITOR PANE ───── */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Template Meta + Fields List */}
          <div className="lg:col-span-2 space-y-6">
            {/* Template Metadata */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Settings2 className="w-4 h-4" /> Template Details
              </h2>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  placeholder="e.g. B737 Line Maintenance Audit"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  placeholder="Describe the purpose of this template..."
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              {divisions.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Division (for ID Generation)</label>
                  <select
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none"
                    value={divisionId}
                    onChange={(e) => setDivisionId(e.target.value)}
                  >
                    <option value="">Default (Your Division)</option>
                    {divisions.map((div) => (
                      <option key={div.value} value={div.value}>
                        {div.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresApproval}
                    onChange={(e) => setRequiresApproval(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-700">Requires Approval</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowsFindings}
                    onChange={(e) => setAllowsFindings(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-700">Allow Findings</span>
                </label>
              </div>
            </div>

            {/* Fields List */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Form Fields ({fields.length})
              </h2>
              {fields.length === 0 && (
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-dashed border-slate-300 text-center">
                  <p className="text-slate-400">No fields yet. Use the panel on the right to add fields.</p>
                </div>
              )}
              {fields.map((field, index) => {
                const typeConfig = fieldTypeConfig.find((c) => c.type === field.type);
                const TypeIcon = typeConfig?.icon || Type;
                const isActive = activeFieldId === field.id;
                return (
                  <div
                    key={field.id}
                    className={`bg-white rounded-2xl shadow-sm border transition-all ${
                      isActive ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-100'
                    }`}
                  >
                    {/* Field Header */}
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer"
                      onClick={() => setActiveFieldId(isActive ? null : field.id)}
                    >
                      <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
                      <div className="p-1.5 bg-slate-50 rounded-lg">
                        <TypeIcon className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-700 truncate block">
                          {field.label || `Untitled ${typeConfig?.label}`}
                        </span>
                      </div>
                      {field.required && (
                        <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">Required</span>
                      )}
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); moveField(index, 'up'); }} disabled={index === 0} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 disabled:opacity-30 transition-colors">
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); moveField(index, 'down'); }} disabled={index === fields.length - 1} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 disabled:opacity-30 transition-colors">
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); removeField(field.id); }} className="p-1 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Field Editor (expanded) */}
                    {isActive && (
                      <div className="px-4 pb-4 pt-0 border-t border-slate-100 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Label</label>
                            <input
                              type="text"
                              placeholder="e.g. Inspector Name"
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={field.label}
                              onChange={(e) => updateField(field.id, { label: e.target.value })}
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Placeholder</label>
                            <input
                              type="text"
                              placeholder="e.g. Enter name"
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={field.placeholder || ''}
                              onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                            />
                          </div>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) => updateField(field.id, { required: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-slate-700">Required field</span>
                        </label>

                        {/* Dropdown-specific options */}
                        {field.type === 'select' && (
                          <div className="space-y-3 p-4 bg-slate-50 rounded-xl">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Data Source</label>
                              <select
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={field.dataSource || 'custom'}
                                onChange={(e) => updateField(field.id, { dataSource: e.target.value as DataSource })}
                              >
                                {Object.entries(dataSourceLabels).map(([key, label]) => (
                                  <option key={key} value={key}>{label}</option>
                                ))}
                              </select>
                            </div>
                            {field.dataSource === 'custom' && (
                              <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-500">Options</label>
                                {(field.options || []).map((opt, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      placeholder={`Option ${i + 1}`}
                                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      value={opt}
                                      onChange={(e) => updateOption(field.id, i, e.target.value)}
                                    />
                                    <button
                                      onClick={() => removeOption(field.id, i)}
                                      className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                                <button
                                  onClick={() => addOption(field.id)}
                                  className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                                >
                                  <Plus className="w-3.5 h-3.5" /> Add Option
                                </button>
                              </div>
                            )}
                            {field.dataSource && field.dataSource !== 'custom' && (
                              <p className="text-xs text-slate-500 italic">
                                Options will be loaded dynamically from the {dataSourceLabels[field.dataSource]} table when the form is used.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Add Field Panel */}
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 sticky top-6">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Add Field</h2>
              <div className="space-y-2">
                {fieldTypeConfig.map((config) => {
                  const Icon = config.icon;
                  return (
                    <button
                      key={config.type}
                      onClick={() => addField(config.type)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-all text-left group border border-transparent hover:border-blue-200"
                    >
                      <div className="p-2 bg-slate-50 group-hover:bg-blue-100 rounded-lg transition-colors">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="block text-sm font-medium">{config.label}</span>
                        <span className="block text-xs text-slate-400 group-hover:text-blue-500">{config.description}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
