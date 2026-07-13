'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { createPayrollOnlyEmployee } from '@/lib/actions/salary';

export function AddPayrollOnlyModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const submittingRef = useRef(false);
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    try {
      const result = await createPayrollOnlyEmployee(formData);
      if (result.error) {
        alert(result.error);
      } else {
        setIsOpen(false);
        router.push(`/salary/create?employee_id=${result.id}`);
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
            <h2 className="text-xl font-bold mb-4">إضافة شخص للرواتب فقط</h2>
            <p className="text-sm text-muted-foreground mb-4">
              هذا الشخص لن يحصل على حساب دخول للنظام — سيظهر فقط في صفحات الرواتب.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">الاسم الكامل</label>
                <input required name="full_name" className="w-full p-2 rounded border bg-background" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">رقم الهاتف (اختياري)</label>
                <input name="phone" className="w-full p-2 rounded border bg-background" />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>إلغاء</Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  إضافة ومتابعة لتحديد الراتب
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
      <Button variant="outline" onClick={() => setIsOpen(true)}>إضافة شخص للرواتب فقط</Button>
      {dialog}
    </>
  );
}
