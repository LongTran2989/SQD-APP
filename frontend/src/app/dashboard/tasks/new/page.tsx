'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../../../store/authStore';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import TaskCreateForm from '../../../../components/tasks/TaskCreateForm';

const ELEVATED_ROLES = ['Manager', 'Director', 'Admin'];
function canAccessNewTaskPage(role: string, prefilledWpId: number | null): boolean {
  return ELEVATED_ROLES.includes(role) || prefilledWpId !== null;
}

export default function NewTaskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();

  const prefilledWpId = searchParams.get('wpId') ? Number(searchParams.get('wpId')) : null;

  useEffect(() => {
    if (user && !canAccessNewTaskPage(user.role, prefilledWpId)) {
      router.replace('/dashboard/tasks');
    }
  }, [user, router, prefilledWpId]);

  if (!user || !canAccessNewTaskPage(user.role, prefilledWpId)) return null;

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
          <h1 className="text-2xl font-bold text-slate-800">New Task</h1>
          <p className="text-slate-500 mt-0.5">Create a task from a published template</p>
        </div>
      </div>
      <TaskCreateForm
        prefilledWpId={prefilledWpId}
        onSaved={(id) => router.push(`/dashboard/tasks/${id}`)}
      />
    </div>
  );
}
