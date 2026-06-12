import { apiClient } from './client';
import { PrivilegeMatrix, RolePrivileges } from '../types';

// Admin-only privilege matrix (Phase 7).

export const getPrivileges = (): Promise<PrivilegeMatrix> =>
  apiClient.get('/settings/privileges').then((r) => r.data);

export interface PublishPrivilegesResponse {
  message: string;
  changedCount: number;
  roles: RolePrivileges[];
}

export const publishPrivileges = (roles: RolePrivileges[]): Promise<PublishPrivilegesResponse> =>
  apiClient.put('/settings/privileges', { roles }).then((r) => r.data);
