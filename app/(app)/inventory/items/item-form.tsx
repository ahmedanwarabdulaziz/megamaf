'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { createItem } from '@/lib/actions/inventory';

export function ItemForm() {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const result = await createItem(formData);
    
    if (result.error) {
      alert(result.error);
    } else {
      (e.target as HTMLFormElement).reset();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card p-4 rounded-lg border shadow-sm space-y-4">
      <h2 className="font-bold border-b pb-2">إضافة صنف جديد</h2>
      <div>
        <label className="block text-sm font-medium mb-1">اسم الصنف</label>
        <input required name="name" className="w-full p-2 rounded border bg-background" placeholder="مثال: أسمنت بورتلاندي" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">الكود (اختياري)</label>
        <input name="code" className="w-full p-2 rounded border bg-background text-left" dir="ltr" placeholder="CEM-001" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">الوحدة</label>
        <input required name="unit" className="w-full p-2 rounded border bg-background" placeholder="طن، كجم، حبة..." />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        حفظ الصنف
      </Button>
    </form>
  );
}
