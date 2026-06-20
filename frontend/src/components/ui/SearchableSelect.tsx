'use client';

import { useState, useRef, useEffect, useId } from 'react';
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
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const triggerId = id ?? `${uid}-trigger`;

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // Build the flat list of selectable items (clear entry first when applicable)
  const filteredOptions = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Items rendered in the listbox: optional clear item + filtered options
  const listItems: Array<{ value: string; label: string; italic?: boolean }> = [
    ...(clearable ? [{ value: '', label: clearLabel, italic: true }] : []),
    ...filteredOptions,
  ];

  // Focus the search input whenever the dropdown opens; reset focused index
  useEffect(() => {
    if (open) {
      setQuery('');
      setFocusedIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Scroll focused option into view
  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${focusedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

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

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, listItems.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault();
      handleSelect(listItems[focusedIndex].value);
    }
  };

  const activeDescendant =
    focusedIndex >= 0 ? `${uid}-option-${focusedIndex}` : undefined;

  return (
    <div ref={containerRef} className="relative" id={id ? undefined : undefined}>
      {/* Trigger */}
      <button
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
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
          aria-hidden="true"
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-[var(--z-dropdown,30)] mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12),0_2px_6px_rgba(15,23,42,0.06)] overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-lg">
              <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                role="searchbox"
                aria-label="Search options"
                aria-controls={listboxId}
                aria-activedescendant={activeDescendant}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setFocusedIndex(-1); }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Type to search…"
                className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => { setQuery(''); setFocusedIndex(-1); inputRef.current?.focus(); }}
                  className="flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Options */}
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label="Options"
            className="max-h-56 overflow-y-auto"
          >
            {listItems.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400 text-center" role="status">
                No results
              </p>
            ) : (
              listItems.map((item, index) => {
                const isSelected = item.value === value;
                const isFocused = index === focusedIndex;
                return (
                  <button
                    key={item.value === '' ? '__clear__' : item.value}
                    id={`${uid}-option-${index}`}
                    data-index={index}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(item.value)}
                    onMouseEnter={() => setFocusedIndex(index)}
                    className={[
                      'w-full text-left px-4 py-2.5 text-sm transition-colors',
                      item.italic ? 'italic' : '',
                      isSelected
                        ? 'bg-blue-50 text-blue-700 font-semibold not-italic'
                        : isFocused
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {item.label}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
