'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../../../store/authStore';
import { WorkPackageDetail } from '../../../../../types';
import { getWorkPackageById, updateWorkPackage } from '../../../../../api/wpApi';
import WorkPackageForm, { WpFormValues } from '../../../../../components/work-packages/WorkPackageForm';
import toast from 'react-hot-toast';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

const ALLOWED_ROLES = ['Manager', 'Director', 'Admin'];

function toDateString(iso: string): string {
  return iso.split('T')[0] ?? iso;
}

export default function EditWorkPackagePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();

  const wpId = Number(params.id);

  const [wp, setWp] = useState<WorkPackageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadWp = useCallback(async () => {
    try {
      const data = await getWorkPackageById(wpId);
      setWp(data);
    } catch (err: any) {
      if (err.response?.status === 404) setError('Work Package not found.');
      else setError('Failed to load work package.');
    } finally {
      setLoading(false);
    }
  }, [wpId]);

  useEffect(() => { loadWp(); }, [loadWp]);

  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) {
      router.replace(`/dashboard/work-packages/${wpId}`);
    }
  }, [user, router, wpId]);

  const handleSubmit = async (values: WpFormValues) => {
    setSubmitting(true);
    try {
      await updateWorkPackage(wpId, {
        name: values.name,
        timeframeFrom: values.timeframeFrom,
        timeframeTo: values.timeframeTo,
        checkTemplateId: values.checkTemplateId ? Number(values.checkTemplateId) : null,
      });
      toast.success('Work Package updated');
      router.push(`/dashboard/work-packages/${wpId}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update work package');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !wp) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-800">{error ?? 'Something went wrong'}</h1>
        <Link href="/dashboard/work-packages" className="text-blue-600 hover:underline text-sm">
          ← Back to Work Packages
        </Link>
      </div>
    );
  }

  if (!user || !ALLOWED_ROLES.includes(user.role)) return null;

  if (wp.computedStatus === 'Closed') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-800">Closed Work Packages cannot be edited</h1>
        <Link href={`/dashboard/work-packages/${wpId}`} className="text-blue-600 hover:underline text-sm">
          ← Back to Work Package
        </Link>
      </div>
    );
  }

  const initial: Partial<WpFormValues> = {
    name: wp.name,
    type: wp.type,
    divisionId: wp.divisionId,
    timeframeFrom: toDateString(wp.timeframeFrom),
    timeframeTo: toDateString(wp.timeframeTo),
    checkTemplateId: wp.checkTemplateId ?? '',
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={`/dashboard/work-packages/${wpId}`}
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Edit Work Package</h1>
          <p className="text-slate-500 mt-0.5">
            <span className="font-mono font-semibold">{wp.wpId}</span> — {wp.name}
          </p>
        </div>
      </div>

      <WorkPackageForm
        initial={initial}
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/dashboard/work-packages/${wpId}`)}
        submitLabel="Save Changes"
      />
    </div>
  );
}
