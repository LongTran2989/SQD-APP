'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { MetricCard } from '../../components/dashboard/MetricCard';
import { DetailedMetricWidget } from '../../components/dashboard/DetailedMetricWidget';
import { QuickActionBar } from '../../components/dashboard/QuickActionBar';
import { ActivityFeedWidget } from '../../components/dashboard/ActivityFeedWidget';
import { EscalationWidget } from '../../components/dashboard/EscalationWidget';
import { WorkPackageWidget } from '../../components/dashboard/WorkPackageWidget';
import { MyTasksWidget } from '../../components/dashboard/MyTasksWidget';
import { StuckFindingsWidget } from '../../components/dashboard/StuckFindingsWidget';

import { CheckCircle2, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  getDashboardSummary,
  getDashboardWorkPackages,
  getDashboardTasks,
  getDashboardFeed,
  DashboardSummary,
  DashboardWorkPackage,
  DashboardTask,
  FeedPost
} from '../../api/dashboardApi';
import toast from 'react-hot-toast';

export default function DashboardHome() {
  const user = useAuthStore((state) => state.user);
  const isStaff = user?.role === 'Staff';

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [wps, setWps] = useState<DashboardWorkPackage[]>([]);
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [feed, setFeed] = useState<FeedPost[]>([]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [isLoadingWps, setIsLoadingWps] = useState(true);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Fetch concurrently but handle states individually for progressive rendering
      const summaryPromise = getDashboardSummary().then(res => { setSummary(res); setIsLoadingSummary(false); });
      const wpsPromise = getDashboardWorkPackages().then(res => { setWps(res); setIsLoadingWps(false); });
      const tasksPromise = getDashboardTasks().then(res => { setTasks(res); setIsLoadingTasks(false); });
      const feedPromise = getDashboardFeed().then(res => { setFeed(res); setIsLoadingFeed(false); });

      await Promise.allSettled([summaryPromise, wpsPromise, tasksPromise, feedPromise]);
    } catch (error) {
      toast.error('Failed to load dashboard data');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isManagerOrDirector = user?.role === 'Manager' || user?.role === 'Director' || user?.role === 'Admin';
  const escalationCount = summary?.escalations ?? 0;
  const showEscalationBanner = !isStaff && !isLoadingSummary && escalationCount > 0;

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Operations Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <span className="bg-signal-blue-surface px-2.5 py-1 rounded-lg text-signal-blue text-xs font-semibold border border-blue-100">{user?.role}</span>
      </div>

      <div className="mb-6">
        <QuickActionBar
          onRefresh={fetchData}
          isRefreshing={isRefreshing}
        />
      </div>

      {/* Status band: escalation banner (only when active) + dense stat strip */}
      <div className="mb-8 space-y-3">
        {showEscalationBanner && (
          <EscalationWidget count={escalationCount} layout="banner" />
        )}

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div
            className={`grid grid-cols-1 divide-y divide-slate-200 sm:divide-y-0 sm:divide-x ${
              isStaff ? 'sm:grid-cols-3' : showEscalationBanner ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
            }`}
          >
            {isStaff ? (
              <>
                <MetricCard
                  title="My Pending Tasks"
                  value={summary?.myPendingTasks ?? 0}
                  subtitle="Tasks assigned to you"
                  icon={<Clock className="w-6 h-6" />}
                  iconBgColor="bg-amber-50"
                  iconTextColor="text-amber-600"
                  isLoading={isLoadingSummary}
                />
                <MetricCard
                  title="Unassigned Tasks"
                  value={summary?.unassignedTasks ?? 0}
                  subtitle="Available in division"
                  icon={<CheckCircle2 className="w-6 h-6" />}
                  iconBgColor="bg-blue-50"
                  iconTextColor="text-blue-600"
                  isLoading={isLoadingSummary}
                />
                <MetricCard
                  title="All Open Findings"
                  value={summary?.allOpenFindings ?? 0}
                  subtitle="System-wide visibility"
                  icon={<AlertTriangle className="w-6 h-6" />}
                  iconBgColor="bg-red-50"
                  iconTextColor="text-red-600"
                  isLoading={isLoadingSummary}
                />
              </>
            ) : (
              <>
                <DetailedMetricWidget
                  title={user?.role === 'Director' ? "System Pending Tasks" : "Division Pending Tasks"}
                  icon={<Clock className="w-6 h-6" />}
                  iconBgColor="bg-amber-50"
                  iconTextColor="text-amber-600"
                  isLoading={isLoadingSummary}
                  breakdown={[
                    { label: 'Unassigned', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.unassigned : summary?.divisionPendingTasks?.unassigned) ?? 0, colorClass: 'bg-slate-400', href: '/dashboard/tasks?status=Unassigned' },
                    { label: 'Due Today', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.dueToday : summary?.divisionPendingTasks?.dueToday) ?? 0, colorClass: 'bg-amber-500', href: '/dashboard/tasks?dueFilter=today' },
                    { label: 'Overdue', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.overdue : summary?.divisionPendingTasks?.overdue) ?? 0, colorClass: 'bg-red-500', urgent: true, href: '/dashboard/tasks?overdueOnly=true' },
                    { label: 'In Review', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.inReview : summary?.divisionPendingTasks?.inReview) ?? 0, colorClass: 'bg-blue-500', href: `/dashboard/tasks?status=${encodeURIComponent('In Review')}` },
                    { label: 'Pending Rating', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.pendingRating : summary?.divisionPendingTasks?.pendingRating) ?? 0, colorClass: 'bg-blue-400', href: '/dashboard/tasks?pendingRatingOnly=true' },
                  ]}
                  linkTo="/dashboard/tasks"
                />
                <DetailedMetricWidget
                  title="Findings Overview"
                  icon={<ShieldCheck className="w-6 h-6" />}
                  iconBgColor="bg-emerald-50"
                  iconTextColor="text-emerald-600"
                  isLoading={isLoadingSummary}
                  breakdown={[
                    { label: 'Open', value: summary?.findingsOverview?.open ?? 0, colorClass: 'bg-red-500', href: '/dashboard/findings?status=Open' },
                    { label: 'Pending Verification', value: summary?.findingsOverview?.pendingVerification ?? 0, colorClass: 'bg-amber-500', href: `/dashboard/findings?status=${encodeURIComponent('Pending Verification')}` },
                    { label: 'In Progress', value: summary?.findingsOverview?.inProgress ?? 0, colorClass: 'bg-blue-500', href: `/dashboard/findings?status=${encodeURIComponent('In Progress')}` },
                  ]}
                  linkTo="/dashboard/findings"
                />
                {!showEscalationBanner && (
                  <EscalationWidget count={escalationCount} isLoading={isLoadingSummary} layout="cell" />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (WPs & Charts) */}
        <div className="lg:col-span-2 space-y-6">
          <StuckFindingsWidget />
          {isStaff && <MyTasksWidget tasks={tasks} isLoading={isLoadingTasks} />}
          <WorkPackageWidget wps={wps} isLoading={isLoadingWps} />
        </div>

        {/* Right Column (Feed) */}
        <div className="lg:col-span-1">
          <ActivityFeedWidget posts={feed} isLoading={isLoadingFeed} />
        </div>
      </div>
    </div>
  );
}
