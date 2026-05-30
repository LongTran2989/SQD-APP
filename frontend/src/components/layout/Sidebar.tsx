'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import {
  LayoutDashboard,
  ClipboardList,
  FileCheck2,
  FolderOpen,
  Users,
  Settings,
  PlaneTakeoff
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const roleName = user?.role;

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Tasks', href: '/dashboard/tasks', icon: ClipboardList, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Work Packages', href: '/dashboard/work-packages', icon: FolderOpen, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
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
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <PlaneTakeoff className="text-white w-5 h-5" />
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
              <span>{item.name}</span>
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
