'use client';

import { useState } from 'react';
import { X, Rocket, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { WpBlueprint } from '../../types';
import { launchBlueprint } from '../../api/wpBlueprintApi';

interface LaunchBlueprintDialogProps {
  blueprint: WpBlueprint;
  onClose: () => void;
  onLaunched: (wpId: number) => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function LaunchBlueprintDialog({ blueprint, onClose, onLaunched }: LaunchBlueprintDialogProps) {
  const [name, setName] = useState(blueprint.name);
  const [timeframeFrom, setTimeframeFrom] = useState(todayStr());
  // Track whether the user has manually edited the end date; until then it
  // auto-follows from + defaultDuration.
  const [toEdited, setToEdited] = useState(false);
  const [timeframeTo, setTimeframeTo] = useState(addDays(todayStr(), blueprint.defaultDuration));
  const [submitting, setSubmitting] = useState(false);

  const onFromChange = (v: string) => {
    setTimeframeFrom(v);
    if (!toEdited && v) setTimeframeTo(addDays(v, blueprint.defaultDuration));
  };

  const autogenSummary = !blueprint.defaultAutoGenerate
    ? 'Off'
    : blueprint.defaultAutoGenMode === 'REPEAT'
      ? `Repeat · every ${blueprint.defaultAutoGenInterval ?? 1} day(s) · ${blueprint.defaultAutoGenTemplate?.templateId ?? `template #${blueprint.defaultAutoGenTemplateId}`}`
      : blueprint.defaultAutoGenSetId
        ? `Single shot · set "${blueprint.defaultAutoGenSet?.name ?? blueprint.defaultAutoGenSetId}"`
        : `Single shot · ${blueprint.defaultAutoGenTemplate?.templateId ?? `template #${blueprint.defaultAutoGenTemplateId}`}`;

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!timeframeFrom || !timeframeTo) { toast.error('Both dates are required'); return; }
    if (timeframeFrom >= timeframeTo) { toast.error('Start date must be before end date'); return; }

    setSubmitting(true);
    try {
      const wp = await launchBlueprint(blueprint.id, { name: name.trim(), timeframeFrom, timeframeTo });
      toast.success(`Work Package ${wp.wpId} launched`);
      onLaunched(wp.id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Failed to launch blueprint');
      setSubmitting(false);
    }
  };

  const field = 'w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm';
  const labelCls = 'block text-sm font-semibold text-slate-700 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Rocket className="w-4 h-4 text-blue-600" /> Launch &ldquo;{blueprint.name}&rdquo;
          </h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleLaunch} className="p-6 space-y-5">
          <div>
            <label className={labelCls} htmlFor="launch-name">Work Package name *</label>
            <input id="launch-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="launch-from">Start date *</label>
              <input id="launch-from" type="date" value={timeframeFrom} max="9999-12-31" onChange={(e) => onFromChange(e.target.value)} className={field} />
            </div>
            <div>
              <label className={labelCls} htmlFor="launch-to">End date *</label>
              <input id="launch-to" type="date" value={timeframeTo} min={timeframeFrom || undefined} max="9999-12-31"
                onChange={(e) => { setToEdited(true); setTimeframeTo(e.target.value); }} className={field} />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-slate-500">Type</span><span className="font-medium text-slate-700">{blueprint.type}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Auto-generate</span><span className="font-medium text-slate-700 text-right">{autogenSummary}</span></div>
            <p className="text-xs text-slate-400 flex items-start gap-1.5 pt-1">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Auto-generate settings are inherited from the blueprint and can be edited on the Work Package after launch.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors">Cancel</button>
            <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-sm transition-all">
              <Rocket className="w-4 h-4" /> {submitting ? 'Launching...' : 'Launch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
