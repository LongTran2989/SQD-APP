// Canonical display reference for a Finding. Prefers the human-readable business
// code (findingId, e.g. FND-000001) and falls back to the numeric id (#8) for any
// legacy finding not yet backfilled, or for lightweight refs (e.g. task.parentFinding)
// that only carry the id. Render as `Finding ${formatFindingRef(f)}`.
export function formatFindingRef(f: { id: number; findingId?: string | null }): string {
  return f.findingId ?? `#${f.id}`;
}
