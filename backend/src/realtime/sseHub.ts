import type { Response } from 'express';

/**
 * In-process registry of open Server-Sent-Events connections, keyed by userId.
 *
 * A single backend instance fans events out to the connections it personally
 * holds. Cross-instance delivery is NOT this module's job — that is handled by
 * Postgres LISTEN/NOTIFY (see pgEvents.ts): every instance LISTENs, any
 * instance's NOTIFY reaches all instances, and each instance then calls into
 * this hub for its own local clients. That keeps the design horizontally
 * scalable with no shared in-memory state and no Redis.
 *
 * Events pushed here are deliberately lightweight SIGNALS, never payloads — the
 * client refetches via the existing REST endpoints so all RBAC scoping and the
 * dual-write are reused untouched (spec non-negotiable: SSE never replaces the
 * dual-write).
 */

/** A signal delivered to the browser. `data` is JSON-serialisable. */
export interface SseEvent {
  type: string; // notification | escalation | feed | ping
  data?: unknown;
}

// Per-user cap on simultaneous streams (multiple tabs/devices). Beyond this we
// reject new connections with 429 rather than leak unbounded sockets.
export const MAX_CONNECTIONS_PER_USER = 5;

const clients = new Map<number, Set<Response>>();

/** Serialises and writes one SSE frame. Swallows write errors (dead socket). */
export function writeEvent(res: Response, evt: SseEvent): void {
  try {
    res.write(`event: ${evt.type}\n`);
    res.write(`data: ${JSON.stringify(evt.data ?? {})}\n\n`);
  } catch {
    // Socket already closed — cleanup happens on the 'close' handler.
  }
}

/**
 * Registers an open SSE response for a user. Returns false when the user is at
 * the connection cap (caller should respond 429 and not stream).
 */
export function addClient(userId: number, res: Response): boolean {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  if (set.size >= MAX_CONNECTIONS_PER_USER) return false;
  set.add(res);
  return true;
}

/** Removes a closed/ended SSE response. */
export function removeClient(userId: number, res: Response): void {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

/** Pushes an event to every open stream for one user. No-op if none. */
export function publishToUser(userId: number, evt: SseEvent): void {
  const set = clients.get(userId);
  if (!set) return;
  for (const res of set) writeEvent(res, evt);
}

/** Pushes an event to every open stream across all users (broadcast). */
export function publishToAll(evt: SseEvent): void {
  for (const set of clients.values()) {
    for (const res of set) writeEvent(res, evt);
  }
}

/** Total number of open streams (diagnostics / tests). */
export function connectionCount(): number {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}
