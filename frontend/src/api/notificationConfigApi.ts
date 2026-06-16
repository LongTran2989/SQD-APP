import { apiClient } from './client';
import {
  NotificationEventCatalogItem,
  NotificationEventConfig,
} from '../types';

// Admin/Director notification event configuration (Settings → Notifications).

export interface NotificationConfigResponse {
  catalog: NotificationEventCatalogItem[];
  configs: NotificationEventConfig[];
}

export const getNotificationConfig = (): Promise<NotificationConfigResponse> =>
  apiClient.get('/settings/notification-config').then((r) => r.data);

export const updateNotificationConfig = (
  eventKey: string,
  body: { enabled: boolean; ccManagers: boolean }
): Promise<{ message: string; config: NotificationEventConfig }> =>
  apiClient.put(`/settings/notification-config/${eventKey}`, body).then((r) => r.data);
