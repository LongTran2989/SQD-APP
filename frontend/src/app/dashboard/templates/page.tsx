'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiClient } from '../../../api/client';
import { Template } from '../../../types';
import { 
  Plus, 
  FileCheck2, 
  Clock, 
  CheckCircle2, 
  Archive, 
  ChevronRight,
  Search,
  Filter
} from 'lucide-react';

const statusConfig = {
  Draft: { color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock, label: 'Draft' },
  Published: { color: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle2, label: 'Published' },
  Archived: { color: 'bg-slate-100 text-slate-500 border-slate-200', icon: Archive, label: 'Archived' },
};

export default function TemplateListPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const response = await apiClient.get('/templates');
      setTemplates(response.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const filteredTemplates = templates.filter((t) => {
    const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Template Builder</h1>
          <p className="text-slate-500 mt-1">Create and manage QA audit templates</p>
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

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded-r">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Templates Grid */}
      {filteredTemplates.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl shadow-sm border border-slate-100 text-center">
          <FileCheck2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-2">
            {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
          </h2>
          <p className="text-slate-500 mb-6">
            {templates.length === 0
              ? 'Create your first QA audit template to get started.'
              : 'Try adjusting your search or filter criteria.'}
          </p>
          {templates.length === 0 && (
            <Link
              href="/dashboard/templates/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm transition-all"
            >
              <Plus className="w-5 h-5" />
              Create Template
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredTemplates.map((template) => {
            const config = statusConfig[template.status] || statusConfig.Draft;
            const StatusIcon = config.icon;
            return (
              <Link
                key={template.id}
                href={`/dashboard/templates/${template.id}`}
                className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-slate-800 truncate">{template.title}</h3>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border ${config.color}`}>
                        <StatusIcon className="w-3 h-3" />
                        {config.label}
                      </span>
                      <span className="text-xs text-slate-400 font-medium">
                        Rev {template.revision}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 truncate">
                      {template.description || 'No description'}
                    </p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                      <span>{(template.formSchema as any[])?.length || 0} fields</span>
                      <span>Updated {new Date(template.updatedAt).toLocaleDateString()}</span>
                      {template.requiresApproval && (
                        <span className="text-blue-500 font-medium">Requires Approval</span>
                      )}
                      {template.allowsFindings && (
                        <span className="text-amber-500 font-medium">Findings Enabled</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors flex-shrink-0 ml-4" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
