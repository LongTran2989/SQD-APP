/**
 * Centralized, validated access to security-critical environment variables.
 *
 * Importing this module fails fast (throws at startup) if a required secret is
 * missing, so the app can never silently fall back to a well-known default
 * value that would allow token forgery. See CLAUDE_HANDOVER.md §11, Fix 4.
 */

export const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'FATAL: JWT_SECRET is not set. Refusing to start without a configured ' +
        'signing secret (no insecure default is permitted).'
    );
  }
  return secret;
})();
