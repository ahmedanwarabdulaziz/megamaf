'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { updateBankAccountOpeningBalance } from '@/lib/actions/banks';
import { Pencil } from 'lucide-react';

export function EditOpeningBalanceModal({ 
  bankAccountId, 
  initialBalance 
}: { 
  bankAccountId: string;
  initialBalance: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const modalName = `edit-balance-${bankAccountId}`;

  async function action(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setLoading(true);
      await updateBankAccountOpeningBalance(formData);
      router.push('/banks');
      router.refresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <>
      <button 
        onClick={() => router.push(`?modal=${modalName}`)}
        className="text-muted-foreground hover:text-primary transition-colors p-1"
        title="تعديل الرصيد الافتتاحي"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      
      <Modal name={modalName} title="تعديل الرصيد الافتتاحي">
        <form action={action} className="space-y-4 mt-4">
          <input type="hidden" name="bank_account_id" value={bankAccountId} />
          
          <div>
            <label className="text-sm font-medium">الرصيد الافتتاحي</label>
            <input 
              name="opening_balance" 
              type="number"
              step="0.01"
              required 
              defaultValue={initialBalance}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" 
            />
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => router.push('/banks')}>
              إلغاء
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
