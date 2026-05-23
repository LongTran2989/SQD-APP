'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../../store/authStore';
import { TaskEnriched, TaskActivityEnriched, FormField } from '../../../../types';
import { getTaskById, getTaskActivity, saveTaskData } from '../../../../api/taskApi';
import TaskDetailPanel from '../../../../components/tasks/TaskDetailPanel';
import TaskActionBar from '../../../../components/tasks/TaskActionBar';
import TaskFormPanel from '../../../../components/tasks/TaskFormPanel';
import TaskActivityFeed from '../../../../components/tasks/TaskActivityFeed';
import TaskStatusBadge from '../../../../components/tasks/TaskStatusBadge';
import toast from 'react-hot-toast';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();

  const taskId = Number(params.id);

  // ── State ──
  const [task, setTask] = useState<TaskEnriched | null>(null);
  const [activities, setActivities] = useState<TaskActivityEnriched[]>([]);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── beforeunload guard (same pattern as TemplateBuilder) ──
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

  // ── Initial load ──
  const loadTask = useCallback(async () => {
    if (!taskId) return;
    try {
      const [taskData, activityData] = await Promise.all([
        getTaskById(taskId),
        getTaskActivity(taskId),
      ]);
      setTask(taskData);
      setActivities(activityData);
      // Pre-fill form with saved taskData
      const saved = taskData.taskData?.data ?? {};
      setFormData(saved as Record<string, unknown>);
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError('You do not have permission to view this task.');
      } else if (err.response?.status === 404) {
        setError('Task not found.');
      } else {
        setError('Failed to load task. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  // ── Form data change handler ──
  const handleDataChange = (fieldId: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
    setHasUnsavedChanges(true);
  };

  // ── Save progress ──
  const handleSaveProgress = async () => {
    if (!task) return;
    setSavingProgress(true);
    try {
      await saveTaskData(task.id, formData);
      toast.success('Progress saved');
      setHasUnsavedChanges(false);
      // Refresh task to pick up any status change (Assigned → In Progress)
      const updated = await getTaskById(task.id);
      setTask(updated);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save progress');
    } finally {
      setSavingProgress(false);
    }
  };

  // ── Required field validation before submit ──
  const validateRequiredFields = (): boolean => {
    if (!task) return false;
    const schema: FormField[] = task.schemaSnapshot;
    const missing: string[] = [];
    for (const field of schema) {
      if (!field.required) continue;
      const val = formData[field.fieldId];
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
        missing.push(field.label);
      }
    }
    if (missing.length > 0) {
      toast.error(`Please fill in required fields: ${missing.join(', ')}`);
      return false;
    }
    return true;
  };

  // ── Task updated callback (from action bar) ──
  const handleTaskUpdated = (updated: TaskEnriched) => {
    setTask(updated);
    // Refresh activity feed to pick up the new SYSTEM_EVENT
    getTaskActivity(taskId)
      .then(setActivities)
      .catch(() => {});
  };

  // ── New activity from comment box ──
  const handleNewActivity = (activity: TaskActivityEnriched) => {
    setActivities((prev) => [...prev, activity]);
  };

  // ── Loading & error states ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !task || !user) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-800">{error ?? 'Something went wrong'}</h1>
        <Link href="/dashboard/tasks" className="text-blue-600 hover:underline text-sm">
          ← Back to Tasks
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">

      {/* Page header */}
      <div className="flex items-start gap-4">
        <Link
          href="/dashboard/tasks"
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0 mt-0.5"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-bold font-mono text-sm border border-slate-200">
              {task.taskId}
            </span>
            <TaskStatusBadge status={task.status} />
            {task.isOverdue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-[10px] font-bold border border-red-200">
                <AlertTriangle className="w-2.5 h-2.5" />
                OVERDUE
              </span>
            )}
          </div>
          <h1 className="text-xl font-bold text-slate-800 truncate">
            {task.template?.title ?? 'Task'}
          </h1>
        </div>
      </div>

      {/* Unsaved changes banner */}
      {hasUnsavedChanges && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          You have unsaved changes. Click "Save Progress" to save your work.
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">

        {/* ── Left panel (3/5 width): Detail + Actions + Form ── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Task metadata */}
          <TaskDetailPanel task={task} currentUser={user} />

          {/* Action bar */}
          <TaskActionBar
            task={task}
            currentUser={user}
            onTaskUpdated={handleTaskUpdated}
            onSaveProgress={handleSaveProgress}
            savingProgress={savingProgress}
          />

          {/* Dynamic form */}
          {task.schemaSnapshot && task.schemaSnapshot.length > 0 && (
            <TaskFormPanel
              schemaSnapshot={task.schemaSnapshot}
              taskStatus={task.status}
              formData={formData}
              onDataChange={handleDataChange}
            />
          )}
        </div>

        {/* ── Right panel (2/5 width): Activity feed ── */}
        <div className="lg:col-span-2 sticky top-6">
          <div className="h-[calc(100vh-140px)] flex flex-col">
            <TaskActivityFeed
              task={task}
              activities={activities}
              currentUser={user}
              onNewActivity={handleNewActivity}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
