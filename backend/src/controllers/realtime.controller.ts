import { Request, Response } from 'express';
import { addClient, removeClient, writeEvent, MAX_CONNECTIONS_PER_USER } from '../realtime/sseHub';

// Keepalive comment interval. Holds proxies/load-balancers open and lets the
// client detect a dead connection. SSE comment lines (": ...") are ignored by
// EventSource.
const KEEPALIVE_MS = 25_000;

/**
 * GET /api/events/stream — opens a Server-Sent-Events stream for the
 * authenticated user. Pushes lightweight SIGNALS only (notification/escalation/
 * feed); the browser refetches via REST so RBAC + the dual-write are reused.
 */
export const streamEvents = (req: Request, res: Response): void => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  // SSE headers. `X-Accel-Buffering: no` disables nginx buffering; `no-transform`
  // stops compression proxies from coalescing frames.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Never time the socket out — this is a long-lived stream.
  req.socket.setTimeout?.(0);

  if (!addClient(userId, res)) {
    // At the per-user connection cap — refuse politely and close.
    writeEvent(res, { type: 'error', data: { message: 'Too many connections', max: MAX_CONNECTIONS_PER_USER } });
    res.end();
    return;
  }

  // Initial hello so the client knows the stream is live (and can refetch counts).
  writeEvent(res, { type: 'ready', data: {} });

  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      /* socket gone — close handler cleans up */
    }
  }, KEEPALIVE_MS);

  const cleanup = (): void => {
    clearInterval(keepalive);
    removeClient(userId, res);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
};
