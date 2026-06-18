import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { filterEpisodeSequenceOptions } from '../../utils/assetEpisodeSequence';

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = '请选择',
  emptyOptionLabel,
  disabled = false,
  hideLabel = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  placeholder?: string;
  /** 筛选条：传「全部集数」等，会多一项空值 */
  emptyOptionLabel?: string;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => filterEpisodeSequenceOptions([...options], query),
    [options, query]
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const display = value || (emptyOptionLabel ? emptyOptionLabel : placeholder);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className="relative">
      {hideLabel ? null : <label className="block text-xs text-gray-500 mb-1.5">{label}</label>}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-left text-sm text-gray-200 disabled:opacity-50"
      >
        <span className={value ? 'text-white' : 'text-gray-500'}>{display}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-[80030] mt-1 w-full overflow-hidden rounded-xl border border-gray-700 bg-[#121722] shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-gray-800 px-2 py-2">
            <Search className="h-4 w-4 shrink-0 text-gray-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`搜索${label}…`}
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                className="rounded p-0.5 text-gray-500 hover:text-gray-300"
                aria-label="清空搜索"
                onClick={() => setQuery('')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {emptyOptionLabel ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-800 ${!value ? 'bg-brand-500/15 text-brand-300' : 'text-gray-400'}`}
                  onClick={() => pick('')}
                >
                  {emptyOptionLabel}
                </button>
              </li>
            ) : null}
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-gray-600">无匹配项</li>
            ) : (
              filtered.map((opt) => (
                <li key={opt}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === opt}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-800 ${
                      value === opt ? 'bg-brand-500/15 text-brand-300' : 'text-gray-200'
                    }`}
                    onClick={() => pick(opt)}
                  >
                    {opt}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
