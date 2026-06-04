'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { listFindings } from '../../api/findingApi';
import { ESCALATION_ACTION_ROLES } from '../../constants/escalationRoles';
import {
  LayoutDashboard,
  ClipboardList,
  FileCheck2,
  FolderOpen,
  AlertTriangle,
  LayoutPanelTop,
  Globe,
  Flag,
  Users,
  Settings
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const roleName = user?.role;

  // Open + In Progress findings count, scoped to the viewer's RBAC visibility
  // (the backend list endpoint applies the scope automatically).
  const [openFindings, setOpenFindings] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      listFindings({ status: 'Open', pageSize: 1 }),
      listFindings({ status: 'In Progress', pageSize: 1 }),
    ])
      .then(([open, inProgress]) => {
        if (!cancelled) setOpenFindings(open.total + inProgress.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Tasks', href: '/dashboard/tasks', icon: ClipboardList, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Work Packages', href: '/dashboard/work-packages', icon: FolderOpen, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Findings', href: '/dashboard/findings', icon: AlertTriangle, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'], badge: openFindings },
    { name: 'Division Board', href: '/dashboard/division-board', icon: LayoutPanelTop, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Org Feed', href: '/dashboard/org-feed', icon: Globe, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Escalations', href: '/dashboard/escalations', icon: Flag, roles: ESCALATION_ACTION_ROLES },
    { name: 'Template Builder', href: '/dashboard/templates', icon: FileCheck2, roles: ['Admin', 'Director', 'Manager'] },
    { name: 'User Management', href: '/dashboard/users', icon: Users, roles: ['Admin', 'Director'] },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
  ];

  const allowedNav = navigation.filter(item => 
    !item.roles || (roleName && item.roles.includes(roleName))
  );

  return (
    <div className="w-64 bg-white border-r border-slate-200 h-full flex flex-col shadow-sm">
      <div className="p-6 flex items-center space-x-3 border-b border-slate-100">
        <div className="w-8 h-8 flex items-center justify-center">
          <img src="/logo.png" alt="SQD Logo" className="w-full h-full object-contain" />
        </div>
        <span className="text-xl font-bold text-slate-800 tracking-tight">SQD-APP</span>
      </div>
      
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {allowedNav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl transition-colors ${
                isActive 
                  ? 'bg-blue-50 text-blue-700 font-medium' 
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
              <span className="flex-1">{item.name}</span>
              {'badge' in item && typeof item.badge === 'number' && item.badge > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-slate-100">
        <div className="bg-slate-50 rounded-xl p-3 flex flex-col">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Current Role</span>
          <span className="text-sm font-medium text-slate-700">{roleName || 'Unknown'}</span>
        </div>
      </div>
    </div>
  );
}
