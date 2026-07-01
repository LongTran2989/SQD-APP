'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { Template, WorkPackageDetail } from '../../types';
import { createTask, getDatasource } from '../../api/taskApi';
import { getWorkPackageById } from '../../api/wpApi';
import AsyncSearchableSelect from '../ui/AsyncSearchableSelect';
import { SearchableSelectOption } from '../ui/SearchableSelect';
import TemplatePickerModal from '../templates/TemplatePickerModal';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { FileCheck2, Clock, Info, FolderOpen, LayoutTemplate, X } from 'lucide-react';

export interface TaskCreateFormProps {
  prefilledWpId?: number | null;
  onSaved?: (taskId: number) => void;
  onCancel?: () => void;
}

function formatRelativeDraftTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

export default function TaskCreateForm({ prefilledWpId, onSaved, onCancel }: TaskCreateFormProps) {
  const router = useRouter();
  const { user } = useAuthStore();

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [targetDivisionId, setTargetDivisionId] = useState<number | ''>(user?.divisionId ?? '');
  const [assignedToUserId, setAssignedToUserId] = useState<number | ''>('');
  const [deadline, setDeadline] = useState('');
  const [wpId, setWpId] = useState<number | ''>(prefilledWpId ?? '');
  const [issuanceNote, setIssuanceNote] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [skillLevel, setSkillLevel] = useState<number>(0);
  const [estimatedHours, setEstimatedHours] = useState<number | ''>('');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [prefilledWp, setPrefilledWp] = useState<WorkPackageDetail | null>(null);
  const [readOnlyDivisionLabel, setReadOnlyDivisionLabel] = useState<string>('—');

  const DRAFT_KEY = 'taskCreateForm.issuanceNoteDraft';
  const [draftBanner, setDraftBanner] = useState<{ text: string; savedAt: string } | null>(null);
  // Tracks genuine user interaction (typing, Restore) rather than effect
  // invocation count — immune to React Strict Mode's dev-only double-invoke
  // of effect setup functions, since this ref is only ever set inside real
  // event handlers, never inside the persist effect itself.
  const userInteractedRef = useRef(false);

  const templateId = selectedTemplate?.id;

  // Seed per-task overrides from the chosen template; the user can still override.
  useEffect(() => {
    if (selectedTemplate) {
      setRequiresApproval(selectedTemplate.requiresApproval);
      setSkillLevel(selectedTemplate.skillLevel ?? 0);
      setTitle((prev) => prev || selectedTemplate.description || selectedTemplate.title);
      setEstimatedHours((prev) => (prev === '' ? (selectedTemplate.estimatedHours ?? '') : prev));
    }
  }, [selectedTemplate]);

  // Resolve the display name for a pre-selected work package (from the WP page).
  useEffect(() => {
    if (prefilledWpId) {
      getWorkPackageById(prefilledWpId).then(setPrefilledWp).catch(() => {});
    }
  }, [prefilledWpId]);

  // Check for an existing Task Instruction draft on mount — never silently
  // pre-fill; only surface it via the restore/discard banner below.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { text: string; savedAt: string };
        if (parsed.text?.trim()) setDraftBanner(parsed);
      }
    } catch {
      // corrupt/unavailable storage — ignore, no draft to offer
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the Task Instruction draft as it changes, debounced to avoid
  // writing on every keystroke.
  useEffect(() => {
    if (!userInteractedRef.current) return; // nothing user-driven has happened yet — don't touch storage (avoids wiping an existing draft before Restore/Discard, and is immune to Strict Mode's double-invoke since this ref is only ever set inside real event handlers, never inside this effect itself)
    const t = setTimeout(() => {
      try {
        if (issuanceNote.trim()) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: issuanceNote, savedAt: new Date().toISOString() }));
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch {
        // storage unavailable (private browsing, quota) — non-fatal, drafts are a convenience only
      }
    }, 500);
    return () => clearTimeout(t);
  }, [issuanceNote]);

  const handleRestoreDraft = () => {
    if (draftBanner) {
      userInteractedRef.current = true;
      setIssuanceNote(draftBanner.text);
    }
    setDraftBanner(null);
  };

  const handleDiscardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* non-fatal */ }
    setDraftBanner(null);
  };

  const ELEVATED_ROLES = ['Manager', 'Director', 'Admin'];
  const isElevated = ELEVATED_ROLES.includes(user?.role ?? '');

  // Non-elevated users have a fixed target division (their own) with no
  // picker — resolve just that one division's label for the read-only display.
  useEffect(() => {
    if (!isElevated && targetDivisionId) {
      getDatasource('divisions', { limit: 20 }).then((divs) => {
        const match = divs.find((d) => d.value === String(targetDivisionId));
        if (match) setReadOnlyDivisionLabel(match.label);
      }).catch(() => {});
    }
  }, [isElevated, targetDivisionId]);

  const fetchDivisionOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('divisions', { q, limit: 20 });

  const fetchAssigneeOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('users', { q, limit: 20, divisionId: targetDivisionId || undefined });

  const fetchWpOptions = (q: string): Promise<SearchableSelectOption[]> =>
    getDatasource('workpackages', { q, limit: 20 });

  const handleDivisionChange = (val: string) => {
    setTargetDivisionId(val ? Number(val) : '');
    // Division-scoped assignee search means a previously-picked assignee may
    // no longer be valid for the new division — always clear it on change.
    setAssignedToUserId('');
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
        title: title.trim() || undefined,
        estimatedHours: estimatedHours === '' ? undefined : Number(estimatedHours),
      });
      toast.success(`Task ${task.taskId} created`);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* non-fatal */ }
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Template selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-blue-600" />
          Template *
        </h2>
        <div>
          {selectedTemplate ? (
            <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                    {selectedTemplate.templateId}
                  </span>
                  {selectedTemplate.type && (
                    <span className="text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded">
                      {selectedTemplate.type}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-800">{selectedTemplate.title}</p>
                {selectedTemplate.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{selectedTemplate.description}</p>
                )}
                <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-1.5">
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
                    <span className="font-medium text-blue-600">Skill Level {selectedTemplate.skillLevel}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTemplate(null)}
                className="p-1 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-600 flex-shrink-0"
                title="Change template"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl text-sm text-slate-500 hover:text-blue-600 transition-all"
            >
              <LayoutTemplate className="w-4 h-4" />
              Browse and select a template…
            </button>
          )}
        </div>
      </div>

      {/* Task Title */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">Task Title</h2>
        <input
          id="task-title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
          placeholder="Defaults to the template description (or title, if no description) — edit to customize"
          className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
        />
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
            <AsyncSearchableSelect
              id="division-select"
              value={targetDivisionId ? String(targetDivisionId) : ''}
              onChange={handleDivisionChange}
              fetchOptions={fetchDivisionOptions}
              placeholder="Search for division…"
            />
          ) : (
            <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-500">
              {readOnlyDivisionLabel}
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
          <AsyncSearchableSelect
            id="assignee-select"
            value={assignedToUserId ? String(assignedToUserId) : ''}
            onChange={(val) => setAssignedToUserId(val ? Number(val) : '')}
            fetchOptions={fetchAssigneeOptions}
            placeholder={targetDivisionId ? 'Search for assignee…' : 'Select a division first'}
            disabled={!targetDivisionId}
            clearable
            clearLabel="No assignee (Unassigned)"
          />
          {!targetDivisionId && (
            <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" /> Select a target division before searching for an assignee.
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

        {/* Skill Level + Estimated Hours + Requires Approval */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="estimated-hours-input">
              Estimated Hours <span className="font-normal text-slate-400">(seeded from template)</span>
            </label>
            <input
              id="estimated-hours-input"
              type="number"
              min="0"
              step="0.5"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Optional"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            />
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
                {prefilledWp ? `${prefilledWp.wpId} — ${prefilledWp.name}` : `WP #${prefilledWpId}`}
              </div>
              <p className="mt-1.5 text-xs text-blue-600 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Work package pre-selected from the work package page.
              </p>
            </>
          ) : (
            <AsyncSearchableSelect
              id="wp-select"
              value={wpId ? String(wpId) : ''}
              onChange={(val) => setWpId(val ? Number(val) : '')}
              fetchOptions={fetchWpOptions}
              placeholder="Search for work package…"
              clearable
              clearLabel="No work package"
            />
          )}
        </div>

        {/* Draft restore banner */}
        {draftBanner && (
          <div className="flex items-center justify-between gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
            <span>You have an unsaved instruction draft from {formatRelativeDraftTime(draftBanner.savedAt)}.</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button type="button" onClick={handleRestoreDraft} className="px-3 py-1 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition-colors">
                Restore
              </button>
              <button type="button" onClick={handleDiscardDraft} className="px-3 py-1 text-amber-700 hover:bg-amber-100 rounded-lg font-semibold transition-colors">
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Task Instruction */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="instruction-input">
            Task Instruction <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="instruction-input"
            rows={3}
            value={issuanceNote}
            onChange={(e) => { userInteractedRef.current = true; setIssuanceNote(e.target.value); }}
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

      {/* Template Picker Modal */}
      <TemplatePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(t) => { setSelectedTemplate(t); setPickerOpen(false); }}
      />
    </form>
  );
}
