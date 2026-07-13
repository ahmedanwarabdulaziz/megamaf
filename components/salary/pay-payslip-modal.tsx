'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { payPayslipFromBank, payPayslipFromExpense } from '@/lib/actions/salary';
import { getEmployeeAvailableExpenses } from '@/lib/actions/expenses';
import { formatMoney } from '@/lib/money';

type BankAccount = { bank_account_id: string; bank_name: string; account_name: string; current_balance: number };
type Employee = { id: string; full_name: string };
type AvailableExpense = { id: string; expense_date: string; amount: number; notes: string | null; category_name: string; project_name: string; available: number };

export function PayPayslipModal({
  payslipId,
  runId,
  employeeId,
  employeeName,
  remaining,
  bankAccounts,
  employees,
}: {
  payslipId: string;
  runId: string;
  employeeId: string;
  employeeName: string;
  remaining: number;
  bankAccounts: BankAccount[];
  employees: Employee[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const submittingRef = useRef(false);
  const router = useRouter();

  const [fundingSource, setFundingSource] = useState<'bank' | 'expense'>('bank');
  const [amount, setAmount] = useState<number>(remaining);
  const [bankAccountId, setBankAccountId] = useState('');
  const [fundingEmployeeId, setFundingEmployeeId] = useState(employeeId);
  const [employeeExpenses, setEmployeeExpenses] = useState<AvailableExpense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [expenseId, setExpenseId] = useState('');
  const [memo, setMemo] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (fundingSource !== 'expense' || !isOpen) return;
    setLoadingExpenses(true);
    setExpenseId('');
    getEmployeeAvailableExpenses(fundingEmployeeId).then(result => {
      setEmployeeExpenses((result as any).data || []);
      setLoadingExpenses(false);
    });
  }, [fundingSource, fundingEmployeeId, isOpen]);

  function selectExpense(exp: AvailableExpense) {
    setExpenseId(exp.id);
    setAmount(Math.min(exp.available, remaining));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (amount <= 0 || amount > remaining + 0.01) {
      alert(`المبلغ يجب أن يكون بين 0 و ${formatMoney(remaining)}`);
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set('payslip_id', payslipId);
      formData.set('run_id', runId);
      formData.set('amount', String(amount));
      formData.set('payment_date', paymentDate);
      formData.set('memo', memo);

      let result;
      if (fundingSource === 'bank') {
        if (!bankAccountId) { alert('يجب اختيار الحساب البنكي'); submittingRef.current = false; setLoading(false); return; }
        formData.set('bank_account_id', bankAccountId);
        result = await payPayslipFromBank(formData);
      } else {
        if (!expenseId) { alert('يجب اختيار المصروف الممول'); submittingRef.current = false; setLoading(false); return; }
        formData.set('funding_employee_id', fundingEmployeeId);
        formData.set('expense_id', expenseId);
        result = await payPayslipFromExpense(formData);
      }

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
            <h2 className="text-xl font-bold mb-1">دفع راتب — {employeeName}</h2>
            <p className="text-sm text-muted-foreground mb-4">المتبقي: <span className="font-bold text-primary">{formatMoney(remaining)}</span></p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">مصدر السداد</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setFundingSource('bank'); setAmount(remaining); }}
                    className={`flex-1 p-2 rounded border text-sm font-medium ${fundingSource === 'bank' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}
                  >
                    من الخزينة / حساب بنكي
                  </button>
                  <button
                    type="button"
                    onClick={() => { setFundingSource('expense'); setAmount(0); setBankAccountId(''); }}
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
                  <div>
                    <label className="block text-sm font-medium mb-1">المبلغ المدفوع</label>
                    <input
                      required type="number" step="0.01" min="0.01" max={remaining}
                      value={amount || ''}
                      onChange={e => setAmount(Math.min(parseFloat(e.target.value) || 0, remaining))}
                      className="w-full p-2 rounded border bg-background font-bold text-lg text-primary"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">الموظف صاحب المصروف الممول</label>
                    <select required value={fundingEmployeeId} onChange={e => setFundingEmployeeId(e.target.value)} className="w-full p-2 rounded border bg-background">
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                      ))}
                    </select>
                  </div>

                  {loadingExpenses ? (
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
                            <input type="radio" name="expense" checked={expenseId === exp.id} onChange={() => selectExpense(exp)} />
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
                  )}

                  {expenseId && (
                    <div>
                      <label className="block text-sm font-medium mb-1">المبلغ المستخدم من المصروف</label>
                      <input
                        required type="number" step="0.01" min="0.01"
                        max={Math.min(remaining, employeeExpenses.find(e => e.id === expenseId)?.available || 0)}
                        value={amount || ''}
                        onChange={e => setAmount(Math.min(parseFloat(e.target.value) || 0, remaining, employeeExpenses.find(x => x.id === expenseId)?.available || 0))}
                        className="w-full p-2 rounded border bg-background font-bold text-lg text-primary"
                      />
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">تاريخ الدفع</label>
                <input required type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="w-full p-2 rounded border bg-background" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea value={memo} onChange={e => setMemo(e.target.value)} className="w-full p-2 rounded border bg-background" rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>إلغاء</Button>
                <Button type="submit" disabled={loading || amount <= 0 || (fundingSource === 'bank' ? !bankAccountId : !expenseId)}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  تأكيد الدفع
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
      <Button size="sm" onClick={() => setIsOpen(true)}>دفع</Button>
      {dialog}
    </>
  );
}
