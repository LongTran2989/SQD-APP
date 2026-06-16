'use client';

import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, User, Users, Tags, ShieldCheck, Database } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import AccountSettings from '../../../components/settings/AccountSettings';
import UserManagementSettings from '../../../components/settings/UserManagementSettings';
import TaxonomySettings from '../../../components/settings/TaxonomySettings';
import PrivilegesSettings from '../../../components/settings/PrivilegesSettings';
import ReferenceDataSettings from '../../../components/settings/ReferenceDataSettings';

type SettingsTab = 'my-account' | 'user-management' | 'taxonomy' | 'privileges' | 'reference-data';

const ADMIN_DIRECTOR = ['Admin', 'Director'];
const ADMIN_ONLY = ['Admin'];

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);

  const isAdminDirector = user ? ADMIN_DIRECTOR.includes(user.role) : false;
  const isAdmin = user ? ADMIN_ONLY.includes(user.role) : false;

  const rawTab = searchParams.get('tab') as SettingsTab | null;

  // Default tab: User Management for Admin/Director, My Account for everyone else.
  const defaultTab: SettingsTab = isAdminDirector ? 'user-management' : 'my-account';

  // Clamp to valid + accessible tab.
  const resolveTab = (t: SettingsTab | null): SettingsTab => {
    if (!t) return defaultTab;
    if ((t === 'privileges' || t === 'reference-data') && !isAdmin) return defaultTab;
    if ((t === 'user-management' || t === 'taxonomy') && !isAdminDirector) return 'my-account';
    return t;
  };

  const activeTab = resolveTab(rawTab);

  // On first load, if no tab param, push the default so the URL is canonical.
  useEffect(() => {
    if (!rawTab) {
      router.replace(`/dashboard/settings?tab=${defaultTab}`);
    }
  }, [rawTab, defaultTab, router]);

  const setTab = (tab: SettingsTab) => {
    router.push(`/dashboard/settings?tab=${tab}`);
  };

  const tabs: { key: SettingsTab; label: string; Icon: LucideIcon; show: boolean }[] = [
    { key: 'my-account',       label: 'My Account',       Icon: User,        show: true },
    { key: 'user-management',  label: 'User Management',  Icon: Users,       show: isAdminDirector },
    { key: 'taxonomy',         label: 'Taxonomy',         Icon: Tags,        show: isAdminDirector },
    { key: 'privileges',       label: 'Privileges',       Icon: ShieldCheck, show: isAdmin },
    { key: 'reference-data',   label: 'Reference Data',   Icon: Database,    show: isAdmin },
  ];

  return (
    <div>
      {/* Page header + tab bar */}
      <div className="px-8 pt-8 pb-0">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Settings className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
            <p className="text-sm text-slate-500">Manage your account and workspace configuration</p>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-slate-200">
          {tabs.filter((t) => t.show).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <tab.Icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'my-account'      && <AccountSettings />}
      {activeTab === 'user-management' && <UserManagementSettings />}
      {activeTab === 'taxonomy'        && <TaxonomySettings />}
      {activeTab === 'privileges'      && <PrivilegesSettings />}
      {activeTab === 'reference-data'  && <ReferenceDataSettings />}
    </div>
  );
}
