import { apiClient } from './client';
import { AppNotification } from '../types';

export interface NotificationPage {
  items: AppNotification[];
  nextCursor: number | null;
}

// The caller's own notifications, newest first. Pass unread=true for the badge
// list; cursor paginates (id of the last item from the previous page).
export const listNotifications = (
  opts: { unread?: boolean; limit?: number; cursor?: number } = {}
): Promise<NotificationPage> =>
  apiClient
    .get('/notifications', {
      params: {
        ...(opts.unread ? { unread: 'true' } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
    })
    .then((r) => r.data);

export const getUnreadCount = (): Promise<number> =>
  apiClient.get('/notifications/unread-count').then((r) => r.data.count);

export const markNotificationRead = (id: number): Promise<void> =>
  apiClient.patch(`/notifications/${id}/read`).then(() => undefined);

export const markAllNotificationsRead = (): Promise<void> =>
  apiClient.post('/notifications/read-all').then(() => undefined);
