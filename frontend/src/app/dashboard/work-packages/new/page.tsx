'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../../store/authStore';
import { createWorkPackage } from '../../../../api/wpApi';
import WorkPackageForm, { WpFormValues } from '../../../../components/work-packages/WorkPackageForm';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';

const ALLOWED_ROLES = ['Manager', 'Director', 'Admin'];

export default function NewWorkPackagePage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) {
      router.replace('/dashboard/work-packages');
    }
  }, [user, router]);

  const handleSubmit = async (values: WpFormValues) => {
    if (!values.divisionId) return;
    setSubmitting(true);
    try {
      const wp = await createWorkPackage({
        name: values.name,
        type: values.type,
        divisionId: Number(values.divisionId),
        timeframeFrom: values.timeframeFrom,
        timeframeTo: values.timeframeTo,
        acRegistration: values.acRegistration || null,
        customer: values.customer || null,
        authority: values.authority || null,
        targetDepartmentId: values.targetDepartmentId ? Number(values.targetDepartmentId) : null,
        autoGenerate: values.autoGenerate,
        autoGenMode: values.autoGenerate ? values.autoGenMode : null,
        autoGenInterval: values.autoGenerate && values.autoGenMode === 'REPEAT' && values.autoGenInterval ? Number(values.autoGenInterval) : null,
        autoGenTemplateId: values.autoGenerate && values.autoGenTemplateId ? Number(values.autoGenTemplateId) : null,
        autoGenSetId: values.autoGenerate && values.autoGenSetId ? Number(values.autoGenSetId) : null,
      });
      toast.success(`Work Package ${wp.wpId} created`);
      router.push(`/dashboard/work-packages/${wp.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create work package');
      setSubmitting(false);
    }
  };

  if (!user || !ALLOWED_ROLES.includes(user.role)) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/work-packages"
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">New Work Package</h1>
          <p className="text-slate-500 mt-0.5">Create a new work package to group related tasks</p>
        </div>
      </div>

      <WorkPackageForm
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/dashboard/work-packages')}
        submitLabel="Create Work Package"
      />
    </div>
  );
}
