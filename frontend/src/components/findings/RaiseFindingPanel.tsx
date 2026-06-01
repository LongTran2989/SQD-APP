'use client';

import { useState, useEffect } from 'react';
import { raiseFinding } from '../../api/findingApi';
import { getDatasource } from '../../api/taskApi';
import toast from 'react-hot-toast';
import { X, AlertTriangle } from 'lucide-react';

interface Props {
  taskId: number;
  onClose: () => void;
  onRaised: () => void;
}

// Standard aviation event types — admin-configurable in Phase 7
const EVENT_TYPES = [
  'Procedural Breach',
  'Equipment Fault',
  'Documentation Error',
  'Maintenance Error',
  'Safety Observation',
  'Regulatory Non-compliance',
  'Training Gap',
  'Communication Failure',
  'Other',
];

export default function RaiseFindingPanel({ taskId, onClose, onRaised }: Props) {
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [eventType, setEventType] = useState('');
  const [eventTypeOther, setEventTypeOther] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [aircraftRegistration, setAircraftRegistration] = useState('');
  const [regulatoryReference, setRegulatoryReference] = useState('');
  const [description, setDescription] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getDatasource('departments').then(setDepartments).catch(() => {});
  }, []);

  const resolvedEventType = eventType === 'Other' ? eventTypeOther.trim() : eventType;

  const handleSubmit = async () => {
    if (!eventType) return toast.error('Event type is required');
    if (eventType === 'Other' && !eventTypeOther.trim()) return toast.error('Please specify the event type');
    if (!departmentId) return toast.error('Department is required');
    if (!description.trim()) return toast.error('Description is required');

    setSubmitting(true);
    try {
      const finding = await raiseFinding({
        taskId,
        eventType: resolvedEventType,
        departmentId: Number(departmentId),
        description: description.trim(),
        aircraftRegistration: aircraftRegistration.trim() || undefined,
        regulatoryReference: regulatoryReference.trim() || undefined,
        fieldId: fieldId.trim() || undefined,
      });
      toast.success(`Finding #${finding.id} raised`);
      onRaised();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to raise finding');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="bg-white w-full max-w-md h-full shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-base font-bold text-slate-800">Raise Finding</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Event Type <span className="text-red-400">*</span>
            </label>
            <select
              value={eventType}
              onChange={(e) => { setEventType(e.target.value); setEventTypeOther(''); }}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select event type…</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {eventType === 'Other' && (
              <input
                type="text"
                value={eventTypeOther}
                onChange={(e) => setEventTypeOther(e.target.value)}
                placeholder="Specify event type…"
                className="mt-2 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Department <span className="text-red-400">*</span>
            </label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select department…</option>
              {departments.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Aircraft Registration
            </label>
            <input
              type="text"
              value={aircraftRegistration}
              onChange={(e) => setAircraftRegistration(e.target.value)}
              placeholder="Optional"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Regulatory Reference
            </label>
            <input
              type="text"
              value={regulatoryReference}
              onChange={(e) => setRegulatoryReference(e.target.value)}
              placeholder="e.g. EASA Part-M (optional)"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Field Reference
            </label>
            <input
              type="text"
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value)}
              placeholder="Which form field triggered this (optional)"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Describe the non-conformance…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {submitting ? 'Raising…' : 'Raise Finding'}
          </button>
        </div>
      </div>
    </div>
  );
}
