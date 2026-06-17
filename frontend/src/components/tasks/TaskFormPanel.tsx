'use client';

import { useState, useEffect } from 'react';
import { FormField, TaskStatus } from '../../types';
import { getDatasource } from '../../api/taskApi';
import { Lock } from 'lucide-react';
import RichTextEditor from '../ui/RichTextEditor';
import FileUploadField from '../ui/FileUploadField';

// ─── Statuses where the form is read-only ─────────────────────────────────────

const READ_ONLY_STATUSES: TaskStatus[] = [
  'Unassigned', 'Inactive', 'Closed', 'Rejected', 'Terminated', 'In Review',
];

// UX guardrail mirroring the backend per-value cap (MAX_FIELD_VALUE_LEN in
// task.controller.ts). The backend is the authoritative limit; this just stops a
// user typing past it and hitting a 400 on save. rich_text is capped server-side.
const MAX_FIELD_VALUE_LEN = 100_000;

// ─── Dynamic select with data source fetch ────────────────────────────────────

function DynamicSelect({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!field.dataSource || field.dataSource === 'custom') {
      setOptions((field.options ?? []).map((o) => ({ value: o, label: o })));
      setLoading(false);
      return;
    }
    getDatasource(field.dataSource)
      .then((data) => setOptions(data))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
    // field.options comes from an immutable schema snapshot; keying only on
    // dataSource avoids refetching when the parent passes a new array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.dataSource]);

  if (loading) {
    return (
      <select disabled className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-400 text-sm">
        <option>Loading options...</option>
      </select>
    );
  }

  return (
    <select
      id={`field-${field.fieldId}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      required={field.required}
      className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
        disabled ? 'bg-slate-50 border-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white border-slate-300'
      }`}
    >
      <option value="">Select...</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Single field renderer ────────────────────────────────────────────────────

function FieldRenderer({
  field,
  value,
  onChange,
  disabled,
  taskId,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  taskId: number;
}) {
  const baseInputClass = `w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
    disabled ? 'bg-slate-50 border-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white border-slate-300'
  }`;

  switch (field.type) {
    case 'text':
      return (
        <input
          id={`field-${field.fieldId}`}
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={field.required}
          maxLength={MAX_FIELD_VALUE_LEN}
          placeholder={field.helpText ?? ''}
          className={baseInputClass}
        />
      );

    case 'textarea':
      return (
        <textarea
          id={`field-${field.fieldId}`}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={field.required}
          maxLength={MAX_FIELD_VALUE_LEN}
          placeholder={field.helpText ?? ''}
          rows={4}
          className={baseInputClass}
        />
      );

    case 'number':
      return (
        <input
          id={`field-${field.fieldId}`}
          type="number"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={field.required}
          placeholder={field.helpText ?? '0'}
          className={baseInputClass}
        />
      );

    case 'date':
      return (
        <input
          id={`field-${field.fieldId}`}
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={field.required}
          max="9999-12-31"
          className={baseInputClass}
        />
      );

    case 'select':
      return (
        <DynamicSelect
          field={field}
          value={(value as string) ?? ''}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case 'radio': {
      const opts = field.options ?? [];
      return (
        <div className="space-y-2 pt-1">
          {opts.map((opt) => (
            <label
              key={opt}
              className={`flex items-center gap-3 p-2.5 border rounded-lg cursor-pointer transition-colors ${
                value === opt
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
            >
              <input
                type="radio"
                name={`field-${field.fieldId}`}
                id={`field-${field.fieldId}-${opt}`}
                value={opt}
                checked={value === opt}
                onChange={() => !disabled && onChange(opt)}
                disabled={disabled}
                required={field.required}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm text-slate-700">{opt}</span>
            </label>
          ))}
        </div>
      );
    }

    case 'checkbox_group': {
      const opts = field.options ?? [];
      const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-2 pt-1">
          {opts.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                className={`flex items-center gap-3 p-2.5 border rounded-lg cursor-pointer transition-colors ${
                  checked ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                <input
                  type="checkbox"
                  id={`field-${field.fieldId}-${opt}`}
                  value={opt}
                  checked={checked}
                  onChange={() => {
                    if (disabled) return;
                    const next = checked
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt];
                    onChange(next);
                  }}
                  disabled={disabled}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm text-slate-700">{opt}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case 'checkbox_single':
      return (
        <label
          className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
            value ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
          } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
        >
          <input
            type="checkbox"
            id={`field-${field.fieldId}`}
            checked={Boolean(value)}
            onChange={(e) => !disabled && onChange(e.target.checked)}
            disabled={disabled}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <span className="text-sm text-slate-700">Yes</span>
        </label>
      );

    case 'rich_text':
      return (
        <RichTextEditor
          value={(value as string) ?? ''}
          onChange={disabled ? undefined : (html) => onChange(html)}
          disabled={disabled}
        />
      );

    case 'file_upload':
      return (
        <FileUploadField
          entityType="TASK"
          entityId={taskId}
          fieldId={field.fieldId}
          disabled={disabled}
          onChange={(ids) => onChange(ids)}
        />
      );

    default:
      return (
        <div className="w-full px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          Unsupported field type: <code className="font-mono">{(field as any).type}</code>
        </div>
      );
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

interface TaskFormPanelProps {
  taskId: number;
  schemaSnapshot: FormField[];
  taskStatus: TaskStatus;
  formData: Record<string, unknown>;
  onDataChange: (fieldId: string, value: unknown) => void;
}

export default function TaskFormPanel({
  taskId,
  schemaSnapshot,
  taskStatus,
  formData,
  onDataChange,
}: TaskFormPanelProps) {
  const isReadOnly = READ_ONLY_STATUSES.includes(taskStatus);

  if (!schemaSnapshot || schemaSnapshot.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <p className="text-slate-400 text-sm">This task has no form fields defined.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Read-only banner */}
      {isReadOnly && (
        <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-sm text-slate-500">
          <Lock className="w-4 h-4 flex-shrink-0" />
          <span>
            {taskStatus === 'Unassigned'
              ? 'Claim this task with "PERFORM THIS TASK" to begin filling the form.'
              : taskStatus === 'In Review'
              ? 'Form is read-only while the task is under review.'
              : `Form is read-only — task is ${taskStatus}.`}
          </span>
        </div>
      )}

      <div className="p-6 space-y-6">
        {schemaSnapshot.map((field, idx) => (
          <div key={field.fieldId ?? `field-${idx}`} className="space-y-1.5">
            <label
              htmlFor={`field-${field.fieldId}`}
              className="block text-sm font-semibold text-slate-700"
            >
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {field.helpText && (
              <p className="text-xs text-slate-500">{field.helpText}</p>
            )}
            <FieldRenderer
              field={field}
              value={formData[field.fieldId]}
              onChange={(v) => onDataChange(field.fieldId, v)}
              disabled={isReadOnly}
              taskId={taskId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
