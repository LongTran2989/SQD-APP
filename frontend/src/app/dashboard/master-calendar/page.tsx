'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../store/authStore';
import { getOngoingWorks, OngoingWork } from '../../../api/dashboardApi';
import toast from 'react-hot-toast';
import { CalendarClock, Building2, Layers, Briefcase, ClipboardList, Filter, ChevronDown, ChevronUp, AlertTriangle, User, History, ArrowUpDown } from 'lucide-react';

const MANAGER_ROLES = ['Manager', 'Director', 'Admin', 'Staff'];

const STATUS_OPTIONS = ['All', 'Active', 'Scheduled', 'Awaiting Completion', 'Overdue'];
const ENTITY_OPTIONS = ['All', 'Work Packages', 'Tasks', 'Scheduled Blueprints'];

export default function MasterCalendarPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [works, setWorks] = useState<OngoingWork[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [entityFilter, setEntityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  
  const [sortColumn, setSortColumn] = useState<'deadline' | 'status' | 'title' | 'entity'>('deadline');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Backend fetches all active works; we filter locally
      const data = await getOngoingWorks('All');
      setWorks(data);
    } catch {
      toast.error('Failed to load ongoing works');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && !MANAGER_ROLES.includes(user.role)) router.replace('/dashboard');
  }, [user, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isOverdue = (date: string) => new Date(date).getTime() < new Date().setHours(0, 0, 0, 0);

  const filteredAndSortedWorks = useMemo(() => {
    let filtered = works;

    if (entityFilter !== 'All') {
      if (entityFilter === 'Work Packages') filtered = filtered.filter(w => w.type === 'WP');
      if (entityFilter === 'Tasks') filtered = filtered.filter(w => w.type === 'TASK');
      if (entityFilter === 'Scheduled Blueprints') filtered = filtered.filter(w => w.type === 'BLUEPRINT');
    }

    if (statusFilter !== 'All') {
      if (statusFilter === 'Active') filtered = filtered.filter(w => w.status !== 'Scheduled' && w.status !== 'Awaiting Completion' && !isOverdue(w.deadline));
      if (statusFilter === 'Overdue') filtered = filtered.filter(w => isOverdue(w.deadline) && w.status !== 'Awaiting Completion');
      if (statusFilter === 'Scheduled') filtered = filtered.filter(w => w.status === 'Scheduled');
      if (statusFilter === 'Awaiting Completion') filtered = filtered.filter(w => w.status === 'Awaiting Completion');
    }

    return [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortColumn === 'deadline') {
        if (!a.deadline && !b.deadline) comparison = 0;
        else if (!a.deadline) comparison = 1;
        else if (!b.deadline) comparison = -1;
        else comparison = new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      } else if (sortColumn === 'status') {
        comparison = a.status.localeCompare(b.status);
      } else if (sortColumn === 'title') {
        comparison = a.title.localeCompare(b.title);
      } else if (sortColumn === 'entity') {
        comparison = a.type.localeCompare(b.type);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [works, entityFilter, statusFilter, sortColumn, sortDirection]);

  if (!user || !MANAGER_ROLES.includes(user.role)) return null;

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleSort = (col: typeof sortColumn) => {
    if (sortColumn === col) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const renderSortIcon = (col: typeof sortColumn) => {
    if (sortColumn !== col) return <ArrowUpDown className="w-3 h-3 ml-1 inline text-slate-300" />;
    return sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 ml-1 inline text-violet-500" /> : <ChevronDown className="w-3 h-3 ml-1 inline text-violet-500" />;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
            <CalendarClock className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Master Calendar</h1>
            <p className="text-slate-500 mt-0.5 text-sm">Overview of all ongoing works, tasks, and recurring schedules</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Layers className="w-4 h-4 text-slate-400" />
            </div>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 appearance-none"
            >
              {ENTITY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Filter className="w-4 h-4 text-slate-400" />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 appearance-none"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-violet-500" />
        </div>
      ) : filteredAndSortedWorks.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
          <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No ongoing works match your criteria.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50/80 border-b border-slate-100 text-slate-500 font-semibold select-none">
                <tr>
                  <th className="px-5 py-3.5 cursor-pointer hover:text-slate-700" onClick={() => handleSort('title')}>
                    Entity {renderSortIcon('title')}
                  </th>
                  <th className="px-5 py-3.5 cursor-pointer hover:text-slate-700" onClick={() => handleSort('entity')}>
                    Context {renderSortIcon('entity')}
                  </th>
                  <th className="px-5 py-3.5 cursor-pointer hover:text-slate-700" onClick={() => handleSort('status')}>
                    Status & Timeline {renderSortIcon('status')}
                  </th>
                  <th className="px-5 py-3.5 cursor-pointer hover:text-slate-700" onClick={() => handleSort('deadline')}>
                    Latest Activity {renderSortIcon('deadline')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAndSortedWorks.map((work) => {
                  const isExpanded = expandedId === work.id;
                  const recentEvent = work.recentEvents?.[0];
                  
                  let badgeColors = "bg-slate-100 text-slate-700";
                  let Icon = ClipboardList;
                  if (work.type === 'WP') { badgeColors = "bg-blue-100 text-blue-700"; Icon = Layers; }
                  else if (work.type === 'TASK') { badgeColors = "bg-emerald-100 text-emerald-700"; Icon = Briefcase; }
                  else if (work.type === 'BLUEPRINT') { badgeColors = "bg-violet-100 text-violet-700"; Icon = CalendarClock; }

                  return (
                    <React.Fragment key={work.id}>
                      <tr className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-lg mt-0.5 ${work.type === 'WP' ? "bg-blue-50 text-blue-600" : work.type === 'TASK' ? "bg-emerald-50 text-emerald-600" : "bg-violet-50 text-violet-600"}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-semibold text-slate-800 flex items-center gap-2">
                                <Link href={work.link} className="max-w-[200px] truncate block hover:text-violet-600 hover:underline" title={work.title}>
                                  {work.title}
                                </Link>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${badgeColors}`}>
                                  {work.type}
                                </span>
                                <span className="text-xs text-slate-500 truncate max-w-[150px]">{work.itemType}</span>
                              </div>
                              {work.instructions && (
                                <div className="text-[11px] text-slate-400 mt-1 max-w-[200px] truncate" title={work.instructions}>
                                  {work.instructions}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-slate-600">
                              <Building2 className="w-3.5 h-3.5 text-slate-400" />
                              <span className="font-medium">{work.divisionAbbrev}</span>
                            </div>
                            {work.type === 'BLUEPRINT' ? (
                              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                <History className="w-3.5 h-3.5 text-slate-400" />
                                <span>{work.meta?.instancesLaunched ?? 0} launched</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                <User className="w-3.5 h-3.5 text-slate-400" />
                                <span className="truncate max-w-[120px]" title={work.assignee}>{work.assignee}</span>
                              </div>
                            )}
                            {work.findingsCount > 0 && (
                              <div className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                                <AlertTriangle className="w-3 h-3" />
                                {work.findingsCount} Finding{work.findingsCount !== 1 ? 's' : ''}
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="space-y-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                              {work.status}
                            </span>
                            {work.deadline ? (
                              <div className={`flex items-center gap-1.5 text-xs font-medium ${isOverdue(work.deadline) ? "text-red-600" : "text-slate-500"}`}>
                                <CalendarClock className="w-3.5 h-3.5" />
                                {fmtDate(work.deadline)}
                                {isOverdue(work.deadline) && <span className="text-red-500 ml-1">(Overdue)</span>}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                                <CalendarClock className="w-3.5 h-3.5" /> {work.type === 'BLUEPRINT' ? 'Awaiting completion' : 'No deadline'}
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              {recentEvent ? (
                                <div>
                                  <p className="text-xs text-slate-600 truncate" title={recentEvent.content}>
                                    <span className="font-semibold text-slate-800">{recentEvent.author?.name || 'System'}: </span>
                                    {recentEvent.content}
                                  </p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    {new Date(recentEvent.createdAt).toLocaleString()}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400 italic">No recent activity</p>
                              )}
                            </div>
                            
                            {work.recentEvents && work.recentEvents.length > 1 && (
                              <button 
                                onClick={() => toggleExpand(work.id)}
                                className="flex-shrink-0 flex items-center gap-1 px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md text-xs font-medium transition-colors border border-slate-200"
                              >
                                History {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && work.recentEvents && work.recentEvents.length > 1 && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={4} className="px-5 py-3 border-t border-slate-100">
                            <div className="pl-12 pr-4 space-y-3">
                              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Recent History</h4>
                              <div className="space-y-2">
                                {work.recentEvents.map(evt => (
                                  <div key={evt.id} className="flex gap-3 text-sm">
                                    <div className="w-24 flex-shrink-0 text-[10px] text-slate-400 pt-0.5 text-right">
                                      {new Date(evt.createdAt).toLocaleDateString()} {new Date(evt.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                    </div>
                                    <div className="flex-1 text-slate-700">
                                      <span className="font-semibold">{evt.author?.name || 'System'}:</span> <span className="text-slate-600">{evt.content}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
