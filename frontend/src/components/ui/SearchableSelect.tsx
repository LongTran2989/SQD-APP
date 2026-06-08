'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** If true, renders a "clear" entry at the top of the list */
  clearable?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  id?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  clearable = false,
  clearLabel = 'None',
  disabled = false,
  id,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Focus the search input whenever the dropdown opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative" id={id}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={[
          'w-full flex items-center justify-between px-3 py-2.5 border rounded-xl text-sm text-left transition-colors',
          disabled
            ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
            : 'bg-white border-slate-300 hover:border-slate-400',
          open && !disabled ? 'ring-2 ring-blue-500 border-blue-500' : '',
        ].join(' ')}
      >
        <span className={selected ? 'text-slate-800 truncate' : 'text-slate-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ml-2 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-lg">
              <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to search…"
                className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="flex-shrink-0">
                  <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" />
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-56 overflow-y-auto">
            {clearable && (
              <button
                type="button"
                onClick={() => handleSelect('')}
                className={`w-full text-left px-4 py-2.5 text-sm italic transition-colors hover:bg-slate-50 ${
                  !value ? 'bg-blue-50 text-blue-600 font-medium not-italic' : 'text-slate-400'
                }`}
              >
                {clearLabel}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400 text-center">No results</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => handleSelect(o.value)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 ${
                    o.value === value ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700'
                  }`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
