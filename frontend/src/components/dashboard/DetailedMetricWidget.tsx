import React from 'react';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface BreakdownItem {
  label: string;
  value: number;
  colorClass: string;
  urgent?: boolean;
}

interface DetailedMetricWidgetProps {
  title: string;
  icon: React.ReactNode;
  iconBgColor: string;
  iconTextColor: string;
  breakdown: BreakdownItem[];
  isLoading?: boolean;
  linkTo?: string;
}

export function DetailedMetricWidget({
  title,
  icon,
  iconBgColor,
  iconTextColor,
  breakdown,
  isLoading,
  linkTo
}: DetailedMetricWidgetProps) {
  const total = breakdown.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${iconBgColor}`}>
            <div className={`${iconTextColor}`}>{icon}</div>
          </div>
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        </div>
        {linkTo && !isLoading && (
          <Link href={linkTo} className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center">
            View All <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3 mt-2">
          <div className="h-8 bg-slate-200 rounded w-16 mb-4"></div>
          {[1, 2, 3].map(i => (
            <div key={i} className="flex justify-between items-center">
              <div className="h-4 bg-slate-200 rounded w-1/3"></div>
              <div className="h-4 bg-slate-200 rounded w-8"></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="mb-4">
            <span className="text-3xl font-bold text-slate-800 tracking-tight">{total}</span>
            <span className="text-sm text-slate-500 ml-2 font-medium">Total</span>
          </div>
          <div className="space-y-2 mt-auto">
            {breakdown.map((item, idx) => (
              <div key={idx} className={`flex justify-between items-center text-sm rounded-lg px-2 py-1 -mx-2 ${item.urgent && item.value > 0 ? 'bg-red-50' : ''}`}>
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${item.colorClass}`} aria-hidden="true"></div>
                  <span className={`font-medium ${item.urgent && item.value > 0 ? 'text-red-700' : 'text-slate-600'}`}>{item.label}</span>
                </div>
                <span className={`font-bold px-2 py-0.5 rounded-md ${item.urgent && item.value > 0 ? 'text-red-700 bg-red-100' : 'text-slate-700 bg-slate-50'}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
