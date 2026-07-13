'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2 } from 'lucide-react';
import { addPayslipComponent, removePayslipComponent } from '@/lib/actions/salary';
import { formatMoney } from '@/lib/money';

const TYPE_LABELS: Record<string, string> = {
  allowance: 'بدل',
  bonus: 'مكافأة',
  overtime: 'إضافي',
  deduction: 'خصم',
};

type Component = { id: string; component_type: string; label: string; amount: number; notes?: string | null };

export function PayslipComponentForm({ payslipId, components }: { payslipId: string; components: Component[] }) {
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState('allowance');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!label || !amount) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set('payslip_id', payslipId);
      formData.set('component_type', type);
      formData.set('label', label);
      formData.set('amount', amount);
      const result = await addPayslipComponent(formData);
      if (result?.error) {
        alert(result.error);
      } else {
        setLabel('');
        setAmount('');
      }
    });
  }

  function onRemove(id: string) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('id', id);
      const result = await removePayslipComponent(formData);
      if (result?.error) alert(result.error);
    });
  }

  return (
    <div className="space-y-3">
      {components.length > 0 && (
        <div className="divide-y divide-border border rounded-lg">
          {components.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{TYPE_LABELS[c.component_type] || c.component_type}</span>
                <span className="text-muted-foreground block truncate text-xs">{c.label}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className={c.component_type === 'deduction' ? 'text-destructive font-medium' : 'text-green-600 font-medium'}>
                  {c.component_type === 'deduction' ? '-' : '+'}{formatMoney(c.amount)}
                </span>
                <Button type="button" size="icon" variant="ghost" onClick={() => onRemove(c.id)} disabled={isPending}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onAdd} className="space-y-2 p-2 border rounded-lg bg-muted/20">
        <div className="grid grid-cols-2 gap-2">
          <select value={type} onChange={e => setType(e.target.value)} className="w-full p-2 rounded border bg-background text-sm">
            <option value="allowance">بدل</option>
            <option value="bonus">مكافأة</option>
            <option value="overtime">إضافي</option>
            <option value="deduction">خصم</option>
          </select>
          <input
            type="number" step="0.01" min="0.01" placeholder="المبلغ"
            value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full p-2 rounded border bg-background text-sm"
          />
        </div>
        <input
          placeholder="الوصف" value={label} onChange={e => setLabel(e.target.value)}
          className="w-full p-2 rounded border bg-background text-sm"
        />
        <Button type="submit" size="sm" className="w-full" disabled={isPending}>
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'إضافة'}
        </Button>
      </form>
    </div>
  );
}
