import { apiClient } from './client';

// ─── Personnel workload + performance ────────────────────────────────────────

export interface PersonnelWorkload {
  activeTasks: number;
  estimatedHours: number;
  wpsManaged: number;
  openCapas: number;
  activeRcas: number;
  upcomingDeadlines: number;
}

export interface PersonnelPerformance {
  tasksCompleted: number;
  hoursLogged: number;
  taskEfficiency: number | null;
  onTimeRate: number | null;       // closed tasks completed on or before deadline / total closed with deadline
  findingsReported: number;
  proactivityRatio: number | null;
  findingsClosed: number;
  capasVerified: number;
  rejectedCount: number;
  rejectionRate: number | null;
  overdueCount: number;
}

export interface PersonnelRow {
  userId: number;
  name: string;
  divisionId: number;
  workload: PersonnelWorkload;
  performance: PersonnelPerformance;
}

export interface PersonnelWorkloadResponse {
  deadlineWindowDays: number;
  personnel: PersonnelRow[];
}

export const getPersonnelWorkload = (params?: {
  divisionId?: number;
  from?: string;
  to?: string;
  deadlineWindowDays?: number;
}): Promise<PersonnelWorkloadResponse> =>
  apiClient.get('/workload/personnel', { params }).then((r) => r.data);

// ─── Personnel detail ─────────────────────────────────────────────────────────

export interface UpcomingDeadlineTask {
  id: number;
  taskId: string;
  title: string;
  deadline: string;
  status: string;
}

export interface ActiveTaskItem {
  id: number;
  taskId: string;
  title: string;
  deadline: string | null;
  status: string;
}

export interface ActiveWpItem {
  id: number;
  wpId: string;
  name: string;
  type: string;
  status: string;
  timeframeTo: string;
}

export interface OpenCapaItem {
  id: number;
  description: string;
  type: string;
  status: string;
  deadline: string | null;
  findingId: number;
  findingDescription: string;
}

export interface ActiveRcaItem {
  id: number;
  method: string;
  findingId: number;
  findingDescription: string;
}

export interface MonthlyHours {
  month: string; // YYYY-MM
  hours: number;
}

export interface PersonnelDetail {
  userId: number;
  name: string;
  deadlineWindowDays: number;
  taskEfficiency: number | null;
  avgRating: number | null;
  tasksCompleted: number;
  onTimeRate: number | null;
  hoursLoggedByMonth: MonthlyHours[];
  upcomingDeadlines: UpcomingDeadlineTask[];
  activeTasks: ActiveTaskItem[];
  activeWps: ActiveWpItem[];
  openCapas: OpenCapaItem[];
  activeRcas: ActiveRcaItem[];
}

export const getPersonnelDetail = (
  userId: number,
  params?: { deadlineWindowDays?: number; from?: string; to?: string }
): Promise<PersonnelDetail> =>
  apiClient.get(`/workload/personnel/${userId}`, { params }).then((r) => r.data);
