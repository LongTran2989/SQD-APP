'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { getDivisions } from '../../../api/taskApi';
import FeedPanel from '../../../components/feed/FeedPanel';
import { LayoutPanelTop } from 'lucide-react';

const SWITCH_ROLES = ['Director', 'Admin'];

// Division Board feed (DIVISION scope). Defaults to the viewer's own division;
// Director / Admin may switch to any division. Reading is open to all; posting
// is own-division only (Director/Admin bypass) — enforced by the backend and
// mirrored by FeedPanel.
export default function DivisionBoardPage() {
  const { user } = useAuthStore();
  const canSwitch = !!user && SWITCH_ROLES.includes(user.role);

  const [divisions, setDivisions] = useState<{ value: string; label: string }[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | null>(user?.divisionId ?? null);

  useEffect(() => {
    if (!canSwitch) return;
    getDivisions().then(setDivisions).catch(() => {});
  }, [canSwitch]);

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <LayoutPanelTop className="w-5 h-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-800">Division Board</h1>
          <p className="text-sm text-slate-500">Division-wide discussion and escalations.</p>
        </div>

        {canSwitch && divisions.length > 0 && (
          <select
            value={selectedDivisionId ?? ''}
            onChange={(e) => setSelectedDivisionId(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {divisions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedDivisionId == null ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-400 text-sm">
          You are not assigned to a division.
        </div>
      ) : (
        <div className="h-[calc(100vh-12rem)]">
          <FeedPanel
            key={selectedDivisionId}
            scope="DIVISION"
            scopeId={selectedDivisionId}
            currentUser={user}
            title="Division Board"
          />
        </div>
      )}
    </div>
  );
}
