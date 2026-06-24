/**
 * Finding-workflow policy constants.
 *
 * Like FILE_UPLOAD_CONFIG (Rule 10), the regulatory *policy* values here are
 * Admin-configurable and are NOT hardcoded as the enforced value — they live in
 * the `SystemSetting` row keyed `FINDING_WORKFLOW_CONFIG` (JSON) and are read at
 * request time (see `getFindingWorkflowConfig` in services/findingService.ts).
 * `DEFAULT_FINDING_WORKFLOW_CONFIG` below is only the seed / fallback used when
 * the row is missing or invalid.
 *
 * Two severity-keyed policies:
 *  - `closureGate` — for each severity, whether a Complete RCA and/or ≥1 Verified
 *    CORRECTIVE CAPA is REQUIRED before the finding may close. This turns the
 *    "enforce only if present" close-gate into a true closed loop for graded
 *    findings (EASA Part 145 Level 1/Level 2), while leaving Observations light.
 *  - `sla` — for each severity, the default corrective-action timescale in days
 *    and whether a due date is mandatory at review time.
 *
 * Severity keys mirror FINDING_SEVERITIES (constants/findingTaxonomy.ts).
 */

import { FINDING_SEVERITIES } from './findingTaxonomy';

export const FINDING_WORKFLOW_CONFIG_KEY = 'FINDING_WORKFLOW_CONFIG';

export interface ClosureGateRule {
  /** RCA must exist AND be Complete before the finding may close. */
  requireRca: boolean;
  /** At least one CORRECTIVE CAPA must exist AND be Verified before closing. */
  requireCorrectiveCapa: boolean;
}

export interface SlaRule {
  /** Default corrective-action timescale in days, or null for no default. */
  days: number | null;
  /** Whether a due date is mandatory at review time for this severity. */
  mandatory: boolean;
}

export interface FindingWorkflowConfig {
  /** Severity → closure-gate requirements. */
  closureGate: Record<string, ClosureGateRule>;
  /** Severity → SLA / due-date policy. */
  sla: Record<string, SlaRule>;
}

/** Seed / fallback policy. Observations stay lightweight; graded findings are gated. */
export const DEFAULT_FINDING_WORKFLOW_CONFIG: FindingWorkflowConfig = {
  closureGate: {
    Observation: { requireRca: false, requireCorrectiveCapa: false },
    'Level 1': { requireRca: true, requireCorrectiveCapa: true },
    'Level 2': { requireRca: true, requireCorrectiveCapa: true },
  },
  sla: {
    Observation: { days: null, mandatory: false },
    'Level 1': { days: 7, mandatory: true },
    'Level 2': { days: 30, mandatory: true },
  },
};

/** Closure-gate rule for a severity, falling back to "no extra gate" when unknown/null. */
export function closureGateForSeverity(
  config: FindingWorkflowConfig,
  severity: string | null | undefined
): ClosureGateRule {
  if (severity && config.closureGate[severity]) return config.closureGate[severity];
  return { requireRca: false, requireCorrectiveCapa: false };
}

/** SLA rule for a severity, falling back to "no default, not mandatory" when unknown/null. */
export function slaForSeverity(
  config: FindingWorkflowConfig,
  severity: string | null | undefined
): SlaRule {
  if (severity && config.sla[severity]) return config.sla[severity];
  return { days: null, mandatory: false };
}

/**
 * Validates an arbitrary parsed JSON value as a FindingWorkflowConfig. Returns
 * the typed config, or null when the shape is invalid (caller falls back to
 * default). Every known severity must have both a closureGate and an sla entry.
 */
export function parseFindingWorkflowConfig(value: unknown): FindingWorkflowConfig | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!v.closureGate || typeof v.closureGate !== 'object') return null;
  if (!v.sla || typeof v.sla !== 'object') return null;

  const gateRaw = v.closureGate as Record<string, unknown>;
  const slaRaw = v.sla as Record<string, unknown>;
  const closureGate: Record<string, ClosureGateRule> = {};
  const sla: Record<string, SlaRule> = {};

  for (const severity of FINDING_SEVERITIES) {
    const g = gateRaw[severity];
    if (!g || typeof g !== 'object') return null;
    const go = g as Record<string, unknown>;
    if (typeof go.requireRca !== 'boolean' || typeof go.requireCorrectiveCapa !== 'boolean') return null;
    closureGate[severity] = {
      requireRca: go.requireRca,
      requireCorrectiveCapa: go.requireCorrectiveCapa,
    };

    const s = slaRaw[severity];
    if (!s || typeof s !== 'object') return null;
    const so = s as Record<string, unknown>;
    const daysOk = so.days === null || (typeof so.days === 'number' && so.days > 0);
    if (!daysOk || typeof so.mandatory !== 'boolean') return null;
    sla[severity] = {
      days: (so.days as number | null) ?? null,
      mandatory: so.mandatory,
    };
  }

  return { closureGate, sla };
}
