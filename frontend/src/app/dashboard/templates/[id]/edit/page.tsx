'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../../api/client';
import toast from 'react-hot-toast';
import TemplateBuilder from '../../../../../components/templates/TemplateBuilder';
import { Template } from '../../../../../types';

export default function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const templateId = parseInt(resolvedParams.id, 10);
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplate();
  }, [templateId]);

  const fetchTemplate = async () => {
    try {
      const response = await apiClient.get(`/templates/${templateId}`);
      setTemplate(response.data);
    } catch (err: any) {
      toast.error('Failed to load template');
      router.push('/dashboard/templates');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (payload: any, action: 'Draft' | 'Published') => {
    try {
      // PR7: echo the updatedAt we last saw for optimistic concurrency (409 on conflict).
      const updatedAt = template?.updatedAt;
      const putRes = await apiClient.put(`/templates/${templateId}`, { ...payload, updatedAt });
      // The PUT advances updatedAt in the DB — use the fresh value for publish so the
      // stale-check doesn't fire on the immediately-following publish call.
      const freshUpdatedAt = putRes.data?.updatedAt ?? updatedAt;
      if (action === 'Published') {
        try {
          await apiClient.post(`/templates/${templateId}/publish`, { updatedAt: freshUpdatedAt });
          toast.success('Template published successfully');
        } catch (err: any) {
          if (err.response?.status === 409) {
            toast.error('This template was changed by someone else. Please reload and retry.');
            throw err;
          }
          toast.error(err.response?.data?.message || 'Draft saved, but failed to publish');
        }
      } else {
        toast.success('Draft saved successfully');
      }
      router.push(`/dashboard/templates/${templateId}`);
    } catch (err: any) {
      if (err.response?.status === 409) {
        toast.error('This template was modified by someone else. Please reload and try again.');
      } else {
        toast.error(err.response?.data?.message || 'Failed to update template');
      }
      throw err;
    }
  };

  // When a pending draft exists, edit the draft (not the live published fields).
  const builderInitialData = (() => {
    if (!template) return undefined;
    if (template.hasPendingChanges && template.draftSchema) {
      const d = template.draftSchema;
      if (Array.isArray(d)) return { ...template, formSchema: d };
      return {
        ...template,
        title: d.title ?? template.title,
        description: d.description ?? template.description,
        formSchema: d.formSchema ?? template.formSchema,
        requiresApproval: d.requiresApproval ?? template.requiresApproval,
        allowsFindings: d.allowsFindings ?? template.allowsFindings,
        estimatedHours: d.estimatedHours ?? template.estimatedHours,
        skillLevel: d.skillLevel ?? template.skillLevel,
        type: d.type ?? template.type,
      };
    }
    return template;
  })();

  const handleDiscard = () => {
    if (window.confirm('Discard all unsaved changes?')) {
      router.push(`/dashboard/templates/${templateId}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!template) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <TemplateBuilder
        initialData={builderInitialData}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  );
}
