'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../api/client';
import { Template } from '../../../../types';
import { useAuthStore } from '../../../../store/authStore';
import toast from 'react-hot-toast';
import RevisionHistoryPanel from '../../../../components/templates/RevisionHistoryPanel';
import TransferOwnershipModal from '../../../../components/templates/TransferOwnershipModal';
import RichTextEditor from '../../../../components/ui/RichTextEditor';
import { 
  ArrowLeft, Edit, Copy, CheckCircle2, Clock, Archive, 
  Settings, User, ChevronRight, History, Trash2, Repeat, RotateCcw
} from 'lucide-react';

const statusConfig = {
  Draft: { color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock, label: 'Draft' },
  Published: { color: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle2, label: 'Published' },
  Archived: { color: 'bg-slate-100 text-slate-500 border-slate-200', icon: Archive, label: 'Archived' },
};

const fieldTypeLabels: Record<string, string> = {
  text: 'Text Input',
  textarea: 'Text Area',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  radio: 'Radio',
  checkbox_group: 'Checkboxes',
  checkbox_single: 'Toggle',
};

export default function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const templateId = parseInt(resolvedParams.id, 10);
  
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const { user } = useAuthStore();

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

  const handleArchive = async () => {
    if (!window.confirm('This template will be archived and can no longer generate new Tasks. All existing Tasks are unaffected.')) return;
    try {
      await apiClient.patch(`/templates/${templateId}/archive`);
      toast.success('Template archived successfully');
      fetchTemplate();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to archive template');
    }
  };

  const handleUnarchive = async () => {
    if (!window.confirm('Are you sure you want to unarchive this template? It will be restored as a Draft.')) return;
    try {
      await apiClient.patch(`/templates/${templateId}/unarchive`);
      toast.success('Template unarchived successfully');
      fetchTemplate();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to unarchive template');
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

  const config = statusConfig[template.status] || statusConfig.Draft;
  const StatusIcon = config.icon;
  const isOwnerOrPrivileged = user && (user.id === template.ownerId || user.role === 'Admin' || user.role === 'Director');
  const hasDraftPending = template.status === 'Draft' && template.publishedAt;
  const fields = template.formSchema as any[] || [];

  return (
    <div className="max-w-6xl mx-auto pb-12">
      {/* Top Navigation */}
      <Link 
        href="/dashboard/templates" 
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Templates
      </Link>

      {hasDraftPending && isOwnerOrPrivileged && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-amber-800">
            <Clock className="w-5 h-5 text-amber-500" />
            <div>
              <p className="font-semibold text-sm">You have unpublished draft changes</p>
              <p className="text-xs mt-0.5 opacity-90">Resume editing to publish these changes or discard them.</p>
            </div>
          </div>
          <Link
            href={`/dashboard/templates/${template.id}/edit`}
            className="px-4 py-2 bg-amber-100 text-amber-800 hover:bg-amber-200 font-medium text-sm rounded-lg transition-colors"
          >
            Resume Draft
          </Link>
        </div>
      )}

      {/* Header Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded text-sm font-bold font-mono border border-slate-200 shadow-sm">
                {template.templateId}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-full border shadow-sm ${config.color}`}>
                <StatusIcon className="w-4 h-4" />
                {config.label}
              </span>
              {template.hasPendingChanges && (
                <span className="px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 shadow-sm">
                  PENDING CHANGES
                </span>
              )}
              {template.skillLevel > 0 && (
                <span className="px-2 py-1 rounded text-xs font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-sm">
                  SKILL {template.skillLevel}
                </span>
              )}
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-2">
              {template.title}
            </h1>
            
            <p className="text-slate-500 text-base leading-relaxed max-w-3xl">
              {template.description || <span className="italic text-slate-400">No description provided.</span>}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowHistory(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold rounded-xl shadow-sm transition-all"
            >
              <History className="w-4 h-4 text-slate-400" />
              History
            </button>
            {isOwnerOrPrivileged && (
              <>
                <button
                  onClick={() => setShowTransfer(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-amber-600 hover:bg-amber-50 hover:border-amber-200 font-semibold rounded-xl shadow-sm transition-all"
                  title="Transfer Ownership"
                >
                  <Repeat className="w-4 h-4" />
                </button>
                {template.status !== 'Archived' && (
                  <>
                    <Link
                      href={`/dashboard/templates/${template.id}/edit`}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm transition-all"
                    >
                      <Edit className="w-4 h-4" />
                      Edit Template
                    </Link>
                    <button
                      onClick={handleArchive}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-red-600 hover:bg-red-50 hover:border-red-200 font-semibold rounded-xl shadow-sm transition-all"
                      title="Archive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                {template.status === 'Archived' && (
                  <button
                    onClick={handleUnarchive}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-green-600 hover:bg-green-50 hover:border-green-200 font-semibold rounded-xl shadow-sm transition-all"
                    title="Unarchive"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Unarchive
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <hr className="my-6 border-slate-100" />

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Revision</p>
            <p className="font-semibold text-slate-800">{template.revision}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Division</p>
            <p className="font-medium text-slate-700">{template.division?.name || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Type</p>
            <p className="font-medium text-slate-700">{template.type || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Est. Time</p>
            <p className="font-medium text-slate-700">{template.estimatedHours ? `${template.estimatedHours}h` : '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Owner</p>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <User className="w-3 h-3 text-slate-400" />
              </div>
              <p className="font-medium text-slate-700 truncate">{template.owner?.name || '—'}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Last Updated By</p>
            <p className="font-medium text-slate-700 truncate">{template.revisedByUser?.name || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Last Updated</p>
            <p className="font-medium text-slate-700">
              {new Date(template.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Published</p>
            <p className="font-medium text-slate-700">
              {template.publishedAt ? new Date(template.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}
            </p>
          </div>
        </div>

        {/* Configuration Pills */}
        <div className="flex flex-wrap items-center gap-3 mt-6 pt-6 border-t border-slate-100">
          <p className="text-sm font-semibold text-slate-500 mr-2">Configuration:</p>
          {template.requiresApproval ? (
            <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold border border-blue-100 shadow-sm flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Requires Approval
            </span>
          ) : (
            <span className="px-3 py-1 bg-slate-50 text-slate-500 rounded-full text-xs font-bold border border-slate-200 shadow-sm flex items-center gap-1">
              <Archive className="w-3.5 h-3.5" /> No Approval Required
            </span>
          )}

          {template.allowsFindings ? (
            <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-100 shadow-sm flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Findings Enabled
            </span>
          ) : (
            <span className="px-3 py-1 bg-slate-50 text-slate-500 rounded-full text-xs font-bold border border-slate-200 shadow-sm flex items-center gap-1">
              <Archive className="w-3.5 h-3.5" /> Findings Disabled
            </span>
          )}
        </div>
      </div>

      {/* Field Viewer */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Form Fields</h2>
            <p className="text-sm text-slate-500 mt-0.5">Read-only view of the template fields</p>
          </div>
          <div className="text-sm font-medium text-slate-500">
            {fields.length} {fields.length === 1 ? 'field' : 'fields'} total
          </div>
        </div>

        <div className="p-6">
          {fields.length === 0 ? (
            <div className="text-center py-12">
              <Settings className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">No fields defined yet</p>
              <p className="text-slate-400 text-sm mt-1">Edit the template to add form fields.</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-3xl">
              {fields.map((f: any, i: number) => (
                <div key={f.fieldId || i} className="opacity-90 pointer-events-none p-4 rounded-xl border border-slate-100 bg-slate-50">
                  <label className="block text-sm font-semibold text-slate-800">
                    {f.label} {f.required && <span className="text-red-500">*</span>}
                  </label>
                  {f.helpText && <p className="text-xs text-slate-500 mb-1">{f.helpText}</p>}
                  
                  {f.type === 'text' && <input type="text" className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white mt-1" placeholder="Text input" disabled />}
                  {f.type === 'number' && <input type="number" className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white mt-1" placeholder="0" disabled />}
                  {f.type === 'date' && <input type="date" className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white mt-1" max="9999-12-31" disabled />}
                  {f.type === 'textarea' && <textarea className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white mt-1" rows={3} placeholder="Text area" disabled />}
                  {f.type === 'select' && (
                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white mt-1" disabled>
                      <option>{f.dataSource === 'custom' ? (f.options?.[0] || 'Select...') : `Dynamic ${f.dataSource}`}</option>
                    </select>
                  )}
                  {f.type === 'radio' && (
                    <div className="space-y-2 mt-2">
                      {(f.options || []).map((o: string, idx: number) => (
                        <label key={idx} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="radio" disabled className="w-4 h-4" /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                  {f.type === 'checkbox_group' && (
                    <div className="space-y-2 mt-2">
                      {(f.options || []).map((o: string, idx: number) => (
                        <label key={idx} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" disabled className="w-4 h-4 rounded" /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                  {f.type === 'checkbox_single' && (
                    <label className="flex items-center gap-2 text-sm text-slate-700 mt-2">
                      <input type="checkbox" disabled className="w-4 h-4 rounded" /> Yes/No
                    </label>
                  )}
                  {f.type === 'rich_text' && (
                    <div className="pointer-events-none mt-1">
                      <RichTextEditor value="" disabled />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showHistory && (
        <RevisionHistoryPanel
          revisions={template.revisionArchives || []}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showTransfer && (
        <TransferOwnershipModal
          templateId={template.id}
          currentOwnerId={template.ownerId}
          onClose={() => setShowTransfer(false)}
          onTransfer={(newOwner) => {
            setTemplate({ ...template, ownerId: newOwner.id, owner: newOwner });
            setShowTransfer(false);
          }}
        />
      )}
    </div>
  );
}
