'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { collectDepositPayout } from '@/lib/actions/deposits';
import { formatMoney } from '@/lib/money';

export function CollectModal({ payout, bankAccounts, defaultBankAccountId }: { payout: any, bankAccounts: any[], defaultBankAccountId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.append('payout_id', payout.id);
    try {
      const result = await collectDepositPayout(formData);
      if (result.error) {
        alert(result.error);
      } else {
        setIsOpen(false);
      }
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const dialog = isOpen && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">تحصيل استحقاق #{payout.seq}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">

              <div>
                <label className="block text-sm font-medium mb-1">المبلغ المحصل فعلياً (ج.م)</label>
                <input required type="number" step="0.01" name="actual_amount" defaultValue={payout.expected_amount} className="w-full p-2 rounded border bg-background text-lg font-bold text-primary" />
                <p className="text-xs text-muted-foreground mt-1">المبلغ المتوقع كان {payout.expected_amount} ج.م</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">تاريخ التحصيل وإيداع البنك</label>
                <input required type="date" name="collected_date" autoComplete="off" defaultValue={new Date().toISOString().split('T')[0]} className="w-full p-2 rounded border bg-background" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">الحساب البنكي</label>
                <select required name="bank_account_id" defaultValue={defaultBankAccountId || ''} className="w-full p-2 rounded border bg-background">
                  <option value="">-- اختر الحساب البنكي للإيداع --</option>
                  {bankAccounts.map((b: any) => (
                    <option key={b.bank_account_id} value={b.bank_account_id}>
                      {b.bank_name} - {b.account_name} ({formatMoney(b.current_balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات التحصيل (تظهر في كشف الحساب)</label>
                <textarea name="notes" className="w-full p-2 rounded border bg-background" rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={loading}>إلغاء</Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  تأكيد التحصيل والإيداع
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
      <Button size="sm" onClick={() => setIsOpen(true)}>تحصيل</Button>
      {dialog}
    </>
  );
}
