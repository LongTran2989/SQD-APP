'use client';

import { TaskStatus } from '../../types';
import {
  Clock,
  User,
  Loader2,
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  XCircle,
  Ban,
  MinusCircle,
} from 'lucide-react';

// ─── Status configuration — single source of truth ────────────────────────────

// Every status maps onto one of the four documented design-system tiers
// (Active = Signal Blue, Caution = Amber, Finding = Red, Clear = Emerald) plus
// Neutral. Color encodes severity tier, not a unique per-status hue — this
// keeps the vocabulary consistent with the deadline badges in TaskListPage.
// Neutral badges use ink-secondary, not ink-muted: badge labels are
// functional status info (must clear 4.5:1), not de-emphasized metadata.
export const STATUS_CONFIG: Record<
  TaskStatus,
  { color: string; dotColor: string; label: string; icon: React.ElementType }
> = {
  Unassigned: {
    color: 'bg-slate-100 text-ink-secondary border-slate-200',
    dotColor: 'bg-slate-400',
    label: 'Unassigned',
    icon: Clock,
  },
  Assigned: {
    color: 'bg-signal-blue-surface text-signal-blue border-signal-blue/20',
    dotColor: 'bg-signal-blue',
    label: 'Assigned',
    icon: User,
  },
  'In Progress': {
    color: 'bg-signal-blue-surface text-signal-blue border-signal-blue/20',
    dotColor: 'bg-signal-blue',
    label: 'In Progress',
    icon: Loader2,
  },
  'In Review': {
    color: 'bg-amber-caution-surface text-amber-caution border-amber-caution/20',
    dotColor: 'bg-amber-caution',
    label: 'In Review',
    icon: AlertCircle,
  },
  'Follow-up Required': {
    color: 'bg-amber-caution-surface text-amber-caution border-amber-caution/20',
    dotColor: 'bg-amber-caution',
    label: 'Follow-up Required',
    icon: MessageSquare,
  },
  Closed: {
    color: 'bg-emerald-clear-surface text-emerald-clear border-emerald-clear/20',
    dotColor: 'bg-emerald-clear',
    label: 'Closed',
    icon: CheckCircle2,
  },
  Rejected: {
    color: 'bg-red-finding-surface text-red-finding border-red-finding/20',
    dotColor: 'bg-red-finding',
    label: 'Rejected',
    icon: XCircle,
  },
  Terminated: {
    color: 'bg-slate-200 text-ink-secondary border-slate-300',
    dotColor: 'bg-slate-400',
    label: 'Terminated',
    icon: Ban,
  },
  Inactive: {
    color: 'bg-slate-100 text-ink-secondary border-slate-200',
    dotColor: 'bg-slate-300',
    label: 'Inactive',
    icon: MinusCircle,
  },
};

interface TaskStatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
}

export default function TaskStatusBadge({ status, size = 'md' }: TaskStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;

  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-2 py-0.5 gap-1'
    : 'text-xs px-2.5 py-1 gap-1.5';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border whitespace-nowrap ${config.color} ${sizeClasses}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dotColor}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}
