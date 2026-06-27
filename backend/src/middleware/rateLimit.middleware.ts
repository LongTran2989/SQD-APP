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

/**
 * Per-USER write limiter for authenticated mutation endpoints (feed comments,
 * escalation flags, task activity). Unlike the auth limiter this keys on the
 * authenticated userId — not IP — so a shared NAT/office IP doesn't penalise
 * everyone and a single account can't spam writes (each comment fans out an SSE
 * signal + watcher notifications). See H3 in FEED_FEATURES_AUDIT.md.
 *
 * Must be mounted AFTER authenticateJWT so req.user is populated. Disabled under
 * test / DISABLE_RATE_LIMIT via the shared skip, like the auth limiter.
 */
export const createMutationRateLimiter = (overrides: Partial<Options> = {}) =>
  rateLimit({
    ...baseOptions,
    windowMs: 60 * 1000, // 1 minute
    limit: 30, // generous: normal use never hits this; a script does
    // Key on the authenticated user; fall back to IP only if (unexpectedly)
    // unauthenticated. keyGeneratorIpFallback validation is off because the
    // primary key is the userId, not the request IP.
    keyGenerator: (req) => String(req.user?.userId ?? req.ip),
    validate: { keyGeneratorIpFallback: false },
    ...overrides,
  });
