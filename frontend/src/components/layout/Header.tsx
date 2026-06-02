'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { LogOut, Bell, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getPendingEscalations } from '../../api/escalationApi';

export default function Header() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();

  // Pending escalations the viewer can action (RBAC-scoped server-side). Polled
  // like the Sidebar findings badge — setState lives in the promise callback so
  // it never trips react-hooks/set-state-in-effect.
  const [pendingEscalations, setPendingEscalations] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = () => {
      getPendingEscalations()
        .then((list) => {
          if (!cancelled) setPendingEscalations(list.length);
        })
        .catch(() => {});
    };
    load();
    const intervalId = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [user]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm sticky top-0 z-10">
      <div className="flex items-center bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200 w-64 focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400 transition-all">
        <Search className="w-4 h-4 text-slate-400 mr-2" />
        <input 
          type="text" 
          placeholder="Search SQD..." 
          className="bg-transparent border-none focus:outline-none text-sm w-full text-slate-700"
        />
      </div>

      <div className="flex items-center space-x-4">
        <button
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors relative"
          title={pendingEscalations > 0 ? `${pendingEscalations} pending escalation(s)` : 'No pending escalations'}
        >
          <Bell className="w-5 h-5" />
          {pendingEscalations > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-white">
              {pendingEscalations > 9 ? '9+' : pendingEscalations}
            </span>
          )}
        </button>
        
        <div className="h-8 w-px bg-slate-200 mx-2"></div>
        
        <div className="flex items-center space-x-3">
          <div className="flex flex-col items-end">
            <span className="text-sm font-semibold text-slate-700 leading-tight">{user?.name}</span>
            <span className="text-xs text-slate-500">{user?.email}</span>
          </div>
          <div className="w-9 h-9 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700 font-bold shadow-inner">
            {user?.name?.charAt(0) || 'U'}
          </div>
        </div>

        <button 
          onClick={handleLogout}
          className="ml-2 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
          title="Logout"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
