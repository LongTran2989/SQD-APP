'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../../../store/authStore';
import { Template, WorkPackageEnriched } from '../../../../types';
import { createTask, getDivisions, getUsers } from '../../../../api/taskApi';
import { getWorkPackages } from '../../../../api/wpApi';
import { apiClient } from '../../../../api/client';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  FileCheck2,
  Clock,
  Info,
  FolderOpen,
} from 'lucide-react';
import Link from 'next/link';

// ─── Role gate ────────────────────────────────────────────────────────────────

const ELEVATED_ROLES = ['Manager', 'Director', 'Admin'];
// Staff/Group Leader may reach this page ONLY when arriving from a WP (wpId pre-filled).
// Backend still enforces WP membership — the frontend just removes the hard redirect.
function canAccessNewTaskPage(role: string, prefilledWpId: number | null): boolean {
  return ELEVATED_ROLES.includes(role) || prefilledWpId !== null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SelectOption {
  value: string;
  label: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewTaskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();

  // Role gate on mount — redirect staff who arrive without a WP context
  useEffect(() => {
    if (user && !canAccessNewTaskPage(user.role, prefilledWpId)) {
      router.replace('/dashboard/tasks');
    }
  }, [user, router, prefilledWpId]);

  // ── Prefill from query params ──
  const prefilledWpId = searchParams.get('wpId') ? Number(searchParams.get('wpId')) : null;

  // ── Form state ──
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [targetDivisionId, setTargetDivisionId] = useState<number | ''>(user?.divisionId ?? '');
  const [assignedToUserId, setAssignedToUserId] = useState<number | ''>('');
  const [deadline, setDeadline] = useState('');
  const [wpId, setWpId] = useState<number | ''>(prefilledWpId ?? '');
  const [submitting, setSubmitting] = useState(false);

  // ── Data ──
  const [templates, setTemplates] = useState<Template[]>([]);
  const [divisions, setDivisions] = useState<SelectOption[]>([]);
  const [users, setUsers] = useState<SelectOption[]>([]);
  const [workPackages, setWorkPackages] = useState<WorkPackageEnriched[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Selected template details for preview
  const selectedTemplate = templates.find((t) => t.id === templateId);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [tplRes, divRes, usersRes, wpsRes] = await Promise.all([
          apiClient.get('/templates'),
          getDivisions(),
          getUsers(),
          getWorkPackages(),
        ]);

        // Only Published templates
        let published: Template[] = (tplRes.data as Template[]).filter(
          (t) => t.status === 'Published'
        );

        // Non-Director/Admin: filter to own division
        if (user && user.role !== 'Director' && user.role !== 'Admin') {
          published = published.filter((t) => t.divisionId === user.divisionId);
        }

        setTemplates(published);
        setDivisions(divRes);
        setUsers(usersRes);
        // Only active (non-Closed, non-Inactive) WPs
        setWorkPackages(wpsRes.filter((w) => w.computedStatus !== 'Closed' && w.computedStatus !== 'Inactive'));
      } catch {
        toast.error('Failed to load form data');
      } finally {
        setLoadingData(false);
      }
    };
    fetchAll();
  }, [user]);

  // Filter user picker to same division for Manager
  const filteredUsers =
    user?.role === 'Manager'
      ? users.filter((u) => {
          // datasources/users returns value = userId; we can't filter by division
          // here without extra data — show all and let backend enforce the rule
          return true;
        })
      : users;

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
      });
      toast.success(`Task ${task.taskId} created`);
      router.push(`/dashboard/tasks/${task.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create task');
      setSubmitting(false);
    }
  };

  if (!user || !canAccessNewTaskPage(user.role, prefilledWpId)) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/tasks"
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">New Task</h1>
          <p className="text-slate-500 mt-0.5">Create a task from a published template</p>
        </div>
      </div>

      {loadingData ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Template selector */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-blue-600" />
              Template *
            </h2>

            <div>
              <select
                id="template-select"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')}
                required
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
              >
                <option value="">Select a published template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.templateId} — {t.title}
                  </option>
                ))}
              </select>
              {templates.length === 0 && (
                <p className="mt-2 text-sm text-amber-600 flex items-center gap-1.5">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  No published templates available
                  {user.role !== 'Director' && user.role !== 'Admin' ? ' in your division.' : '.'}
                </p>
              )}
            </div>

            {/* Template preview */}
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
                  {selectedTemplate.isOneOff && (
                    <span className="font-medium text-purple-600">One-off (auto-archived after assignment)</span>
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
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="division-select">
                Target Division *
              </label>
              <select
                id="division-select"
                value={targetDivisionId}
                onChange={(e) => setTargetDivisionId(e.target.value ? Number(e.target.value) : '')}
                required
                disabled={!ELEVATED_ROLES.includes(user?.role ?? '')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="">Select division...</option>
                {divisions.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Assignee (optional) */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="assignee-select">
                Assignee <span className="font-normal text-slate-400">(optional — leave blank to create as Unassigned)</span>
              </label>
              <select
                id="assignee-select"
                value={assignedToUserId}
                onChange={(e) => setAssignedToUserId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
              >
                <option value="">No assignee (Unassigned)</option>
                {filteredUsers.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Deadline (optional) */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="deadline-input">
                Deadline <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="deadline-input"
                type="date"
                value={deadline}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
              />
            </div>

            {/* Work Package */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-select">
                <span className="flex items-center gap-1.5">
                  <FolderOpen className="w-4 h-4 text-slate-400" />
                  Work Package <span className="font-normal text-slate-400">(optional)</span>
                </span>
              </label>
              <select
                id="wp-select"
                value={wpId}
                onChange={(e) => setWpId(e.target.value ? Number(e.target.value) : '')}
                disabled={!!prefilledWpId}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="">No work package</option>
                {workPackages.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.wpId} — {w.name}
                  </option>
                ))}
              </select>
              {prefilledWpId && (
                <p className="mt-1.5 text-xs text-blue-600 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5" /> Work package pre-selected from the work package page.
                </p>
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-3">
            <Link
              href="/dashboard/tasks"
              className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
            >
              Cancel
            </Link>
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
      )}
    </div>
  );
}
