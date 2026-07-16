'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { disburseLoan } from '@/lib/actions/loans';
import { formatMoney } from '@/lib/money';

type BankAccount = { bank_account_id: string; bank_name: string; account_name: string; current_balance: number };
type CustomRow = { due_date: string; amount: string };

export function DisburseLoanModal({ employeeId, bankAccounts }: { employeeId: string; bankAccounts: BankAccount[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const submittingRef = useRef(false);
  const router = useRouter();

  const [repaymentType, setRepaymentType] = useState<'next_salary_full' | 'equal_installments' | 'custom_schedule'>('next_salary_full');
  const [customRows, setCustomRows] = useState<CustomRow[]>([{ due_date: '', amount: '' }]);

  useEffect(() => { setMounted(true); }, []);

  function addCustomRow() {
    setCustomRows(prev => [...prev, { due_date: '', amount: '' }]);
  }
  function updateCustomRow(i: number, patch: Partial<CustomRow>) {
    setCustomRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeCustomRow(i: number) {
    setCustomRows(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.set('employee_id', employeeId);
    formData.set('repayment_type', repaymentType);
    if (repaymentType === 'custom_schedule') {
      formData.set(
        'custom_schedule',
        JSON.stringify(customRows.filter(r => r.due_date && r.amount).map(r => ({ due_date: r.due_date, amount: parseFloat(r.amount) })))
      );
    }
    try {
      const result = await disburseLoan(formData);
      if (result.error) {
        alert(result.error);
      } else {
        setIsOpen(false);
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
          <div className="bg-card p-6 rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">صرف سلفة جديدة</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">المبلغ</label>
                <input required type="number" step="0.01" min="0.01" name="amount" className="w-full p-2 rounded border bg-background text-lg font-bold text-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">تاريخ الصرف</label>
                <input required type="date" name="date" autoComplete="off" defaultValue={new Date().toISOString().split('T')[0]} className="w-full p-2 rounded border bg-background" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الحساب البنكي</label>
                <select required name="bank_account_id" className="w-full p-2 rounded border bg-background">
                  <option value="">-- اختر الحساب البنكي --</option>
                  {bankAccounts.map(b => (
                    <option key={b.bank_account_id} value={b.bank_account_id}>
                      {b.bank_name} - {b.account_name} ({formatMoney(b.current_balance)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">طريقة السداد</label>
                <select value={repaymentType} onChange={e => setRepaymentType(e.target.value as any)} className="w-full p-2 rounded border bg-background">
                  <option value="next_salary_full">خصم كامل من الراتب القادم</option>
                  <option value="equal_installments">أقساط شهرية متساوية</option>
                  <option value="custom_schedule">جدول سداد مخصص</option>
                </select>
              </div>

              {repaymentType === 'equal_installments' && (
                <div>
                  <label className="block text-sm font-medium mb-1">عدد الأشهر</label>
                  <input required type="number" min="2" name="installment_months" className="w-full p-2 rounded border bg-background" />
                </div>
              )}

              {repaymentType === 'custom_schedule' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="block text-sm font-medium">جدول الأقساط</label>
                    <Button type="button" size="sm" variant="outline" onClick={addCustomRow}>
                      <Plus className="w-4 h-4 ml-1" /> إضافة قسط
                    </Button>
                  </div>
                  {customRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input required type="date" autoComplete="off" value={row.due_date} onChange={e => updateCustomRow(i, { due_date: e.target.value })} className="flex-1 p-2 rounded border bg-background" />
                      <input required type="number" step="0.01" min="0.01" placeholder="المبلغ" value={row.amount} onChange={e => updateCustomRow(i, { amount: e.target.value })} className="w-28 p-2 rounded border bg-background" />
                      <Button type="button" size="icon" variant="ghost" onClick={() => removeCustomRow(i)} disabled={customRows.length === 1}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea name="memo" className="w-full p-2 rounded border bg-background" rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>إلغاء</Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  صرف السلفة
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
      <Button size="sm" onClick={() => setIsOpen(true)}>سلفة جديدة</Button>
      {dialog}
    </>
  );
}
