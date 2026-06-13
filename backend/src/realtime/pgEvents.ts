import { PrismaClient, Prisma } from '@prisma/client';
import { pool } from '../lib/prisma';
import { publishToUser, publishToAll } from './sseHub';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Cross-instance realtime bridge built on Postgres LISTEN/NOTIFY.
 *
 * Producers call emitRealtimeEvent() inside the SAME transaction client that
 * performed the write, so Postgres only delivers the NOTIFY when that
 * transaction COMMITs — the listener therefore never refetches before the new
 * rows are visible (atomic, race-free). Every instance LISTENs on one channel;
 * any instance's NOTIFY reaches all instances; each instance fans out to its
 * own local SSE clients via sseHub. No Redis, no shared memory, scales to N
 * instances.
 *
 * Events are SIGNALS only — the client refetches via REST, so the dual-write
 * and all RBAC scoping are reused untouched.
 */

export const REALTIME_CHANNEL = 'sqd_realtime';

// Discriminated union of everything that can be signalled. A `userId` routes to
// one user's streams; its absence broadcasts (used sparingly).
export type RealtimeEvent =
  | { kind: 'notification'; userId: number }
  | { kind: 'escalation'; userId: number }
  | { kind: 'feed'; scope: 'TASK' | 'WP' | 'DIVISION' | 'ORG' | 'FINDING'; scopeId: number | null };

// Postgres pg_notify has an 8000-byte payload limit (hard limit in the backend).
// Signals here are signals only ({kind, userId} or {kind, scope, scopeId}) and
// are always << 100 bytes. This guard is defensive against future field additions
// and ensures a payload overflow is caught before it can abort a surrounding tx.
const MAX_NOTIFY_BYTES = 7900;

/**
 * Publishes a realtime signal via pg_notify, riding the caller's transaction
 * client when one is supplied. Best-effort: never throws, never blocks the
 * business write (mirrors the additive-third-write contract). Skipped entirely
 * under NODE_ENV==='test' so Jest opens no extra handles and rows still persist.
 */
export async function emitRealtimeEvent(client: PrismaLike, evt: RealtimeEvent): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const payload = JSON.stringify(evt);
    if (Buffer.byteLength(payload, 'utf8') > MAX_NOTIFY_BYTES) {
      // Should never happen — guard exists to catch future signal-shape drift.
      console.error('[realtime] emit skipped — payload exceeds pg_notify limit:', Buffer.byteLength(payload, 'utf8'), 'bytes');
      return;
    }
    // pg_notify(text, text) — parameterised so the JSON payload is safely quoted.
    await client.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`;
  } catch (err) {
    console.error('[realtime] emit failed (non-fatal):', err);
  }
}

// Dedicated long-lived connection holding the LISTEN. A pooled query client
// cannot be used because LISTEN must keep its own connection open for the
// lifetime of the process.
let listenClient: import('pg').PoolClient | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

function dispatch(raw: string): void {
  let evt: RealtimeEvent;
  try {
    evt = JSON.parse(raw) as RealtimeEvent;
  } catch {
    return; // ignore malformed payloads
  }
  switch (evt.kind) {
    case 'notification':
      publishToUser(evt.userId, { type: 'notification', data: {} });
      return;
    case 'escalation':
      publishToUser(evt.userId, { type: 'escalation', data: {} });
      return;
    case 'feed':
      // Feed signals have no single owner — broadcast and let each client decide
      // (via its open views + RBAC-scoped refetch) whether the signal is relevant.
      publishToAll({ type: 'feed', data: { scope: evt.scope, scopeId: evt.scopeId } });
      return;
    default: {
      // Exhaustiveness guard: a new event kind that forgets a dispatch case (or a
      // malformed payload) must surface in logs rather than vanish silently.
      const unhandled: never = evt;
      console.warn('[realtime] dropped unknown event:', JSON.stringify(unhandled));
      return;
    }
  }
}

/**
 * Opens the dedicated LISTEN connection and begins dispatching NOTIFYs to the
 * SSE hub. Auto-reconnects with a short backoff on connection error. Call once
 * at server startup (never under test — see index.ts guard).
 */
export async function startRealtimeListener(): Promise<void> {
  try {
    listenClient = await pool.connect();
    listenClient.on('notification', (msg) => {
      if (msg.channel === REALTIME_CHANNEL && msg.payload) dispatch(msg.payload);
    });
    listenClient.on('error', (err) => {
      console.error('[realtime] listener connection error — reconnecting:', err);
      scheduleReconnect();
    });
    await listenClient.query(`LISTEN ${REALTIME_CHANNEL}`);
    console.log('[realtime] LISTEN active on channel', REALTIME_CHANNEL);
  } catch (err) {
    console.error('[realtime] failed to start listener — retrying:', err);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  try {
    listenClient?.release();
  } catch {
    /* already gone */
  }
  listenClient = null;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startRealtimeListener();
  }, 2000);
}
