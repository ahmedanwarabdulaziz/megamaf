'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, X, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  /** Small secondary text shown beneath the label */
  sub?: string;
  /** Pill badge shown on the right (e.g. stock qty) */
  badge?: string;
  /** Tailwind color classes for the badge e.g. 'bg-green-50 text-green-700 border-green-300' */
  badgeColor?: string;
}

interface Props {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'اختر...',
  required = false,
  disabled = false,
  className = '',
}: Props) {
  const [query, setQuery]       = useState('');
  const [open, setOpen]         = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef              = useRef<HTMLButtonElement>(null);
  const inputRef                = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value);

  const filtered = query.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.sub ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : options;

  /** Compute & store dropdown position from trigger rect */
  const positionDropdown = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropHeight = Math.min(300, options.length * 36 + 60); // rough estimate

    if (spaceBelow >= dropHeight || spaceBelow > rect.top) {
      // Open downward
      setDropdownStyle({
        position: 'fixed',
        top:  rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 9999,
      });
    } else {
      // Open upward
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 9999,
      });
    }
  }, [options.length]);

  function openDropdown() {
    if (disabled) return;
    positionDropdown();
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // Reposition on scroll / resize while open
  useEffect(() => {
    if (!open) return;
    const handler = () => positionDropdown();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, positionDropdown]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      // Keep open if clicking inside trigger or portal dropdown
      if (triggerRef.current?.contains(target)) return;
      const portalRoot = document.getElementById('searchable-select-portal');
      if (portalRoot?.contains(target)) return;
      setOpen(false);
      setQuery('');
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  function pick(opt: SelectOption) {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
  }

  // Portal target — create once if missing
  function getPortalTarget() {
    let el = document.getElementById('searchable-select-portal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'searchable-select-portal';
      document.body.appendChild(el);
    }
    return el;
  }

  const dropdown = open ? (
    <div
      style={dropdownStyle}
      className="bg-popover border rounded-xl shadow-2xl overflow-hidden"
    >
      {/* Search box */}
      <div className="p-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 bg-background border rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition">
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

      {/* Options */}
      <ul className="max-h-52 overflow-y-auto divide-y divide-border/40">
        {filtered.length === 0 ? (
          <li className="px-4 py-5 text-center text-sm text-muted-foreground">لا توجد نتائج</li>
        ) : (
          filtered.map(opt => (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => pick(opt)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-right hover:bg-accent transition-colors ${opt.value === value ? 'bg-primary/5' : ''}`}
              >
                {opt.value === value && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{opt.label}</div>
                  {opt.sub && <div className="text-[11px] text-muted-foreground truncate">{opt.sub}</div>}
                </div>
                {opt.badge && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${opt.badgeColor ?? 'bg-muted text-muted-foreground border-border'}`}>
                    {opt.badge}
                  </span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>

      {query && filtered.length > 0 && (
        <div className="px-3 py-1 text-[11px] text-muted-foreground border-t bg-muted/20">
          {filtered.length} من {options.length}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`}>
      {/* Hidden input for native required validation */}
      <input type="hidden" value={value} required={required} aria-hidden />

      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={openDropdown}
        disabled={disabled}
        className={`
          w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-background text-sm
          transition-colors text-right
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50 cursor-pointer'}
          ${open ? 'border-primary ring-2 ring-primary/20' : 'border-input'}
        `}
      >
        {selected ? (
          <>
            <span className="flex-1 truncate">{selected.label}</span>
            {selected.sub && <span className="text-xs text-muted-foreground">{selected.sub}</span>}
            {selected.badge && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${selected.badgeColor ?? 'bg-muted text-muted-foreground border-border'}`}>
                {selected.badge}
              </span>
            )}
            {!disabled && (
              <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive flex-shrink-0" onClick={clear} />
            )}
          </>
        ) : (
          <>
            <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="flex-1 text-muted-foreground">{placeholder}</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          </>
        )}
      </button>

      {/* Render dropdown via portal so it escapes any overflow:hidden parent */}
      {typeof document !== 'undefined' && open && createPortal(dropdown, getPortalTarget())}
    </div>
  );
}
