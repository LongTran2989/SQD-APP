'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Template } from '../../types';
import { searchTemplates } from '../../api/templateApi';
import { ALL_TEMPLATE_TYPES, STANDALONE_TEMPLATE_TYPES, AUD_TEMPLATE_TYPES, SI_TEMPLATE_TYPES } from '../../constants/templateTypes';
import { apiClient } from '../../api/client';
import { Search, X, Clock, BarChart2, ChevronDown, Loader2 } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Division {
  value: string;
  label: string;
}

export interface TemplatePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (template: Template) => void;
  /** Template IDs to exclude (e.g. already added to a TemplateSet) */
  excludeTemplateIds?: number[];
}

// ─── Skill level labels ──────────────────────────────────────────────────────
const SKILL_LABELS = ['Entry', 'Junior', 'Intermediate', 'Senior', 'Expert'];

// ─── Type option groups for the filter dropdown ──────────────────────────────
const TYPE_GROUPS = [
  { label: 'Standalone', options: STANDALONE_TEMPLATE_TYPES },
  { label: 'Audit (AUD)', options: AUD_TEMPLATE_TYPES },
  { label: 'Surveillance (SI)', options: SI_TEMPLATE_TYPES },
];

// ─── Skeleton card ───────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="animate-pulse border border-slate-200 rounded-xl p-4 space-y-2">
      <div className="flex gap-2">
        <div className="h-5 w-16 bg-slate-200 rounded" />
        <div className="h-5 w-12 bg-slate-200 rounded" />
      </div>
      <div className="h-4 w-3/4 bg-slate-200 rounded" />
      <div className="h-3 w-full bg-slate-100 rounded" />
    </div>
  );
}

// ─── Template card ────────────────────────────────────────────────────────────
function TemplateCard({
  template,
  onSelect,
  excluded,
}: {
  template: Template;
  onSelect: (t: Template) => void;
  excluded: boolean;
}) {
  return (
    <button
      onClick={() => !excluded && onSelect(template)}
      disabled={excluded}
      className={`w-full text-left border rounded-xl p-4 transition-all group ${
        excluded
          ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
          : 'border-slate-200 hover:border-blue-400 hover:shadow-md bg-white cursor-pointer'
      }`}
    >
      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          {template.templateId}
        </span>
        {template.externalRef && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-slate-100 text-slate-500 border border-slate-200" title="External Reference">
            Ref: {template.externalRef}
          </span>
        )}
        {template.type && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
            {template.type}
          </span>
        )}
        {(template.division as any)?.name && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
            {(template.division as any).name}
          </span>
        )}
        {excluded && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-600">
            Already added
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-700 leading-tight mb-1">
        {template.title}
      </p>

      {/* Description snippet */}
      {template.description && (
        <p className="text-xs text-slate-500 line-clamp-2 mb-2">{template.description}</p>
      )}

      {/* Footer chips */}
      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
        {template.estimatedHours != null && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {template.estimatedHours}h
          </span>
        )}
        {template.skillLevel > 0 && (
          <span className="flex items-center gap-1">
            <BarChart2 className="w-3 h-3" />
            {SKILL_LABELS[template.skillLevel] ?? `Level ${template.skillLevel}`}
          </span>
        )}
        {template.formSchema?.length > 0 && (
          <span>{template.formSchema.length} field{template.formSchema.length !== 1 ? 's' : ''}</span>
        )}
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TemplatePickerModal({
  open,
  onClose,
  onSelect,
  excludeTemplateIds = [],
}: TemplatePickerModalProps) {
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState<string>('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LIMIT = 20;

  // Load divisions once on mount
  useEffect(() => {
    apiClient
      .get('/datasources/divisions')
      .then((r: any) => setDivisions(r.data as Division[]))
      .catch(() => {});
  }, []);

  // Debounced search effect
  const doSearch = useCallback(
    (searchQ: string, searchType: string, searchDiv: string, searchPage: number, append = false) => {
      if (searchPage === 1 && !append) setLoading(true);
      else setLoadingMore(true);

      const params: Record<string, unknown> = {
        status: 'Published',
        limit: LIMIT,
        page: searchPage,
      };
      if (searchQ)    params['q']          = searchQ;
      if (searchType) params['type']        = searchType;
      if (searchDiv)  params['divisionId']  = parseInt(searchDiv, 10);

      searchTemplates(params as any)
        .then((result) => {
          setTotal(result.total);
          setTemplates((prev) => (append ? [...prev, ...result.data] : result.data));
        })
        .catch(() => {
          if (!append) setTemplates([]);
        })
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    []
  );

  // Re-search when filters change (debounced on q, immediate on type/div)
  useEffect(() => {
    if (!open) return;
    if (searchRef.current) clearTimeout(searchRef.current);
    setPage(1);
    searchRef.current = setTimeout(() => {
      doSearch(q, typeFilter, divisionFilter, 1, false);
    }, 300);
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, [open, q, typeFilter, divisionFilter, doSearch]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setQ('');
      setTypeFilter('');
      setDivisionFilter('');
      setPage(1);
    }
  }, [open]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    doSearch(q, typeFilter, divisionFilter, nextPage, true);
  };

  const clearFilters = () => {
    setQ('');
    setTypeFilter('');
    setDivisionFilter('');
  };

  const hasFilters = q || typeFilter || divisionFilter;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-lg font-bold text-slate-800">Select a Template</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search + Filters */}
        <div className="px-6 pt-4 pb-3 border-b border-slate-100 flex-shrink-0 space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by title…"
              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter row */}
          <div className="flex gap-2">
            {/* Division filter */}
            <div className="relative flex-1">
              <select
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm appearance-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white pr-8"
              >
                <option value="">All Divisions</option>
                {divisions.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>

            {/* Type filter */}
            <div className="relative flex-1">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm appearance-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white pr-8"
              >
                <option value="">All Types</option>
                {TYPE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                <Search className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-600 mb-1">No templates found</p>
              <p className="text-xs text-slate-400 mb-4">
                {hasFilters ? 'Try different search terms or filters' : 'No published templates available'}
              </p>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-400 pb-1">
                {total} template{total !== 1 ? 's' : ''} found
              </p>
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onSelect={(selected) => { onSelect(selected); onClose(); }}
                  excluded={excludeTemplateIds.includes(t.id)}
                />
              ))}

              {/* Load more */}
              {templates.length < total && (
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-full py-3 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading…
                    </>
                  ) : (
                    `Load more (${total - templates.length} remaining)`
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
