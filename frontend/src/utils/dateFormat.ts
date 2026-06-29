// Shared date formatting helpers.

/**
 * Format a finding due date for display.
 *
 * A due date is a calendar DAY: it is entered date-only (`<input type="date">`),
 * sent to the API as `YYYY-MM-DD`, and persisted as UTC midnight. Formatting it
 * in the browser's local zone shifts the shown day by one in negative-UTC-offset
 * timezones (UTC midnight renders as the previous day) and disagrees with the
 * day the editor prefills. Render it in UTC so the shown day always matches the
 * entered/stored day and round-trips cleanly through the edit modal.
 *
 * Use this for any finding `dueDate`. For real instants (createdAt, updatedAt,
 * task deadlines that carry a time component) keep local-zone formatting.
 */
export function formatDueDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
