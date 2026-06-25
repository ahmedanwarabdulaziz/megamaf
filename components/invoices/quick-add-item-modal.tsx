'use client';

import { useRef, useEffect, useState } from 'react';
import { Plus, X, Loader2, PackagePlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface InventoryItem { id: string; name: string; unit: string; code?: string | null; }

interface Props {
  /** Called with the newly created item so the parent can append + select it */
  onItemCreated: (item: InventoryItem) => void;
}

export function QuickAddItemModal({ onItemCreated }: Props) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  // Focus name field when opening (nameRef assigned in handleSubmit block)
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const nameRef = useRef<HTMLInputElement>(null);
  const unitRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    setError('');
    const name = nameRef.current?.value.trim() ?? '';
    const unit = unitRef.current?.value.trim() ?? '';
    const code = codeRef.current?.value.trim() || null;

    if (!name || !unit) { setError('الاسم والوحدة مطلوبان'); return; }

    setLoading(true);
    try {
      // Use the browser client directly — avoids server-action router.refresh()
      // which would wipe the entire invoice form state.
      const supabase = createClient();
      const { data, error: dbError } = await supabase
        .from('inventory_items')
        .insert({ name, unit, code })
        .select('id, name, unit, code')
        .single();

      if (dbError) { setError(dbError.message); return; }
      if (data) {
        onItemCreated(data);
        setOpen(false);
        if (nameRef.current) nameRef.current.value = '';
        if (unitRef.current) unitRef.current.value = '';
        if (codeRef.current) codeRef.current.value = '';
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        title="إضافة صنف جديد للدليل"
        onClick={() => setOpen(true)}
        className="flex-shrink-0 h-9 w-9 flex items-center justify-center rounded-md border border-dashed border-primary/60 text-primary hover:bg-primary/10 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      {/* Backdrop + dialog */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-card border shadow-2xl rounded-2xl w-full max-w-sm animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                <PackagePlus className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-base">إضافة صنف جديد</h3>
                <p className="text-xs text-muted-foreground">سيُضاف تلقائياً للفاتورة</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mr-auto text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* No <form> here — we are already inside CreateInvoiceForm's <form>.
                 Inputs are read via refs; submit is wired to onClick. */}
            <div className="p-5 space-y-4">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg border border-destructive/20">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">
                  اسم الصنف <span className="text-destructive">*</span>
                </label>
                <input
                  ref={nameRef}
                  required
                  name="name"
                  placeholder="مثال: أسمنت بورتلاندي"
                  className="w-full p-2.5 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    الوحدة <span className="text-destructive">*</span>
                  </label>
                  <input
                    ref={unitRef}
                    name="unit"
                    placeholder="طن، كجم، حبة..."
                    className="w-full p-2.5 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">الكود</label>
                  <input
                    ref={codeRef}
                    name="code"
                    placeholder="CEM-001"
                    dir="ltr"
                    className="w-full p-2.5 rounded-lg border bg-background text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition text-left"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 py-2.5 rounded-lg border text-sm font-medium hover:bg-accent transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {loading ? 'جاري الإضافة...' : 'إضافة وتحديد'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
