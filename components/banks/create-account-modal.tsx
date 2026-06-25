'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { createBankAccount } from '@/lib/actions/banks';

export function CreateAccountModal({ banks }: { banks: any[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function action(formData: FormData) {
    try {
      setLoading(true);
      await createBankAccount(formData);
      router.push('/banks');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => router.push('?modal=create-account')}>إضافة حساب</Button>
      
      <Modal name="create-account" title="إضافة حساب بنكي">
        <form action={action} className="space-y-4 mt-4">
          <div>
            <label className="text-sm font-medium">البنك</label>
            <select 
              name="bank_id" 
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
            >
              <option value="">اختر البنك...</option>
              {banks.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="text-sm font-medium">اسم الحساب</label>
            <input 
              name="account_name" 
              required 
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" 
              placeholder="مثال: حساب جاري الشركة"
            />
          </div>

          <div>
            <label className="text-sm font-medium">رقم الحساب</label>
            <input 
              name="account_number" 
              required 
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" 
              placeholder="123456789"
            />
          </div>

          <div>
            <label className="text-sm font-medium">الرصيد الافتتاحي</label>
            <input 
              name="opening_balance" 
              type="number"
              step="0.01"
              required 
              defaultValue={0}
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
