'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Loader2, Plus } from 'lucide-react';
import { createItem } from '@/lib/actions/inventory';
import { CategoryFields } from '@/components/inventory/category-fields';

interface Category { id: string; name: string; parent_id: string | null; }

export function ItemForm({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  const [mainCatId, setMainCatId] = useState('');
  const [subCatId, setSubCatId] = useState('');

  const subs = categories.filter(c => c.parent_id === mainCatId);
  const mains = categories.filter(c => !c.parent_id);

  // Items attach to the sub-category when one is chosen (or exists),
  // otherwise directly to the main category.
  const categoryId = subCatId || (subs.length === 0 ? mainCatId : '');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    try {
      const result = await createItem(formData);
      if (result.error) {
        alert(result.error);
      } else {
        (e.target as HTMLFormElement).reset();
        setMainCatId('');
        setSubCatId('');
        setOpen(false);
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={mains.length === 0}>
        <Plus className="w-4 h-4 ml-2" /> إضافة صنف
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="إضافة صنف جديد">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">اسم الصنف</label>
            <input required name="name" className="w-full p-2 rounded border bg-background" placeholder="مثال: أسمنت بورتلاندي" />
          </div>
          <CategoryFields
            categories={categories}
            mainCatId={mainCatId}
            subCatId={subCatId}
            onMainChange={id => { setMainCatId(id); setSubCatId(''); }}
            onSubChange={setSubCatId}
          />
          <input type="hidden" name="category_id" value={categoryId} />
          <div>
            <label className="block text-sm font-medium mb-1">الكود (اختياري)</label>
            <input name="code" className="w-full p-2 rounded border bg-background text-left" dir="ltr" placeholder="CEM-001" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الوحدة</label>
            <input required name="unit" className="w-full p-2 rounded border bg-background" placeholder="طن، كجم، حبة..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>إلغاء</Button>
            <Button type="submit" disabled={loading || !categoryId}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              حفظ الصنف
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
