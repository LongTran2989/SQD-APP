import { apiClient } from './client';
import { UserPreferences } from '../types';

// Deep-merges an allowlisted subset of UI state into the caller's own preferences.
export const updateMyPreferences = (preferences: UserPreferences): Promise<{ preferences: UserPreferences }> =>
  apiClient.patch('/users/me/preferences', { preferences }).then((r) => r.data);

// ─── Admin User Management ─────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  employeeId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  forcePasswordChange: boolean;
  divisionId: number;
  division: { id: number; name: string; code: string };
  roleId: number;
  role: { id: number; name: string };
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserFormData {
  employeeId?: string;
  name: string;
  email?: string;
  phone?: string;
  roleName: string;
  divisionId: number;
}

export const listAdminUsers = (params: {
  page?: number;
  limit?: number;
  q?: string;
  role?: string;
  divisionId?: number;
  includeDeleted?: boolean;
}): Promise<ListUsersResponse> =>
  apiClient.get('/users', { params }).then((r) => r.data);

export const createAdminUser = (data: UserFormData): Promise<{ message: string; user: AdminUser }> =>
  apiClient.post('/users', data).then((r) => r.data);

export const updateAdminUser = (id: number, data: Partial<UserFormData>): Promise<{ message: string; user: AdminUser }> =>
  apiClient.put(`/users/${id}`, data).then((r) => r.data);

export const deleteAdminUser = (id: number): Promise<{ message: string }> =>
  apiClient.delete(`/users/${id}`).then((r) => r.data);

export const adminResetUserPassword = (id: number): Promise<{ message: string }> =>
  apiClient.patch(`/users/${id}/reset-password`).then((r) => r.data);

export const changeMyPassword = (currentPassword: string, newPassword: string): Promise<{ message: string }> =>
  apiClient.patch('/users/me/password', { currentPassword, newPassword }).then((r) => r.data);
