'use client';

import { useState, useRef, useEffect } from 'react';
import { AtSign, X } from 'lucide-react';
import { MentionUser } from '../../types';
import { mentionSearch } from '../../api/userApi';

interface MentionFieldProps {
  selected: MentionUser[];
  onChange: (next: MentionUser[]) => void;
}

// Chip-based @mention picker for the comment composers. Selected users are shown
// as removable chips; the parent passes their ids to the post call. Kept separate
// from the comment text so the textarea stays clean (no inline markup).
export default function MentionField({ selected, onChange }: MentionFieldProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MentionUser[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search while the dropdown is open. All setState happens inside the
  // timer/promise callbacks (never synchronously in the effect body) to satisfy
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    let cancelled = false;
    const t = setTimeout(() => {
      if (term.length < 1) { setResults([]); return; }
      setLoading(true);
      mentionSearch(term)
        .then((r) => { if (!cancelled) setResults(r); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const add = (u: MentionUser) => {
    if (!selected.some((s) => s.id === u.id)) onChange([...selected, u]);
    setQ('');
    setResults([]);
  };
  const remove = (id: number) => onChange(selected.filter((s) => s.id !== id));

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex flex-wrap items-center gap-1">
        {selected.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] font-medium">
            @{u.name ?? 'Unknown'}
            <button type="button" onClick={() => remove(u.id)} className="hover:text-blue-900" aria-label={`Remove ${u.name ?? 'mention'}`}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 text-[11px]"
        >
          <AtSign className="w-3 h-3" /> Mention
        </button>
      </div>

      {open && (
        <div className="absolute z-20 bottom-full mb-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className="w-full px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="mt-1 max-h-44 overflow-y-auto">
            {loading ? (
              <div className="text-[11px] text-slate-400 px-2 py-2">Searching…</div>
            ) : results.length === 0 ? (
              <div className="text-[11px] text-slate-400 px-2 py-2">{q.trim() ? 'No matches' : 'Type to search'}</div>
            ) : (
              results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => add(u)}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm flex items-center justify-between"
                >
                  <span className="text-slate-700">{u.name ?? 'Unknown'}</span>
                  {u.employeeId && <span className="text-[10px] text-slate-400">{u.employeeId}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
