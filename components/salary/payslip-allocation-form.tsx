'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2, Plus } from 'lucide-react';
import { setPayslipProjectAllocations } from '@/lib/actions/salary';
import { formatMoney } from '@/lib/money';

type Project = { id: string; name: string };
type AllocationRow = { project_id: string; allocation_type: 'percentage' | 'fixed_amount'; allocation_value: number };

export function PayslipAllocationForm({
  payslipId,
  baseAmount,
  projects,
  initialRows,
}: {
  payslipId: string;
  baseAmount: number;
  projects: Project[];
  initialRows: AllocationRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<AllocationRow[]>(
    initialRows.length > 0 ? initialRows : [{ project_id: '', allocation_type: 'percentage', allocation_value: 100 }]
  );
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  const allocatedTotal = rows.reduce((sum, r) => {
    const amount = r.allocation_type === 'percentage' ? (baseAmount * (r.allocation_value || 0)) / 100 : (r.allocation_value || 0);
    return sum + amount;
  }, 0);
  const diff = Math.round((baseAmount - allocatedTotal) * 100) / 100;

  function updateRow(index: number, patch: Partial<AllocationRow>) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows(prev => [...prev, { project_id: '', allocation_type: 'percentage', allocation_value: 0 }]);
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('payslip_id', payslipId);
      formData.set('allocations', JSON.stringify(rows.filter(r => r.project_id && r.allocation_value > 0)));
      const result = await setPayslipProjectAllocations(formData);
      if (result.error) {
        alert(result.error);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      alert(err.message || 'حدث خطأ');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2">
        <p className="text-xs text-muted-foreground">توزيع تكلفة الراتب على المشاريع لهذا الشهر</p>
        <Button type="button" size="sm" variant="outline" onClick={addRow} className="shrink-0">
          <Plus className="w-4 h-4 ml-1" /> إضافة
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="p-2 border rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={row.project_id}
                onChange={e => updateRow(i, { project_id: e.target.value })}
                className="flex-1 min-w-0 p-2 rounded border bg-background text-sm"
              >
                <option value="">-- المشروع --</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <Button type="button" size="icon" variant="ghost" onClick={() => removeRow(i)} disabled={rows.length === 1} className="shrink-0">
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={row.allocation_type}
                onChange={e => updateRow(i, { allocation_type: e.target.value as 'percentage' | 'fixed_amount' })}
                className="w-full p-2 rounded border bg-background text-sm"
              >
                <option value="percentage">نسبة %</option>
                <option value="fixed_amount">مبلغ ثابت</option>
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                max={row.allocation_type === 'percentage' ? 100 : undefined}
                value={row.allocation_value || ''}
                onChange={e => updateRow(i, { allocation_value: parseFloat(e.target.value) || 0 })}
                className="w-full p-2 rounded border bg-background text-sm"
              />
            </div>
          </div>
        ))}
      </div>

      <div className={`text-xs font-medium pt-2 border-t ${Math.abs(diff) > 0.01 ? 'text-destructive' : 'text-green-600'}`}>
        الموزّع: {formatMoney(allocatedTotal)} من {formatMoney(baseAmount)}
        {Math.abs(diff) > 0.01 && ` — الفرق: ${formatMoney(diff)}`}
      </div>

      <Button type="button" onClick={handleSave} disabled={loading} className="w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
        حفظ التوزيع
      </Button>
    </div>
  );
}
