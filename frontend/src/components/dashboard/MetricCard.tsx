import React from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  iconBgColor: string;
  iconTextColor: string;
  isLoading?: boolean;
}

export function MetricCard({ title, value, subtitle, icon, iconBgColor, iconTextColor, isLoading }: MetricCardProps) {
  return (
    <div className="p-5 sm:p-6 flex flex-col h-full">
      <div className="flex items-center space-x-3 mb-3">
        <div className={`p-1.5 rounded-md ${iconBgColor}`}>
          <div className={`${iconTextColor} [&>svg]:w-4 [&>svg]:h-4`}>{icon}</div>
        </div>
        <h2 className="text-sm font-semibold text-slate-600">{title}</h2>
      </div>

      {isLoading ? (
        <div className="animate-pulse flex flex-col gap-2 mt-1">
          <div className="h-9 bg-slate-200 rounded w-16"></div>
          {subtitle && <div className="h-4 bg-slate-200 rounded w-32 mt-1"></div>}
        </div>
      ) : (
        <>
          <span className="text-3xl font-bold text-slate-800 tracking-tight">{value}</span>
          {subtitle && <span className="text-xs text-slate-500 mt-1.5 font-medium">{subtitle}</span>}
        </>
      )}
    </div>
  );
}
