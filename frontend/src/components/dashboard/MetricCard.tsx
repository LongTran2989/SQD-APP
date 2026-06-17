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
    <div className="bg-white/80 backdrop-blur-md p-6 rounded-2xl shadow-sm hover:shadow-md border border-slate-100 flex flex-col transition-all duration-300 hover:-translate-y-1 group">
      <div className="flex items-center space-x-3 mb-4">
        <div className={`p-2 rounded-lg ${iconBgColor}`}>
          <div className={`${iconTextColor}`}>{icon}</div>
        </div>
        <h2 className="text-lg font-semibold text-slate-700">{title}</h2>
      </div>
      
      {isLoading ? (
        <div className="animate-pulse flex flex-col gap-2 mt-1">
          <div className="h-10 bg-slate-200 rounded w-16"></div>
          {subtitle && <div className="h-4 bg-slate-200 rounded w-32 mt-1"></div>}
        </div>
      ) : (
        <>
          <span className="text-4xl font-bold text-slate-800 tracking-tight">{value}</span>
          {subtitle && <span className="text-sm text-slate-500 mt-2 font-medium">{subtitle}</span>}
        </>
      )}
    </div>
  );
}
