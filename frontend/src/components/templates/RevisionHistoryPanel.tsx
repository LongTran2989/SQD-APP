'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import { FormField } from '../../types';
import { X, Clock, User, Eye, ChevronRight } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────
interface RevisionEntry {
  id: number;
  revision: number;
  publishedAt: string;
  revisedByUser: { name: string };
  formSchema: FormField[];
}

interface RevisionHistoryPanelProps {
  revisions: RevisionEntry[];
  onClose: () => void;
}

// ── Field type label map ───────────────────────────────────────────────
const fieldTypeLabels: Record<string, string> = {
  text: 'Text Input',
  textarea: 'Text Area',
  number: 'Number',
  select: 'Dropdown',
  checkbox: 'Checkbox',
};

// ── Snapshot Preview Modal ─────────────────────────────────────────────
function SnapshotModal({
  revision,
  schema,
  onClose,
}: {
  revision: number;
  schema: FormField[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col border border-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800 text-base">Revision {revision} — Snapshot</h3>
            <p className="text-xs text-slate-400 mt-0.5">Read-only preview of this revision's form fields</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Field List */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2">
          {schema.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No fields in this revision.</p>
          ) : (
            schema.map((field, i) => (
              <div
                key={field.fieldId ?? i}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100"
              >
                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                  <span className="text-xs font-bold text-slate-400">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    {field.label || <span className="italic text-slate-400">Unlabeled</span>}
                    {field.required && <span className="ml-1 text-red-400">*</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {fieldTypeLabels[field.type] ?? field.type}
                    {field.type === 'select' && field.dataSource && field.dataSource !== 'custom'
                      ? ` · source: ${field.dataSource}`
                      : field.type === 'select' && field.options?.length
                      ? ` · ${field.options.filter(Boolean).length} option(s)`
                      : ''}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────
export default function RevisionHistoryPanel({ revisions, onClose }: RevisionHistoryPanelProps) {
  const [snapshot, setSnapshot] = useState<{ revision: number; schema: FormField[] } | null>(null);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed right-0 top-0 h-full w-80 z-50 bg-white shadow-2xl border-l border-slate-100 flex flex-col">
        {/* Panel Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-800 text-sm">Revision History</h2>
            <p className="text-xs text-slate-400 mt-0.5">Published snapshots</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
            aria-label="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {revisions.length === 0 && (
            <div className="text-center py-12">
              <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No published revisions yet.</p>
              <p className="text-xs text-slate-300 mt-1">Publish this template to create the first snapshot.</p>
            </div>
          )}

          {revisions.length > 0 && (
            <ol className="relative border-l border-slate-200 ml-2 space-y-1">
              {revisions.map((rev) => (
                <li key={rev.id} className="ml-4 pb-5">
                  {/* Timeline dot */}
                  <span className="absolute -left-[9px] flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 border-2 border-blue-400 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  </span>

                  <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 group hover:border-blue-200 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-700">Rev. {rev.revision}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <User className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          <p className="text-xs text-slate-500 truncate">{rev.revisedByUser?.name || 'Unknown'}</p>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          <p className="text-xs text-slate-400">
                            {new Date(rev.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setSnapshot({ revision: rev.revision, schema: rev.formSchema })}
                        className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-100"
                        title="View snapshot"
                      >
                        <Eye className="w-3 h-3" />
                        View
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Snapshot Modal (rendered at z-60, above the panel) */}
      {snapshot && (
        <SnapshotModal
          revision={snapshot.revision}
          schema={snapshot.schema}
          onClose={() => setSnapshot(null)}
        />
      )}
    </>
  );
}
