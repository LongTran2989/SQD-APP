'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import SearchableSelect, { SearchableSelectOption } from './SearchableSelect';

interface AsyncSearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  fetchOptions: (query: string) => Promise<SearchableSelectOption[]>;
  placeholder?: string;
  clearable?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  id?: string;
  minChars?: number;
  debounceMs?: number;
}

export default function AsyncSearchableSelect({
  value,
  onChange,
  fetchOptions,
  placeholder = 'Search…',
  clearable = false,
  clearLabel = 'None',
  disabled = false,
  id,
  minChars = 3,
  debounceMs = 300,
}: AsyncSearchableSelectProps) {
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const runFetch = useCallback((q: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    fetchOptions(q)
      .then((results) => {
        if (requestId !== requestIdRef.current) return; // stale response, ignore
        setOptions((prev) => {
          // Keep the currently-selected option visible even if the new
          // result set doesn't include it, so the trigger never reverts to
          // showing a blank value mid-search.
          const selected = prev.find((o) => o.value === value);
          if (value && selected && !results.some((o) => o.value === value)) {
            return [selected, ...results];
          }
          return results;
        });
      })
      .catch(() => {
        // non-fatal — leave existing options in place
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOptions, value]);

  // Resolve a label for a pre-filled value (e.g. a division defaulted from
  // the creator's own profile) before any search has run.
  useEffect(() => {
    if (value && !options.some((o) => o.value === value)) {
      runFetch('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < minChars) {
      setOptions((prev) => prev.filter((o) => o.value === value));
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runFetch(q.trim()), debounceMs);
  };

  const belowThreshold = query.trim().length < minChars;

  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      onQueryChange={handleQueryChange}
      placeholder={placeholder}
      clearable={clearable}
      clearLabel={clearLabel}
      disabled={disabled}
      loading={loading}
      serverFiltered
      noResultsLabel={belowThreshold ? `Type at least ${minChars} characters to search` : 'No results'}
    />
  );
}
