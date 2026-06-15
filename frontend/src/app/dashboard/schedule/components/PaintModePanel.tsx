'use client';

import { ShiftType } from '../../../../api/scheduleApi';
import { X } from 'lucide-react';

interface PaintModePanelProps {
  shiftTypes: ShiftType[];
  selectedShiftId: number | null;
  onSelect: (id: number) => void;
  onExit: () => void;
}

export default function PaintModePanel({ shiftTypes, selectedShiftId, onSelect, onExit }: PaintModePanelProps) {
  // Group by groupName
  const groups = shiftTypes.reduce<Record<string, ShiftType[]>>((acc, st) => {
    const g = st.groupName ?? st.groupCode ?? 'Other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(st);
    return acc;
  }, {});

  return (
    <div className="w-56 shrink-0 bg-white border border-slate-200 rounded-2xl shadow-lg p-4 space-y-4 max-h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Paint Mode</h3>
        <button onClick={onExit} className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-slate-400">Click cells to fill with selected shift</p>

      {Object.entries(groups).map(([groupName, shifts]) => (
        <div key={groupName}>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{groupName}</p>
          <div className="space-y-1">
            {shifts.map((st) => (
              <button
                key={st.id}
                onClick={() => onSelect(st.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedShiftId === st.id
                    ? 'ring-2 ring-blue-500 bg-blue-50'
                    : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className="w-5 h-5 rounded shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ backgroundColor: st.color }}
                >
                  {st.code.slice(0, 2)}
                </span>
                <span className="truncate text-slate-700">{st.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
