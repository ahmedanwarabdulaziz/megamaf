'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { setEmployeeSalary } from '@/lib/actions/salary';

type Employee = { id: string; full_name: string; employment_type: string };

export function SalaryForm({
  employees,
  fixedEmployeeId,
  fixedEmployeeName,
}: {
  employees: Employee[];
  fixedEmployeeId?: string;
  fixedEmployeeName?: string;
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(fixedEmployeeId || '');
  const [baseAmount, setBaseAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!employeeId) { alert('يجب اختيار الموظف'); return; }
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
        router.push(`/salary/${employeeId}`);
      }
    } catch (err: any) {
      alert(err.message || 'حدث خطأ');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div className="bg-card p-4 rounded-lg border shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">الموظف</label>
          {fixedEmployeeId ? (
            <div className="p-2 rounded border bg-muted font-medium">{fixedEmployeeName}</div>
          ) : (
            <select required value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="w-full p-2 rounded border bg-background">
              <option value="">-- اختر الموظف --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} {emp.employment_type === 'payroll_only' ? '(رواتب فقط)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">تاريخ السريان</label>
            <input required type="date" autoComplete="off" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className="w-full p-2 rounded border bg-background" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الراتب الأساسي</label>
            <input required type="number" step="0.01" min="0" value={baseAmount} onChange={e => setBaseAmount(e.target.value)} className="w-full p-2 rounded border bg-background text-lg font-bold text-primary" />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          توزيع تكلفة هذا الراتب على المشاريع يتم تحديده شهرياً عند إنشاء كل دورة رواتب، وليس هنا.
        </p>
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
        حفظ الراتب
      </Button>
    </form>
  );
}
