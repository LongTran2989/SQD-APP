import { FindingSeverity, FindingStatus, CapaType, CapaStatus, FindingLinkType } from '../../types';

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
  'In Progress': { label: 'In Progress', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  'Pending Verification': { label: 'Pending Verification', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  'Closed': { label: 'Closed', color: 'bg-green-50 text-green-700 border-green-200' },
  'Dismissed': { label: 'Dismissed', color: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  const cfg = FINDING_STATUS_CONFIG[status];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>{cfg.label}</span>;
}

// ─── CAPA ─────────────────────────────────────────────────────────────────────

const CAPA_TYPE_CONFIG: Record<CapaType, { label: string; color: string }> = {
  CORRECTIVE: { label: 'Corrective', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  PREVENTIVE: { label: 'Preventive', color: 'bg-purple-50 text-purple-700 border-purple-200' },
};

export function CapaTypeBadge({ type }: { type: CapaType }) {
  const cfg = CAPA_TYPE_CONFIG[type];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>{cfg.label}</span>;
}

const CAPA_STATUS_CONFIG: Record<CapaStatus, { label: string; color: string }> = {
  'Open': { label: 'Open', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  'In Progress': { label: 'In Progress', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  'Completed': { label: 'Completed', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  'Verified': { label: 'Verified', color: 'bg-green-50 text-green-700 border-green-200' },
  'Waived': { label: 'Waived', color: 'bg-amber-50 text-amber-700 border-amber-200' },
};

export function CapaStatusBadge({ status }: { status: CapaStatus }) {
  const cfg = CAPA_STATUS_CONFIG[status];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>{cfg.label}</span>;
}

// ─── Finding link type ────────────────────────────────────────────────────────

const LINK_TYPE_CONFIG: Record<FindingLinkType, { label: string; color: string }> = {
  DUPLICATE: { label: 'Duplicate', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  RELATED: { label: 'Related', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  CAUSED_BY: { label: 'Caused by', color: 'bg-orange-50 text-orange-700 border-orange-200' },
};

export function LinkTypeBadge({ linkType }: { linkType: FindingLinkType }) {
  const cfg = LINK_TYPE_CONFIG[linkType];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>{cfg.label}</span>;
}

// ─── Response Action ──────────────────────────────────────────────────────────

const RESPONSE_ACTION_STYLES: Record<string, string> = {
  IR:            'bg-blue-100 text-blue-700',
  CAR:           'bg-amber-100 text-amber-700',
  NCR:           'bg-amber-100 text-amber-700',
  QR:            'bg-orange-100 text-orange-700',
  QN:            'bg-purple-100 text-purple-700',
  Dissemination: 'bg-green-100 text-green-700',
};

export function ResponseActionBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${RESPONSE_ACTION_STYLES[type] ?? 'bg-slate-100 text-slate-600'}`}>
      {type}
    </span>
  );
}
