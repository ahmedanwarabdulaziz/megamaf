'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Loader2 } from 'lucide-react';
import { updateDepositPayoutDueDate } from '@/lib/actions/deposits';

export function EditDueDateModal({ payout }: { payout: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.append('payout_id', payout.id);
    try {
      const result = await updateDepositPayoutDueDate(formData);
      if (result.error) {
        alert(result.error);
      } else {
        setIsOpen(false);
      }
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const dialog = isOpen && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card p-6 rounded-lg shadow-lg w-full max-w-sm">
            <h2 className="text-lg font-bold mb-4">تعديل تاريخ الاستحقاق #{payout.seq}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">تاريخ الاستحقاق الفعلي (حسب البنك)</label>
                <input
                  required
                  type="date"
                  name="due_date"
                  defaultValue={payout.due_date}
                  className="w-full p-2 rounded border bg-background"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={loading}
                  className="px-3 py-1.5 rounded border text-sm"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm flex items-center gap-1"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-muted-foreground hover:text-primary"
        title="تعديل تاريخ الاستحقاق"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>

      {dialog}
    </>
  );
}
