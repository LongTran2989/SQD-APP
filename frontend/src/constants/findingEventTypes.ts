// Canonical finding event-type vocabulary, shared by every place a finding can
// be raised (the task RaiseFindingPanel and the escalation Raise-Finding modal)
// so the two never diverge. Replaced by an admin-managed EventType table in
// Phase 7; until then this single list is the source of truth. "Other" lets the
// reporter type a free-text value.
export const FINDING_EVENT_TYPES = [
  'Procedural Breach',
  'Equipment Fault',
  'Documentation Error',
  'Maintenance Error',
  'Safety Observation',
  'Regulatory Non-compliance',
  'Training Gap',
  'Communication Failure',
  'Other',
] as const;
