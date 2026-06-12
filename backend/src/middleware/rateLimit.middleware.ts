import rateLimit, { Options } from 'express-rate-limit';

/**
 * Rate limiting for sensitive, unauthenticated auth endpoints (login, password
 * reset). Protects against brute-force and reset-token spraying.
 * See CLAUDE_HANDOVER.md §11, Fix 3.
 *
 * Disabled in the test environment (the suite hammers /login repeatedly) and via
 * an explicit DISABLE_RATE_LIMIT escape hatch, so production stays strict by
 * default. The check is evaluated per-request so tests can opt back in.
 */
const limitingDisabled = (): boolean =>
  process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true';

const baseOptions: Partial<Options> = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // max attempts per window per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
  skip: () => limitingDisabled(),
};

/**
 * Build a fresh limiter (each call gets its own in-memory store, so endpoints
 * get independent buckets). `overrides` is used by tests to force the limiter on
 * with a small ceiling.
 */
export const createAuthRateLimiter = (overrides: Partial<Options> = {}) =>
  rateLimit({ ...baseOptions, ...overrides });
