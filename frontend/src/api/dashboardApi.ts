import { apiClient } from './client';
import type { TaskStatus } from '../constants/taskStatus';

export interface TaskBreakdown {
  unassigned: number;
  dueToday: number;
  overdue: number;
  inReview: number;
  pendingRating: number;
}

export interface FindingsOverview {
  open: number;
  pendingVerification: number;
  inProgress: number;
}

export interface DashboardSummary {
  myPendingTasks?: number;
  unassignedTasks?: number;
  allOpenFindings?: number;
  divisionPendingTasks?: TaskBreakdown;
  systemPendingTasks?: TaskBreakdown;
  findingsOverview?: FindingsOverview;
  escalations?: number;
}

export interface DashboardWorkPackage {
  id: number;
  wpId: string;
  name: string;
  type: string;
  status: string;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  timeframeTo: string;
}

export interface DashboardTask {
  id: number;
  taskId: string;
  title: string;
  itemType: string;
  status: TaskStatus;
  deadline: string | null;
  wpId: string | null;
}

export interface FeedPost {
  id: number;
  type: string;
  scope: string;
  scopeId: number | null;
  scopeName?: string | null;
  content: string;
  author: { name: string } | null;
  createdAt: string;
  metadata?: any;
}

export const getDashboardSummary = async (): Promise<DashboardSummary> => {
  const { data } = await apiClient.get('/dashboard/summary');
  return data;
};

export const getDashboardWorkPackages = async (): Promise<DashboardWorkPackage[]> => {
  const { data } = await apiClient.get('/dashboard/work-packages');
  return data;
};

export const getDashboardTasks = async (): Promise<DashboardTask[]> => {
  const { data } = await apiClient.get('/dashboard/tasks');
  return data;
};

export const getDashboardFeed = async (): Promise<FeedPost[]> => {
  const { data } = await apiClient.get('/dashboard/feed');
  return data;
};

export interface OngoingWork {
  id: string;
  entityId: number;
  link: string;
  type: 'WP' | 'TASK' | 'BLUEPRINT';
  title: string;
  itemType: string;
  status: string;
  assignee: string;
  deadline: string;
  divisionAbbrev: string;
  instructions: string | null;
  findingsCount: number;
  recentEvents: FeedPost[];
  meta: any;
}

export const getOngoingWorks = async (statusFilter: string = 'All'): Promise<OngoingWork[]> => {
  const { data } = await apiClient.get(`/dashboard/master-calendar?status=${encodeURIComponent(statusFilter)}`);
  return data;
};
