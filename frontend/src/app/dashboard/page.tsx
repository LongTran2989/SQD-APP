'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { MetricCard } from '../../components/dashboard/MetricCard';
import { QuickActionBar } from '../../components/dashboard/QuickActionBar';
import { ActivityFeedWidget } from '../../components/dashboard/ActivityFeedWidget';
import { EscalationWidget } from '../../components/dashboard/EscalationWidget';
import { WorkPackageWidget } from '../../components/dashboard/WorkPackageWidget';

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
import CreateTaskModal from '../../components/tasks/CreateTaskModal';

export default function DashboardHome() {
  const user = useAuthStore((state) => state.user);
  
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [wps, setWps] = useState<DashboardWorkPackage[]>([]);
  const [feed, setFeed] = useState<FeedPost[]>([]);
  
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [isLoadingWps, setIsLoadingWps] = useState(true);
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);

  const [showCreateTask, setShowCreateTask] = useState(false);

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
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-8 rounded-2xl shadow-md flex items-center justify-between relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/5 rounded-full blur-3xl"></div>
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Welcome back, {user?.name}!</h1>
          <p className="text-slate-300 font-medium">
            {isStaff ? 'Here are your assigned tasks and recent updates.' : "Here is the overview of your division's operations today."}
          </p>
        </div>
        <div className="w-16 h-16 bg-white/10 backdrop-blur rounded-2xl flex items-center justify-center relative z-10 border border-white/20">
          <img src="/logo.png" alt="SQD Logo" className="w-10 h-10 object-contain drop-shadow-md" />
        </div>
      </div>

      <QuickActionBar 
        onRefresh={fetchData} 
        isRefreshing={isRefreshing} 
        onCreateTask={() => setShowCreateTask(true)}
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
            <MetricCard 
              title={user?.role === 'Director' ? "System Pending Tasks" : "Division Pending Tasks"} 
              value={user?.role === 'Director' ? (summary?.systemPendingTasks ?? 0) : (summary?.divisionPendingTasks ?? 0)} 
              subtitle="Tasks awaiting action"
              icon={<Clock className="w-6 h-6" />}
              iconBgColor="bg-amber-50"
              iconTextColor="text-amber-600"
              isLoading={isLoadingSummary}
            />
            <EscalationWidget count={summary?.escalations ?? 0} isLoading={isLoadingSummary} />
            <MetricCard 
              title="Pending Verification" 
              value={summary?.findingsPendingVerification ?? 0} 
              subtitle="Findings requiring closure"
              icon={<ShieldCheck className="w-6 h-6" />}
              iconBgColor="bg-emerald-50"
              iconTextColor="text-emerald-600"
              isLoading={isLoadingSummary}
            />
          </>
        )}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (WPs & Charts) */}
        <div className="lg:col-span-2 space-y-6">
          <WorkPackageWidget wps={wps} isLoading={isLoadingWps} />
        </div>

        {/* Right Column (Feed) */}
        <div className="lg:col-span-1">
          <ActivityFeedWidget posts={feed} isLoading={isLoadingFeed} />
        </div>
      </div>

      {/* Modals */}
      {showCreateTask && (
        <CreateTaskModal 
          onClose={() => setShowCreateTask(false)}
          onSaved={(id) => { setShowCreateTask(false); fetchData(); }}
        />
      )}
    </div>
  );
}
