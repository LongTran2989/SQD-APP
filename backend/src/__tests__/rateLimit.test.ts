import request from 'supertest';
import express from 'express';
import { createAuthRateLimiter, createMutationRateLimiter } from '../middleware/rateLimit.middleware';

describe('Auth rate limiter', () => {
  // When forced on (skip overridden), the limiter blocks once the ceiling is hit.
  it('returns 429 once the request ceiling is exceeded', async () => {
    const app = express();
    app.use(
      '/probe',
      createAuthRateLimiter({ skip: () => false, limit: 2, windowMs: 60_000 }),
      (_req, res) => res.json({ ok: true })
    );

    expect((await request(app).get('/probe')).status).toBe(200);
    expect((await request(app).get('/probe')).status).toBe(200);
    expect((await request(app).get('/probe')).status).toBe(429);
  });

  // In the test environment the limiter is skipped by default so suites that hit
  // /login repeatedly are never throttled.
  it('is skipped by default under NODE_ENV=test', async () => {
    expect(process.env.NODE_ENV).toBe('test');

    const app = express();
    app.use(
      '/probe',
      createAuthRateLimiter({ limit: 1, windowMs: 60_000 }),
      (_req, res) => res.json({ ok: true })
    );

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/probe')).status).toBe(200);
    }
  });
});

describe('Mutation (per-user) rate limiter — H3', () => {
  // Builds a probe app that stamps req.user.userId from an x-user header so the
  // limiter's keyGenerator (userId-based) can be exercised without real auth.
  const buildApp = (limit: number) => {
    const app = express();
    app.use((req, _res, next) => {
      const uid = req.header('x-user');
      if (uid) (req as unknown as { user: { userId: number } }).user = { userId: Number(uid) };
      next();
    });
    app.use(
      '/probe',
      createMutationRateLimiter({ skip: () => false, limit, windowMs: 60_000 }),
      (_req, res) => res.json({ ok: true })
    );
    return app;
  };

  it('throttles per user, not globally', async () => {
    const app = buildApp(2);

    // User 1 burns their budget …
    expect((await request(app).get('/probe').set('x-user', '1')).status).toBe(200);
    expect((await request(app).get('/probe').set('x-user', '1')).status).toBe(200);
    expect((await request(app).get('/probe').set('x-user', '1')).status).toBe(429);

    // … user 2 is unaffected (separate bucket keyed on userId).
    expect((await request(app).get('/probe').set('x-user', '2')).status).toBe(200);
  });

  it('is skipped by default under NODE_ENV=test', async () => {
    expect(process.env.NODE_ENV).toBe('test');
    const app = express();
    app.use(
      '/probe',
      createMutationRateLimiter({ limit: 1, windowMs: 60_000 }),
      (_req, res) => res.json({ ok: true })
    );
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/probe')).status).toBe(200);
    }
  });
});
