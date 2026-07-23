'use client';

import { useState, useTransition } from 'react';
import { Pencil, Trash2, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updateItem, deleteItem } from '@/lib/actions/inventory';
import { CategoryFields } from '@/components/inventory/category-fields';

interface Category { id: string; name: string; parent_id: string | null; }
interface Item { id: string; name: string; code: string | null; unit: string; category_id: string | null; }

export function ItemRowActions({ item, categories }: { item: Item; categories: Category[] }) {
  const [isEditing, setIsEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);

  const initialCat = categories.find(c => c.id === item.category_id) || null;
  const [mainCatId, setMainCatId] = useState(initialCat?.parent_id || initialCat?.id || '');
  const [subCatId, setSubCatId] = useState(initialCat?.parent_id ? initialCat.id : '');

  const subs = categories.filter(c => c.parent_id === mainCatId);
  const categoryId = subCatId || (subs.length === 0 ? mainCatId : '');

  function openEdit() {
    setMainCatId(initialCat?.parent_id || initialCat?.id || '');
    setSubCatId(initialCat?.parent_id ? initialCat.id : '');
    setIsEditing(true);
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateItem(formData);
      if (result.error) alert(result.error);
      else setIsEditing(false);
    });
  }

  function handleDelete() {
    if (!confirm(`هل تريد حذف الصنف «${item.name}»؟`)) return;
    setDeleting(true);
    const fd = new FormData();
    fd.set('id', item.id);
    startTransition(async () => {
      const result = await deleteItem(fd);
      setDeleting(false);
      if (result.error) alert(result.error);
    });
  }

  return (
    <>
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          title="تعديل"
          onClick={openEdit}
          className="text-muted-foreground hover:text-primary p-1.5 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="حذف"
          onClick={handleDelete}
          disabled={deleting}
          className="text-muted-foreground hover:text-destructive p-1.5 transition-colors disabled:opacity-40"
        >
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isEditing && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center pb-16 sm:pb-0">
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setIsEditing(false)} />
          <div className="relative z-[70] w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-xl border-t-4 sm:border-2 border-primary shadow-2xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between bg-primary text-primary-foreground p-4 sm:px-6 shrink-0">
              <h2 className="text-lg font-semibold">تعديل الصنف</h2>
              <button onClick={() => setIsEditing(false)} className="rounded-full p-2 hover:bg-primary-foreground/20 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <input type="hidden" name="id" value={item.id} />
              <div>
                <label className="block text-sm font-medium mb-1">اسم الصنف</label>
                <input required name="name" defaultValue={item.name} className="w-full p-2 rounded border bg-background" />
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
                <input name="code" defaultValue={item.code || ''} className="w-full p-2 rounded border bg-background text-left" dir="ltr" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الوحدة</label>
                <input required name="unit" defaultValue={item.unit} className="w-full p-2 rounded border bg-background" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)} disabled={pending}>الغاء</Button>
                <Button type="submit" disabled={pending || !categoryId}>
                  {pending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  حفظ التعديلات
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
