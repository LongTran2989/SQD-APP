import { FindingSeverity, FindingStatus } from '../../types';

// ─── Severity ───────────────────────────────────────────────────────────────

export const SEVERITY_CONFIG: Record<FindingSeverity, { label: string; color: string }> = {
  'Observation': { label: 'Observation', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  'Level 1': { label: 'Level 1', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  'Level 2': { label: 'Level 2', color: 'bg-red-50 text-red-700 border-red-200' },
};

export function SeverityBadge({ severity }: { severity: FindingSeverity | null }) {
  if (!severity) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold border bg-slate-50 text-slate-400 border-slate-200">Unset</span>;
  }
  const cfg = SEVERITY_CONFIG[severity];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>{cfg.label}</span>;
}

// ─── Status ─────────────────────────────────────────────────────────────────

export const FINDING_STATUS_CONFIG: Record<FindingStatus, { label: string; color: string }> = {
  'Open': { label: 'Open', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  'In Progress': { label: 'In Progress', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  'Pending Verification': { label: 'Pending Verification', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  'Closed': { label: 'Closed', color: 'bg-green-50 text-green-700 border-green-200' },
};

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  const cfg = FINDING_STATUS_CONFIG[status];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>{cfg.label}</span>;
}
