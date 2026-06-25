'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { addAdjustment } from '@/lib/actions/banks';

export function AdjustmentModal({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function action(formData: FormData) {
    try {
      setLoading(true);
      await addAdjustment(formData);
      router.push(`?`); // clear modal query param
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => router.push('?modal=adjustment')}>تسوية بنكية</Button>
      
      <Modal name="adjustment" title="إضافة تسوية بنكية">
        <form action={action} className="space-y-4 mt-4">
          <input type="hidden" name="bank_account_id" value={accountId} />
          
          <div>
            <label className="text-sm font-medium">النوع</label>
            <select 
              name="type" 
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
            >
              <option value="interest">فوائد إيجابية (+)</option>
              <option value="deduction">خصومات / مصروفات بنكية (-)</option>
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
            <label className="text-sm font-medium">البيان (ملاحظات)</label>
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
              {loading ? 'جاري الحفظ...' : 'تأكيد التسوية'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
