'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../../../store/authStore';
import { FindingListItem, FindingStatus, FindingSeverity } from '../../../types';
import { listFindings } from '../../../api/findingApi';
import { getDivisions, getUsers } from '../../../api/taskApi';
import {
  SeverityBadge,
  FindingStatusBadge,
  FINDING_STATUS_CONFIG,
  SEVERITY_CONFIG,
} from '../../../components/findings/FindingBadges';
import toast from 'react-hot-toast';
import { AlertTriangle, Eye, ClipboardList } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_STATUSES: FindingStatus[] = ['Open', 'In Progress', 'Pending Verification', 'Closed'];
const ALL_SEVERITIES: FindingSeverity[] = ['Observation', 'Level 1', 'Level 2'];
const MANAGER_ROLES = ['Manager', 'Director', 'Admin'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FindingsListPage() {
  const { user } = useAuthStore();
  const canFilterAdvanced = !!user && MANAGER_ROLES.includes(user.role);

  const [findings, setFindings] = useState<FindingListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<FindingStatus | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');
  const [divisionFilter, setDivisionFilter] = useState<string>('all');
  const [reporterFilter, setReporterFilter] = useState<string>('all');

  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [users, setUsers] = useState<{ value: string; label: string }[]>([]);

  // Load filter option lists (Manager/Director only).
  useEffect(() => {
    if (!canFilterAdvanced) return;
    getDivisions().then(setDivisions).catch(() => {});
    getUsers().then(setUsers).catch(() => {});
  }, [canFilterAdvanced]);

  const fetchFindings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFindings({
        status: statusFilter === 'all' ? undefined : statusFilter,
        severity: severityFilter === 'all' ? undefined : severityFilter,
        divisionId: divisionFilter === 'all' ? undefined : Number(divisionFilter),
        reportedBy: reporterFilter === 'all' ? undefined : Number(reporterFilter),
        pageSize: 100,
      });
      setFindings(res.findings);
    } catch {
      toast.error('Failed to load findings');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, divisionFilter, reporterFilter]);

  useEffect(() => {
    fetchFindings();
  }, [fetchFindings]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Findings</h1>
          <p className="text-slate-500 mt-1">Non-conformance records and corrective action tracking</p>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Filter bar */}
        <div className="p-4 flex flex-col gap-4 border-b border-slate-100">
          {/* Status pills */}
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
            {ALL_STATUSES.map((s) => {
              const cfg = FINDING_STATUS_CONFIG[s];
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

          {/* Severity pills + advanced filters */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide mr-1">Severity</span>
              <button
                onClick={() => setSeverityFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  severityFilter === 'all'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                All
              </button>
              {ALL_SEVERITIES.map((s) => {
                const cfg = SEVERITY_CONFIG[s];
                const isActive = severityFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(isActive ? 'all' : s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      isActive ? cfg.color + ' border-current' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>

            {canFilterAdvanced && (
              <div className="flex items-center gap-3 sm:ml-auto">
                <select
                  value={divisionFilter}
                  onChange={(e) => setDivisionFilter(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All divisions</option>
                  {divisions.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
                <select
                  value={reporterFilter}
                  onChange={(e) => setReporterFilter(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All reporters</option>
                  {users.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
          </div>
        ) : findings.length === 0 ? (
          <div className="p-12 text-center">
            <AlertTriangle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">No findings</h2>
            <p className="text-slate-500">No findings match your current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Finding</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Source Task</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Severity</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Due Date</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Reported By</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Created</th>
                  <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {findings.map((f) => (
                  <tr
                    key={f.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      f.status === 'Pending Verification' ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <td className="p-4 align-middle">
                      <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-bold font-mono border border-slate-200">
                        #{f.id}
                      </span>
                      <div className="text-xs text-slate-400 mt-1">{f.eventType}</div>
                    </td>
                    <td className="p-4 align-middle max-w-xs">
                      <div className="text-sm text-slate-700 truncate">{f.description}</div>
                    </td>
                    <td className="p-4 align-middle">
                      {f.sourceTask ? (
                        <Link
                          href={`/dashboard/tasks/${f.sourceTask.id}`}
                          className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-blue-600 hover:text-blue-700"
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                          {f.sourceTask.taskId}
                        </Link>
                      ) : (
                        <span className="text-slate-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="p-4 align-middle">
                      <SeverityBadge severity={f.severity} />
                    </td>
                    <td className="p-4 align-middle">
                      <FindingStatusBadge status={f.status} />
                    </td>
                    <td className="p-4 align-middle text-sm">
                      <span className={f.dueDateBreached ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                        {formatDate(f.dueDate)}
                      </span>
                    </td>
                    <td className="p-4 align-middle text-sm text-slate-600">
                      {f.reportedByUser?.name ?? '—'}
                    </td>
                    <td className="p-4 align-middle text-sm text-slate-600 whitespace-nowrap">
                      {formatDate(f.createdAt)}
                    </td>
                    <td className="p-4 align-middle">
                      <div className="flex items-center justify-end">
                        <Link
                          href={`/dashboard/findings/${f.id}`}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View Finding"
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
