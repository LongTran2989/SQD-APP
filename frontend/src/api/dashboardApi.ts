import { apiClient } from './client';

export interface DashboardSummary {
  myPendingTasks?: number;
  unassignedTasks?: number;
  allOpenFindings?: number;
  divisionPendingTasks?: number;
  escalations?: number;
  findingsPendingVerification?: number;
  systemPendingTasks?: number;
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

export interface FeedPost {
  id: number;
  type: string;
  scope: string;
  scopeId: number | null;
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

export const getDashboardFeed = async (): Promise<FeedPost[]> => {
  const { data } = await apiClient.get('/dashboard/feed');
  return data;
};
