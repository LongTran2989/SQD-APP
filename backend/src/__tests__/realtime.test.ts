import type { Response } from 'express';
import { addClient, removeClient } from '../realtime/sseHub';
import { dispatch } from '../realtime/pgEvents';

// Unit test for the SSE routing logic (M1). No DB/network: we register fake SSE
// responses in the hub, push a payload through dispatch(), and assert which
// clients received an event frame.

function fakeClient() {
  const writes: string[] = [];
  const res = { write: (s: string) => { writes.push(s); return true; } } as unknown as Response;
  return { res, writes, received: () => writes.join('').includes('event: feed') };
}

describe('Realtime feed signal routing (M1)', () => {
  it('routes a scoped (TASK) feed signal only to the listed watchers', () => {
    const watcher = fakeClient();
    const bystander = fakeClient();
    addClient(1, watcher.res);
    addClient(2, bystander.res);
    try {
      dispatch(JSON.stringify({ kind: 'feed', scope: 'TASK', scopeId: 42, userIds: [1] }));
      expect(watcher.received()).toBe(true);
      expect(bystander.received()).toBe(false);
    } finally {
      removeClient(1, watcher.res);
      removeClient(2, bystander.res);
    }
  });

  it('broadcasts a shared (ORG) feed signal to every client', () => {
    const a = fakeClient();
    const b = fakeClient();
    addClient(1, a.res);
    addClient(2, b.res);
    try {
      dispatch(JSON.stringify({ kind: 'feed', scope: 'ORG', scopeId: null }));
      expect(a.received()).toBe(true);
      expect(b.received()).toBe(true);
    } finally {
      removeClient(1, a.res);
      removeClient(2, b.res);
    }
  });

  it('broadcasts when userIds is empty (defensive fallback)', () => {
    const a = fakeClient();
    const b = fakeClient();
    addClient(1, a.res);
    addClient(2, b.res);
    try {
      dispatch(JSON.stringify({ kind: 'feed', scope: 'WP', scopeId: 7, userIds: [] }));
      expect(a.received()).toBe(true);
      expect(b.received()).toBe(true);
    } finally {
      removeClient(1, a.res);
      removeClient(2, b.res);
    }
  });
});
