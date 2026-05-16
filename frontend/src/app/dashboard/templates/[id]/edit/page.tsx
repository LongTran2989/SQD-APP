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
      await apiClient.put(`/templates/${templateId}`, payload);
      if (action === 'Published') {
        try {
          await apiClient.post(`/templates/${templateId}/publish`);
          toast.success('Template published successfully');
        } catch (err: any) {
          toast.error(err.response?.data?.message || 'Draft saved, but failed to publish');
        }
      } else {
        toast.success('Draft saved successfully');
      }
      router.push(`/dashboard/templates/${templateId}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update template');
      throw err;
    }
  };

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
        initialData={template}
        onSave={handleSave} 
        onDiscard={handleDiscard}
      />
    </div>
  );
}
