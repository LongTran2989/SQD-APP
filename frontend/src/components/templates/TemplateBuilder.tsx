'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FormField, FormFieldType, Template } from '../../types';
import { apiClient } from '../../api/client';
import toast from 'react-hot-toast';
import {
  GripVertical,
  Trash2,
  Copy,
  Plus,
  Settings,
  Eye,
  ArrowUp,
  ArrowDown,
  Info
} from 'lucide-react';
import RichTextEditor from '../ui/RichTextEditor';

interface DataSourceOption {
  value: string;
  label: string;
}

interface TemplateBuilderProps {
  initialData?: Partial<Template> & { id?: number, publishedAt?: string | null, status?: string };
  onSave: (payload: any, action: 'Draft' | 'Published') => Promise<void>;
  onDiscard?: () => void;
}

export default function TemplateBuilder({ initialData, onSave, onDiscard }: TemplateBuilderProps) {
  const router = useRouter();

  // Header State
  const [title, setTitle] = useState(initialData?.title || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [divisionId, setDivisionId] = useState<number | ''>(initialData?.divisionId || '');
  const [type, setType] = useState(initialData?.type || '');
  const [estimatedHours, setEstimatedHours] = useState<number | ''>(initialData?.estimatedHours || '');
  const [requiresApproval, setRequiresApproval] = useState(initialData?.requiresApproval || false);
  const [allowsFindings, setAllowsFindings] = useState(initialData?.allowsFindings ?? true);
  const [skillLevel, setSkillLevel] = useState<number>(initialData?.skillLevel ?? 0);

  // Form Fields State
  const [fields, setFields] = useState<FormField[]>(initialData?.formSchema || []);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  // Divisions Data
  const [divisions, setDivisions] = useState<DataSourceOption[]>([]);

  // Unsaved changes tracking
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    apiClient.get('/datasources/divisions').then((res: any) => setDivisions(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Mark changes
  const markChanged = () => setHasUnsavedChanges(true);

  // Helpers for fields
  const generateId = () => crypto.randomUUID();

  const addField = (fieldType: FormFieldType) => {
    const newField: FormField = {
      fieldId: generateId(),
      type: fieldType,
      label: `New ${fieldType} field`,
      required: false,
      options: ['select', 'radio', 'checkbox_group'].includes(fieldType) ? ['Option 1'] : undefined,
      dataSource: fieldType === 'select' ? 'custom' : undefined,
    };
    setFields([...fields, newField]);
    setSelectedFieldId(newField.fieldId);
    markChanged();
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFields(fields.map(f => f.fieldId === id ? { ...f, ...updates } : f));
    markChanged();
  };

  const deleteField = (id: string) => {
    const field = fields.find(f => f.fieldId === id);
    if (field && field.label !== `New ${field.type} field` && !window.confirm(`Delete field "${field.label}"?`)) {
      return;
    }
    setFields(fields.filter(f => f.fieldId !== id));
    if (selectedFieldId === id) setSelectedFieldId(null);
    markChanged();
  };

  const duplicateField = (id: string) => {
    const field = fields.find(f => f.fieldId === id);
    if (!field) return;
    const newField = { ...field, fieldId: generateId(), label: `${field.label} (Copy)` };
    const index = fields.findIndex(f => f.fieldId === id);
    const newFields = [...fields];
    newFields.splice(index + 1, 0, newField);
    setFields(newFields);
    setSelectedFieldId(newField.fieldId);
    markChanged();
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === fields.length - 1)) return;
    const newFields = [...fields];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newFields[index], newFields[swapIndex]] = [newFields[swapIndex], newFields[index]];
    setFields(newFields);
    markChanged();
  };

  const handleSave = async (action: 'Draft' | 'Published') => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (action === 'Published' && fields.length === 0) {
      toast.error('Cannot publish a template with no fields');
      return;
    }
    if (!divisionId) {
      toast.error('Division is required');
      return;
    }

    const payload = {
      title,
      description,
      divisionId: Number(divisionId),
      type: type || null,
      estimatedHours: estimatedHours ? Number(estimatedHours) : null,
      requiresApproval,
      allowsFindings,
      skillLevel: Number(skillLevel),
      formSchema: fields,
      status: action
    };

    try {
      await onSave(payload, action);
      setHasUnsavedChanges(false);
    } catch (err) {
      // Error handled in parent or here
    }
  };

  const selectedField = fields.find(f => f.fieldId === selectedFieldId);
  const isEditingPublished = initialData?.publishedAt && initialData.status === 'Draft';

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden">
      {isEditingPublished && (
        <div className="bg-amber-100 text-amber-800 px-6 py-3 font-medium flex items-center gap-2">
          <Info className="w-5 h-5" />
          You are editing a draft. The published version is unchanged until you click Publish.
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            {initialData?.id ? `Edit Template` : 'New Template'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {onDiscard && (
            <button onClick={onDiscard} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors">
              Discard Changes
            </button>
          )}
          {initialData?.status !== 'Archived' && (
            <>
              <button 
                onClick={() => handleSave('Draft')}
                className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                Save as Draft
              </button>
              <button 
                onClick={() => handleSave('Published')}
                disabled={fields.length === 0}
                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
              >
                Publish
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        {/* Left/Middle: Builder Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            
            {/* Header Settings Card */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
              <h2 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2">Template Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Title *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); markChanged(); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. Daily Aircraft Inspection"
                  />
                </div>
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => { setDescription(e.target.value); markChanged(); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Division *</label>
                  <select
                    value={divisionId}
                    onChange={(e) => { setDivisionId(Number(e.target.value)); markChanged(); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a division...</option>
                    {divisions.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Type</label>
                  <input
                    type="text"
                    value={type}
                    onChange={(e) => { setType(e.target.value); markChanged(); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Reserved for future use"
                  />
                  <p className="text-xs text-slate-400 mt-1">Reserved for future classification</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Estimated Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={estimatedHours}
                    onChange={(e) => { setEstimatedHours(e.target.value ? Number(e.target.value) : ''); markChanged(); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 2.5"
                  />
                  <p className="text-xs text-slate-400 mt-1">Used for future time budget tracking</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Skill Level</label>
                  <select
                    value={skillLevel}
                    onChange={(e) => { setSkillLevel(Number(e.target.value)); markChanged(); }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    {[0, 1, 2, 3, 4].map((lvl) => (
                      <option key={lvl} value={lvl}>Level {lvl}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">Required competency (0–4) seeded onto tasks</p>
                </div>
                <div className="col-span-1 md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={requiresApproval} onChange={(e) => { setRequiresApproval(e.target.checked); markChanged(); }} className="w-4 h-4 text-blue-600 rounded" />
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600" title="Tasks generated from this template require explicit reviewer approval before closing">Requires Approval</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={allowsFindings} onChange={(e) => { setAllowsFindings(e.target.checked); markChanged(); }} className="w-4 h-4 text-blue-600 rounded" />
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600">Allows Findings</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Field List */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-slate-800 mb-4">Form Fields</h2>
              {fields.map((field, idx) => (
                <div 
                  key={field.fieldId} 
                  className={`bg-white border rounded-xl p-4 shadow-sm transition-all cursor-pointer ${selectedFieldId === field.fieldId ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 hover:border-blue-300'}`}
                  onClick={() => setSelectedFieldId(field.fieldId)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col gap-1 text-slate-400 pt-1">
                      <button onClick={(e) => { e.stopPropagation(); moveField(idx, 'up'); }} disabled={idx === 0} className="hover:text-slate-700 disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                      <button onClick={(e) => { e.stopPropagation(); moveField(idx, 'down'); }} disabled={idx === fields.length - 1} className="hover:text-slate-700 disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-800">
                          {field.label || 'Untitled Field'} {field.required && <span className="text-red-500">*</span>}
                        </div>
                        <span className="text-xs font-mono bg-slate-100 text-slate-500 px-2 py-1 rounded">{field.type}</span>
                      </div>
                      {field.helpText && <p className="text-xs text-slate-500 mt-1">{field.helpText}</p>}
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      <button onClick={(e) => { e.stopPropagation(); duplicateField(field.fieldId); }} className="p-1 hover:text-blue-600 hover:bg-blue-50 rounded"><Copy className="w-4 h-4" /></button>
                      <button onClick={(e) => { e.stopPropagation(); deleteField(field.fieldId); }} className="p-1 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              ))}

              <div className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <button onClick={() => addField('text')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Text</button>
                <button onClick={() => addField('textarea')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Text Area</button>
                <button onClick={() => addField('number')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Number</button>
                <button onClick={() => addField('date')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Date</button>
                <button onClick={() => addField('select')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Dropdown</button>
                <button onClick={() => addField('radio')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Radio</button>
                <button onClick={() => addField('checkbox_group')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Checkboxes</button>
                <button onClick={() => addField('checkbox_single')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Toggle</button>
                <button onClick={() => addField('rich_text')} className="py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-blue-500 hover:text-blue-600 bg-white font-medium flex items-center justify-center gap-1"><Plus className="w-4 h-4" /> Rich Text</button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Settings or Preview */}
        <div className="w-full lg:w-96 bg-white border-l border-slate-200 flex flex-col h-full">
          <div className="flex border-b border-slate-200">
            <button className={`flex-1 py-3 text-sm font-semibold border-b-2 flex justify-center items-center gap-2 ${selectedFieldId ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`} onClick={() => { if (fields.length) setSelectedFieldId(fields[0].fieldId); }}>
              <Settings className="w-4 h-4" /> Settings
            </button>
            <button className={`flex-1 py-3 text-sm font-semibold border-b-2 flex justify-center items-center gap-2 ${!selectedFieldId ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`} onClick={() => setSelectedFieldId(null)}>
              <Eye className="w-4 h-4" /> Live Preview
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {selectedField ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Field Label *</label>
                  <input
                    type="text"
                    value={selectedField.label}
                    onChange={(e) => updateField(selectedField.fieldId, { label: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Help Text</label>
                  <input
                    type="text"
                    value={selectedField.helpText || ''}
                    onChange={(e) => updateField(selectedField.fieldId, { helpText: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional helper text"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedField.required}
                    onChange={(e) => updateField(selectedField.fieldId, { required: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm font-medium text-slate-700">Required Field</span>
                </label>

                {selectedField.type === 'select' && (
                  <div className="pt-4 border-t border-slate-100">
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Data Source</label>
                    <select
                      value={selectedField.dataSource || 'custom'}
                      onChange={(e) => updateField(selectedField.fieldId, { dataSource: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 mb-4"
                    >
                      <option value="custom">Custom Static Options</option>
                      <option value="divisions">Divisions</option>
                      <option value="users">Users</option>
                      <option value="aircrafts">Aircraft Types</option>
                    </select>
                  </div>
                )}

                {(['radio', 'checkbox_group'].includes(selectedField.type) || (selectedField.type === 'select' && selectedField.dataSource === 'custom')) && (
                  <div className="pt-4 border-t border-slate-100">
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Options</label>
                    <div className="space-y-2">
                      {(selectedField.options || []).map((opt: string, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => {
                              const newOpts = [...(selectedField.options || [])];
                              newOpts[i] = e.target.value;
                              updateField(selectedField.fieldId, { options: newOpts });
                            }}
                            className="flex-1 px-3 py-1.5 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                          <button onClick={() => {
                            const newOpts = [...(selectedField.options || [])];
                            newOpts.splice(i, 1);
                            updateField(selectedField.fieldId, { options: newOpts });
                          }} className="text-slate-400 hover:text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <button onClick={() => updateField(selectedField.fieldId, { options: [...(selectedField.options || []), `Option ${(selectedField.options?.length || 0) + 1}`] })} className="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1 mt-2">
                        <Plus className="w-3 h-3" /> Add Option
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Field ID (Read-only)</label>
                  <input
                    type="text"
                    value={selectedField.fieldId}
                    readOnly
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-500 cursor-not-allowed"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                  <p className="text-sm text-slate-500 mb-2">This is how your fields will appear to assignees.</p>
                  <p className="text-xs text-slate-400">(Read-only preview)</p>
                </div>
                
                <div className="space-y-6">
                  {fields.map(f => (
                    <div key={f.fieldId} className="space-y-1 opacity-90 pointer-events-none">
                      <label className="block text-sm font-semibold text-slate-800">
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                      {f.helpText && <p className="text-xs text-slate-500 mb-1">{f.helpText}</p>}
                      
                      {f.type === 'text' && <input type="text" className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white" placeholder="Text input" disabled />}
                      {f.type === 'number' && <input type="number" className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white" placeholder="0" disabled />}
                      {f.type === 'date' && <input type="date" className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white" max="9999-12-31" disabled />}
                      {f.type === 'textarea' && <textarea className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white" rows={3} placeholder="Text area" disabled />}
                      {f.type === 'select' && (
                        <select className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white" disabled>
                          <option>{f.dataSource === 'custom' ? (f.options?.[0] || 'Select...') : `Dynamic ${f.dataSource}`}</option>
                        </select>
                      )}
                      {f.type === 'radio' && (
                        <div className="space-y-2 pt-1">
                          {(f.options || []).map((o: string, i: number) => (
                            <label key={i} className="flex items-center gap-2 text-sm text-slate-700">
                              <input type="radio" disabled className="w-4 h-4" /> {o}
                            </label>
                          ))}
                        </div>
                      )}
                      {f.type === 'checkbox_group' && (
                        <div className="space-y-2 pt-1">
                          {(f.options || []).map((o: string, i: number) => (
                            <label key={i} className="flex items-center gap-2 text-sm text-slate-700">
                              <input type="checkbox" disabled className="w-4 h-4 rounded" /> {o}
                            </label>
                          ))}
                        </div>
                      )}
                      {f.type === 'checkbox_single' && (
                        <label className="flex items-center gap-2 text-sm text-slate-700 pt-1">
                          <input type="checkbox" disabled className="w-4 h-4 rounded" /> Yes/No
                        </label>
                      )}
                      {f.type === 'rich_text' && (
                        <div className="pointer-events-none mt-1">
                          <RichTextEditor value="" disabled />
                        </div>
                      )}
                    </div>
                  ))}
                  {fields.length === 0 && (
                    <div className="text-center text-slate-400 text-sm py-10">
                      Add fields to see preview
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
