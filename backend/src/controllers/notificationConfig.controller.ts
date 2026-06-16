import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  getAllConfigs,
  upsertConfig,
  isNotificationEventKey,
} from '../services/notificationConfigService';

// ─── GET /api/settings/notification-config ────────────────────────────────────
// Returns the event catalog plus each event's current effective config.
export const getNotificationConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await getAllConfigs(prisma);
    res.json(result);
  } catch (error) {
    console.error('Error fetching notification config:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ─── PUT /api/settings/notification-config/:eventKey ──────────────────────────
// Updates a single event class. Body: { enabled: boolean, ccManagers: boolean }.
export const updateNotificationConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { eventKey } = req.params;
    if (!isNotificationEventKey(eventKey)) {
      res.status(400).json({ message: `Unknown notification event key: ${eventKey}` });
      return;
    }

    const { enabled, ccManagers } = req.body as { enabled?: unknown; ccManagers?: unknown };
    if (typeof enabled !== 'boolean' || typeof ccManagers !== 'boolean') {
      res.status(400).json({ message: '"enabled" and "ccManagers" must both be booleans.' });
      return;
    }

    const updated = await upsertConfig(prisma, eventKey, { enabled, ccManagers }, userId);
    res.json({ message: 'Notification config updated', config: updated });
  } catch (error) {
    console.error('Error updating notification config:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
