'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { MetricCard } from '../../components/dashboard/MetricCard';
import { DetailedMetricWidget } from '../../components/dashboard/DetailedMetricWidget';
import { QuickActionBar } from '../../components/dashboard/QuickActionBar';
import { ActivityFeedWidget } from '../../components/dashboard/ActivityFeedWidget';
import { EscalationWidget } from '../../components/dashboard/EscalationWidget';
import { WorkPackageWidget } from '../../components/dashboard/WorkPackageWidget';
import { StuckFindingsWidget } from '../../components/dashboard/StuckFindingsWidget';

import { CheckCircle2, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  getDashboardSummary,
  getDashboardWorkPackages,
  getDashboardFeed,
  DashboardSummary,
  DashboardWorkPackage,
  FeedPost
} from '../../api/dashboardApi';
import toast from 'react-hot-toast';

export default function DashboardHome() {
  const user = useAuthStore((state) => state.user);
  
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [wps, setWps] = useState<DashboardWorkPackage[]>([]);
  const [feed, setFeed] = useState<FeedPost[]>([]);
  
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [isLoadingWps, setIsLoadingWps] = useState(true);
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Fetch concurrently but handle states individually for progressive rendering
      const summaryPromise = getDashboardSummary().then(res => { setSummary(res); setIsLoadingSummary(false); });
      const wpsPromise = getDashboardWorkPackages().then(res => { setWps(res); setIsLoadingWps(false); });
      const feedPromise = getDashboardFeed().then(res => { setFeed(res); setIsLoadingFeed(false); });

      await Promise.allSettled([summaryPromise, wpsPromise, feedPromise]);
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
  const isStaff = user?.role === 'Staff';

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Operations Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <span className="bg-blue-50 px-2.5 py-1 rounded-lg text-blue-700 text-xs font-semibold border border-blue-100">{user?.role}</span>
      </div>

      <QuickActionBar 
        onRefresh={fetchData} 
        isRefreshing={isRefreshing} 
      />

      {/* Top Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                { label: 'Unassigned', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.unassigned : summary?.divisionPendingTasks?.unassigned) ?? 0, colorClass: 'bg-slate-400' },
                { label: 'Due Today', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.dueToday : summary?.divisionPendingTasks?.dueToday) ?? 0, colorClass: 'bg-amber-500' },
                { label: 'Overdue', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.overdue : summary?.divisionPendingTasks?.overdue) ?? 0, colorClass: 'bg-red-500', urgent: true },
                { label: 'In Review', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.inReview : summary?.divisionPendingTasks?.inReview) ?? 0, colorClass: 'bg-blue-500' },
                { label: 'Pending Rating', value: (user?.role === 'Director' ? summary?.systemPendingTasks?.pendingRating : summary?.divisionPendingTasks?.pendingRating) ?? 0, colorClass: 'bg-blue-400' },
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
                { label: 'Open', value: summary?.findingsOverview?.open ?? 0, colorClass: 'bg-red-500' },
                { label: 'Pending Verification', value: summary?.findingsOverview?.pendingVerification ?? 0, colorClass: 'bg-amber-500' },
                { label: 'In Progress', value: summary?.findingsOverview?.inProgress ?? 0, colorClass: 'bg-blue-500' },
              ]}
              linkTo="/dashboard/findings"
            />
            <EscalationWidget count={summary?.escalations ?? 0} isLoading={isLoadingSummary} />
          </>
        )}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (WPs & Charts) */}
        <div className="lg:col-span-2 space-y-6">
          <StuckFindingsWidget />
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
