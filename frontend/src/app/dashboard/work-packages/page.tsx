'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../../../store/authStore';
import { WorkPackageEnriched, WpStatus } from '../../../types';
import { getWorkPackages } from '../../../api/wpApi';
import WorkPackageStatusBadge, { WP_STATUS_CONFIG } from '../../../components/work-packages/WorkPackageStatusBadge';
import toast from 'react-hot-toast';
import {
  Plus,
  Search,
  FolderOpen,
  Eye,
  CalendarRange,
  Users,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const WP_MANAGER_ROLES = ['Manager', 'Director', 'Admin'];
const ALL_WP_STATUSES: WpStatus[] = ['Open', 'In Progress', 'Overdue', 'Closed', 'Inactive'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkPackageListPage() {
  const { user } = useAuthStore();

  const [wps, setWps] = useState<WorkPackageEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<WpStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchWps = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWorkPackages();
      setWps(data);
    } catch {
      toast.error('Failed to load work packages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWps();
  }, [fetchWps]);

  const filtered = wps.filter((wp) => {
    if (statusFilter !== 'all' && wp.computedStatus !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        wp.wpId.toLowerCase().includes(q) ||
        wp.name.toLowerCase().includes(q) ||
        wp.type.toLowerCase().includes(q) ||
        (wp.division?.name ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const canCreate = user && WP_MANAGER_ROLES.includes(user.role);

  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Work Packages</h1>
          <p className="text-slate-500 mt-1">Manage audit work packages and track task progress</p>
        </div>
        {canCreate && (
          <Link
            href="/dashboard/work-packages/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm transition-all"
          >
            <Plus className="w-5 h-5" />
            New Work Package
          </Link>
        )}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">

        {/* Filter bar */}
        <div className="p-4 flex flex-col sm:flex-row gap-3 border-b border-slate-100">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by WP ID, name, type, or division..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* Status filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                statusFilter === 'all'
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              All
            </button>
            {ALL_WP_STATUSES.map((s) => {
              const cfg = WP_STATUS_CONFIG[s];
              const isActive = statusFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(isActive ? 'all' : s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    isActive ? cfg.color + ' border-current' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">
              {wps.length === 0 ? 'No work packages yet' : 'No matching work packages'}
            </h2>
            <p className="text-slate-500">
              {wps.length === 0
                ? canCreate
                  ? 'Create your first work package to get started.'
                  : 'No work packages have been created yet.'
                : 'Try adjusting your search or filter criteria.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">WP ID</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Division</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeframe</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Assigned</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tasks</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((wp) => (
                  <tr key={wp.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* WP ID */}
                    <td className="p-4 align-middle">
                      <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-bold font-mono border border-slate-200">
                        {wp.wpId}
                      </span>
                    </td>

                    {/* Name */}
                    <td className="p-4 align-middle max-w-xs">
                      <div className="font-medium text-slate-800 truncate">{wp.name}</div>
                      {wp.creator && (
                        <div className="text-xs text-slate-400 mt-0.5">by {wp.creator.name}</div>
                      )}
                    </td>

                    {/* Type */}
                    <td className="p-4 align-middle">
                      <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-semibold border border-purple-100">
                        {wp.type}
                      </span>
                    </td>

                    {/* Division */}
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {wp.division?.name ?? '—'}
                    </td>

                    {/* Timeframe */}
                    <td className="p-4 align-middle text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <CalendarRange className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="whitespace-nowrap">
                          {formatDate(wp.timeframeFrom)} – {formatDate(wp.timeframeTo)}
                        </span>
                      </div>
                    </td>

                    {/* Assigned users */}
                    <td className="p-4 align-middle text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        {wp.assignments.length}
                      </div>
                    </td>

                    {/* Task count */}
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {wp._count.tasks}
                    </td>

                    {/* Status */}
                    <td className="p-4 align-middle">
                      <WorkPackageStatusBadge status={wp.computedStatus} />
                    </td>

                    {/* Actions */}
                    <td className="p-4 align-middle">
                      <div className="flex items-center justify-end">
                        <Link
                          href={`/dashboard/work-packages/${wp.id}`}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View Work Package"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
