// -----------------------------------------------------------------------
// Findings Expansion — controlled vocabularies + config
//
// Follows the existing String + app-validation convention (see SEVERITIES /
// FINDING_STATUSES in finding.controller.ts). No Prisma enums are used anywhere
// in this schema. Phase 7 will migrate the tunable config below into the
// admin-managed PrivilegeConfig / SystemSetting tables.
// -----------------------------------------------------------------------

// ─── RCA ──────────────────────────────────────────────────────────────────────
export const RCA_METHODS = ['MEDA', 'FIVE_WHYS', 'OTHER'] as const;
export const RCA_STATUSES = ['Draft', 'Complete'] as const;

// MEDA contributing-factor categories (Boeing Maintenance Error Decision Aid).
// Mirrors the cause-code group taxonomy so factors map cleanly to cause groups.
export const RCA_MEDA_CATEGORIES = [
  'Information',
  'Ground Support Equipment/Tools/Safety Equipment',
  'Aircraft Design/Configuration/Parts',
  'Job/Task',
  'Knowledge/Skills',
  'Individual Factors',
  'Environment/Facilities',
  'Organizational Factors',
  'Leadership/Supervision',
  'Communication',
] as const;

// ─── CAPA ─────────────────────────────────────────────────────────────────────
export const CAPA_TYPES = ['CORRECTIVE', 'PREVENTIVE'] as const;
export const CAPA_STATUSES = ['Open', 'In Progress', 'Completed', 'Verified', 'Waived'] as const;

// ─── Traceability ─────────────────────────────────────────────────────────────
export const LINK_TYPES = ['DUPLICATE', 'RELATED', 'CAUSED_BY'] as const;

// ─── Trend engine config (tunable now; admin-managed in Phase 7) ──────────────
// A finding is flagged "recurring" when this many findings (inclusive of itself)
// share the same Department + ATA Chapter + Cause Code AND ≥1 Hazard Tag within
// the rolling window.
export const TREND_THRESHOLD = 3;
export const TREND_WINDOW_DAYS = 180;

// ─── AuditLog actionType strings ──────────────────────────────────────────────
export const FINDING_EXPANSION_ACTIONS = {
  RCA_UPDATED: 'RCA_UPDATED',
  CAPA_CREATED: 'CAPA_CREATED',
  CAPA_UPDATED: 'CAPA_UPDATED',
  CAPA_VERIFIED: 'CAPA_VERIFIED',
  CAPA_WAIVED: 'CAPA_WAIVED',
  CAPA_DELETED: 'CAPA_DELETED',
  FINDING_LINKED: 'FINDING_LINKED',
  FINDING_UNLINKED: 'FINDING_UNLINKED',
  TAXONOMY_SET: 'TAXONOMY_SET',
} as const;

export type RcaMethod = (typeof RCA_METHODS)[number];
export type CapaType = (typeof CAPA_TYPES)[number];
export type LinkType = (typeof LINK_TYPES)[number];
