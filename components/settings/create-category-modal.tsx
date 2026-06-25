'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { createExpenseCategory } from '@/lib/actions/categories';

export function CreateCategoryModal({ categories }: { categories: any[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!open) return <Button onClick={() => setOpen(true)}>إضافة تصنيف</Button>;

  async function action(formData: FormData) {
    try {
      setLoading(true);
      await createExpenseCategory(formData);
      setOpen(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50 p-4">
      <div className="bg-card w-full max-w-md p-6 rounded-xl border shadow-lg relative">
        <h2 className="text-xl font-bold mb-4">إضافة تصنيف جديد</h2>
        <form action={action} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">الاسم</label>
            <input name="name" type="text" required className="w-full p-2 rounded-md border bg-background" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">التصنيف الرئيسي (اختياري)</label>
            <select name="parent_id" className="w-full p-2 rounded-md border bg-background">
              <option value="">-- تصنيف رئيسي --</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading} className="w-full">
              إلغاء
            </Button>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
