'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { useUIStore } from '../../store/uiStore';
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
  Settings,
  BarChart2,
  Layers,
  Rocket,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';

function SidebarInner({
  collapsed,
  isMobile = false,
}: {
  collapsed: boolean;
  isMobile?: boolean;
}) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const roleName = user?.role;
  const { toggleSidebarCollapsed, setMobileSidebarOpen } = useUIStore();

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
    return () => { cancelled = true; };
  }, [user]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile) setMobileSidebarOpen(false);
  }, [pathname, isMobile, setMobileSidebarOpen]);

  const navigation = [
    // ── Operational (daily) ────────────────────────────────────────────────────
    { name: 'Dashboard',         href: '/dashboard',                  icon: LayoutDashboard, roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Tasks',             href: '/dashboard/tasks',            icon: ClipboardList,   roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Work Packages',     href: '/dashboard/work-packages',    icon: FolderOpen,      roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Findings',          href: '/dashboard/findings',         icon: AlertTriangle,   roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'], badge: openFindings, iconColor: 'text-amber-500' },
    { name: 'Escalations',       href: '/dashboard/escalations',      icon: Flag,            roles: ESCALATION_ACTION_ROLES, iconColor: 'text-red-500' },
    // ── Communication ──────────────────────────────────────────────────────────
    { name: 'Division Feed',     href: '/dashboard/division-board',   icon: LayoutPanelTop,  roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    { name: 'Organisation Feed', href: '/dashboard/org-feed',         icon: Globe,           roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
    // ── Planning & configuration ───────────────────────────────────────────────
    { name: 'Analytics',         href: '/dashboard/analytics',        icon: BarChart2,       roles: ['Admin', 'Director', 'Manager'] },
    { name: 'Master Calendar',   href: '/dashboard/master-calendar',  icon: CalendarClock,   roles: ['Admin', 'Director', 'Manager'] },
    { name: 'Template Builder',  href: '/dashboard/templates',        icon: FileCheck2,      roles: ['Admin', 'Director', 'Manager'] },
    { name: 'Template Sets',     href: '/dashboard/template-sets',    icon: Layers,          roles: ['Admin', 'Director', 'Manager'] },
    { name: 'WP Blueprints',     href: '/dashboard/wp-blueprints',    icon: Rocket,          roles: ['Admin', 'Director', 'Manager'] },
    // ── Always last ────────────────────────────────────────────────────────────
    { name: 'Settings',          href: '/dashboard/settings',         icon: Settings,        roles: ['Admin', 'Director', 'Manager', 'Group Leader', 'Staff'] },
  ];

  const allowedNav = navigation.filter(
    (item) => !item.roles || (roleName && item.roles.includes(roleName))
  );


  const renderNavItem = (item: typeof navigation[number]) => {
    // Exact match for /dashboard to avoid highlighting it on every sub-route
    const isActive = item.href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.name}
        href={item.href}
        title={collapsed ? item.name : undefined}
        aria-label={collapsed ? item.name : undefined}
        className={`flex items-center rounded-xl transition-colors ${
          collapsed ? 'justify-center p-3' : 'space-x-3 px-3 py-2.5'
        } ${
          isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <div className="relative flex-shrink-0">
          <item.icon
            className={`w-5 h-5 ${isActive ? 'text-blue-600' : (item.iconColor ?? 'text-slate-400')}`}
            aria-hidden="true"
          />
          {/* Dot badge in icon-only mode */}
          {collapsed && 'badge' in item && typeof item.badge === 'number' && item.badge > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full" aria-hidden="true" />
          )}
        </div>

        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.name}</span>
            {'badge' in item && typeof item.badge === 'number' && item.badge > 0 && (
              <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                {item.badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Logo bar */}
      <div className={`flex items-center border-b border-slate-100 flex-shrink-0 ${collapsed ? 'justify-center p-4' : 'space-x-3 p-5'}`}>
        <img src="/logo.png" alt="SQD Logo" className="w-8 h-8 object-contain flex-shrink-0" />
        {!collapsed && (
          <span className="text-xl font-bold text-slate-800 tracking-tight truncate">SQD-APP</span>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="ml-auto p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {allowedNav.map(renderNavItem)}
      </nav>

      {/* User identity footer */}
      <div className={`border-t border-slate-100 ${collapsed ? 'p-3 flex justify-center' : 'p-4'}`}>
        {collapsed ? (
          <div
            className="w-8 h-8 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700 text-xs font-bold cursor-default"
            title={`${user?.name ?? ''} · ${roleName ?? ''}`}
          >
            {user?.name?.charAt(0) ?? 'U'}
          </div>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3 flex flex-col">
            <span className="text-[10px] font-semibold text-slate-400 tracking-wide mb-1">Signed in as</span>
            <span className="text-sm font-semibold text-blue-600 truncate">{user?.name ?? 'Unknown'}</span>
            <span className="text-[10px] text-slate-400 mt-0.5">{roleName}</span>
          </div>
        )}
      </div>

      {/* Collapse toggle — desktop only */}
      {!isMobile && (
        <div className="border-t border-slate-100 p-3 flex justify-center">
          <button
            onClick={toggleSidebarCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="p-3 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            {collapsed
              ? <ChevronRight className="w-5 h-5" aria-hidden="true" />
              : <ChevronLeft  className="w-5 h-5" aria-hidden="true" />
            }
          </button>
        </div>
      )}
    </>
  );
}

export default function Sidebar() {
  const { sidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();

  return (
    <>
      {/* Desktop in-flow sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-white border-r border-slate-200 shadow-sm h-full flex-shrink-0 transition-[width] duration-200 motion-reduce:transition-none overflow-hidden ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <SidebarInner collapsed={sidebarCollapsed} />
      </aside>

      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-[var(--z-modal-backdrop,40)] bg-black/30 lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed inset-y-0 left-0 w-64 z-[var(--z-modal,50)] flex flex-col bg-white border-r border-slate-200 shadow-lg lg:hidden"
            aria-modal="true"
            aria-label="Navigation"
          >
            <SidebarInner collapsed={false} isMobile />
          </aside>
        </>
      )}
    </>
  );
}
