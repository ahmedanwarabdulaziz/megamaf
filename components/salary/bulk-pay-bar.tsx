'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { bulkPayPayslipsFromBank, bulkPayPayslipsFromExpense } from '@/lib/actions/salary';
import { getEmployeeAvailableExpenses } from '@/lib/actions/expenses';
import { formatMoney } from '@/lib/money';

type Row = { id: string; employeeName: string; remaining: number };
type BankAccount = { bank_account_id: string; bank_name: string; account_name: string; current_balance: number };
type Employee = { id: string; full_name: string };
type AvailableExpense = { id: string; expense_date: string; amount: number; notes: string | null; category_name: string; project_name: string; available: number };

export function BulkPayBar({
  runId,
  selectedRows,
  bankAccounts,
  employees,
  onClear,
  onDone,
}: {
  runId: string;
  selectedRows: Row[];
  bankAccounts: BankAccount[];
  employees: Employee[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [fundingSource, setFundingSource] = useState<'bank' | 'expense'>('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [fundingEmployeeId, setFundingEmployeeId] = useState('');
  const [employeeExpenses, setEmployeeExpenses] = useState<AvailableExpense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [expenseId, setExpenseId] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [memo, setMemo] = useState('');
  const submittingRef = useRef(false);
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (fundingSource !== 'expense' || !fundingEmployeeId) { setEmployeeExpenses([]); return; }
    setLoadingExpenses(true);
    setExpenseId('');
    getEmployeeAvailableExpenses(fundingEmployeeId).then(result => {
      setEmployeeExpenses((result as any).data || []);
      setLoadingExpenses(false);
    });
  }, [fundingSource, fundingEmployeeId, isOpen]);

  if (selectedRows.length === 0) return null;

  const total = selectedRows.reduce((sum, r) => sum + r.remaining, 0);
  const selectedExpense = employeeExpenses.find(e => e.id === expenseId);

  // From an expense: its "available" balance is a hard cap shared across every
  // selected payslip, so it's spent down row by row in selection order — rows
  // past the point where it runs out simply don't get paid this round.
  let expenseAllocation: (Row & { amount: number })[] = [];
  if (fundingSource === 'expense' && selectedExpense) {
    expenseAllocation = selectedRows.reduce<{ remaining: number; rows: (Row & { amount: number })[] }>(
      (acc, r) => {
        const amount = Math.max(0, Math.min(r.remaining, acc.remaining));
        return {
          remaining: acc.remaining - amount,
          rows: [...acc.rows, { ...r, amount }],
        };
      },
      { remaining: selectedExpense.available, rows: [] },
    ).rows;
  }
  const expenseAllocatedTotal = expenseAllocation.reduce((sum, r) => sum + r.amount, 0);
  const expenseCoveredCount = expenseAllocation.filter(r => r.amount > 0).length;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;

    if (fundingSource === 'bank') {
      if (!bankAccountId) { alert('يجب اختيار الحساب البنكي'); return; }
    } else {
      if (!expenseId) { alert('يجب اختيار المصروف الممول'); return; }
      if (expenseAllocatedTotal <= 0) { alert('رصيد المصروف غير كافٍ لدفع أي من القسائم المحددة'); return; }
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('run_id', runId);
      formData.set('payment_date', paymentDate);
      formData.set('memo', memo);

      let result;
      if (fundingSource === 'bank') {
        formData.set('bank_account_id', bankAccountId);
        formData.set('items', JSON.stringify(selectedRows.map(r => ({ payslip_id: r.id, amount: r.remaining }))));
        result = await bulkPayPayslipsFromBank(formData);
      } else {
        formData.set('funding_employee_id', fundingEmployeeId);
        formData.set('expense_id', expenseId);
        formData.set('items', JSON.stringify(
          expenseAllocation.filter(r => r.amount > 0).map(r => ({ payslip_id: r.id, amount: r.amount }))
        ));
        result = await bulkPayPayslipsFromExpense(formData);
      }

      if (result.error) alert(result.error);
      if (result.success) {
        setIsOpen(false);
        onDone();
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
            <h2 className="text-xl font-bold mb-1">دفع جماعي — {selectedRows.length} قسيمة</h2>
            <p className="text-sm text-muted-foreground mb-4">الإجمالي: <span className="font-bold text-primary">{formatMoney(total)}</span></p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">مصدر السداد</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFundingSource('bank')}
                    className={`flex-1 p-2 rounded border text-sm font-medium ${fundingSource === 'bank' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}
                  >
                    من الخزينة / حساب بنكي
                  </button>
                  <button
                    type="button"
                    onClick={() => { setFundingSource('expense'); setBankAccountId(''); }}
                    className={`flex-1 p-2 rounded border text-sm font-medium ${fundingSource === 'expense' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}
                  >
                    من عهدة موظف (مصروف معتمد)
                  </button>
                </div>
              </div>

              {fundingSource === 'bank' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">الحساب البنكي</label>
                    <select required value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} className="w-full p-2 rounded border bg-background">
                      <option value="">-- اختر الحساب البنكي --</option>
                      {bankAccounts.map(b => (
                        <option key={b.bank_account_id} value={b.bank_account_id}>
                          {b.bank_name} - {b.account_name} ({formatMoney(b.current_balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="border rounded divide-y max-h-40 overflow-y-auto text-sm">
                    {selectedRows.map(r => (
                      <div key={r.id} className="flex justify-between p-2">
                        <span>{r.employeeName}</span>
                        <span className="font-medium">{formatMoney(r.remaining)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">الموظف صاحب المصروف الممول</label>
                    <select required value={fundingEmployeeId} onChange={e => setFundingEmployeeId(e.target.value)} className="w-full p-2 rounded border bg-background">
                      <option value="">-- اختر الموظف --</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                      ))}
                    </select>
                  </div>

                  {fundingEmployeeId && (
                    loadingExpenses ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm p-3">
                        <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل...
                      </div>
                    ) : employeeExpenses.length === 0 ? (
                      <p className="text-sm text-muted-foreground p-3">لا يوجد مصروفات معتمدة لهذا الموظف بها رصيد غير مستخدم.</p>
                    ) : (
                      <div className="border rounded divide-y max-h-48 overflow-y-auto">
                        {employeeExpenses.map(exp => (
                          <label key={exp.id} className={`flex items-center justify-between gap-3 p-3 cursor-pointer text-sm ${expenseId === exp.id ? 'bg-primary/5' : ''}`}>
                            <div className="flex items-center gap-3 min-w-0">
                              <input type="radio" name="bulk-expense" checked={expenseId === exp.id} onChange={() => setExpenseId(exp.id)} />
                              <div className="min-w-0">
                                <div className="font-medium truncate">{exp.category_name || 'مصروف'} — {exp.expense_date}</div>
                                {exp.project_name && <div className="text-xs text-primary/80 truncate">{exp.project_name}</div>}
                              </div>
                            </div>
                            <div className="text-left whitespace-nowrap">
                              <div className="text-xs text-muted-foreground">المتاح</div>
                              <div className="font-bold text-primary">{formatMoney(exp.available)}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )
                  )}

                  {selectedExpense && (
                    <div className="border rounded divide-y max-h-48 overflow-y-auto text-sm">
                      {expenseAllocation.map(r => (
                        <div key={r.id} className="flex justify-between items-center p-2">
                          <span>{r.employeeName}</span>
                          {r.amount > 0 ? (
                            <span className="font-medium">{formatMoney(r.amount)}</span>
                          ) : (
                            <span className="text-xs text-destructive">الرصيد غير كافٍ</span>
                          )}
                        </div>
                      ))}
                      <div className="flex justify-between p-2 bg-muted/40 font-semibold">
                        <span>سيُدفع لـ {expenseCoveredCount} من {selectedRows.length}</span>
                        <span>{formatMoney(expenseAllocatedTotal)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">تاريخ الدفع</label>
                <input required type="date" autoComplete="off" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="w-full p-2 rounded border bg-background" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea value={memo} onChange={e => setMemo(e.target.value)} className="w-full p-2 rounded border bg-background" rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>إلغاء</Button>
                <Button
                  type="submit"
                  disabled={loading || (fundingSource === 'bank' ? !bankAccountId : !expenseId || expenseAllocatedTotal <= 0)}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {fundingSource === 'bank'
                    ? `تأكيد دفع ${selectedRows.length} قسيمة`
                    : `تأكيد دفع ${expenseCoveredCount} قسيمة`}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="sticky top-0 z-20 bg-card border rounded-lg shadow-sm p-3 mb-3 flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {selectedRows.length} محددة — الإجمالي: <span className="font-bold text-foreground">{formatMoney(total)}</span>
        </span>
        <button type="button" onClick={onClear} className="text-muted-foreground hover:underline">إلغاء التحديد</button>
      </div>
      <Button size="sm" onClick={() => setIsOpen(true)}>دفع جماعي</Button>
      {dialog}
    </div>
  );
}
