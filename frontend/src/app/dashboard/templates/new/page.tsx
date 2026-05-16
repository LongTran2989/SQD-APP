'use client';

import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../api/client';
import toast from 'react-hot-toast';
import TemplateBuilder from '../../../../components/templates/TemplateBuilder';

export default function NewTemplatePage() {
  const router = useRouter();

  const handleSave = async (payload: any, action: 'Draft' | 'Published') => {
    try {
      const response = await apiClient.post('/templates', payload);
      if (action === 'Published') {
        try {
          await apiClient.post(`/templates/${response.data.id}/publish`);
          toast.success('Template published successfully');
        } catch (err: any) {
          toast.error(err.response?.data?.message || 'Draft saved, but failed to publish');
        }
      } else {
        toast.success('Draft saved successfully');
      }
      router.push('/dashboard/templates');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save template');
      throw err; // throw to let TemplateBuilder know it failed
    }
  };

  const handleDiscard = () => {
    if (window.confirm('Discard all changes?')) {
      router.push('/dashboard/templates');
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <TemplateBuilder 
        onSave={handleSave} 
        onDiscard={handleDiscard}
      />
    </div>
  );
}
