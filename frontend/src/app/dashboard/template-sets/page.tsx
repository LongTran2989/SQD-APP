'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { TemplateSet } from '../../../types';
import { getTemplateSets, disableTemplateSet } from '../../../api/templateSetApi';
import TemplateSetForm from '../../../components/template-sets/TemplateSetForm';
import toast from 'react-hot-toast';
import { Plus, Layers, Pencil, Ban, Building2 } from 'lucide-react';

const MANAGER_ROLES = ['Manager', 'Director', 'Admin'];

export default function TemplateSetsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canManage = user ? MANAGER_ROLES.includes(user.role) : false;
  const isGlobal = user ? ['Admin', 'Director'].includes(user.role) : false;

  const [sets, setSets] = useState<TemplateSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showActive, setShowActive] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; editId?: number }>({ open: false });

  // Managers can only act on their own division's sets.
  const canManageSet = (s: TemplateSet) => canManage && (isGlobal || s.divisionId === user?.divisionId);

  const fetchSets = useCallback(async () => {
    setLoading(true);
    try {
      setSets(await getTemplateSets(showActive ? { activeOnly: true } : undefined));
    } catch {
      toast.error('Failed to load template sets');
    } finally {
      setLoading(false);
    }
  }, [showActive]);

  useEffect(() => {
    if (user && !MANAGER_ROLES.includes(user.role)) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  useEffect(() => { fetchSets(); }, [fetchSets]);

  const handleDisable = async (s: TemplateSet) => {
    if (!confirm(`Disable template set "${s.name}"? Work Packages already using it keep their generated tasks.`)) return;
    try {
      await disableTemplateSet(s.id);
      toast.success('Template set disabled');
      fetchSets();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to disable template set');
    }
  };

  if (!user || !MANAGER_ROLES.includes(user.role)) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <Layers className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Template Sets</h1>
            <p className="text-slate-500 mt-0.5 text-sm">Reusable ordered template lists for single-shot auto-generation</p>
          </div>
        </div>
        <button onClick={() => setModal({ open: true })}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm transition-all">
          <Plus className="w-4 h-4" /> New Set
        </button>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={showActive} onChange={(e) => setShowActive(e.target.checked)} />
        Show active only
      </label>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
        </div>
      ) : sets.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
          <Layers className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No template sets yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
          {sets.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800 truncate">{s.name}</span>
                  {!s.isActive && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Disabled</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                  <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{s.division?.name ?? `Division ${s.divisionId}`}</span>
                  <span>{s._count?.items ?? s.items?.length ?? 0} template(s)</span>
                  {s.owner?.name && <span>· {s.owner.name}</span>}
                </div>
                {s.description && <p className="text-sm text-slate-500 mt-1 truncate">{s.description}</p>}
              </div>
              {canManageSet(s) && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setModal({ open: true, editId: s.id })}
                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" aria-label="Edit">
                    <Pencil className="w-4 h-4" />
                  </button>
                  {s.isActive && (
                    <button onClick={() => handleDisable(s)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" aria-label="Disable">
                      <Ban className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal.open && (
        <TemplateSetForm
          editId={modal.editId}
          onClose={() => setModal({ open: false })}
          onSaved={() => { setModal({ open: false }); fetchSets(); }}
        />
      )}
    </div>
  );
}
