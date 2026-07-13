'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { generatePayrollRun } from '@/lib/actions/salary';

const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function GenerateRunModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const submittingRef = useRef(false);
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('period_year', String(year));
      formData.set('period_month', String(month));
      const result = await generatePayrollRun(formData);
      if (result.error) {
        alert(result.error);
      } else {
        setIsOpen(false);
        router.push(`/salary/runs/${result.id}`);
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
          <div className="bg-card p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">إنشاء دورة رواتب جديدة</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">الشهر</label>
                  <select value={month} onChange={e => setMonth(parseInt(e.target.value, 10))} className="w-full p-2 rounded border bg-background">
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">السنة</label>
                  <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className="w-full p-2 rounded border bg-background" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>إلغاء</Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  إنشاء الدورة
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
      <Button onClick={() => setIsOpen(true)}>إنشاء دورة رواتب جديدة</Button>
      {dialog}
    </>
  );
}
