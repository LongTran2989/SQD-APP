'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { WpBlueprint } from '../../../types';
import { getWpBlueprints, disableWpBlueprint } from '../../../api/wpBlueprintApi';
import WpBlueprintForm from '../../../components/wp-blueprints/WpBlueprintForm';
import LaunchBlueprintDialog from '../../../components/wp-blueprints/LaunchBlueprintDialog';
import toast from 'react-hot-toast';
import { Plus, ClipboardList, Pencil, Ban, Building2, Rocket, Repeat } from 'lucide-react';

const MANAGER_ROLES = ['Manager', 'Director', 'Admin'];

export default function WpBlueprintsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canManage = user ? MANAGER_ROLES.includes(user.role) : false;
  const isGlobal = user ? ['Admin', 'Director'].includes(user.role) : false;

  const [blueprints, setBlueprints] = useState<WpBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showActive, setShowActive] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; editId?: number }>({ open: false });
  const [launching, setLaunching] = useState<WpBlueprint | null>(null);

  const canManageBp = (b: WpBlueprint) => canManage && (isGlobal || b.divisionId === user?.divisionId);

  const fetchBlueprints = useCallback(async () => {
    setLoading(true);
    try {
      setBlueprints(await getWpBlueprints(showActive ? { activeOnly: true } : undefined));
    } catch {
      toast.error('Failed to load blueprints');
    } finally {
      setLoading(false);
    }
  }, [showActive]);

  useEffect(() => {
    if (user && !MANAGER_ROLES.includes(user.role)) router.replace('/dashboard');
  }, [user, router]);

  useEffect(() => { fetchBlueprints(); }, [fetchBlueprints]);

  const handleDisable = async (b: WpBlueprint) => {
    if (!confirm(`Disable blueprint "${b.name}"? Work Packages already launched from it are unaffected.`)) return;
    try {
      await disableWpBlueprint(b.id);
      toast.success('Blueprint disabled');
      fetchBlueprints();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to disable blueprint');
    }
  };

  if (!user || !MANAGER_ROLES.includes(user.role)) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">WP Blueprints</h1>
            <p className="text-slate-500 mt-0.5 text-sm">Reusable Work Package templates you can launch on demand</p>
          </div>
        </div>
        <button onClick={() => setModal({ open: true })} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm transition-all">
          <Plus className="w-4 h-4" /> New Blueprint
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
      ) : blueprints.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
          <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No blueprints yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
          {blueprints.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800 truncate">{b.name}</span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{b.type}</span>
                  {!b.isActive && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Disabled</span>}
                  {b.defaultAutoGenerate && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 inline-flex items-center gap-1">
                      <Repeat className="w-3 h-3" /> auto-gen
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                  <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{b.division?.name ?? `Division ${b.divisionId}`}</span>
                  <span>{b.defaultDuration} day(s)</span>
                  <span>· {b._count?.instances ?? 0} launched</span>
                </div>
                {b.description && <p className="text-sm text-slate-500 mt-1 truncate">{b.description}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {b.isActive && canManageBp(b) && (
                  <button onClick={() => setLaunching(b)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
                    <Rocket className="w-3.5 h-3.5" /> Launch
                  </button>
                )}
                {canManageBp(b) && (
                  <>
                    <button onClick={() => setModal({ open: true, editId: b.id })} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" aria-label="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    {b.isActive && (
                      <button onClick={() => handleDisable(b)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" aria-label="Disable">
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && (
        <WpBlueprintForm editId={modal.editId} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); fetchBlueprints(); }} />
      )}
      {launching && (
        <LaunchBlueprintDialog blueprint={launching} onClose={() => setLaunching(null)} onLaunched={(wpId) => router.push(`/dashboard/work-packages/${wpId}`)} />
      )}
    </div>
  );
}
