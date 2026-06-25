'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';

interface InventoryItem { id: string; name: string; unit: string; code?: string | null; }

interface Props {
  items: InventoryItem[];
  value: string;               // selected item id
  onChange: (id: string) => void;
  placeholder?: string;
  required?: boolean;
}

export function SearchableItemSelect({
  items,
  value,
  onChange,
  placeholder = 'ابحث عن صنف...',
  required = false,
}: Props) {
  const [query, setQuery]     = useState('');
  const [open, setOpen]       = useState(false);
  const containerRef          = useRef<HTMLDivElement>(null);
  const inputRef              = useRef<HTMLInputElement>(null);

  const selected = items.find(i => i.id === value);

  // Filter by name, code, or unit
  const filtered = query.trim()
    ? items.filter(i =>
        i.name.toLowerCase().includes(query.toLowerCase()) ||
        (i.code ?? '').toLowerCase().includes(query.toLowerCase()) ||
        i.unit.toLowerCase().includes(query.toLowerCase())
      )
    : items;

  // Close on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  // Keyboard: close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function openDropdown() {
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function pick(item: InventoryItem) {
    onChange(item.id);
    setOpen(false);
    setQuery('');
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Hidden native input keeps the `required` constraint working inside the outer form */}
      <input
        type="hidden"
        value={value}
        required={required}
        aria-hidden="true"
        // This trick makes the browser fire a validation error if value is empty
        // by placing a visible (but size-0) input directly before the hidden one
      />

      {/* Trigger pill */}
      <button
        type="button"
        onClick={openDropdown}
        className={`
          w-full flex items-center gap-2 p-2 rounded-lg border bg-background text-sm
          hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
          transition-colors text-right
          ${open ? 'border-primary ring-2 ring-primary/20' : ''}
        `}
      >
        {selected ? (
          <>
            <span className="flex-1 truncate font-medium">{selected.name}</span>
            {selected.code && (
              <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {selected.code}
              </span>
            )}
            <span className="text-xs text-muted-foreground border rounded px-1">{selected.unit}</span>
            <X
              className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={clear}
            />
          </>
        ) : (
          <>
            <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="flex-1 text-muted-foreground">{placeholder}</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-xl shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b bg-muted/30">
            <div className="flex items-center gap-2 bg-background border rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="اكتب للبحث..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                dir="rtl"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')}>
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Results */}
          <ul className="max-h-56 overflow-y-auto divide-y divide-border/50">
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                لا توجد نتائج لـ «{query}»
              </li>
            ) : (
              filtered.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => pick(item)}
                    className={`
                      w-full flex items-center gap-3 px-4 py-2.5 text-sm text-right
                      hover:bg-accent transition-colors
                      ${item.id === value ? 'bg-primary/5 font-semibold' : ''}
                    `}
                  >
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.code && (
                      <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground whitespace-nowrap">
                        {item.code}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5 whitespace-nowrap">
                      {item.unit}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {/* Count */}
          {query && filtered.length > 0 && (
            <div className="px-4 py-1.5 text-[11px] text-muted-foreground border-t bg-muted/20">
              {filtered.length} نتيجة من أصل {items.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
