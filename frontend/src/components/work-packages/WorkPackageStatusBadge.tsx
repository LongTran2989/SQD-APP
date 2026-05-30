'use client';

import { WpStatus } from '../../types';
import {
  Circle,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
} from 'lucide-react';

export const WP_STATUS_CONFIG: Record<
  WpStatus,
  { color: string; dotColor: string; label: string; icon: React.ElementType }
> = {
  Open: {
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    dotColor: 'bg-blue-500',
    label: 'Open',
    icon: Circle,
  },
  'In Progress': {
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    dotColor: 'bg-indigo-500',
    label: 'In Progress',
    icon: Loader2,
  },
  Overdue: {
    color: 'bg-red-50 text-red-700 border-red-200',
    dotColor: 'bg-red-500',
    label: 'Overdue',
    icon: AlertTriangle,
  },
  Closed: {
    color: 'bg-green-50 text-green-700 border-green-200',
    dotColor: 'bg-green-500',
    label: 'Closed',
    icon: CheckCircle2,
  },
  Inactive: {
    color: 'bg-slate-100 text-slate-400 border-slate-200',
    dotColor: 'bg-slate-300',
    label: 'Inactive',
    icon: MinusCircle,
  },
};

interface WorkPackageStatusBadgeProps {
  status: WpStatus;
  size?: 'sm' | 'md';
}

export default function WorkPackageStatusBadge({ status, size = 'md' }: WorkPackageStatusBadgeProps) {
  const config = WP_STATUS_CONFIG[status];
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
