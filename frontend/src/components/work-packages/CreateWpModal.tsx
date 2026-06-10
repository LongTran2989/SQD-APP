'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import WorkPackageForm, { WpFormValues } from './WorkPackageForm';
import { createWorkPackage } from '../../api/wpApi';

interface CreateWpModalProps {
  onClose: () => void;
  onSaved: (id: number) => void;
}

export default function CreateWpModal({ onClose, onSaved }: CreateWpModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (values: WpFormValues) => {
    if (!values.divisionId) {
      toast.error('Please select a division');
      return;
    }
    setSubmitting(true);
    try {
      const wp = await createWorkPackage({
        name: values.name,
        type: values.type,
        divisionId: Number(values.divisionId),
        timeframeFrom: values.timeframeFrom,
        timeframeTo: values.timeframeTo,
        checkTemplateId: values.checkTemplateId ? Number(values.checkTemplateId) : undefined,
      });
      toast.success(`Work Package ${wp.wpId} created`);
      onSaved(wp.id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to create work package');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Create New Work Package</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          <WorkPackageForm
            submitting={submitting}
            onSubmit={handleSubmit}
            onCancel={onClose}
            submitLabel="Create Work Package"
          />
        </div>
      </div>
    </div>
  );
}
