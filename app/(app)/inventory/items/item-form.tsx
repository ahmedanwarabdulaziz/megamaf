'use client';

import { useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Loader2, FolderTree } from 'lucide-react';
import { createItem } from '@/lib/actions/inventory';

interface Category { id: string; name: string; parent_id: string | null; }

export function ItemForm({ categories }: { categories: Category[] }) {
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  const [mainCatId, setMainCatId] = useState('');
  const [subCatId, setSubCatId] = useState('');

  const mains = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const subs = useMemo(() => categories.filter(c => c.parent_id === mainCatId), [categories, mainCatId]);

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
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card p-4 rounded-lg border shadow-sm space-y-4">
      <h2 className="font-bold border-b pb-2">إضافة صنف جديد</h2>
      <div>
        <label className="block text-sm font-medium mb-1">اسم الصنف</label>
        <input required name="name" className="w-full p-2 rounded border bg-background" placeholder="مثال: أسمنت بورتلاندي" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">الفئة الرئيسية</label>
        <select
          required
          value={mainCatId}
          onChange={e => { setMainCatId(e.target.value); setSubCatId(''); }}
          className="w-full p-2 rounded border bg-background"
        >
          <option value="">اختر الفئة...</option>
          {mains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {mains.length === 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            لا توجد فئات بعد — <Link href="/inventory/categories" className="text-primary hover:underline">أضف الفئات أولاً</Link>
          </p>
        )}
      </div>
      {subs.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">الفئة الفرعية</label>
          <select
            required
            value={subCatId}
            onChange={e => setSubCatId(e.target.value)}
            className="w-full p-2 rounded border bg-background"
          >
            <option value="">اختر الفئة الفرعية...</option>
            {subs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <input type="hidden" name="category_id" value={categoryId} />
      <div>
        <label className="block text-sm font-medium mb-1">الكود (اختياري)</label>
        <input name="code" className="w-full p-2 rounded border bg-background text-left" dir="ltr" placeholder="CEM-001" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">الوحدة</label>
        <input required name="unit" className="w-full p-2 rounded border bg-background" placeholder="طن، كجم، حبة..." />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !categoryId}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        حفظ الصنف
      </Button>
      <Link href="/inventory/categories" className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
        <FolderTree className="w-3.5 h-3.5" /> إدارة الفئات
      </Link>
    </form>
  );
}
