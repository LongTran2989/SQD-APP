/**
 * Centralized password policy. Enforced server-side on EVERY path that sets a
 * password (register, update-password, reset-password) so the rules cannot be
 * bypassed by a non-browser/API client — the frontend length check is advisory
 * only. See auth audit H1.
 */

// Minimum length. Mirrors the frontend hint ("at least 8 characters").
export const MIN_PASSWORD_LENGTH = 8;

// bcrypt silently truncates input at 72 BYTES; anything beyond that is not
// actually part of the hash. Reject longer inputs so two passwords that differ
// only past byte 72 are never treated as equal.
export const MAX_PASSWORD_BYTES = 72;

/**
 * Validate a candidate password against policy.
 * @returns a human-readable error message, or `null` if the password is valid.
 */
export const validatePassword = (password: unknown): string | null => {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password is required';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes long`;
  }
  // Require a mix of letters and digits — low-friction complexity that blocks the
  // weakest passwords without forcing symbol gymnastics on an internal tool.
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain both letters and numbers';
  }
  return null;
};
