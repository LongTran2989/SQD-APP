'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { Template, WorkPackageEnriched } from '../../types';
import { createTask, getDivisions, getUsers } from '../../api/taskApi';
import { getWorkPackages } from '../../api/wpApi';
import { getPublishedTemplates } from '../../api/templateApi';
import SearchableSelect from '../ui/SearchableSelect';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { FileCheck2, Clock, Info, FolderOpen } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
}

interface UserOption extends SelectOption {
  divisionId: number | null;
}

export interface TaskCreateFormProps {
  prefilledWpId?: number | null;
  onSaved?: (taskId: number) => void;
  onCancel?: () => void;
}

export default function TaskCreateForm({ prefilledWpId, onSaved, onCancel }: TaskCreateFormProps) {
  const router = useRouter();
  const { user } = useAuthStore();

  const [templateId, setTemplateId] = useState<number | ''>('');
  const [targetDivisionId, setTargetDivisionId] = useState<number | ''>(user?.divisionId ?? '');
  const [assignedToUserId, setAssignedToUserId] = useState<number | ''>('');
  const [deadline, setDeadline] = useState('');
  const [wpId, setWpId] = useState<number | ''>(prefilledWpId ?? '');
  const [issuanceNote, setIssuanceNote] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [skillLevel, setSkillLevel] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [divisions, setDivisions] = useState<SelectOption[]>([]);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [workPackages, setWorkPackages] = useState<WorkPackageEnriched[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  // Seed per-task overrides from the chosen template; the user can still override.
  useEffect(() => {
    if (selectedTemplate) {
      setRequiresApproval(selectedTemplate.requiresApproval);
      setSkillLevel(selectedTemplate.skillLevel ?? 0);
    }
  }, [selectedTemplate]);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [tpl, divRes, usersRes, wpsRes] = await Promise.all([
          getPublishedTemplates(),
          getDivisions(),
          getUsers(),
          getWorkPackages(),
        ]);

        let published = tpl;
        if (user && user.role !== 'Director' && user.role !== 'Admin') {
          published = published.filter((t) => t.divisionId === user.divisionId);
        }

        setTemplates(published);
        setDivisions(divRes);
        setAllUsers(usersRes);
        setWorkPackages(wpsRes.filter((w) => w.computedStatus !== 'Closed' && w.computedStatus !== 'Inactive'));
      } catch {
        toast.error('Failed to load form data');
      } finally {
        setLoadingData(false);
      }
    };
    fetchAll();
  }, [user]);

  const templateOptions = templates.map((t) => ({
    value: String(t.id),
    label: `${t.templateId} — ${t.title}`,
  }));

  const assigneeOptions = targetDivisionId
    ? allUsers.filter((u) => u.divisionId === targetDivisionId)
    : allUsers;

  const handleDivisionChange = (val: string) => {
    const newDivId = val ? Number(val) : '';
    setTargetDivisionId(newDivId);
    if (assignedToUserId) {
      const still = allUsers.find(
        (u) => u.value === String(assignedToUserId) && u.divisionId === newDivId
      );
      if (!still) setAssignedToUserId('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId) {
      toast.error('Please select a template');
      return;
    }
    if (!targetDivisionId) {
      toast.error('Please select a target division');
      return;
    }
    if (deadline) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(deadline) || isNaN(Date.parse(deadline))) {
        toast.error('Invalid deadline date format. Please use a valid date.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const task = await createTask({
        templateId: Number(templateId),
        targetDivisionId: Number(targetDivisionId),
        assignedToUserId: assignedToUserId ? Number(assignedToUserId) : undefined,
        deadline: deadline || undefined,
        wpId: wpId ? Number(wpId) : undefined,
        issuanceNote: issuanceNote.trim() || undefined,
        requiresApproval,
        skillLevel,
      });
      toast.success(`Task ${task.taskId} created`);
      if (onSaved) {
        onSaved(task.id);
      } else {
        router.push(`/dashboard/tasks/${task.id}`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to create task');
    } finally {
      // Always release the button — even if onSaved() throws, the form must not
      // stay frozen in its spinner state.
      setSubmitting(false);
    }
  };

  const ELEVATED_ROLES = ['Manager', 'Director', 'Admin'];
  const isElevated = ELEVATED_ROLES.includes(user?.role ?? '');

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Template selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-blue-600" />
          Template *
        </h2>
        <div>
          <SearchableSelect
            id="template-select"
            options={templateOptions}
            value={templateId ? String(templateId) : ''}
            onChange={(val) => setTemplateId(val ? Number(val) : '')}
            placeholder="Select a published template…"
          />
          {templates.length === 0 && (
            <p className="mt-2 text-sm text-amber-600 flex items-center gap-1.5">
              <Info className="w-4 h-4 flex-shrink-0" />
              No published templates available
              {user && user.role !== 'Director' && user.role !== 'Admin' ? ' in your division.' : '.'}
            </p>
          )}
        </div>
        {selectedTemplate && (
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm space-y-1.5">
            {selectedTemplate.description && (
              <p className="text-slate-700">{selectedTemplate.description}</p>
            )}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-1">
              {selectedTemplate.estimatedHours != null && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Est. {selectedTemplate.estimatedHours}h
                </span>
              )}
              {selectedTemplate.requiresApproval && (
                <span className="font-medium text-amber-600">Requires Approval</span>
              )}
              {selectedTemplate.skillLevel > 0 && (
                <span className="font-medium text-indigo-600">Skill Level {selectedTemplate.skillLevel}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Task details */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">Task Details</h2>

        {/* Target Division */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Target Division *
          </label>
          {isElevated ? (
            <SearchableSelect
              id="division-select"
              options={divisions}
              value={targetDivisionId ? String(targetDivisionId) : ''}
              onChange={handleDivisionChange}
              placeholder="Select division…"
            />
          ) : (
            <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-500">
              {divisions.find((d) => d.value === String(targetDivisionId))?.label ?? '—'}
            </div>
          )}
        </div>

        {/* Assignee */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Assignee{' '}
            <span className="font-normal text-slate-400">
              (optional — leave blank to create as Unassigned)
            </span>
          </label>
          <SearchableSelect
            id="assignee-select"
            options={assigneeOptions}
            value={assignedToUserId ? String(assignedToUserId) : ''}
            onChange={(val) => setAssignedToUserId(val ? Number(val) : '')}
            placeholder={
              targetDivisionId
                ? assigneeOptions.length === 0
                  ? 'No users in this division'
                  : 'Search for assignee…'
                : 'Select a division first'
            }
            clearable
            clearLabel="No assignee (Unassigned)"
          />
          {targetDivisionId && assigneeOptions.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" /> No users found in the selected division.
            </p>
          )}
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="deadline-input">
            Deadline <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="deadline-input"
            type="date"
            value={deadline}
            min={new Date().toISOString().split('T')[0]}
            max="9999-12-31"
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
          />
        </div>

        {/* Skill Level + Requires Approval */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="skill-level-select">
              Skill Level <span className="font-normal text-slate-400">(seeded from template)</span>
            </label>
            <select
              id="skill-level-select"
              value={skillLevel}
              onChange={(e) => setSkillLevel(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            >
              {[0, 1, 2, 3, 4].map((lvl) => (
                <option key={lvl} value={lvl}>Level {lvl}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer group pb-2.5">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600" title="When unchecked, the task closes immediately on submit (unless it requires Director approval)">
                Requires Approval
              </span>
            </label>
          </div>
        </div>

        {/* Work Package */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            <span className="flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-slate-400" />
              Work Package <span className="font-normal text-slate-400">(optional)</span>
            </span>
          </label>
          {prefilledWpId ? (
            <>
              <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-500">
                {workPackages.find((w) => w.id === prefilledWpId)
                  ? `${workPackages.find((w) => w.id === prefilledWpId)!.wpId} — ${workPackages.find((w) => w.id === prefilledWpId)!.name}`
                  : `WP #${prefilledWpId}`}
              </div>
              <p className="mt-1.5 text-xs text-blue-600 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Work package pre-selected from the work package page.
              </p>
            </>
          ) : (
            <SearchableSelect
              id="wp-select"
              options={workPackages.map((w) => ({ value: String(w.id), label: `${w.wpId} — ${w.name}` }))}
              value={wpId ? String(wpId) : ''}
              onChange={(val) => setWpId(val ? Number(val) : '')}
              placeholder="No work package"
              clearable
              clearLabel="No work package"
            />
          )}
        </div>

        {/* Task Instruction */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="instruction-input">
            Task Instruction <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="instruction-input"
            rows={3}
            value={issuanceNote}
            onChange={(e) => setIssuanceNote(e.target.value)}
            placeholder="Add context or specific guidance for this task instance…"
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm resize-none"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end gap-3">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
          >
            Cancel
          </button>
        ) : (
          <Link
            href="/dashboard/tasks"
            className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
          >
            Cancel
          </Link>
        )}
        <button
          type="submit"
          disabled={submitting || !templateId || !targetDivisionId}
          id="create-task-submit"
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-sm transition-all"
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </span>
          ) : (
            'Create Task'
          )}
        </button>
      </div>
    </form>
  );
}
