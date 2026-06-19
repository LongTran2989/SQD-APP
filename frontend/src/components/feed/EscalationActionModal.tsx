'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { X, LayoutTemplate } from 'lucide-react';
import { Template } from '../../types';
import { actionEscalation } from '../../api/escalationApi';
import { getDivisions, getUsers, getDatasource } from '../../api/taskApi';
import { listEventTypes } from '../../api/taxonomyApi';
import { getApiErrorMessage } from '../../utils/apiError';
import { FINDING_EVENT_TYPES } from '../../constants/findingEventTypes';
import { EventType } from '../../types';
import TemplatePickerModal from '../templates/TemplatePickerModal';

type Option = { value: string; label: string };

// Modal-driven actions (Acknowledge / Dismiss are one-click, handled on the card).
export type ModalAction = 'RAISE_FINDING' | 'CREATE_TASK' | 'REASSIGN_TASK' | 'DISSEMINATE';

const TITLES: Record<ModalAction, string> = {
  RAISE_FINDING: 'Raise Finding from escalation',
  CREATE_TASK: 'Create Task from escalation',
  REASSIGN_TASK: 'Reassign source task',
  DISSEMINATE: 'Disseminate to Organisation Feed',
};

interface Props {
  flagId: number;
  action: ModalAction;
  sourceTaskId: number | null;
  sourceWpId: number | null;
  onClose: () => void;
  onDone: () => void;
}

// Compact, card-local form that collects an action's payload and POSTs to the
// escalation action endpoint (so the SAME flag is linked + flipped to ACTIONED).
// Loads any reference data via getX().then(setState) + a cancelled flag (the
// Sidebar/FeedPanel pattern) to avoid new react-hooks lint.
export default function EscalationActionModal({ flagId, action, sourceTaskId, sourceWpId, onClose, onDone }: Props) {
  const [submitting, setSubmitting] = useState(false);

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [divisions, setDivisions] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>(FINDING_EVENT_TYPES as unknown as string[]);

  // CREATE_TASK
  const [targetDivisionId, setTargetDivisionId] = useState<number | ''>('');
  const [assignedToUserId, setAssignedToUserId] = useState<number | ''>('');

  // RAISE_FINDING
  const [eventType, setEventType] = useState('');
  const [eventTypeOther, setEventTypeOther] = useState('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [description, setDescription] = useState('');

  // REASSIGN_TASK
  const [newAssigneeId, setNewAssigneeId] = useState<number | ''>('');
  const [reason, setReason] = useState('');

  // DISSEMINATE
  const [taggedDivisionIds, setTaggedDivisionIds] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (action === 'CREATE_TASK') {
      getDivisions().then((d) => { if (!cancelled) setDivisions(d); }).catch(() => {});
      getUsers().then((u) => { if (!cancelled) setUsers(u); }).catch(() => {});
    } else if (action === 'RAISE_FINDING') {
      getDatasource('departments').then((d) => { if (!cancelled) setDepartments(d); }).catch(() => {});
      listEventTypes(true)
        .then((types: EventType[]) => {
          if (!cancelled) {
            const codes = types.map((t) => t.code);
            if (!codes.includes('Other')) codes.push('Other');
            setEventTypes(codes);
          }
        })
        .catch(() => {});
    } else if (action === 'REASSIGN_TASK') {
      getUsers().then((u) => { if (!cancelled) setUsers(u); }).catch(() => {});
    } else if (action === 'DISSEMINATE') {
      getDivisions().then((d) => { if (!cancelled) setDivisions(d); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [action]);

  const toggleDivision = (id: number) => {
    setTaggedDivisionIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };

  const submit = async () => {
    let payload: Record<string, unknown>;

    if (action === 'CREATE_TASK') {
      if (!selectedTemplate || !targetDivisionId) {
        toast.error('Template and target division are required');
        return;
      }
      payload = {
        templateId: selectedTemplate.id,
        targetDivisionId: Number(targetDivisionId),
        wpId: sourceWpId ?? undefined,
        assignedToUserId: assignedToUserId ? Number(assignedToUserId) : undefined,
      };
    } else if (action === 'RAISE_FINDING') {
      const resolvedEventType = eventType === 'Other' ? eventTypeOther.trim() : eventType;
      if (!resolvedEventType) { toast.error('Event type is required'); return; }
      if (!departmentId) { toast.error('Department is required'); return; }
      if (!description.trim()) { toast.error('Description is required'); return; }
      payload = { eventType: resolvedEventType, departmentId: Number(departmentId), description: description.trim() };
    } else if (action === 'REASSIGN_TASK') {
      if (!newAssigneeId) { toast.error('A new assignee is required'); return; }
      if (!reason.trim()) { toast.error('A reason is required'); return; }
      payload = { newAssigneeId: Number(newAssigneeId), reason: reason.trim() };
    } else {
      payload = { taggedDivisionIds };
    }

    setSubmitting(true);
    try {
      await actionEscalation(flagId, action, payload as never);
      toast.success('Escalation actioned');
      onDone();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Action failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-800">{TITLES[action]}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {action === 'CREATE_TASK' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Template</label>
              {selectedTemplate ? (
                <div className="flex items-center gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono font-semibold text-blue-700">{selectedTemplate.templateId}</span>
                    <p className="text-xs text-slate-700 truncate">{selectedTemplate.title}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTemplate(null)}
                    className="p-0.5 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-lg text-xs text-slate-500 hover:text-blue-600 transition-all"
                >
                  <LayoutTemplate className="w-3.5 h-3.5" />
                  Browse templates…
                </button>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Target division</label>
              <select className={inputCls} value={targetDivisionId} onChange={(e) => setTargetDivisionId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Select a division…</option>
                {divisions.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Assignee (optional)</label>
              <select className={inputCls} value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Leave unassigned</option>
                {users.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {action === 'RAISE_FINDING' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Event type</label>
              <select className={inputCls} value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="">Select an event type…</option>
                {eventTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            {eventType === 'Other' && (
              <input className={inputCls} placeholder="Specify event type" value={eventTypeOther} onChange={(e) => setEventTypeOther(e.target.value)} />
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Department</label>
              <select className={inputCls} value={departmentId} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Select a department…</option>
                {departments.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <textarea className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the finding" />
            </div>
          </div>
        )}

        {action === 'REASSIGN_TASK' && (
          <div className="space-y-3">
            {sourceTaskId == null && <p className="text-xs text-red-600">This escalation has no source task to reassign.</p>}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">New assignee</label>
              <select className={inputCls} value={newAssigneeId} onChange={(e) => setNewAssigneeId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Select a user…</option>
                {users.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
              <textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reassignment" />
            </div>
          </div>
        )}

        {action === 'DISSEMINATE' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Posts this escalation to the Organisation Feed for organisation-wide awareness. Optionally tag specific divisions.</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {divisions.map((d) => (
                <label key={d.value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={taggedDivisionIds.includes(Number(d.value))}
                    onChange={() => toggleDivision(Number(d.value))}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
          >
            {submitting ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>

      {/* Template Picker Modal (for CREATE_TASK action) */}
      <TemplatePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(t) => { setSelectedTemplate(t); setPickerOpen(false); }}
      />
    </div>
  );
}
