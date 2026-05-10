'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '../../../../api/client';
import { FormField, FieldType, DataSource, Template } from '../../../../types';
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
  Settings2,
  Clock,
  CheckCircle2,
  Archive
} from 'lucide-react';

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

const statusConfig: Record<string, { icon: any; color: string }> = {
  Draft: { icon: Clock, color: 'text-amber-600 bg-amber-50' },
  Published: { icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
  Archived: { icon: Archive, color: 'text-slate-500 bg-slate-100' },
};

function generateId() {
  return 'field_' + Math.random().toString(36).substring(2, 9);
}

export default function EditTemplatePage() {
  const router = useRouter();
  const params = useParams();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<Template | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [allowsFindings, setAllowsFindings] = useState(true);
  const [fields, setFields] = useState<FormField[]>([]);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // ── Unsaved changes tracking ──────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [pendingNavUrl, setPendingNavUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        const response = await apiClient.get(`/templates/${templateId}`);
        const data: Template = response.data;
        setTemplate(data);
        setTitle(data.title);
        setDescription(data.description || '');
        setRequiresApproval(data.requiresApproval);
        setAllowsFindings(data.allowsFindings);
        setFields(Array.isArray(data.formSchema) ? data.formSchema : []);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load template');
      } finally {
        setLoading(false);
      }
    };
    fetchTemplate();
  }, [templateId]);

  // ── beforeunload guard (browser tab close / refresh) ─────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ── Intercept programmatic Next.js navigation ─────────────────────
  const safeNavigate = (url: string) => {
    if (isDirty) {
      setPendingNavUrl(url);
      setShowLeaveModal(true);
    } else {
      router.push(url);
    }
  };

  const handleDiscardAndLeave = () => {
    setIsDirty(false);
    setShowLeaveModal(false);
    if (pendingNavUrl) router.push(pendingNavUrl);
  };

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
    setIsDirty(true); // mark dirty
  }, []);

  const updateField = useCallback((id: string, updates: Partial<FormField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
    setIsDirty(true); // mark dirty
  }, []);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (activeFieldId === id) setActiveFieldId(null);
    setIsDirty(true); // mark dirty
  }, [activeFieldId]);

  const moveField = useCallback((index: number, direction: 'up' | 'down') => {
    setFields((prev) => {
      const newFields = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newFields.length) return prev;
      [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
      return newFields;
    });
    setIsDirty(true); // mark dirty
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
    const emptyLabel = fields.find((f) => !f.label.trim());
    if (emptyLabel) {
      setError(`A field is missing a label. Please fill in all field labels.`);
      setActiveFieldId(emptyLabel.id);
      return;
    }

    setSaving(true);
    try {
      await apiClient.put(`/templates/${templateId}`, {
        title: title.trim(),
        description: description.trim() || null,
        formSchema: fields,
        status,
        requiresApproval,
        allowsFindings,
      });
      setIsDirty(false); // clear dirty on successful save
      setShowLeaveModal(false);
      router.push('/dashboard/templates');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this template?')) return;
    try {
      await apiClient.delete(`/templates/${templateId}`);
      router.push('/dashboard/templates');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete template');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!template && error) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <Link href="/dashboard/templates" className="text-blue-600 font-semibold hover:text-blue-700">
          Back to Templates
        </Link>
      </div>
    );
  }

  const currentStatus = template?.status || 'Draft';
  const StatusIcon = statusConfig[currentStatus]?.icon || Clock;

  return (
    <>
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => safeNavigate('/dashboard/templates')}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-800">Edit Template</h1>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${statusConfig[currentStatus]?.color}`}>
                <StatusIcon className="w-3 h-3" />
                {currentStatus}
              </span>
              <span className="text-xs text-slate-400 font-medium">Rev {template?.revision}</span>
            </div>
            <p className="text-sm text-slate-500">Modify your QA audit form</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* ── Unsaved Changes Badge ── */}
          {isDirty && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-300 animate-pulse">
              ● Unsaved Changes
            </span>
          )}
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
            onClick={handleDelete}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 font-semibold rounded-xl text-sm transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Delete
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
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="mb-8">
              <h2 className="text-xl font-bold text-slate-800">{title || 'Untitled Template'}</h2>
              {description && <p className="text-slate-500 mt-1">{description}</p>}
            </div>
            {fields.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No fields added yet.</p>
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
                      {field.dataSource === 'custom' && field.options?.filter(Boolean).map((opt, i) => <option key={i}>{opt}</option>)}
                      {field.dataSource && field.dataSource !== 'custom' && <option>— Loaded from {dataSourceLabels[field.dataSource]} —</option>}
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Template Metadata */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Settings2 className="w-4 h-4" /> Template Details
              </h2>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Title</label>
                <input type="text" placeholder="e.g. B737 Line Maintenance Audit" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" value={title} onChange={(e) => { setTitle(e.target.value); setIsDirty(true); }} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Description</label>
                <textarea placeholder="Describe the purpose of this template..." rows={2} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none" value={description} onChange={(e) => { setDescription(e.target.value); setIsDirty(true); }} />
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={requiresApproval} onChange={(e) => { setRequiresApproval(e.target.checked); setIsDirty(true); }} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-slate-700">Requires Approval</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={allowsFindings} onChange={(e) => { setAllowsFindings(e.target.checked); setIsDirty(true); }} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-slate-700">Allow Findings</span>
                </label>
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Form Fields ({fields.length})</h2>
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
                  <div key={field.id} className={`bg-white rounded-2xl shadow-sm border transition-all ${isActive ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-100'}`}>
                    <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setActiveFieldId(isActive ? null : field.id)}>
                      <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
                      <div className="p-1.5 bg-slate-50 rounded-lg"><TypeIcon className="w-4 h-4 text-slate-500" /></div>
                      <div className="flex-1 min-w-0"><span className="text-sm font-medium text-slate-700 truncate block">{field.label || `Untitled ${typeConfig?.label}`}</span></div>
                      {field.required && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">Required</span>}
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); moveField(index, 'up'); }} disabled={index === 0} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 disabled:opacity-30 transition-colors"><ChevronUp className="w-4 h-4" /></button>
                        <button onClick={(e) => { e.stopPropagation(); moveField(index, 'down'); }} disabled={index === fields.length - 1} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 disabled:opacity-30 transition-colors"><ChevronDown className="w-4 h-4" /></button>
                        <button onClick={(e) => { e.stopPropagation(); removeField(field.id); }} className="p-1 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                    {isActive && (
                      <div className="px-4 pb-4 pt-0 border-t border-slate-100 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Label</label>
                            <input type="text" placeholder="e.g. Inspector Name" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={field.label} onChange={(e) => updateField(field.id, { label: e.target.value })} autoFocus />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Placeholder</label>
                            <input type="text" placeholder="e.g. Enter name" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={field.placeholder || ''} onChange={(e) => updateField(field.id, { placeholder: e.target.value })} />
                          </div>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={field.required} onChange={(e) => updateField(field.id, { required: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                          <span className="text-sm text-slate-700">Required field</span>
                        </label>
                        {field.type === 'select' && (
                          <div className="space-y-3 p-4 bg-slate-50 rounded-xl">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Data Source</label>
                              <select className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" value={field.dataSource || 'custom'} onChange={(e) => updateField(field.id, { dataSource: e.target.value as DataSource })}>
                                {Object.entries(dataSourceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                              </select>
                            </div>
                            {field.dataSource === 'custom' && (
                              <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-500">Options</label>
                                {(field.options || []).map((opt, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <input type="text" placeholder={`Option ${i + 1}`} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={opt} onChange={(e) => updateOption(field.id, i, e.target.value)} />
                                    <button onClick={() => removeOption(field.id, i)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                  </div>
                                ))}
                                <button onClick={() => addOption(field.id)} className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add Option</button>
                              </div>
                            )}
                            {field.dataSource && field.dataSource !== 'custom' && (
                              <p className="text-xs text-slate-500 italic">Options will be loaded dynamically from the {dataSourceLabels[field.dataSource]} table when the form is used.</p>
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
                    <button key={config.type} onClick={() => addField(config.type)} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-all text-left group border border-transparent hover:border-blue-200">
                      <div className="p-2 bg-slate-50 group-hover:bg-blue-100 rounded-lg transition-colors"><Icon className="w-4 h-4" /></div>
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

      {/* ── Unsaved Changes Modal ─────────────────────────────────── */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLeaveModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 border border-slate-100">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-2xl">⚠️</span>
              <h2 className="text-lg font-bold text-slate-800">Unsaved Changes</h2>
            </div>
            <p className="text-slate-500 text-sm mb-6">You have unsaved changes. What would you like to do?</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleSave('Draft')}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-sm transition-all"
              >
                <Save className="w-4 h-4" />
                Save Draft
              </button>
              <button
                onClick={() => handleSave('Published')}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-all"
              >
                <Send className="w-4 h-4" />
                Publish
              </button>
              <button
                onClick={handleDiscardAndLeave}
                className="w-full inline-flex items-center justify-center px-4 py-3 text-red-600 hover:bg-red-50 font-medium rounded-xl text-sm transition-all border border-transparent hover:border-red-100"
              >
                Discard &amp; Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
