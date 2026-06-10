'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiClient } from '../../../api/client';
import { Template } from '../../../types';
import { useAuthStore } from '../../../store/authStore';
import toast from 'react-hot-toast';
import { 
  Plus, 
  FileCheck2, 
  Clock, 
  CheckCircle2, 
  Archive, 
  Search,
  Filter,
  Eye,
  Edit,
  Trash2,
  RotateCcw
} from 'lucide-react';

const statusConfig = {
  Draft: { color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock, label: 'Draft' },
  Published: { color: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle2, label: 'Published' },
  Archived: { color: 'bg-slate-100 text-slate-500 border-slate-200', icon: Archive, label: 'Archived' },
};

export default function TemplateListPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { user } = useAuthStore();

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const response = await apiClient.get('/templates');
      setTemplates(response.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async (id: number) => {
    if (!window.confirm('This template will be archived and can no longer generate new Tasks. All existing Tasks are unaffected.')) return;
    try {
      await apiClient.patch(`/templates/${id}/archive`);
      toast.success('Template archived successfully');
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to archive template');
    }
  };

  const handleUnarchive = async (id: number) => {
    if (!window.confirm('Are you sure you want to unarchive this template? It will be restored as a Draft.')) return;
    try {
      await apiClient.patch(`/templates/${id}/unarchive`);
      toast.success('Template unarchived successfully');
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to unarchive template');
    }
  };

  const filteredTemplates = templates.filter((t) => {
    const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.templateId || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const canEditOrArchive = (template: Template) => {
    if (!user) return false;
    return user.id === template.ownerId || user.role === 'Admin' || user.role === 'Director';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Templates</h1>
          <p className="text-slate-500 mt-1">Manage QA audit templates</p>
        </div>
        <Link
          href="/dashboard/templates/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm transition-all"
        >
          <Plus className="w-5 h-5" />
          New Template
        </Link>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search templates..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select
            className="pl-10 pr-8 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer transition-all"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Published">Published</option>
            <option value="Archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Templates Data Grid */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {filteredTemplates.length === 0 ? (
          <div className="p-12 text-center">
            <FileCheck2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">
              {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
            </h2>
            <p className="text-slate-500">
              {templates.length === 0
                ? 'Create your first QA audit template to get started.'
                : 'Try adjusting your search or filter criteria.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-sm font-semibold text-slate-600">ID</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Title</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Division</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Type</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Status</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Owner</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Published</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTemplates.map((template) => {
                  const config = statusConfig[template.status] || statusConfig.Draft;
                  const StatusIcon = config.icon;
                  const hasPrivilege = canEditOrArchive(template);

                  return (
                    <tr key={template.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 align-middle">
                        <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-bold font-mono border border-slate-200">
                          {template.templateId}
                        </span>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="font-semibold text-slate-800">{template.title}</div>
                        <div className="flex items-center gap-2 mt-1">
                          {template.hasPendingChanges && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
                              PENDING
                            </span>
                          )}
                          {template.skillLevel > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">
                              SKILL {template.skillLevel}
                            </span>
                          )}
                          <span className="text-xs text-slate-500">Rev {template.revision}</span>
                        </div>
                      </td>
                      <td className="p-4 align-middle text-sm text-slate-600">
                        {template.division?.name || 'N/A'}
                      </td>
                      <td className="p-4 align-middle text-sm text-slate-600">
                        {template.type || '—'}
                      </td>
                      <td className="p-4 align-middle">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border ${config.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {config.label}
                        </span>
                      </td>
                      <td className="p-4 align-middle text-sm text-slate-600">
                        {template.owner?.name || '—'}
                      </td>
                      <td className="p-4 align-middle text-sm text-slate-600">
                        {template.publishedAt ? new Date(template.publishedAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-4 align-middle text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/dashboard/templates/${template.id}`}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="View"
                          >
                            <Eye className="w-4 h-4" />
                          </Link>
                          {hasPrivilege && (
                            <>
                              {template.status !== 'Archived' && (
                                <Link
                                  href={`/dashboard/templates/${template.id}/edit`}
                                  className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                  title="Edit"
                                >
                                  <Edit className="w-4 h-4" />
                                </Link>
                              )}
                              {template.status !== 'Archived' && (
                                <button
                                  onClick={() => handleArchive(template.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                  title="Archive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                              {template.status === 'Archived' && (
                                <button
                                  onClick={() => handleUnarchive(template.id)}
                                  className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                                  title="Unarchive"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
