import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

/**
 * Notification Center REST. Every endpoint is scoped to the authenticated
 * caller (req.user.userId) — a user can only ever read or mutate their OWN
 * notifications. Notifications are a disposable UI artifact (not soft-delete
 * protected), so there is no deletedAt filter to apply here.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// GET /api/notifications?unread=true&limit=20&cursor=<id>
export const listNotifications = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  const unreadOnly = String(req.query.unread ?? '').toLowerCase() === 'true';
  const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isNaN(limitRaw) ? DEFAULT_LIMIT : Math.min(Math.max(limitRaw, 1), MAX_LIMIT);
  const cursorRaw = parseInt(String(req.query.cursor ?? ''), 10);
  const cursor = Number.isNaN(cursorRaw) ? undefined : cursorRaw;

  const items = await prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit + 1, // fetch one extra to compute nextCursor
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  res.status(200).json({ items: page, nextCursor });
};

// GET /api/notifications/unread-count
export const getUnreadCount = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const count = await prisma.notification.count({ where: { userId, readAt: null } });
  res.status(200).json({ count });
};

// PATCH /api/notifications/:id/read
export const markRead = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'A numeric notification id is required.' });
    return;
  }

  // Scope the update by userId so one user can never mark another's as read.
  const readAt = new Date();
  const result = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt },
  });
  if (result.count > 0) {
    // Freshly marked read — echo the timestamp the client can sync to.
    res.status(200).json({ ok: true, updated: true, readAt });
    return;
  }
  // Nothing updated: either not found / not theirs (404) or already read (no-op).
  const existing = await prisma.notification.findFirst({
    where: { id, userId },
    select: { readAt: true },
  });
  if (!existing) {
    res.status(404).json({ message: 'Notification not found.' });
    return;
  }
  res.status(200).json({ ok: true, updated: false, readAt: existing.readAt });
};

// POST /api/notifications/read-all
export const markAllRead = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  res.status(200).json({ ok: true, updated: result.count });
};
