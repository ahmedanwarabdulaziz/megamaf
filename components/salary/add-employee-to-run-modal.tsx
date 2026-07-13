'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { addEmployeeToPayrollRun } from '@/lib/actions/salary';

type Employee = { id: string; full_name: string };

export function AddEmployeeToRunModal({ runId, employees }: { runId: string; employees: Employee[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const submittingRef = useRef(false);
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!employeeId) { alert('يجب اختيار الموظف'); return; }
    submittingRef.current = true;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('run_id', runId);
      formData.set('employee_id', employeeId);
      const result = await addEmployeeToPayrollRun(formData);
      if (result.error) {
        alert(result.error);
      } else {
        setIsOpen(false);
        setEmployeeId('');
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
          <div className="bg-card p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">إضافة موظف لهذه الدورة</h2>
            {employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                لا يوجد موظفون لديهم راتب محدد وغير مدرجين في هذه الدورة بالفعل.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">الموظف</label>
                  <select required value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="w-full p-2 rounded border bg-background">
                    <option value="">-- اختر الموظف --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>إلغاء</Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    إضافة
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <Button variant="outline" onClick={() => setIsOpen(true)}>إضافة موظف</Button>
      {dialog}
    </>
  );
}
