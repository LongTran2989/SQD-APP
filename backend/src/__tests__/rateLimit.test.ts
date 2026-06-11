import request from 'supertest';
import express from 'express';
import { createAuthRateLimiter } from '../middleware/rateLimit.middleware';

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
