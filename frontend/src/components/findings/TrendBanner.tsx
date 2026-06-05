'use client';

import { TrendInfo } from '../../types';
import { TrendingUp } from 'lucide-react';

export default function TrendBanner({ trend }: { trend: TrendInfo | undefined }) {
  if (!trend?.isRecurring) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <TrendingUp className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold text-amber-800">Recurrent pattern detected</p>
        <p className="text-amber-700">
          {trend.matchCount} findings sharing this Department + ATA Chapter + Cause Code + Hazard Tag in the last{' '}
          {trend.windowDays} days (threshold {trend.threshold}). Consider a systemic preventive action.
        </p>
      </div>
    </div>
  );
}
