'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Pencil, DollarSign } from 'lucide-react';
import { setEmployeeSalary } from '@/lib/actions/salary';

type Props = {
  employeeId: string;
  employeeName: string;
  currentAmount?: number | null;
  currentEffectiveFrom?: string | null;
  hasExisting: boolean;
};

export function UpdateSalaryModal({ employeeId, employeeName, currentAmount, currentEffectiveFrom, hasExisting }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [baseAmount, setBaseAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function handleOpen() {
    // Pre-fill with current salary value and its original effective_from date
    setBaseAmount(currentAmount != null ? String(currentAmount) : '');
    setEffectiveFrom(currentEffectiveFrom || localToday());
    setIsOpen(true);
  }

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  function handleClose() {
    setIsOpen(false);
    setBaseAmount('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('employee_id', employeeId);
      formData.set('effective_from', effectiveFrom);
      formData.set('base_amount', baseAmount);
      const result = await setEmployeeSalary(formData);
      if (result.error) {
        alert(result.error);
      } else {
        handleClose();
        router.refresh();
      }
    } catch (err: any) {
      alert(err.message || 'حدث خطأ');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const dialog = isOpen && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-sm">
            {/* Header */}
            <div className="p-5 border-b flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-bold">{hasExisting ? 'تحديث الراتب' : 'تحديد الراتب'}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{employeeName}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {hasExisting && currentAmount != null && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-3 text-sm">
                  <span className="text-muted-foreground">الراتب الحالي:</span>
                  <span className="font-bold text-foreground">
                    {currentAmount.toLocaleString('ar-EG')} ج.م
                  </span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">الراتب الأساسي الجديد</label>
                <input
                  ref={inputRef}
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={baseAmount}
                  onChange={e => setBaseAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2.5 rounded-lg border bg-background text-lg font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">تاريخ السريان</label>
                <input
                  required
                  type="date"
                  value={effectiveFrom}
                  onChange={e => setEffectiveFrom(e.target.value)}
                  className="w-full p-2.5 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                توزيع تكلفة الراتب على المشاريع يتم شهرياً عند إنشاء دورة الرواتب.
              </p>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>إلغاء</Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : null}
                  {hasExisting ? 'تحديث' : 'حفظ'}
                </Button>
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
        onClick={handleOpen}
        className="text-xs font-semibold text-primary hover:underline whitespace-nowrap inline-flex items-center gap-1"
      >
        <Pencil className="w-3 h-3" />
        {hasExisting ? 'تحديث الراتب' : 'تحديد الراتب'}
      </button>
      {dialog}
    </>
  );
}
