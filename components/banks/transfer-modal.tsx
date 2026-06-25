'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { createTransfer } from '@/lib/actions/banks';
import { formatMoney } from '@/lib/money';

export function TransferModal({ banks, currentAccountId }: { banks: any[], currentAccountId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Flatten accounts for easy selection
  const accounts = banks.flatMap(b => 
    (b.accounts || []).map((a: any) => ({
      ...a,
      displayName: `${b.name} - ${a.account_name} (${a.account_number}) — رصيد: ${formatMoney(a.current_balance)}`
    }))
  ).filter((a: any) => a.bank_account_id !== currentAccountId); // exclude current account

  async function action(formData: FormData) {
    try {
      setLoading(true);
      await createTransfer(formData);
      router.push(`?`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => router.push('?modal=transfer')}>تحويل صادر</Button>
      
      <Modal name="transfer" title="تحويل بنكي صادر">
        <form action={action} className="space-y-4 mt-4">
          <input type="hidden" name="from_account_id" value={currentAccountId} />
          
          <div>
            <label className="text-sm font-medium">إلى حساب</label>
            <select 
              name="to_account_id" 
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
            >
              <option value="">اختر الحساب المحول إليه...</option>
              {accounts.map((acc: any) => (
                <option key={acc.bank_account_id} value={acc.bank_account_id}>
                  {acc.displayName}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="text-sm font-medium">المبلغ</label>
            <input 
              name="amount" 
              type="number"
              step="0.01"
              min="0.01"
              required 
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" 
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="text-sm font-medium">التاريخ</label>
            <input 
              name="date" 
              type="date"
              required 
              defaultValue={new Date().toISOString().split('T')[0]}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" 
            />
          </div>

          <div>
            <label className="text-sm font-medium">البيان (سبب التحويل)</label>
            <input 
              name="memo" 
              required 
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" 
            />
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => router.push('?')}>
              إلغاء
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'جاري التحويل...' : 'تأكيد التحويل'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
