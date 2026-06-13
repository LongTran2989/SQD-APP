// Canonical Finding taxonomy — the single source of truth for Finding severity
// and status values. Imported by both finding.controller.ts (validation) and
// analytics.controller.ts (bucket seeding + ?severity validation) so the lists
// can never drift out of sync.
//
// Kept as plain string[] (not `as const`) so `.includes(someString)` type-checks
// without narrowing the argument to the literal union.

// Severity is nullable until a finding is reviewed.
export const FINDING_SEVERITIES: string[] = ['Observation', 'Level 1', 'Level 2'];

// Finding status machine: Open → In Progress → Pending Verification → Closed,
// with Dismissed as a terminal off-ramp.
export const FINDING_STATUSES: string[] = [
  'Open',
  'In Progress',
  'Pending Verification',
  'Closed',
  'Dismissed',
];
