'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { createBank } from '@/lib/actions/banks';
import { useSearchParams } from 'next/navigation';

export function CreateBankModal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);

  async function action(formData: FormData) {
    try {
      setLoading(true);
      await createBank(formData);
      router.push('/banks'); // Remove modal from URL
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => router.push('?modal=create-bank')}>إضافة بنك</Button>
      
      <Modal name="create-bank" title="إضافة بنك جديد">
        <form action={action} className="space-y-4 mt-4">
          <div>
            <label className="text-sm font-medium">اسم البنك</label>
            <input 
              name="name" 
              required 
              minLength={2}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1" 
              placeholder="مثال: البنك الأهلي المصري"
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
