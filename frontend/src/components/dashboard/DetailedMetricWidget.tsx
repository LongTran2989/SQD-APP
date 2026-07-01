import React from 'react';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface BreakdownItem {
  label: string;
  value: number;
  colorClass: string;
  urgent?: boolean;
  /** Drill-through to the filtered list for this status (e.g. /dashboard/tasks?status=Overdue). */
  href?: string;
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
  // Urgent items (e.g. Overdue) are promoted out of the list so they read
  // as a distinguished top-line figure instead of one row among several —
  // this also keeps the remaining breakdown within the ≤4 chunking limit.
  const urgentItem = breakdown.find((item) => item.urgent);
  const restItems = breakdown.filter((item) => !item.urgent);

  return (
    <div className="p-5 sm:p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <div className={`p-1.5 rounded-md ${iconBgColor}`}>
            <div className={`${iconTextColor} [&>svg]:w-4 [&>svg]:h-4`}>{icon}</div>
          </div>
          <h2 className="text-sm font-semibold text-slate-600">{title}</h2>
        </div>
        {linkTo && !isLoading && (
          <Link href={linkTo} className="text-xs font-semibold text-signal-blue hover:text-signal-blue-hover flex items-center">
            View All <ChevronRight className="w-3.5 h-3.5 ml-0.5" aria-hidden="true" />
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
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <span className="text-3xl font-bold text-slate-800 tracking-tight">{total}</span>
              <span className="text-xs text-slate-500 ml-2 font-medium">Total</span>
            </div>
            {urgentItem && (() => {
              const content = (
                <>
                  <span className="text-2xl font-extrabold leading-none tracking-tight">{urgentItem.value}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide mt-0.5">{urgentItem.label}</span>
                </>
              );
              const className = `flex flex-col items-end ${urgentItem.value > 0 ? 'text-red-finding' : 'text-slate-400'}`;
              return urgentItem.href ? (
                <Link
                  href={urgentItem.href}
                  className={`${className} hover:opacity-80 transition-opacity`}
                  role="status"
                  aria-live="polite"
                >
                  {content}
                </Link>
              ) : (
                <div
                  className={className}
                  role={urgentItem.value > 0 ? 'status' : undefined}
                  aria-live={urgentItem.value > 0 ? 'polite' : undefined}
                >
                  {content}
                </div>
              );
            })()}
          </div>
          <div className="space-y-2 mt-auto">
            {restItems.map((item, idx) => {
              const rowContent = (
                <>
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${item.colorClass}`} aria-hidden="true"></div>
                    <span className="font-medium text-slate-600">{item.label}</span>
                  </div>
                  <span className="font-bold px-2 py-0.5 rounded-md text-slate-700 bg-slate-50">
                    {item.value}
                  </span>
                </>
              );
              return item.href ? (
                <Link key={idx} href={item.href} className="flex justify-between items-center text-sm px-2 py-1 -mx-2 rounded-lg hover:bg-slate-50 transition-colors">
                  {rowContent}
                </Link>
              ) : (
                <div key={idx} className="flex justify-between items-center text-sm px-2 py-1 -mx-2">
                  {rowContent}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
