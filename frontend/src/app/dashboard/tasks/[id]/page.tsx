'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../../store/authStore';
import { TaskEnriched, TaskActivityEnriched, FormField, FindingListItem } from '../../../../types';
import { getTaskById, getTaskActivity, saveTaskData } from '../../../../api/taskApi';
import { getFindingsByTask } from '../../../../api/findingApi';
import TaskDetailPanel from '../../../../components/tasks/TaskDetailPanel';
import TaskActionBar from '../../../../components/tasks/TaskActionBar';
import TaskFormPanel from '../../../../components/tasks/TaskFormPanel';
import TaskActivityFeed from '../../../../components/tasks/TaskActivityFeed';
import TaskStatusBadge from '../../../../components/tasks/TaskStatusBadge';
import TimeBookingPanel from '../../../../components/tasks/TimeBookingPanel';
import TimeEntryPanel from '../../../../components/tasks/TimeEntryPanel';
import RaiseFindingPanel from '../../../../components/findings/RaiseFindingPanel';
import { SeverityBadge, FindingStatusBadge } from '../../../../components/findings/FindingBadges';
import toast from 'react-hot-toast';
import { ArrowLeft, AlertTriangle, Clock, FileText } from 'lucide-react';

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
  const [linkedFindings, setLinkedFindings] = useState<FindingListItem[]>([]);
  const [showRaiseFinding, setShowRaiseFinding] = useState(false);

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
      // Findings raised on this task (non-fatal)
      getFindingsByTask(taskId).then(setLinkedFindings).catch(() => {});
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

  // ── Lightweight meta refresh — updates task/activity/findings without resetting
  //    formData. Use this for callbacks triggered mid-edit (time entries, bookings)
  //    so unsaved form changes are not wiped. loadTask() is for initial mount only.
  const refreshTaskMeta = useCallback(async () => {
    if (!taskId) return;
    try {
      const [taskData, activityData] = await Promise.all([
        getTaskById(taskId),
        getTaskActivity(taskId),
      ]);
      setTask(taskData);
      setActivities(activityData);
      getFindingsByTask(taskId).then(setLinkedFindings).catch(() => {});
    } catch {
      // non-fatal — page already loaded, silently ignore
    }
  }, [taskId]);

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

  // ── Submit task ──
  const handleSubmitTask = async () => {
    if (!task) return;
    if (!validateRequiredFields()) return;
    setSavingProgress(true);
    try {
      // 1. Save form data
      await saveTaskData(task.id, formData);
      setHasUnsavedChanges(false);
      
      // 2. Submit task
      const { submitTask } = await import('../../../../api/taskApi');
      const updated = await submitTask(task.id);
      toast.success('Task submitted for review');
      
      // 3. Update task state
      setTask(updated);
      
      // 4. Refresh activity feed
      getTaskActivity(task.id).then(setActivities).catch(() => {});
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to submit task');
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
      const val = formData[field.fieldId];
      
      // Date format validation
      if (field.type === 'date' && val) {
        const dateStr = String(val);
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateStr) || isNaN(Date.parse(dateStr))) {
          toast.error(`Invalid date format for ${field.label}. Please use a valid date.`);
          return false;
        }
      }

      if (!field.required) continue;
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
          {/* Back-to-finding: follow-up tasks point home via parentFinding; source
              tasks (which raised a finding) fall back to the finding(s) linked to them. */}
          {(() => {
            const back = task.parentFinding ?? (linkedFindings.length > 0 ? linkedFindings[0] : null);
            if (!back) return null;
            const more = task.parentFinding ? 0 : Math.max(0, linkedFindings.length - 1);
            return (
              <Link
                href={`/dashboard/findings/${back.id}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700 mb-1"
              >
                <ArrowLeft className="w-3 h-3" />
                Back to Finding #{back.id}{more > 0 ? ` (+${more} more below)` : ''}
              </Link>
            );
          })()}
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

        {/* View Report — once the task has saved form data, available at any status */}
        {task.taskData?.data && Object.keys(task.taskData.data).length > 0 && (
          <Link
            href={`/tasks/${task.id}/report`}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-600 text-sm font-semibold rounded-xl shadow-sm transition-colors flex-shrink-0"
          >
            <FileText className="w-4 h-4" />
            View Report
          </Link>
        )}

        {/* Raise Finding — only when the template allows findings and the task is still actionable */}
        {task.template?.allowsFindings &&
          !['Closed', 'Terminated', 'Inactive'].includes(task.status) && (
            <button
              onClick={() => setShowRaiseFinding(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors flex-shrink-0"
            >
              <AlertTriangle className="w-4 h-4" />
              Raise Finding
            </button>
          )}
      </div>

      {/* Unsaved changes banner */}
      {hasUnsavedChanges && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          You have unsaved changes. Click "Save Progress" to save your work.
        </div>
      )}

      {task.status === 'In Review' && !task.timeBooking && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <Clock className="w-4 h-4 flex-shrink-0" />
          <a href="#time-booking-section" className="font-bold underline hover:text-amber-800 transition-colors">
            Please perform final time booking!
          </a>
          <span>Submit it now so your manager can rate the task once it is approved.</span>
        </div>
      )}

      {/* Time booking required banner — Closed tasks with no booking block manager rating */}
      {task.status === 'Closed' && !task.timeBooking && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <Clock className="w-4 h-4 flex-shrink-0" />
          Time booking required — your manager cannot rate this task until you log your time.
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
            onSubmitTask={handleSubmitTask}
          />

          {/* Dynamic form */}
          {task.schemaSnapshot && task.schemaSnapshot.length > 0 && (
            <TaskFormPanel
              taskId={task.id}
              schemaSnapshot={task.schemaSnapshot}
              taskStatus={task.status}
              formData={formData}
              onDataChange={handleDataChange}
            />
          )}

          {/* Work Log — visible for all post-assignment statuses for historical tracking */}
          {task.status !== 'Unassigned' && task.status !== 'Inactive' && (
            <TimeEntryPanel
              task={task}
              currentUser={user}
              onEntryAdded={refreshTaskMeta}
            />
          )}

          {/* Time Booking — available from In Review onwards */}
          {['In Review', 'Closed', 'Rejected', 'Terminated'].includes(task.status) && (
            <div id="time-booking-section">
              <TimeBookingPanel task={task} currentUser={user} onBookingChange={refreshTaskMeta} />
            </div>
          )}

          {/* Linked Findings — findings raised on this task */}
          {linkedFindings.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">
                Linked Findings ({linkedFindings.length})
              </h3>
              <div className="space-y-2">
                {linkedFindings.map((f) => (
                  <Link
                    key={f.id}
                    href={`/dashboard/findings/${f.id}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono font-bold text-slate-600 flex-shrink-0">#{f.id}</span>
                      <span className="text-sm text-slate-700 truncate">{f.description}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <SeverityBadge severity={f.severity} />
                      <FindingStatusBadge status={f.status} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
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
              onRefresh={() => getTaskActivity(taskId).then(setActivities).catch(() => {})}
            />
          </div>
        </div>
      </div>

      {/* Raise Finding slide-over */}
      {showRaiseFinding && (
        <RaiseFindingPanel
          taskId={task.id}
          onClose={() => setShowRaiseFinding(false)}
          onRaised={() => {
            setShowRaiseFinding(false);
            // Refresh linked findings + the activity feed (a SYSTEM_EVENT was logged).
            getFindingsByTask(task.id).then(setLinkedFindings).catch(() => {});
            getTaskActivity(task.id).then(setActivities).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
