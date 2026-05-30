'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { WpType, Template } from '../../types';
import { getWpTypes } from '../../api/wpApi';
import { getDivisions } from '../../api/taskApi';
import { apiClient } from '../../api/client';
import toast from 'react-hot-toast';
import { Info } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WpFormValues {
  name: string;
  type: string;
  divisionId: number | '';
  timeframeFrom: string;
  timeframeTo: string;
  checkTemplateId: number | '';
}

interface WorkPackageFormProps {
  initial?: Partial<WpFormValues>;
  submitting: boolean;
  onSubmit: (values: WpFormValues) => void;
  onCancel: () => void;
  submitLabel?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkPackageForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
  submitLabel = 'Create Work Package',
}: WorkPackageFormProps) {
  const { user } = useAuthStore();

  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const [divisionId, setDivisionId] = useState<number | ''>(initial?.divisionId ?? user?.divisionId ?? '');
  const [timeframeFrom, setTimeframeFrom] = useState(initial?.timeframeFrom ?? '');
  const [timeframeTo, setTimeframeTo] = useState(initial?.timeframeTo ?? '');
  const [checkTemplateId, setCheckTemplateId] = useState<number | ''>(initial?.checkTemplateId ?? '');

  const [wpTypes, setWpTypes] = useState<WpType[]>([]);
  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [publishedTemplates, setPublishedTemplates] = useState<Template[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [typesData, divsData, tplRes] = await Promise.all([
          getWpTypes(),
          getDivisions(),
          apiClient.get('/templates'),
        ]);
        setWpTypes(typesData);
        setDivisions(divsData);
        const published = (tplRes.data as Template[]).filter((t) => t.status === 'Published');
        setPublishedTemplates(published);
      } catch {
        toast.error('Failed to load form data');
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!type) { toast.error('WP Type is required'); return; }
    if (!divisionId) { toast.error('Division is required'); return; }
    if (!timeframeFrom) { toast.error('Start date is required'); return; }
    if (!timeframeTo) { toast.error('End date is required'); return; }
    if (timeframeFrom >= timeframeTo) { toast.error('Start date must be before end date'); return; }
    if (type === 'CHECK' && !checkTemplateId) { toast.error('CHECK type requires a Check Template'); return; }

    onSubmit({ name: name.trim(), type, divisionId, timeframeFrom, timeframeTo, checkTemplateId });
  };

  const isCheckType = type === 'CHECK';

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Core details */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">Work Package Details</h2>

        {/* Name */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-name">
            Name *
          </label>
          <input
            id="wp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q3 Line Maintenance Audit"
            required
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-type">
            Type *
          </label>
          <select
            id="wp-type"
            value={type}
            onChange={(e) => { setType(e.target.value); setCheckTemplateId(''); }}
            required
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
          >
            <option value="">Select type...</option>
            {wpTypes.map((t) => (
              <option key={t.id} value={t.code}>
                {t.code}{t.description ? ` — ${t.description}` : ''}
              </option>
            ))}
          </select>
          {wpTypes.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" /> No WP types configured. An Admin must add types first.
            </p>
          )}
        </div>

        {/* Division */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-division">
            Division *
          </label>
          <select
            id="wp-division"
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value ? Number(e.target.value) : '')}
            required
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
          >
            <option value="">Select division...</option>
            {divisions.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        {/* CHECK template — only when type=CHECK */}
        {isCheckType && (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-check-template">
              Check Template * <span className="font-normal text-slate-500">(daily tasks will be generated from this template)</span>
            </label>
            <select
              id="wp-check-template"
              value={checkTemplateId}
              onChange={(e) => setCheckTemplateId(e.target.value ? Number(e.target.value) : '')}
              required
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            >
              <option value="">Select a published template...</option>
              {publishedTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.templateId} — {t.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Timeframe */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">Timeframe</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-from">
              Start Date *
            </label>
            <input
              id="wp-from"
              type="date"
              value={timeframeFrom}
              onChange={(e) => setTimeframeFrom(e.target.value)}
              required
              max="9999-12-31"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="wp-to">
              End Date *
            </label>
            <input
              id="wp-to"
              type="date"
              value={timeframeTo}
              min={timeframeFrom || undefined}
              max="9999-12-31"
              onChange={(e) => setTimeframeTo(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-sm transition-all"
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>
  );
}
