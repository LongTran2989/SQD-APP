'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../../../store/authStore';
import Link from 'next/link';
import { ArrowLeft, FileText, Zap } from 'lucide-react';
import TaskCreateForm from '../../../../components/tasks/TaskCreateForm';
import QuickTaskForm from '../../../../components/tasks/QuickTaskForm';

const ELEVATED_ROLES = ['Manager', 'Director', 'Admin'];

function canAccessNewTaskPage(role: string, prefilledWpId: number | null): boolean {
  return ELEVATED_ROLES.includes(role) || prefilledWpId !== null;
}

type CreateMode = 'template' | 'quick';

export default function NewTaskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();

  const prefilledWpId = searchParams.get('wpId') ? Number(searchParams.get('wpId')) : null;
  const mode = (searchParams.get('mode') as CreateMode) ?? 'template';

  useEffect(() => {
    if (user && !canAccessNewTaskPage(user.role, prefilledWpId)) {
      router.replace('/dashboard/tasks');
    }
  }, [user, router, prefilledWpId]);

  if (!user || !canAccessNewTaskPage(user.role, prefilledWpId)) return null;

  const canQuickTask = ELEVATED_ROLES.includes(user.role);
  const showTabs = canQuickTask && !prefilledWpId;

  const setMode = (m: CreateMode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('mode', m);
    router.replace(`/dashboard/tasks/new?${params.toString()}`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/tasks"
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Create Task</h1>
          <p className="text-slate-500 mt-0.5">
            {mode === 'quick' && showTabs
              ? 'Issue a task without a template'
              : 'Create a task from a published template'}
          </p>
        </div>
      </div>

      {showTabs && (
        <div className="flex items-center gap-1 border-b border-slate-200">
          <button
            onClick={() => setMode('template')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              mode === 'template'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileText className="w-4 h-4" />
            From Template
          </button>
          <button
            onClick={() => setMode('quick')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              mode === 'quick'
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Zap className="w-4 h-4" />
            Quick Task
          </button>
        </div>
      )}

      {mode === 'quick' && showTabs ? (
        <QuickTaskForm />
      ) : (
        <TaskCreateForm
          prefilledWpId={prefilledWpId}
          onSaved={(id) => router.push(`/dashboard/tasks/${id}`)}
        />
      )}
    </div>
  );
}
