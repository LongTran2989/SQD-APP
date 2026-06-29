import { apiClient } from './client';

export interface SecuritySettings {
  enforceSingleSession: boolean;
}

export const getSecuritySettings = async (): Promise<SecuritySettings> => {
  const res = await apiClient.get<SecuritySettings>('/settings/security');
  return res.data;
};

export const updateSecuritySettings = async (settings: SecuritySettings): Promise<SecuritySettings> => {
  const res = await apiClient.put<SecuritySettings>('/settings/security', settings);
  return res.data;
};
