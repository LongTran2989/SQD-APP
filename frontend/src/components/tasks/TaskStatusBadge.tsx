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

export const STATUS_CONFIG: Record<
  TaskStatus,
  { color: string; dotColor: string; label: string; icon: React.ElementType }
> = {
  Unassigned: {
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    dotColor: 'bg-slate-400',
    label: 'Unassigned',
    icon: Clock,
  },
  Assigned: {
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    dotColor: 'bg-blue-500',
    label: 'Assigned',
    icon: User,
  },
  'In Progress': {
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    dotColor: 'bg-indigo-500',
    label: 'In Progress',
    icon: Loader2,
  },
  'In Review': {
    color: 'bg-amber-50 text-amber-700 border-amber-200',
    dotColor: 'bg-amber-500',
    label: 'In Review',
    icon: AlertCircle,
  },
  'Follow-up Required': {
    color: 'bg-orange-50 text-orange-700 border-orange-200',
    dotColor: 'bg-orange-500',
    label: 'Follow-up Required',
    icon: MessageSquare,
  },
  Closed: {
    color: 'bg-green-50 text-green-700 border-green-200',
    dotColor: 'bg-green-500',
    label: 'Closed',
    icon: CheckCircle2,
  },
  Rejected: {
    color: 'bg-rose-50 text-rose-700 border-rose-200',
    dotColor: 'bg-rose-500',
    label: 'Rejected',
    icon: XCircle,
  },
  Terminated: {
    color: 'bg-slate-200 text-slate-500 border-slate-300',
    dotColor: 'bg-slate-400',
    label: 'Terminated',
    icon: Ban,
  },
  Inactive: {
    color: 'bg-slate-100 text-slate-400 border-slate-200',
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
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dotColor}`} />
      {config.label}
    </span>
  );
}
